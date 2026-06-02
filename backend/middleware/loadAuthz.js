const { getActorUserId, loadUserAuthz } = require('../lib/userAuthz');

/** Attach req.authz for the authenticated user (one DB read per request). */
async function loadAuthz(req, res, next) {
  try {
    const userId = getActorUserId(req);
    if (userId) {
      req.authz = await loadUserAuthz(userId);
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = loadAuthz;
