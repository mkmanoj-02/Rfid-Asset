const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ── CORS — only allow configured origins ──────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin "${origin}" not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-username', 'x-user-id'],
}));
app.use(express.json());

// Attach username from header to req for audit logging
app.use((req, res, next) => {
  req.auditUser = req.headers['x-username'] || 'system';
  req.auditUserId = req.headers['x-user-id'] || null;
  next();
});

app.use('/api/locations', require('./routes/locations'));
app.use('/api/asset-types', require('./routes/assetTypes'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/movements', require('./routes/movements'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/rfid', require('./routes/rfid'));
app.use('/api/import', require('./routes/import'));
app.use('/api/users', require('./routes/users'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/rules', require('./routes/rules'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/audit-logs', require('./routes/auditLogs'));
app.use('/api/location-types', require('./routes/locationTypes'));
app.use('/api/tag-types', require('./routes/tagTypes'));
app.use('/api/vendors',  require('./routes/vendors'));

const { startRuleEngine } = require('./ruleEngine');
startRuleEngine();

// ── Global error handler — catches any unhandled error from routes ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);

  // MySQL duplicate entry
  if (err.code === 'ER_DUP_ENTRY') {
    const field = err.sqlMessage && err.sqlMessage.includes('rfid_tag') ? 'RFID tag' :
                  err.sqlMessage && err.sqlMessage.includes('asset_serial') ? 'Asset serial' : 'A field';
    return res.status(409).json({ message: `${field} already exists. Please use a unique value.` });
  }

  res.status(500).json({ message: 'An unexpected error occurred. Please try again.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
