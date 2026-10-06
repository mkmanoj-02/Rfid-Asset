const express = require('express');
const router = express.Router();
const db = require('../db');
const { ok, envelopeNotFound, envelopeErrorHandler } = require('../lib/apiEnvelope');
const { isoSql, toSqlUtc } = require('../lib/rfidTime');

// GET /api/rfid-dashboard — RFID middleware counters (spec "GET /dashboard";
// /api/dashboard stays the Asset Management dashboard)
router.get('/', async (req, res) => {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);

  const [[counts]] = await db.query(
    `SELECT COUNT(*) AS totalReaders,
            COALESCE(SUM(status = 'RUNNING'), 0) AS running
       FROM readers`
  );
  const [[{ tagsToday }]] = await db.query(
    'SELECT COUNT(*) AS tagsToday FROM tag_events WHERE event_time >= ? AND event_time < ?',
    [toSqlUtc(dayStart), toSqlUtc(dayEnd)]
  );
  const [[service]] = await db.query('SELECT status FROM service_state WHERE id = 1');
  const [[stats]] = await db.query(
    `SELECT successful_posts, failed_posts, tags_posted, ${isoSql('last_post_at')} AS last_post_iso
       FROM api_post_stats WHERE id = 1`
  );
  const [readers] = await db.query(
    `SELECT name, reader_type AS readerType, ip_address AS ipAddress, port, status
       FROM readers ORDER BY name`
  );

  const totalReaders = Number(counts.totalReaders);
  const running = Number(counts.running);
  ok(res, 'Success', {
    totalReaders,
    running,
    stopped: totalReaders - running,
    tagsToday: Number(tagsToday),
    serviceStatus: service ? service.status : 'NOT_CREATED',
    server: {
      successfulPosts: Number(stats?.successful_posts || 0),
      failedPosts: Number(stats?.failed_posts || 0),
      tagsPosted: Number(stats?.tags_posted || 0),
      lastPost: stats?.last_post_iso || null,
    },
    readers,
  });
});

router.use(envelopeNotFound);
router.use(envelopeErrorHandler);

module.exports = router;
