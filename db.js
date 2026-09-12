const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'payments.db');
const db = new DatabaseSync(dbPath);

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    order_mark TEXT,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'PKR',
    pay_product_code TEXT NOT NULL,
    mobile TEXT,
    status TEXT DEFAULT 'PENDING',
    response_message TEXT,
    raw_response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT,
    mobile TEXT,
    category TEXT DEFAULT 'SYSTEM',
    action TEXT,
    status TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Ensure category column exists in logs
try {
  db.exec("ALTER TABLE logs ADD COLUMN category TEXT DEFAULT 'SYSTEM'");
} catch (e) {
  // column already exists
}

// Seed Default Settings
const defaultSettings = {
  jazzcash_account: '03001234567',
  jazzcash_title: 'JazzCash Merchant Store',
  jazzcash_till_id: '00291823',
  jazzcash_qr_url: '',
  easypaisa_account: '03451234567',
  easypaisa_title: 'EasyPaisa Merchant Store',
  easypaisa_till_id: '00982312',
  easypaisa_qr_url: '',
  active_mode: 'dynamic_qr', // 'dynamic_qr' | 'intent' | 'manual'
  aggregator_api_url: '',
  aggregator_api_key: '',
  auto_approve_seconds: '12', // Auto-verifies dynamic QR transaction in 12s
  preset_amounts: '100,300,500,1000,2000,5000',
  admin_pin: '1234'
};

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

for (const [key, value] of Object.entries(defaultSettings)) {
  const existing = getSettingStmt.get(key);
  if (!existing) {
    setSettingStmt.run(key, value);
  }
}

const DB = {
  // Orders
  createOrder({ order_no, order_mark, amount, currency = 'PKR', pay_product_code }) {
    const stmt = db.prepare(`
      INSERT INTO orders (order_no, order_mark, amount, currency, pay_product_code, status)
      VALUES (?, ?, ?, ?, ?, 'PENDING')
    `);
    stmt.run(order_no, order_mark, amount, currency, pay_product_code);
    return this.getOrderByNo(order_no);
  },

  getOrderByNo(order_no) {
    const stmt = db.prepare('SELECT * FROM orders WHERE order_no = ?');
    return stmt.get(order_no);
  },

  getOrders(limit = 100, offset = 0) {
    const stmt = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ? OFFSET ?');
    return stmt.all(limit, offset);
  },

  updateOrderSubmission(order_no, { mobile, status, response_message, raw_response }) {
    const stmt = db.prepare(`
      UPDATE orders
      SET mobile = ?, status = ?, response_message = ?, raw_response = ?, updated_at = CURRENT_TIMESTAMP
      WHERE order_no = ?
    `);
    stmt.run(mobile, status, response_message, raw_response ? JSON.stringify(raw_response) : null, order_no);
    return this.getOrderByNo(order_no);
  },

  updateOrderStatus(order_no, status, response_message = null) {
    const stmt = db.prepare(`
      UPDATE orders
      SET status = ?, response_message = COALESCE(?, response_message), updated_at = CURRENT_TIMESTAMP
      WHERE order_no = ?
    `);
    stmt.run(status, response_message, order_no);
    return this.getOrderByNo(order_no);
  },

  getStats() {
    const totalOrders = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM orders').get();
    const successOrders = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM orders WHERE status = 'SUCCESS'").get();
    const pendingOrders = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM orders WHERE status IN ('PENDING', 'PROCESSING')").get();
    const failedOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status IN ('FAILED', 'REJECTED')").get();

    return {
      totalCount: totalOrders.count,
      totalVolume: totalOrders.total,
      successCount: successOrders.count,
      successVolume: successOrders.total,
      pendingCount: pendingOrders.count,
      pendingVolume: pendingOrders.total,
      failedCount: failedOrders.count
    };
  },

  // Settings
  getAllSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    return settings;
  },

  getSetting(key) {
    const row = getSettingStmt.get(key);
    return row ? row.value : null;
  },

  updateSettings(obj) {
    for (const [key, value] of Object.entries(obj)) {
      setSettingStmt.run(key, String(value));
    }
    return this.getAllSettings();
  },

  // Logs with categorized filtering
  addLog(order_no, mobile, action, status, details, category = 'SYSTEM') {
    const stmt = db.prepare(`
      INSERT INTO logs (order_no, mobile, category, action, status, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const detailsStr = typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details || '');
    stmt.run(order_no || null, mobile || null, category, action, status, detailsStr);
  },

  getLogs(category = null, limit = 150) {
    if (category && category !== 'ALL') {
      const stmt = db.prepare('SELECT * FROM logs WHERE category = ? ORDER BY id DESC LIMIT ?');
      return stmt.all(category, limit);
    }
    const stmt = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?');
    return stmt.all(limit);
  },

  expireOldPendingOrders(timeoutSeconds = 120) {
    const stmt = db.prepare(`
      UPDATE orders
      SET status = 'FAILED', response_message = 'Payment expired / Timeout'
      WHERE status IN ('PENDING', 'PROCESSING')
      AND (strftime('%s', 'now') - strftime('%s', created_at)) > ?
    `);
    return stmt.run(timeoutSeconds);
  }
};

module.exports = DB;
