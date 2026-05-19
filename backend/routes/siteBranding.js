const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const authorizeRoles = require('../middleware/authorizeRoles');
const { optionalImageUpload } = require('../middleware/optionalImageUpload');
const {
  logoUrlFromUpload,
  resolveBrandingLogoOnUpdate,
  truthyFormFlag,
} = require('../controllers/siteBrandingImages');

const DEFAULTS = {
  app_name: 'RFID Asset',
  app_subtitle: 'Management System',
  logo_url: null,
};

async function fetchBrandingRow() {
  const [rows] = await db.query(
    'SELECT app_name, app_subtitle, logo_url, updated_at FROM site_branding WHERE id = 1 LIMIT 1'
  );
  return rows[0] || null;
}

/** Public — used by login page and app shell before auth */
async function getBranding(req, res) {
  try {
    const row = await fetchBrandingRow();
    res.json(row || DEFAULTS);
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.json(DEFAULTS);
    }
    throw err;
  }
}

/** Super admin — multipart: app_name, app_subtitle, optional image, remove_logo */
router.put(
  '/',
  authorizeRoles('super_admin'),
  optionalImageUpload('site_branding'),
  async (req, res) => {
    const app_name = (req.body.app_name || '').trim();
    const app_subtitle = (req.body.app_subtitle || '').trim();

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
          message: 'Site branding is not configured. Run: node migrate-v17.js',
        });
      }
      throw err;
    }

    const previousLogo = row?.logo_url || null;
    const logo_url = await resolveBrandingLogoOnUpdate(
      previousLogo,
      req.file,
      truthyFormFlag(req.body.remove_logo)
    );

    if (!row) {
      await db.query(
        'INSERT INTO site_branding (id, app_name, app_subtitle, logo_url) VALUES (1, ?, ?, ?)',
        [app_name, app_subtitle, logo_url]
      );
    } else {
      await db.query(
        'UPDATE site_branding SET app_name = ?, app_subtitle = ?, logo_url = ? WHERE id = 1',
        [app_name, app_subtitle, logo_url]
      );
    }

    await audit.log(
      'Settings',
      'Modified',
      `Profile updated (${app_name})`,
      req.auditUser,
      req.auditUserId
    );

    res.json({
      app_name,
      app_subtitle,
      logo_url,
      message: 'Profile saved',
    });
  }
);

module.exports = router;
module.exports.getBranding = getBranding;
module.exports.DEFAULTS = DEFAULTS;
