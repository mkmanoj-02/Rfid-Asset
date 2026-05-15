const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const verifyToken = require('./middleware/verifyToken');


const app = express();

const routeMethods = ['all', 'get', 'post', 'put', 'patch', 'delete'];

function wrapHandler(handler) {
  if (Array.isArray(handler)) return handler.map(wrapHandler);
  if (typeof handler !== 'function' || handler.length === 4) return handler;
  return function asyncErrorBoundary(req, res, next) {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

function wrapAsyncHandlers(target) {
  for (const method of routeMethods) {
    const original = target[method];
    target[method] = function patchedRouteMethod(...args) {
      return original.call(this, ...args.map(wrapHandler));
    };
  }
}

const createRouter = express.Router;
express.Router = function patchedRouter(...args) {
  const router = createRouter.apply(this, args);
  wrapAsyncHandlers(router);
  return router;
};

wrapAsyncHandlers(app);

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

// Optional JWT: sets req.user when Bearer token is valid (backward-compatible with x-user-id)
const optionalVerifyToken = require('./middleware/optionalVerifyToken');
app.use(optionalVerifyToken);

// Audit context: prefer JWT user, fall back to legacy headers
app.use((req, res, next) => {
  req.auditUser = req.user?.username || req.headers['x-username'] || 'system';
  req.auditUserId = req.user?.id || req.headers['x-user-id'] || null;
  next();
});
app.use('/api/auth', require('./routes/auth'));

app.use(verifyToken); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/asset-types', require('./routes/assetTypes'));
app.use('/api/attribute-list', require('./routes/attributeList'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/movements', require('./routes/movements'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/rfid', require('./routes/rfid'));
app.use('/api/import', require('./routes/import'));
app.use('/api/users', require('./routes/users'));
app.use('/api/rules', require('./routes/rules'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/audit-logs', require('./routes/auditLogs'));
app.use('/api/location-types', require('./routes/locationTypes'));
app.use('/api/tag-types', require('./routes/tagTypes'));
app.use('/api/vendors',  require('./routes/vendors'));
app.use('/api/depreciation', require('./routes/depreciation'));

const { startRuleEngine } = require('./ruleEngine');
startRuleEngine();

// ── 404 handler — must come before the error handler ──
app.use((req, res, next) => {
  res.status(404).json({ status: false, message: `Endpoint not found: ${req.method} ${req.originalUrl}` });
});

// ── Global error handler — catches any unhandled error from routes ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);

  if (res.headersSent) return next(err);

  // MySQL duplicate entry
  if (err.code === 'ER_DUP_ENTRY') {
    const field = err.sqlMessage && err.sqlMessage.includes('rfid_tag') ? 'RFID tag' :
                  err.sqlMessage && err.sqlMessage.includes('asset_serial') ? 'Asset serial' : 'A field';
    return res.status(409).json({ message: `${field} already exists. Please use a unique value.` });
  }

  if (err.code === 'ER_BAD_NULL_ERROR') {
    const field = err.sqlMessage?.match(/Column '([^']+)' cannot be null/)?.[1] || 'Required field';
    return res.status(400).json({ message: `${field} is required.` });
  }

  if (err.code?.startsWith('ER_')) {
    return res.status(400).json({ message: err.sqlMessage || 'Database request failed.' });
  }

  res.status(err.status || 500).json({ message: err.message || 'An unexpected error occurred. Please try again.' });
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err?.message || err);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
