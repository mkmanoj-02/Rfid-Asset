const express = require('express');
const router = express.Router();

// In-memory store of scanned RFID tags (simulates reader buffer)
// In production this would be fed by a WebSocket from the RFID reader hardware
let scannedTags = [];

// Reader posts tags here (handheld/fixed reader would call this)
router.post('/scan', (req, res) => {
  const { tag } = req.body;
  if (tag && !scannedTags.includes(tag)) {
    scannedTags.unshift(tag);
    if (scannedTags.length > 50) scannedTags.pop(); // keep last 50
  }
  res.json({ message: 'Tag received', tag });
});

// Frontend polls this to get available tags
router.get('/tags', (req, res) => {
  res.json(scannedTags);
});

// Clear tags after selection
router.delete('/tags/:tag', (req, res) => {
  scannedTags = scannedTags.filter(t => t !== req.params.tag);
  res.json({ message: 'Removed' });
});

router.delete('/tags', (req, res) => {
  scannedTags = [];
  res.json({ message: 'Cleared' });
});

module.exports = router;
