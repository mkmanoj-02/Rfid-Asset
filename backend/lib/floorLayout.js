/**
 * Multi floor plan storage: floor_plans, floor_zones, floor_placements,
 * floor_antenna_placements. Placements reference readers by name in the API
 * and by reader_id in the database.
 */

const crypto = require('crypto');
const db = require('../db');
const { validationError } = require('./apiEnvelope');

const ZONE_TYPES = new Set(['DOOR', 'BIN']);
const DEFAULT_PLAN_ID = 'floor-1';
const DEFAULT_PLAN_NAME = 'Floor 1';

function newId() {
  return crypto.randomUUID();
}

function num(value, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw validationError(`${field} must be a number.`, field);
  return n;
}

function serializeZone(row) {
  return {
    id: row.id,
    type: row.zone_type,
    name: row.name,
    x: row.pos_x,
    y: row.pos_y,
    width: row.width,
    height: row.height,
  };
}

async function ensureDefaultPlan(conn = db) {
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM floor_plans');
  if (Number(n) === 0) {
    await conn.query(
      `INSERT IGNORE INTO floor_plans (id, name, image_url, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, '', 1, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [DEFAULT_PLAN_ID, DEFAULT_PLAN_NAME]
    );
  }
  const [[{ active }]] = await conn.query('SELECT COUNT(*) AS active FROM floor_plans WHERE is_active = 1');
  if (Number(active) !== 1) {
    const [[first]] = await conn.query('SELECT id FROM floor_plans ORDER BY sort_order, created_at, id LIMIT 1');
    await conn.query('UPDATE floor_plans SET is_active = (id = ?), updated_at = UTC_TIMESTAMP(3)', [first.id]);
  }
}

async function getActivePlanId(conn = db) {
  await ensureDefaultPlan(conn);
  const [[row]] = await conn.query('SELECT id FROM floor_plans WHERE is_active = 1 LIMIT 1');
  return row.id;
}

async function getPlanRow(id, conn = db) {
  const [rows] = await conn.query('SELECT * FROM floor_plans WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

/** Load plans (optionally a single plan) with zones and placements. */
async function loadPlans(conn = db, planId = null) {
  const where = planId ? 'WHERE id = ?' : '';
  const args = planId ? [planId] : [];
  const [plans] = await conn.query(
    `SELECT id, name, image_url FROM floor_plans ${where} ORDER BY sort_order, created_at, id`,
    args
  );
  if (!plans.length) return [];
  const ids = plans.map((p) => p.id);

  const [zones] = await conn.query(
    `SELECT * FROM floor_zones WHERE floor_plan_id IN (?) ORDER BY sort_order, name`,
    [ids]
  );
  const [placements] = await conn.query(
    `SELECT p.id, p.floor_plan_id, p.reader_id, p.placed, p.pos_x, p.pos_y, r.name AS reader_name
       FROM floor_placements p
       JOIN readers r ON r.id = p.reader_id
      WHERE p.floor_plan_id IN (?)
      ORDER BY r.name`,
    [ids]
  );
  const placementIds = placements.map((p) => p.id);
  const [antennas] = placementIds.length
    ? await conn.query(
        `SELECT placement_id, antenna_number, pos_x, pos_y
           FROM floor_antenna_placements
          WHERE placement_id IN (?)
          ORDER BY antenna_number`,
        [placementIds]
      )
    : [[]];

  const antennasByPlacement = new Map();
  for (const a of antennas) {
    if (!antennasByPlacement.has(a.placement_id)) antennasByPlacement.set(a.placement_id, []);
    antennasByPlacement.get(a.placement_id).push({ number: a.antenna_number, x: a.pos_x, y: a.pos_y });
  }

  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    imageUrl: p.image_url || '',
    zones: zones.filter((z) => z.floor_plan_id === p.id).map(serializeZone),
    placements: placements
      .filter((pl) => pl.floor_plan_id === p.id)
      .map((pl) => ({
        readerName: pl.reader_name,
        placed: Boolean(pl.placed),
        x: pl.pos_x,
        y: pl.pos_y,
        antennas: antennasByPlacement.get(pl.id) || [],
      })),
  }));
}

async function loadLayout(conn = db) {
  const activeId = await getActivePlanId(conn);
  const plans = await loadPlans(conn);
  return { activeId, plans };
}

function parseZones(zones, seenIds) {
  if (zones === undefined || zones === null) return [];
  if (!Array.isArray(zones)) throw validationError('zones must be an array.', 'zones');
  return zones.map((z) => {
    if (!z || typeof z !== 'object') throw validationError('Each zone must be an object.', 'zones');
    const id = String(z.id ?? '').trim();
    const name = String(z.name ?? '').trim();
    const type = String(z.type ?? '').trim().toUpperCase();
    if (!id) throw validationError('Each zone needs an id.', 'zones.id');
    if (id.length > 64) throw validationError('Zone id is too long (max 64 characters).', 'zones.id');
    if (!name) throw validationError('Each zone needs a name.', 'zones.name');
    if (name.length > 128) throw validationError('Zone name is too long (max 128 characters).', 'zones.name');
    if (!ZONE_TYPES.has(type)) throw validationError('Zone type must be DOOR or BIN.', 'zones.type');
    if (seenIds.has(id)) throw validationError(`Duplicate zone id "${id}".`, 'zones.id');
    seenIds.add(id);
    return {
      id,
      name,
      type,
      x: num(z.x, 0, 'zones.x'),
      y: num(z.y, 0, 'zones.y'),
      width: num(z.width, 220, 'zones.width'),
      height: num(z.height, 120, 'zones.height'),
    };
  });
}

function parsePlacements(placements) {
  if (placements === undefined || placements === null) return [];
  if (!Array.isArray(placements)) throw validationError('placements must be an array.', 'placements');
  return placements.map((p) => {
    if (!p || typeof p !== 'object') throw validationError('Each placement must be an object.', 'placements');
    const antennas = p.antennas === undefined || p.antennas === null ? [] : p.antennas;
    if (!Array.isArray(antennas)) throw validationError('placement antennas must be an array.', 'placements.antennas');
    return {
      readerName: String(p.readerName ?? '').trim(),
      placed: p.placed === undefined ? true : Boolean(p.placed),
      x: num(p.x, 0, 'placements.x'),
      y: num(p.y, 0, 'placements.y'),
      antennas: antennas.map((a) => {
        const number = Number(a && a.number);
        if (!Number.isInteger(number) || number < 1 || number > 32) {
          throw validationError('Antenna number must be an integer between 1 and 32.', 'placements.antennas.number');
        }
        return { number, x: num(a.x, 0, 'placements.antennas.x'), y: num(a.y, 0, 'placements.antennas.y') };
      }),
    };
  });
}

function parseImageUrl(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw validationError('imageUrl must be a string.', 'imageUrl');
  const v = value.trim();
  if (v.length > 500) throw validationError('imageUrl is too long (max 500 characters).', 'imageUrl');
  return v;
}

function parsePlanName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw validationError('Floor plan name is required.', 'name');
  if (name.length > 128) throw validationError('Floor plan name is too long (max 128 characters).', 'name');
  return name;
}

/** Replace a plan's zones and placements. Unknown reader names are dropped. */
async function writePlanContents(conn, planId, zones, placements) {
  await conn.query('DELETE FROM floor_zones WHERE floor_plan_id = ?', [planId]);
  await conn.query('DELETE FROM floor_placements WHERE floor_plan_id = ?', [planId]);

  let order = 0;
  for (const z of zones) {
    await conn.query(
      `INSERT INTO floor_zones (id, floor_plan_id, zone_type, name, pos_x, pos_y, width, height, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [z.id, planId, z.type, z.name, z.x, z.y, z.width, z.height, order++]
    );
  }

  const names = [...new Set(placements.map((p) => p.readerName).filter(Boolean))];
  if (!names.length) return;
  const [readers] = await conn.query('SELECT id, name FROM readers WHERE name IN (?)', [names]);
  const idByName = new Map(readers.map((r) => [r.name.toLowerCase(), r.id]));
  const done = new Set();

  for (const p of placements) {
    const readerId = idByName.get(p.readerName.toLowerCase());
    if (!readerId || done.has(readerId)) continue;
    done.add(readerId);
    const [result] = await conn.query(
      `INSERT INTO floor_placements (floor_plan_id, reader_id, placed, pos_x, pos_y) VALUES (?, ?, ?, ?, ?)`,
      [planId, readerId, p.placed ? 1 : 0, p.x, p.y]
    );
    const seen = new Set();
    for (const a of p.antennas) {
      if (seen.has(a.number)) continue;
      seen.add(a.number);
      await conn.query(
        `INSERT INTO floor_antenna_placements (placement_id, antenna_number, pos_x, pos_y) VALUES (?, ?, ?, ?)`,
        [result.insertId, a.number, a.x, a.y]
      );
    }
  }
}

module.exports = {
  ZONE_TYPES,
  DEFAULT_PLAN_ID,
  DEFAULT_PLAN_NAME,
  newId,
  ensureDefaultPlan,
  getActivePlanId,
  getPlanRow,
  loadPlans,
  loadLayout,
  parseZones,
  parsePlacements,
  parseImageUrl,
  parsePlanName,
  writePlanContents,
  serializeZone,
};
