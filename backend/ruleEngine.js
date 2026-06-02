const db = require('./db');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Email transporter — configure in .env
function getTransporter() {
  if (!process.env.SMTP_HOST || process.env.SMTP_HOST === 'smtp.gmail.com' && process.env.SMTP_USER === 'your-email@gmail.com') {
    return null; // not configured
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendEmail(to, subject, text, html) {
  const transporter = getTransporter();
  if (!transporter || !to) {
    console.log(`[Email skipped - not configured] To: ${to}, Subject: ${subject}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"RFID Asset Management" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject,
      text,   // plain-text fallback
      html,   // rich HTML
    });
    console.log(`[Email sent] To: ${to}, Subject: ${subject}`);
  } catch (e) { console.error('Email error:', e.message); }
}

// Build a professional HTML email for an alert
function buildAlertEmail(rule, description, asset) {
  const now = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const filterColors = {
    asset:       '#2563EB',
    inventory:   '#059669',
    maintenance: '#D97706',
    attribute:   '#7C3AED',
  };
  const filterLabels = {
    asset:       'Asset Alert',
    inventory:   'Inventory Alert',
    maintenance: 'Maintenance Alert',
    attribute:   'Attribute Alert',
  };

  const accentColor = filterColors[rule.filter_type] || '#2563EB';
  const filterLabel = filterLabels[rule.filter_type] || 'System Alert';

  // Asset detail rows (only shown when asset info is available)
  const assetRows = asset ? `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #F1F5F9;color:#64748B;font-size:13px;width:140px;">Asset Serial</td>
      <td style="padding:8px 0;border-bottom:1px solid #F1F5F9;color:#0F172A;font-size:13px;font-weight:600;">${asset.asset_serial || '—'}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #F1F5F9;color:#64748B;font-size:13px;">Asset Type</td>
      <td style="padding:8px 0;border-bottom:1px solid #F1F5F9;color:#0F172A;font-size:13px;">${asset.asset_type_name || '—'}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#64748B;font-size:13px;">Last Location</td>
      <td style="padding:8px 0;color:#0F172A;font-size:13px;">${asset.location_name || '—'}</td>
    </tr>
  ` : '';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${filterLabel}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'Segoe UI',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0EA5E9,#2563EB);border-radius:16px 16px 0 0;padding:28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.7);margin-bottom:6px;">
                      RFID Asset Management System
                    </div>
                    <div style="font-size:22px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;">
                      📡 ${filterLabel}
                    </div>
                  </td>
                  <td align="right">
                    <div style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:8px;padding:6px 14px;font-size:12px;color:#fff;font-weight:600;white-space:nowrap;">
                      ${now}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#FFFFFF;padding:28px 32px;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0;">

              <!-- Rule badge + name -->
              <div style="margin-bottom:20px;">
                <span style="display:inline-block;background:${accentColor}18;color:${accentColor};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:4px 10px;border-radius:6px;border:1px solid ${accentColor}30;">
                  ${filterLabel}
                </span>
                <div style="font-size:18px;font-weight:700;color:#0F172A;margin-top:10px;letter-spacing:-0.01em;">
                  ${rule.name}
                </div>
                ${rule.description ? `<div style="font-size:13px;color:#64748B;margin-top:4px;">${rule.description}</div>` : ''}
              </div>

              <!-- Alert message box -->
              <div style="background:#F8FAFC;border-left:4px solid ${accentColor};border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:24px;">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94A3B8;margin-bottom:6px;">Alert Details</div>
                <div style="font-size:14px;color:#1E293B;line-height:1.6;">${description}</div>
              </div>

              <!-- Asset details table (if available) -->
              ${asset ? `
              <div style="margin-bottom:24px;">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94A3B8;margin-bottom:10px;">Asset Information</div>
                <table width="100%" cellpadding="0" cellspacing="0">
                  ${assetRows}
                </table>
              </div>
              ` : ''}

              <!-- Divider -->
              <div style="border-top:1px solid #F1F5F9;margin:20px 0;"></div>

              <!-- Footer note -->
              <div style="font-size:12px;color:#94A3B8;line-height:1.6;">
                This alert was generated automatically by the RFID Asset Management System.<br/>
                Rule: <strong style="color:#64748B;">${rule.name}</strong> &nbsp;·&nbsp;
                Type: <strong style="color:#64748B;">${filterLabel}</strong>
              </div>

            </td>
          </tr>

          <!-- Footer bar -->
          <tr>
            <td style="background:#F1F5F9;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 16px 16px;padding:16px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:12px;color:#94A3B8;">
                    © ${new Date().getFullYear()} RFID Asset Management System
                  </td>
                  <td align="right" style="font-size:12px;color:#94A3B8;">
                    Automated alert — do not reply
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

  return html;
}

async function createAlert(rule, description, asset = null) {
  await db.query(
    `INSERT INTO alerts (rule_id, rule_name, filter_type, description,
      asset_id, asset_serial, asset_type, last_known_location, last_seen_time)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      rule.id, rule.name, rule.filter_type, description,
      asset?.id || null, asset?.asset_serial || null,
      asset?.asset_type_name || null, asset?.location_name || null,
      asset?.last_seen || null,
    ]
  );
  if ((rule.action_type === 'email_alert' || rule.action_type === 'both') && rule.action_email) {
    const subject = `[RFID Alert] ${rule.name} — ${description.slice(0, 80)}${description.length > 80 ? '…' : ''}`;
    const html    = buildAlertEmail(rule, description, asset);
    await sendEmail(rule.action_email, subject, description, html);
  }
}

// Convert duration to milliseconds
function toMs(value, unit) {
  const v = parseInt(value);
  const map = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000, years: 31536000000 };
  return v * (map[unit] || 60000);
}

// Get all sub-location IDs recursively
async function getSubLocationIds(locationId) {
  const [all] = await db.query('SELECT id, parent_id FROM locations');
  const result = new Set([locationId]);
  const addChildren = (pid) => {
    all.filter(l => l.parent_id === pid).forEach(l => { result.add(l.id); addChildren(l.id); });
  };
  addChildren(locationId);
  return [...result];
}

// Track last known state to detect enters/exits
const lastState = {}; // assetId -> { locationId, lastSeen }

async function runRules() {
  const [rules] = await db.query('SELECT * FROM rules WHERE is_active = 1');
  if (!rules.length) return;

  const [assets] = await db.query(`
    SELECT a.*, at.name AS asset_type_name, l.name AS location_name,
      (SELECT MAX(moved_at) FROM movement_history WHERE asset_id = a.id) AS last_seen
    FROM assets a
    LEFT JOIN asset_types at ON a.asset_type_id = at.id
    LEFT JOIN locations l ON a.current_location_id = l.id
  `);

  const now = Date.now();

  for (const rule of rules) {
    try {
      // Get applicable location IDs
      let locationIds = null;
      if (rule.location_id) {
        locationIds = rule.include_sub_locations
          ? await getSubLocationIds(rule.location_id)
          : [rule.location_id];
      }

      // Filter assets by location and asset type
      let scopedAssets = assets;
      if (locationIds) scopedAssets = scopedAssets.filter(a => locationIds.includes(a.current_location_id));
      if (rule.asset_type_id) scopedAssets = scopedAssets.filter(a => a.asset_type_id === rule.asset_type_id);

      if (rule.filter_type === 'asset') {
        if (rule.asset_action === 'enters' || rule.asset_action === 'exits') {
          // Detect from movement_history — movements in the last engine interval
          const [recentMoves] = await db.query(
            `SELECT mh.*, a.id AS asset_id, a.asset_serial, a.name AS asset_name,
               a.asset_type_id, at.name AS asset_type_name,
               fl.name AS from_location_name, tl.name AS to_location_name,
               tl.id AS to_location_id, fl.id AS from_location_id_val
             FROM movement_history mh
             JOIN assets a ON mh.asset_id = a.id
             LEFT JOIN asset_types at ON a.asset_type_id = at.id
             LEFT JOIN locations fl ON mh.from_location_id = fl.id
             LEFT JOIN locations tl ON mh.to_location_id = tl.id
             WHERE mh.moved_at > DATE_SUB(NOW(), INTERVAL 3 MINUTE)
               ${rule.asset_type_id ? 'AND a.asset_type_id = ?' : ''}
             ORDER BY mh.moved_at DESC`,
            rule.asset_type_id ? [rule.asset_type_id] : []
          );

          for (const move of recentMoves) {
            // Check if this movement matches the rule's location
            const matchesEnter = rule.asset_action === 'enters' &&
              (!locationIds || locationIds.includes(move.to_location_id));
            const matchesExit = rule.asset_action === 'exits' &&
              (!locationIds || locationIds.includes(move.from_location_id_val));

            if (matchesEnter || matchesExit) {
              // Avoid duplicate alert for same movement
              const [existing] = await db.query(
                'SELECT id FROM alerts WHERE rule_id=? AND asset_id=? AND alert_time > DATE_SUB(NOW(), INTERVAL 3 MINUTE)',
                [rule.id, move.asset_id]
              );
              if (!existing.length) {
                const action = rule.asset_action === 'enters' ? 'entered' : 'exited';
                const locName = rule.asset_action === 'enters' ? move.to_location_name : move.from_location_name;
                await createAlert(rule,
                  `Asset "${move.asset_name}" (${move.asset_serial || move.asset_id}) ${action} location "${locName}"`,
                  { id: move.asset_id, asset_serial: move.asset_serial, asset_type_name: move.asset_type_name, location_name: move.to_location_name }
                );
              }
            }
          }
        } else {
          for (const asset of scopedAssets) {
            if (rule.asset_action === 'stays_at') {
              const lastSeen = asset.last_seen ? new Date(asset.last_seen).getTime() : null;
              if (lastSeen && locationIds?.includes(asset.current_location_id)) {
                const stayMs = now - lastSeen;
                const thresholdMs = toMs(rule.duration_value, rule.duration_unit);
                const cond = rule.duration_condition === 'more_than' ? stayMs > thresholdMs : stayMs < thresholdMs;
                if (cond) {
                  const [existing] = await db.query(
                    'SELECT id FROM alerts WHERE rule_id=? AND asset_id=? AND alert_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
                    [rule.id, asset.id]
                  );
                  if (!existing.length) {
                    const hrs = Math.round(stayMs / 3600000);
                    await createAlert(rule, `Asset "${asset.name}" has stayed at "${asset.location_name}" for ${hrs} hour(s)`, asset);
                  }
                }
              }
            } else if (rule.asset_action === 'not_scanned') {
              const lastSeen = asset.last_seen ? new Date(asset.last_seen).getTime() : null;
              if (lastSeen) {
                const notScannedMs = now - lastSeen;
                const thresholdMs = toMs(rule.duration_value, rule.duration_unit);
                if (notScannedMs > thresholdMs) {
                  const [existing] = await db.query(
                    'SELECT id FROM alerts WHERE rule_id=? AND asset_id=? AND alert_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
                    [rule.id, asset.id]
                  );
                  if (!existing.length) {
                    await createAlert(rule, `Asset "${asset.name}" has not been scanned for ${rule.duration_value} ${rule.duration_unit}`, asset);
                  }
                }
              }
            } else if (rule.asset_action === 'is_missing') {
              const lastSeen = asset.last_seen ? new Date(asset.last_seen).getTime() : null;
              if (lastSeen) {
                const missingMs = now - lastSeen;
                const thresholdMs = toMs(rule.duration_value, rule.duration_unit);
                if (missingMs > thresholdMs) {
                  const [existing] = await db.query(
                    'SELECT id FROM alerts WHERE rule_id=? AND asset_id=? AND alert_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
                    [rule.id, asset.id]
                  );
                  if (!existing.length) {
                    await createAlert(rule, `Asset "${asset.name}" is missing from "${asset.location_name}" for ${rule.duration_value} ${rule.duration_unit}`, asset);
                  }
                }
              }
            }
          }

          // is_added
          if (rule.asset_action === 'is_added') {
            const [recent] = await db.query(
              `SELECT mh.*, a.asset_serial, a.name AS asset_name, a.id AS asset_id,
                 at.name AS asset_type_name, l.name AS location_name
               FROM movement_history mh
               JOIN assets a ON mh.asset_id = a.id
               LEFT JOIN asset_types at ON a.asset_type_id = at.id
               LEFT JOIN locations l ON l.id = COALESCE(mh.to_location_id, mh.from_location_id)
               WHERE mh.notes IN ('Initial placement','Imported')
                 AND mh.moved_at > DATE_SUB(NOW(), INTERVAL 3 MINUTE)
                 ${rule.asset_type_id ? 'AND a.asset_type_id = ?' : ''}`,
              rule.asset_type_id ? [rule.asset_type_id] : []
            );
            for (const r of recent) {
              const [existing] = await db.query(
                'SELECT id FROM alerts WHERE rule_id=? AND asset_id=? AND alert_time > DATE_SUB(NOW(), INTERVAL 5 MINUTE)',
                [rule.id, r.asset_id]
              );
              if (!existing.length) {
                await createAlert(rule, `New asset "${r.asset_name}" (${r.asset_serial || r.asset_id}) was added`,
                  { id: r.asset_id, asset_serial: r.asset_serial, asset_type_name: r.asset_type_name, location_name: r.location_name });
              }
            }
          }
        }
      } else if (rule.filter_type === 'inventory') {
        // Count assets at location matching asset type
        const count = scopedAssets.length;
        const ruleVal = parseInt(rule.inventory_value);
        let triggered = false;
        if (rule.inventory_condition === 'equal_to') triggered = count === ruleVal;
        else if (rule.inventory_condition === 'greater_than') triggered = count > ruleVal;
        else if (rule.inventory_condition === 'less_than') triggered = count < ruleVal;

        if (triggered) {
          const [existing] = await db.query(
            'SELECT id FROM alerts WHERE rule_id=? AND alert_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
            [rule.id]
          );
          if (!existing.length) {
            const [loc] = await db.query('SELECT name FROM locations WHERE id=?', [rule.location_id]);
            const locName = loc[0]?.name || 'selected location';
            const typeName = rule.asset_type_id ? (await db.query('SELECT name FROM asset_types WHERE id=?', [rule.asset_type_id]))[0][0]?.name : 'any type';
            await createAlert(rule, `Inventory count (${count}) of "${typeName}" at "${locName}" is ${rule.inventory_condition.replace(/_/g, ' ')} ${ruleVal}`);
          }
        }

      } else if (rule.filter_type === 'attribute') {
        if (!rule.attribute_id) continue;
        // Get the attribute name so we can match across asset types
        const [[attrDef]] = await db.query('SELECT name, attr_type FROM asset_type_attributes WHERE id=?', [rule.attribute_id]);
        if (!attrDef) continue;

        // Match by attribute NAME across all asset types (same as user privilege fix)
        const [attrVals] = await db.query(
          `SELECT aav.value, a.id AS asset_id, a.asset_serial, a.name AS asset_name,
            at.name AS asset_type_name, l.name AS location_name
           FROM asset_attribute_values aav
           JOIN asset_type_attributes ata ON aav.attribute_id = ata.id
           JOIN assets a ON aav.asset_id = a.id
           LEFT JOIN asset_types at ON a.asset_type_id = at.id
           LEFT JOIN locations l ON a.current_location_id = l.id
           WHERE LOWER(ata.name) = LOWER(?)
             ${rule.asset_type_id ? 'AND a.asset_type_id = ?' : ''}
             ${locationIds ? `AND a.current_location_id IN (${locationIds.map(() => '?').join(',')})` : ''}`,
          [attrDef.name, ...(rule.asset_type_id ? [rule.asset_type_id] : []), ...(locationIds || [])]
        );

        for (const av of attrVals) {
          let triggered = false;
          const val = (av.value || '').trim();
          const ruleVal = (rule.attribute_value || '').trim();

          if (rule.attribute_condition === 'is') triggered = val.toLowerCase() === ruleVal.toLowerCase();
          else if (rule.attribute_condition === 'equal_to') triggered = parseFloat(val) === parseFloat(ruleVal);
          else if (rule.attribute_condition === 'greater_than') triggered = !isNaN(parseFloat(val)) && parseFloat(val) > parseFloat(ruleVal);
          else if (rule.attribute_condition === 'less_than') triggered = !isNaN(parseFloat(val)) && parseFloat(val) < parseFloat(ruleVal);
          else if (rule.attribute_condition === 'before') triggered = !!val && new Date(val) < new Date(ruleVal);
          else if (rule.attribute_condition === 'after') triggered = !!val && new Date(val) > new Date(ruleVal);

          if (triggered) {
            const [existing] = await db.query(
              'SELECT id FROM alerts WHERE rule_id=? AND asset_id=? AND alert_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
              [rule.id, av.asset_id]
            );
            if (!existing.length) {
              await createAlert(rule,
                `Asset "${av.asset_name}" (${av.asset_serial || av.asset_id}): attribute "${attrDef.name}" = "${val}" matches condition (${rule.attribute_condition} "${ruleVal}")`,
                { id: av.asset_id, asset_serial: av.asset_serial, asset_type_name: av.asset_type_name, location_name: av.location_name }
              );
            }
          }
        }

      } else if (rule.filter_type === 'maintenance') {
        if (!rule.attribute_id) continue;
        // Get attribute name for cross-type matching
        const [[attrDef]] = await db.query('SELECT name FROM asset_type_attributes WHERE id=?', [rule.attribute_id]);
        if (!attrDef) continue;

        const [attrVals] = await db.query(
          `SELECT aav.value, a.id AS asset_id, a.asset_serial, a.name AS asset_name,
            at.name AS asset_type_name, l.name AS location_name
           FROM asset_attribute_values aav
           JOIN asset_type_attributes ata ON aav.attribute_id = ata.id
           JOIN assets a ON aav.asset_id = a.id
           LEFT JOIN asset_types at ON a.asset_type_id = at.id
           LEFT JOIN locations l ON a.current_location_id = l.id
           WHERE LOWER(ata.name) = LOWER(?) AND aav.value IS NOT NULL AND aav.value != ''
             ${rule.asset_type_id ? 'AND a.asset_type_id = ?' : ''}
             ${locationIds ? `AND a.current_location_id IN (${locationIds.map(() => '?').join(',')})` : ''}`,
          [attrDef.name, ...(rule.asset_type_id ? [rule.asset_type_id] : []), ...(locationIds || [])]
        );

        const alertMs = toMs(rule.maintenance_alert_value, rule.maintenance_alert_unit);

        for (const av of attrVals) {
          try {
            const attrDate = new Date(av.value).getTime();
            if (isNaN(attrDate)) continue;
            const diff = attrDate - now;
            let triggered = false;
            // "before": alert X time before the date — fire from (date - alertMs) up to the date itself
            // Add 12 hours buffer to handle time-of-day differences
            const alertBuffer = alertMs + (12 * 3600000);
            if (rule.maintenance_condition === 'before') {
              triggered = Math.abs(diff) <= alertBuffer;
            }
            // "after": alert X time after the date has passed
            else if (rule.maintenance_condition === 'after') {
              triggered = diff < 0 && Math.abs(diff) <= alertBuffer;
            }

            if (triggered) {
              const [existing] = await db.query(
                'SELECT id FROM alerts WHERE rule_id=? AND asset_id=? AND alert_time > DATE_SUB(NOW(), INTERVAL 24 HOUR)',
                [rule.id, av.asset_id]
              );
              if (!existing.length) {
                const absDays = Math.round(Math.abs(diff) / 86400000);
                const timeDesc = diff > 0
                  ? `due in ${absDays} day(s) (${av.value})`
                  : `was due ${absDays} day(s) ago (${av.value})`;
                await createAlert(rule,
                  `Maintenance alert for "${av.asset_name}" (${av.asset_serial || av.asset_id}): "${attrDef.name}" ${timeDesc}`,
                  { id: av.asset_id, asset_serial: av.asset_serial, asset_type_name: av.asset_type_name, location_name: av.location_name }
                );
              }
            }
          } catch {}
        }
      }
    } catch (e) { console.error(`Rule ${rule.id} error:`, e.message); }
  }
}

// Run every 30 seconds as fallback, but also triggered on-demand
function startRuleEngine() {
  console.log('Rule engine started');
  runRules().catch(e => console.error('Rule engine error:', e.message));
  setInterval(() => {
    runRules().catch(e => console.error('Rule engine error:', e.message));
  }, 30 * 1000);
}

module.exports = { startRuleEngine, runRules };
