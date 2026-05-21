const express = require('express');
const router = express.Router();
const publicLocationsController = require('../controllers/publicLocationsController');

// No verifyToken — mounted before global auth in index.js

/** Combined list + tree (recommended for Android) */
router.get('/', publicLocationsController.getLocationsForAndroid);

router.get('/list', publicLocationsController.getLocationList);
router.get('/tree', publicLocationsController.getLocationTree);

module.exports = router;
