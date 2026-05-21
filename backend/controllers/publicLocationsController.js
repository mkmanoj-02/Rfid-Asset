const locationQueryService = require('../services/locationQueryService');
const assetQueryService = require('../services/assetQueryService');

/**
 * GET /api/public/locations
 * Android / public (no access token).
 * - No query: { list, tree }
 * - ?location=1 (or location_id): assets at that location (+ sub-locations)
 */
async function getLocationsForAndroid(req, res) {
  const locationParam = req.query.location ?? req.query.location_id;

  if (locationParam !== undefined && locationParam !== null && locationParam !== '') {
    const location = await locationQueryService.getLocationById(locationParam);
    if (!location) {
      return res.status(404).json({ status: false, message: 'Location not found' });
    }

    const result = await assetQueryService.getAssetsByLocationId(locationParam);
    if (result.error) {
      return res.status(400).json({ status: false, message: result.error });
    }

    return res.json({
      status: true,
      location,
      assets: result.assets,
      asset_count: result.assets.length,
      location_scope_ids: result.locationIds,
    });
  }

  const [list, tree] = await Promise.all([
    locationQueryService.getLocationList(),
    locationQueryService.getLocationTree(),
  ]);

  return res.json({
    status: true,
    list,
    tree,
  });
}

/**
 * GET /api/public/locations/list
 */
async function getLocationList(req, res) {
  const list = await locationQueryService.getLocationList();
  return res.json({ status: true, data: list });
}

/**
 * GET /api/public/locations/tree
 */
async function getLocationTree(req, res) {
  const tree = await locationQueryService.getLocationTree();
  return res.json({ status: true, data: tree });
}

module.exports = {
  getLocationsForAndroid,
  getLocationList,
  getLocationTree,
};
