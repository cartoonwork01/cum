/**
 * Ogun State BPMS - Client Data Layer
 * Supports:
 * 1. Free Cloud Database (Supabase PostgreSQL via REST / JS Client)
 * 2. Automatic LocalStorage Fallback (works immediately offline / on static hosting)
 */

const SUPABASE_CONFIG = {
  // To connect free Supabase cloud DB:
  // 1. Create a free project at https://supabase.com
  // 2. Run schema.sql in Supabase SQL Editor
  // 3. Paste your Project URL and Anon Public Key below:
  url: '',      // e.g. 'https://xyzcompany.supabase.co'
  anonKey: ''  // e.g. 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};

const DEFAULT_SEEDS = [
  {
    id: 4,
    payment_code: "0094000099999",
    billed_to: "CHIEF TUNDE BAKARE",
    bill_description: "DEVELOPMENT LEVY & INFRASTRUCTURE",
    ministry: "Internal Revenue Service IRS",
    service: "Development Levy",
    bill_date: "12th September, 2026",
    bill_number: "48435552",
    amount: 75000,
    status: "Paid",
    created_at: "2026-09-12 20:18:48"
  },
  {
    id: 3,
    payment_code: "0094000056961",
    billed_to: "OLAWALE ENTERPRISES LTD",
    bill_description: "BUSINESS PREMISES PERMIT",
    ministry: "Ministry of Commerce & Industry",
    service: "Business Registration",
    bill_date: "12th April, 2026",
    bill_number: "13388029",
    amount: 50000,
    status: "Pending",
    created_at: "2026-09-12 20:13:34"
  },
  {
    id: 2,
    payment_code: "0094000056960",
    billed_to: "MRS FOLASHADE BALOGUN",
    bill_description: "LAND USE CHARGE",
    ministry: "Ministry of Finance",
    service: "Land Use & Building Assessment",
    bill_date: "10th April, 2026",
    bill_number: "13388028",
    amount: 35500,
    status: "Paid",
    created_at: "2026-09-12 20:13:34"
  },
  {
    id: 1,
    payment_code: "0094000056959",
    billed_to: "MR ADEYEMI ADEMOLA",
    bill_description: "MINIMUM TAX",
    ministry: "Internal Revenue Service IRS",
    service: "Minimum Tax",
    bill_date: "7th April, 2026",
    bill_number: "13388027",
    amount: 10100,
    status: "Paid",
    created_at: "2026-09-12 20:13:34"
  }
];

const STORAGE_KEY = 'ogun_bpms_bills_db';

class BPMSDataService {
  constructor() {
    this.supabaseClient = null;
    this.isCloudEnabled = false;

    if (SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey && window.supabase) {
      try {
        this.supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
        this.isCloudEnabled = true;
      } catch (err) {
        console.warn('Supabase initialization failed, falling back to local database:', err);
      }
    }

    this._initLocalStorage();
  }

  _initLocalStorage() {
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SEEDS));
    }
  }

  _getLocalBills() {
    this._initLocalStorage();
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return DEFAULT_SEEDS;
    }
  }

  _saveLocalBills(bills) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bills));
  }

  normalizeCode(code) {
    if (!code) return '';
    return code.toString().trim().replace(/^#+/, '');
  }

  async getAllBills() {
    if (this.isCloudEnabled) {
      try {
        const { data, error } = await this.supabaseClient
          .from('bills')
          .select('*')
          .order('id', { ascending: false });
        if (!error && data) return data;
      } catch (e) {
        console.warn('Cloud fetch failed, using local storage fallback:', e);
      }
    }
    return this._getLocalBills();
  }

  async getBillByCode(code) {
    const cleanCode = this.normalizeCode(code);
    if (!cleanCode) return null;

    if (this.isCloudEnabled) {
      try {
        const { data, error } = await this.supabaseClient
          .from('bills')
          .select('*')
          .or(`payment_code.eq.${cleanCode},payment_code.eq.#${cleanCode}`)
          .maybeSingle();
        if (!error && data) return data;
      } catch (e) {
        console.warn('Cloud getBillByCode failed, using local storage fallback:', e);
      }
    }

    const bills = this._getLocalBills();
    return bills.find(b => this.normalizeCode(b.payment_code) === cleanCode) || null;
  }

  async createBill(data) {
    const cleanCode = this.normalizeCode(data.payment_code);
    const billNumber = data.bill_number ? this.normalizeCode(data.bill_number) : Math.floor(10000000 + Math.random() * 90000000).toString();
    const amount = parseFloat(data.amount) || 0;
    const billDate = data.bill_date ? data.bill_date.trim() : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const newRecord = {
      payment_code: cleanCode,
      billed_to: (data.billed_to || '').trim(),
      bill_description: (data.bill_description || '').trim(),
      ministry: (data.ministry || 'Internal Revenue Service IRS').trim(),
      service: (data.service || data.bill_description || '').trim(),
      bill_date: billDate,
      bill_number: billNumber,
      amount: amount,
      status: data.status || 'Paid'
    };

    if (this.isCloudEnabled) {
      try {
        const { data: inserted, error } = await this.supabaseClient
          .from('bills')
          .insert([newRecord])
          .select()
          .single();
        if (!error && inserted) return inserted;
        if (error) throw new Error(error.message);
      } catch (e) {
        console.warn('Cloud insert failed, saving to local storage:', e);
      }
    }

    // Local storage persistence
    const bills = this._getLocalBills();
    const existing = bills.find(b => this.normalizeCode(b.payment_code) === cleanCode);
    if (existing) {
      throw new Error(`Payment code #${cleanCode} already exists in database.`);
    }

    const nextId = bills.length > 0 ? Math.max(...bills.map(b => Number(b.id) || 0)) + 1 : 1;
    const createdLocal = {
      ...newRecord,
      id: nextId,
      created_at: new Date().toISOString()
    };
    bills.unshift(createdLocal);
    this._saveLocalBills(bills);
    return createdLocal;
  }

  async updateBill(id, data) {
    const numericId = Number(id);
    const cleanCode = data.payment_code ? this.normalizeCode(data.payment_code) : undefined;
    const billNumber = data.bill_number !== undefined ? this.normalizeCode(data.bill_number) : undefined;
    const amount = data.amount !== undefined ? parseFloat(data.amount) : undefined;

    const updates = {};
    if (cleanCode !== undefined) updates.payment_code = cleanCode;
    if (data.billed_to !== undefined) updates.billed_to = data.billed_to.trim();
    if (data.bill_description !== undefined) updates.bill_description = data.bill_description.trim();
    if (data.ministry !== undefined) updates.ministry = data.ministry.trim();
    if (data.service !== undefined) updates.service = data.service.trim();
    if (data.bill_date !== undefined) updates.bill_date = data.bill_date.trim();
    if (billNumber !== undefined) updates.bill_number = billNumber;
    if (amount !== undefined) updates.amount = amount;
    if (data.status !== undefined) updates.status = data.status;

    if (this.isCloudEnabled) {
      try {
        const { data: updated, error } = await this.supabaseClient
          .from('bills')
          .update(updates)
          .eq('id', numericId)
          .select()
          .single();
        if (!error && updated) return updated;
      } catch (e) {
        console.warn('Cloud update failed, updating local storage:', e);
      }
    }

    const bills = this._getLocalBills();
    const index = bills.findIndex(b => Number(b.id) === numericId);
    if (index === -1) throw new Error('Bill record not found');

    bills[index] = { ...bills[index], ...updates };
    this._saveLocalBills(bills);
    return bills[index];
  }

  async deleteBill(id) {
    const numericId = Number(id);
    if (this.isCloudEnabled) {
      try {
        const { error } = await this.supabaseClient
          .from('bills')
          .delete()
          .eq('id', numericId);
        if (!error) return true;
      } catch (e) {
        console.warn('Cloud delete failed, removing from local storage:', e);
      }
    }

    const bills = this._getLocalBills();
    const filtered = bills.filter(b => Number(b.id) !== numericId);
    this._saveLocalBills(filtered);
    return true;
  }

  async getStats() {
    const bills = await this.getAllBills();
    let totalAmount = 0;
    let paidCount = 0;
    let paidAmount = 0;
    let pendingCount = 0;
    let pendingAmount = 0;

    bills.forEach(b => {
      const amt = parseFloat(b.amount) || 0;
      totalAmount += amt;
      const isPaid = (b.status || '').toLowerCase() === 'paid';
      if (isPaid) {
        paidCount++;
        paidAmount += amt;
      } else {
        pendingCount++;
        pendingAmount += amt;
      }
    });

    return {
      totalCount: bills.length,
      totalAmount,
      paidCount,
      paidAmount,
      pendingCount,
      pendingAmount
    };
  }
}

// Global instance
window.BPMS = new BPMSDataService();
