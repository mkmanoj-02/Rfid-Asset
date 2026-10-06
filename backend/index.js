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

app.use(express.json({ limit: '10mb' }));

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

const siteBrandingRoutes = require('./routes/siteBranding');
app.get('/api/site-branding', siteBrandingRoutes.getBranding);

// Public static files — must be before verifyToken (<img> cannot send Bearer tokens)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(verifyToken);
const attachUserContext = require('./middleware/attachUserContext');
const loadAuthz = require('./middleware/loadAuthz');
app.use(attachUserContext);
app.use(loadAuthz);

// Android app APIs (require access token)
app.use('/api/public/locations', require('./routes/publicLocations'));
app.use('/api/mobile', require('./routes/mobile'));
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
app.use('/api/handheld-devices', require('./routes/handheldDevices'));
app.use('/api/zones', require('./routes/zones'));
app.use('/api/readers', require('./routes/readers'));

// RFID middleware API (spec v2.0) — { status, message, data } envelope
const { layoutRouter: floorLayoutRoutes, plansRouter: floorPlansRoutes } = require('./routes/floorLayout');
app.use('/api/tag-reads', require('./routes/tagReads'));
app.use('/api/reader-status', require('./routes/readerStatus'));
app.use('/api/rfid-dashboard', require('./routes/rfidDashboard'));
app.use('/api/floor-layout', floorLayoutRoutes);
app.use('/api/floor-plans', floorPlansRoutes);
app.use('/api/service', require('./routes/rfidService'));
app.use('/api/unassigned-tags', require('./routes/unassignedTags'));
app.use('/api/site-branding', siteBrandingRoutes);

const { startRuleEngine } = require('./ruleEngine');
startRuleEngine();

// ── 404 handler — must come before the error handler ──
app.use((req, res, next) => {
  res.status(404).json({ status: false, message: `Endpoint not found: ${req.method} ${req.originalUrl}` });
});

// Body-parse errors on RFID API paths happen before the routers run; answer with the envelope.
app.use(
  ['/api/readers', '/api/tag-reads', '/api/reader-status', '/api/rfid-dashboard',
    '/api/floor-layout', '/api/floor-plans', '/api/service'],
  require('./lib/apiEnvelope').envelopeErrorHandler
);

// ── Global error handler — catches any unhandled error from routes ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (res.headersSent) return next(err);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }

  // MySQL duplicate entry
  if (err.code === 'ER_DUP_ENTRY') {
    const field = err.sqlMessage && err.sqlMessage.includes('asset_code') ? 'Asset ID / Asset Serial' :
                  err.sqlMessage && err.sqlMessage.includes('rfid_tag') ? 'RFID tag' : 'A field';
    return res.status(409).json({ message: `${field} already exists. Please use a unique value.` });
  }

  if (err.code === 'ER_BAD_NULL_ERROR') {
    const field = err.sqlMessage?.match(/Column '([^']+)' cannot be null/)?.[1] || 'Required field';
    return res.status(400).json({ message: `${field} is required.` });
  }

  if (err.code?.startsWith('ER_')) {
    return res.status(400).json({ message: err.sqlMessage || 'Database request failed.' });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      message: 'Request body too large. Try fewer rows per import or split the file into smaller batches.',
    });
  }

  res.status(err.status || 500).json({ message: err.message || 'An unexpected error occurred. Please try again.' });
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err?.message || err);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
