/** Movement note recorded when a 24-character RFID tag is assigned or changed. */
const RFID_TAG_MOVEMENT_NOTE = 'RFID tagged';

function normalizeRfidTag(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function isValidRfidTag(value) {
  return normalizeRfidTag(value).length === 24;
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
  normalizeRfidTag,
  isValidRfidTag,
  shouldLogRfidTagMovement,
  insertRfidTagMovement,
};
