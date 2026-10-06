/**
 * RFID tables store UTC in DATETIME(3). API timestamps are ISO 8601 with
 * milliseconds and an explicit +00:00 offset, e.g. 2026-05-19T14:32:11.482+00:00.
 */

/** SQL expression that renders a DATETIME(3) column as the API ISO string. */
function isoSql(column) {
  return `CONCAT(DATE_FORMAT(${column}, '%Y-%m-%dT%H:%i:%s.'), LPAD(FLOOR(MICROSECOND(${column}) / 1000), 3, '0'), '+00:00')`;
}

/** Date -> ISO string with milliseconds and +00:00. */
function toIso(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace('Z', '+00:00');
}

/** Date -> 'YYYY-MM-DD HH:MM:SS.mmm' (UTC) for DATETIME(3) parameters. */
function toSqlUtc(date) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Parse an incoming ISO 8601 timestamp. Requires a date and time; values
 * without an offset are treated as UTC. Returns a Date or null.
 */
function parseIso(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.test(s)) return null;
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const d = new Date(hasOffset ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = { isoSql, toIso, toSqlUtc, parseIso };
