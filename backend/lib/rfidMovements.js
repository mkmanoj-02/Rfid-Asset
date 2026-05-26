/** Movement note recorded when a 24-character RFID tag is assigned or changed. */
const RFID_TAG_MOVEMENT_NOTE = 'RFID tagged';

function normalizeRfidTag(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function isValidRfidTag(value) {
  return normalizeRfidTag(value).length === 24;
}

const RFID_TAG_LENGTH_ERROR = 'RFID tag must be exactly 24 characters';

/** If RFID is present, it must be exactly 24 characters (same rule as assets create/update). */
function validateOptionalRfidTag(value, errors) {
  const tag = normalizeRfidTag(value);
  if (tag && !isValidRfidTag(tag)) {
    errors.push(RFID_TAG_LENGTH_ERROR);
    return false;
  }
  return true;
}

/** True when the new tag is valid and different from the previous value. */
function shouldLogRfidTagMovement(previousTag, nextTag) {
  const next = normalizeRfidTag(nextTag);
  if (!isValidRfidTag(next)) return false;
  return normalizeRfidTag(previousTag) !== next;
}

async function insertRfidTagMovement(executor, assetId, locationId) {
  if (!assetId || !locationId) return;
  await executor.query(
    'INSERT INTO movement_history (asset_id, from_location_id, to_location_id, notes) VALUES (?, ?, ?, ?)',
    [assetId, locationId, locationId, RFID_TAG_MOVEMENT_NOTE]
  );
}

module.exports = {
  RFID_TAG_MOVEMENT_NOTE,
  RFID_TAG_LENGTH_ERROR,
  normalizeRfidTag,
  isValidRfidTag,
  validateOptionalRfidTag,
  shouldLogRfidTagMovement,
  insertRfidTagMovement,
};
