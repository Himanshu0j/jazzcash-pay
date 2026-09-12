const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const DB = require('../db');

// Setup multer for QR code uploads
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'qr-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Admin Stats
router.get('/stats', (req, res) => {
  try {
    const stats = DB.getStats();
    res.json({ code: '000000', data: stats });
  } catch (error) {
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// Admin Orders list
router.get('/orders', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const orders = DB.getOrders(limit, offset);
    res.json({ code: '000000', data: orders });
  } catch (error) {
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// Update Order Status (Manual Approve / Reject)
router.post('/order/status', (req, res) => {
  try {
    const { orderNo, status, note } = req.body;
    if (!orderNo || !status) {
      return res.status(400).json({ code: 'MISSING_DATA', message: 'orderNo and status are required' });
    }

    const order = DB.getOrderByNo(orderNo);
    if (!order) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    const updated = DB.updateOrderStatus(orderNo, status, note || `Status manually changed to ${status} by Admin`);
    DB.addLog(orderNo, order.mobile, 'STATUS_MANUAL_CHANGE', status === 'SUCCESS' ? 'SUCCESS' : 'WARNING', {
      previousStatus: order.status,
      newStatus: status,
      adminNote: note
    });

    res.json({ code: '000000', message: 'Order status updated', data: updated });
  } catch (error) {
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// Get Settings
router.get('/settings', (req, res) => {
  try {
    const settings = DB.getAllSettings();
    res.json({ code: '000000', data: settings });
  } catch (error) {
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// Update Settings
router.post('/settings', (req, res) => {
  try {
    const updated = DB.updateSettings(req.body);
    DB.addLog(null, null, 'SETTINGS_UPDATED', 'INFO', { updatedKeys: Object.keys(req.body) });
    res.json({ code: '000000', message: 'Settings saved successfully', data: updated });
  } catch (error) {
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// Upload QR Code Image
router.post('/upload-qr', upload.single('qrImage'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 'NO_FILE', message: 'No image uploaded' });
    }

    const channel = req.body.channel; // 'jazzcash' or 'easypaisa'
    const fileUrl = '/uploads/' + req.file.filename;

    if (channel === 'jazzcash') {
      DB.updateSettings({ jazzcash_qr_url: fileUrl });
    } else if (channel === 'easypaisa') {
      DB.updateSettings({ easypaisa_qr_url: fileUrl });
    }

    DB.addLog(null, null, 'QR_UPLOADED', 'INFO', { channel, fileUrl });
    res.json({ code: '000000', message: 'QR Code uploaded successfully', data: { fileUrl, channel } });
  } catch (error) {
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

// Get System & Error Logs with Category Filter
router.get('/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '150', 10);
    const category = req.query.category || null;
    const logs = DB.getLogs(category, limit);
    res.json({ code: '000000', data: logs });
  } catch (error) {
    res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

module.exports = router;
