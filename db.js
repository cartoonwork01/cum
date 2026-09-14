const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'bpms.db');
const db = new DatabaseSync(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_code TEXT UNIQUE NOT NULL,
    billed_to TEXT NOT NULL,
    bill_description TEXT NOT NULL,
    ministry TEXT NOT NULL,
    service TEXT NOT NULL,
    bill_date TEXT NOT NULL,
    bill_number TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Paid',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed initial authentic record if database is empty
const countStmt = db.prepare('SELECT COUNT(*) as count FROM bills');
const row = countStmt.get();
if (!row || row.count === 0) {
  const insertSeed = db.prepare(`
    INSERT INTO bills (payment_code, billed_to, bill_description, ministry, service, bill_date, bill_number, amount, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSeed.run(
    '0094000056959',
    'MR ADEYEMI ADEMOLA',
    'MINIMUM TAX',
    'Internal Revenue Service IRS',
    'Minimum Tax',
    '7th April, 2026',
    '13388027',
    10100.00,
    'Paid'
  );
  insertSeed.run(
    '0094000056960',
    'MRS FOLASHADE BALOGUN',
    'LAND USE CHARGE',
    'Ministry of Finance',
    'Land Use & Building Assessment',
    '10th April, 2026',
    '13388028',
    35500.00,
    'Paid'
  );
  insertSeed.run(
    '0094000056961',
    'OLAWALE ENTERPRISES LTD',
    'BUSINESS PREMISES PERMIT',
    'Ministry of Commerce & Industry',
    'Business Registration',
    '12th April, 2026',
    '13388029',
    50000.00,
    'Pending'
  );
  console.log('Database seeded with initial sample bills.');
}

function normalizeCode(code) {
  if (!code) return '';
  return code.toString().trim().replace(/^#+/, '');
}

function getAllBills() {
  const stmt = db.prepare('SELECT * FROM bills ORDER BY id DESC');
  return stmt.all();
}

function getBillByCode(code) {
  const cleanCode = normalizeCode(code);
  const stmt = db.prepare('SELECT * FROM bills WHERE payment_code = ? OR payment_code = ?');
  return stmt.get(cleanCode, '#' + cleanCode) || null;
}

function getBillById(id) {
  const stmt = db.prepare('SELECT * FROM bills WHERE id = ?');
  return stmt.get(Number(id)) || null;
}

function createBill(data) {
  const payment_code = normalizeCode(data.payment_code);
  const bill_number = data.bill_number ? data.bill_number.toString().trim().replace(/^#+/, '') : Math.floor(10000000 + Math.random() * 90000000).toString();
  const amount = parseFloat(data.amount) || 0;
  const status = data.status || 'Paid';

  const stmt = db.prepare(`
    INSERT INTO bills (payment_code, billed_to, bill_description, ministry, service, bill_date, bill_number, amount, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    payment_code,
    data.billed_to.trim(),
    data.bill_description.trim(),
    data.ministry ? data.ministry.trim() : 'Internal Revenue Service IRS',
    data.service ? data.service.trim() : data.bill_description.trim(),
    data.bill_date ? data.bill_date.trim() : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    bill_number,
    amount,
    status
  );

  return getBillById(result.lastInsertRowid);
}

function updateBill(id, data) {
  const existing = getBillById(id);
  if (!existing) return null;

  const payment_code = data.payment_code ? normalizeCode(data.payment_code) : existing.payment_code;
  const billed_to = data.billed_to ? data.billed_to.trim() : existing.billed_to;
  const bill_description = data.bill_description ? data.bill_description.trim() : existing.bill_description;
  const ministry = data.ministry ? data.ministry.trim() : existing.ministry;
  const service = data.service ? data.service.trim() : existing.service;
  const bill_date = data.bill_date ? data.bill_date.trim() : existing.bill_date;
  const bill_number = data.bill_number ? data.bill_number.toString().trim().replace(/^#+/, '') : existing.bill_number;
  const amount = data.amount !== undefined ? parseFloat(data.amount) : existing.amount;
  const status = data.status !== undefined ? data.status : existing.status;

  const stmt = db.prepare(`
    UPDATE bills
    SET payment_code = ?, billed_to = ?, bill_description = ?, ministry = ?, service = ?, bill_date = ?, bill_number = ?, amount = ?, status = ?
    WHERE id = ?
  `);

  stmt.run(
    payment_code,
    billed_to,
    bill_description,
    ministry,
    service,
    bill_date,
    bill_number,
    amount,
    status,
    Number(id)
  );

  return getBillById(id);
}

function deleteBill(id) {
  const stmt = db.prepare('DELETE FROM bills WHERE id = ?');
  stmt.run(Number(id));
  return true;
}

function getStats() {
  const totalBills = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount FROM bills').get();
  const paidBills = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as paid_amount FROM bills WHERE status = 'Paid'").get();
  const pendingBills = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as pending_amount FROM bills WHERE status != 'Paid'").get();

  return {
    totalCount: totalBills.count,
    totalAmount: totalBills.total_amount,
    paidCount: paidBills.count,
    paidAmount: paidBills.paid_amount,
    pendingCount: pendingBills.count,
    pendingAmount: pendingBills.pending_amount
  };
}

module.exports = {
  db,
  getAllBills,
  getBillByCode,
  getBillById,
  createBill,
  updateBill,
  deleteBill,
  getStats,
  normalizeCode
};
