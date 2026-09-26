const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const authorizeRoles = require('../middleware/authorizeRoles');
const { optionalBrandingUpload } = require('../middleware/optionalImageUpload');
const {
  resolveBrandingFileOnUpdate,
  firstUploadedFile,
  truthyFormFlag,
} = require('../controllers/siteBrandingImages');

const ALLOWED_THEMES = new Set(['blue', 'purple']);

const DEFAULTS = {
  app_name: 'RFID Asset',
  app_subtitle: 'Management System',
  logo_url: null,
  favicon_url: null,
  theme: 'blue',
};

function normalizeTheme(value) {
  const t = String(value || '').trim().toLowerCase();
  return ALLOWED_THEMES.has(t) ? t : 'blue';
}

async function fetchBrandingRow() {
  const [rows] = await db.query(
    'SELECT app_name, app_subtitle, logo_url, favicon_url, theme, updated_at FROM site_branding WHERE id = 1 LIMIT 1'
  );
  return rows[0] || null;
}

function serializeBranding(row) {
  if (!row) return { ...DEFAULTS };
  return {
    app_name: row.app_name || DEFAULTS.app_name,
    app_subtitle: row.app_subtitle || DEFAULTS.app_subtitle,
    logo_url: row.logo_url || null,
    favicon_url: row.favicon_url || null,
    theme: normalizeTheme(row.theme),
    updated_at: row.updated_at,
  };
}

/** Public — used by login page and app shell before auth */
async function getBranding(req, res) {
  try {
    const row = await fetchBrandingRow();
    res.json(serializeBranding(row));
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR') {
      return res.json(DEFAULTS);
    }
    throw err;
  }
}

/** Super admin — multipart: app_name, app_subtitle, theme, optional image/favicon, remove_* */
router.put(
  '/',
  authorizeRoles('super_admin'),
  optionalBrandingUpload(),
  async (req, res) => {
    const app_name = (req.body.app_name || '').trim();
    const app_subtitle = (req.body.app_subtitle || '').trim();
    const theme = normalizeTheme(req.body.theme);

    if (!app_name) return res.status(400).json({ message: 'App name is required' });
    if (!app_subtitle) return res.status(400).json({ message: 'Subtitle is required' });
    if (app_name.length > 120) return res.status(400).json({ message: 'App name is too long (max 120 characters)' });
    if (app_subtitle.length > 120) return res.status(400).json({ message: 'Subtitle is too long (max 120 characters)' });

    let row;
    try {
      row = await fetchBrandingRow();
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') {
        return res.status(503).json({
          message: 'Site branding is not configured. Run: npm run migrate',
        });
      }
      if (err.code === 'ER_BAD_FIELD_ERROR') {
        return res.status(503).json({
          message: 'Branding columns missing. Run: npm run migrate',
        });
      }
      throw err;
    }

    const logoFile = firstUploadedFile(req, 'image');
    const faviconFile = firstUploadedFile(req, 'favicon');

    const previousLogo = row?.logo_url || null;
    const previousFavicon = row?.favicon_url || null;

    const logo_url = await resolveBrandingFileOnUpdate(
      previousLogo,
      logoFile,
      truthyFormFlag(req.body.remove_logo)
    );
    const favicon_url = await resolveBrandingFileOnUpdate(
      previousFavicon,
      faviconFile,
      truthyFormFlag(req.body.remove_favicon)
    );

    if (!row) {
      await db.query(
        'INSERT INTO site_branding (id, app_name, app_subtitle, logo_url, favicon_url, theme) VALUES (1, ?, ?, ?, ?, ?)',
        [app_name, app_subtitle, logo_url, favicon_url, theme]
      );
    } else {
      await db.query(
        'UPDATE site_branding SET app_name = ?, app_subtitle = ?, logo_url = ?, favicon_url = ?, theme = ? WHERE id = 1',
        [app_name, app_subtitle, logo_url, favicon_url, theme]
      );
    }

    await audit.log(
      'Settings',
      'Modified',
      `Profile updated (${app_name}, theme: ${theme})`,
      req.auditUser,
      req.auditUserId
    );

    res.json({
      app_name,
      app_subtitle,
      logo_url,
      favicon_url,
      theme,
      message: 'Profile saved',
    });
  }
);

module.exports = router;
module.exports.getBranding = getBranding;
module.exports.DEFAULTS = DEFAULTS;
