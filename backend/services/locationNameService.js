/**
 * Location naming rules.
 *
 * A child location keeps its typed name when that name is not used anywhere.
 * When the same name already exists under another parent it is stored as
 * "<parent>_<child>" in lowercase (e.g. "hil_1st floor"), so stored names stay
 * unique while parent_id keeps the real hierarchy. The same child name twice
 * under one parent is rejected.
 */

const LOCK_NAME = 'locations_name';
const LOCK_TIMEOUT_SECONDS = 10;

function normalizeName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function nameKey(value) {
  return normalizeName(value).toLowerCase();
}

function generatedName(parentName, childName) {
  return `${nameKey(parentName)}_${nameKey(childName)}`;
}

/** "hil_1st floor" under parent "HIL" -> "1st floor"; other names unchanged. */
function stripParentPrefix(name, parentName) {
  const normalized = normalizeName(name);
  if (!parentName) return normalized;
  const prefix = `${nameKey(parentName)}_`;
  if (nameKey(normalized).startsWith(prefix) && normalized.length > prefix.length) {
    return normalizeName(normalized.slice(prefix.length));
  }
  return normalized;
}

/**
 * Decide the stored name for a location against a list of existing rows.
 * @param {Array<{id:number,name:string,parent_id:number|null}>} existing
 * @param {{ name: string, parent: {id:number,name:string}|null, excludeId?: number|null }} input
 * @returns {{ name: string, generated: boolean, originalName: string } | { error: string, status: number }}
 */
function planLocationName(existing, { name, parent, excludeId = null }) {
  const base = stripParentPrefix(name, parent?.name);
  if (!base) return { error: 'Location name is required', status: 400 };
  if (base.length > 255) return { error: 'Location name is too long (max 255 characters)', status: 400 };

  const others = existing.filter((row) => excludeId == null || Number(row.id) !== Number(excludeId));
  const baseKey = nameKey(base);
  const generated = parent ? generatedName(parent.name, base) : null;

  if (parent) {
    const sameParent = others.some(
      (row) => Number(row.parent_id) === Number(parent.id)
        && (nameKey(row.name) === baseKey || nameKey(row.name) === generated)
    );
    if (sameParent) {
      return { error: `Child location "${base}" already exists under "${parent.name}"`, status: 400 };
    }
  } else if (others.some((row) => row.parent_id == null && nameKey(row.name) === baseKey)) {
    return { error: `Parent location "${base}" already exists`, status: 400 };
  }

  if (!parent || !others.some((row) => nameKey(row.name) === baseKey)) {
    return { name: base, generated: false, originalName: base };
  }

  if (generated.length > 255) {
    return { error: `Location name "${generated}" is too long (max 255 characters)`, status: 400 };
  }
  if (others.some((row) => nameKey(row.name) === generated)) {
    return {
      error: `Location name "${generated}" is already in use. Please choose a different name.`,
      status: 400,
    };
  }
  return { name: generated, generated: true, originalName: base };
}

async function loadLocationRows(conn) {
  const [rows] = await conn.query('SELECT id, name, parent_id FROM locations');
  return rows;
}

async function loadParent(conn, parentId) {
  if (parentId == null) return null;
  const [[row]] = await conn.query('SELECT id, name FROM locations WHERE id = ?', [parentId]);
  return row || null;
}

/** Serialize name decisions + writes so two requests cannot claim the same name. */
async function withLocationNameLock(pool, fn) {
  const conn = await pool.getConnection();
  try {
    const [[{ locked }]] = await conn.query('SELECT GET_LOCK(?, ?) AS locked', [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
    if (locked !== 1) throw new Error('Location names are busy. Please try again.');
    try {
      return await fn(conn);
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
  } finally {
    conn.release();
  }
}

module.exports = {
  normalizeName,
  nameKey,
  generatedName,
  stripParentPrefix,
  planLocationName,
  loadLocationRows,
  loadParent,
  withLocationNameLock,
};
