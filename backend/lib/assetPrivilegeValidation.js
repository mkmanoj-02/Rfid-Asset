/**
 * Validate users.asset_privileges (attribute-based asset visibility filters).
 */

const db = require('../db');
const { trimAttrName } = require('../attributeNameUtil');

/**
 * @param {unknown} raw
 * @returns {Promise<{ ok: true, value: null | Array<{ attribute_id: number, attribute_name: string, value: string }> } | { ok: false, message: string }>}
 */
async function validateAndNormalizeAssetPrivileges(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }

  let entries = raw;
  if (typeof raw === 'string') {
    try {
      entries = JSON.parse(raw);
    } catch {
      return { ok: false, message: 'asset_privileges must be valid JSON' };
    }
  }

  if (!Array.isArray(entries)) {
    return { ok: false, message: 'asset_privileges must be an array' };
  }

  if (entries.length === 0) {
    return { ok: true, value: null };
  }

  const parsed = [];
  const seenIds = new Set();

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      return { ok: false, message: `asset_privileges[${i}]: must be an object` };
    }

    const providedName = trimAttrName(e.attribute_name);
    const label = providedName || `entry ${i + 1}`;

    if (
      e.attribute_id === undefined
      || e.attribute_id === null
      || e.attribute_id === ''
    ) {
      return {
        ok: false,
        message: `Asset privilege "${label}": attribute must be selected`,
      };
    }

    const attrId = parseInt(e.attribute_id, 10);
    if (Number.isNaN(attrId) || attrId <= 0) {
      return {
        ok: false,
        message: `Asset privilege "${label}": invalid attribute`,
      };
    }

    const value = e.value != null ? String(e.value).trim() : '';
    if (!value) {
      return {
        ok: false,
        message: `Asset privilege "${label}": value is required`,
      };
    }

    if (seenIds.has(attrId)) {
      return { ok: false, message: 'Duplicate attribute in asset_privileges' };
    }
    seenIds.add(attrId);

    parsed.push({ attrId, value, index: i, providedName });
  }

  const ids = [...seenIds];
  const ph = ids.map(() => '?').join(',');
  const [attrs] = await db.query(
    `SELECT id, name, attr_type FROM asset_type_attributes WHERE id IN (${ph})`,
    ids
  );
  const attrById = new Map(attrs.map((a) => [a.id, a]));

  const listAttrIds = attrs.filter((a) => a.attr_type === 'list').map((a) => a.id);
  const listOptionsByAttrId = new Map();
  if (listAttrIds.length) {
    const lph = listAttrIds.map(() => '?').join(',');
    const [opts] = await db.query(
      `SELECT attribute_id, option_value FROM attribute_list_options WHERE attribute_id IN (${lph})`,
      listAttrIds
    );
    for (const o of opts) {
      if (!listOptionsByAttrId.has(o.attribute_id)) {
        listOptionsByAttrId.set(o.attribute_id, []);
      }
      listOptionsByAttrId.get(o.attribute_id).push(String(o.option_value).trim());
    }
  }

  const normalized = [];

  for (const { attrId, value, index, providedName } of parsed) {
    const attr = attrById.get(attrId);
    if (!attr) {
      return {
        ok: false,
        message: `asset_privileges[${index}]: attribute id ${attrId} is not registered`,
      };
    }

    const canonicalName = trimAttrName(attr.name);
    if (providedName && providedName.toLowerCase() !== canonicalName.toLowerCase()) {
      return {
        ok: false,
        message: `asset_privileges[${index}]: attribute_name "${providedName}" does not match registered attribute "${canonicalName}"`,
      };
    }

    if (attr.attr_type === 'list') {
      const allowed = (listOptionsByAttrId.get(attrId) || []).map((v) => v.toLowerCase());
      if (!allowed.length) {
        return {
          ok: false,
          message: `asset_privileges[${index}]: attribute "${canonicalName}" has no list options configured`,
        };
      }
      if (!allowed.includes(value.toLowerCase())) {
        return {
          ok: false,
          message: `asset_privileges[${index}]: value "${value}" is not a valid option for attribute "${canonicalName}"`,
        };
      }
    }

    normalized.push({
      attribute_id: attrId,
      attribute_name: canonicalName,
      value,
    });
  }

  return { ok: true, value: normalized };
}

module.exports = { validateAndNormalizeAssetPrivileges };
