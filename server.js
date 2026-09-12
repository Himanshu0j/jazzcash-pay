const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const DB = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure upload directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Mount API routes
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);

// Friendly route aliases matching reference Paygrid / Lucky-Bazar
app.get('/next', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// Fallback to home (Express 5 compatible)
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  DB.addLog(null, null, 'SERVER_EXCEPTION', 'ERROR', { message: err.message, stack: err.stack });
  res.status(500).json({ code: 'SERVER_ERROR', message: err.message });
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 JazzCash & EasyPaisa Payment Gateway is RUNNING`);
  console.log(`💳 Cashier UI: http://localhost:${PORT}/next`);
  console.log(`⚙️  Admin Panel: http://localhost:${PORT}/admin`);
  console.log(`====================================================`);
});
