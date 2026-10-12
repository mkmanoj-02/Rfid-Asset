/**
 * RFID tables store local time (RFID_TZ_OFFSET, default IST +05:30) in DATETIME(3).
 * API timestamps are ISO 8601 with milliseconds and that explicit offset,
 * e.g. 2026-05-19T20:02:11.482+05:30.
 */

const OFFSET = /^[+-]\d{2}:\d{2}$/.test(process.env.RFID_TZ_OFFSET || '')
  ? process.env.RFID_TZ_OFFSET
  : '+05:30';
const OFFSET_MS = (OFFSET.startsWith('-') ? -1 : 1)
  * (Number(OFFSET.slice(1, 3)) * 60 + Number(OFFSET.slice(4, 6))) * 60000;

/** SQL expression that renders a DATETIME(3) column as the API ISO string. */
function isoSql(column) {
  return `CONCAT(DATE_FORMAT(${column}, '%Y-%m-%dT%H:%i:%s.'), LPAD(FLOOR(MICROSECOND(${column}) / 1000), 3, '0'), '${OFFSET}')`;
}

/** Date -> ISO string with milliseconds and the local offset. */
function toIso(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + OFFSET_MS).toISOString().replace('Z', OFFSET);
}

/** Date -> 'YYYY-MM-DD HH:MM:SS.mmm' (local offset) for DATETIME(3) parameters. */
function toSqlLocal(date) {
  return new Date(date.getTime() + OFFSET_MS).toISOString().replace('T', ' ').replace('Z', '');
}

/** Current time as a DATETIME(3) parameter; use instead of UTC_TIMESTAMP(3) / NOW(3). */
function nowSql() {
  return toSqlLocal(new Date());
}

/** Local midnight today and tomorrow as DATETIME(3) parameters. */
function todayRangeSql() {
  const today = nowSql().slice(0, 10);
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return [`${today} 00:00:00.000`, `${tomorrow.toISOString().slice(0, 10)} 00:00:00.000`];
}

/**
 * Parse an incoming ISO 8601 timestamp. Requires a date and time; values
 * without an offset are treated as local (RFID_TZ_OFFSET). Returns a Date or null.
 */
function parseIso(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.test(s)) return null;
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const d = new Date(hasOffset ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}${OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = { OFFSET, isoSql, toIso, toSqlLocal, nowSql, todayRangeSql, parseIso };
