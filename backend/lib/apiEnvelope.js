/**
 * Standard RFID API response envelope: { status, message, data }.
 * Errors: { status: false, message, data: null } — validation errors carry data: { field }.
 */

class ApiError extends Error {
  constructor(httpStatus, message, data = null) {
    super(message);
    this.httpStatus = httpStatus;
    this.data = data;
  }
}

function ok(res, message, data = null, httpStatus = 200) {
  return res.status(httpStatus).json({ status: true, message, data });
}

function fail(res, httpStatus, message, data = null) {
  return res.status(httpStatus).json({ status: false, message, data });
}

function validationError(message, field) {
  return new ApiError(400, message, field ? { field } : null);
}

function notFound(message) {
  return new ApiError(404, message);
}

function conflict(message) {
  return new ApiError(409, message);
}

/** Router-level 404 for unmatched paths under an RFID router. */
function envelopeNotFound(req, res) {
  return fail(res, 404, 'Not found');
}

/** Router-level error handler: never leaks stack traces. */
// eslint-disable-next-line no-unused-vars
function envelopeErrorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return fail(res, err.httpStatus, err.message, err.data);
  }
  if (err && err.type === 'entity.parse.failed') {
    return fail(res, 400, 'Request body is not valid JSON.');
  }
  if (err && err.type === 'entity.too.large') {
    return fail(res, 413, 'Request body is too large.');
  }
  if (err && err.code === 'ER_DUP_ENTRY') {
    return fail(res, 409, 'A record with the same unique value already exists.');
  }
  console.error('[rfid-api]', req.method, req.originalUrl, err && err.message);
  return fail(res, 500, 'Internal server error');
}

module.exports = {
  ApiError,
  ok,
  fail,
  validationError,
  notFound,
  conflict,
  envelopeNotFound,
  envelopeErrorHandler,
};
