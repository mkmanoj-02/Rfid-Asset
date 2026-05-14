/** Trim leading/trailing spaces only; preserve inner spacing and casing. */
function trimAttrName(name) {
  if (name === undefined || name === null) return '';
  return String(name).trim();
}

module.exports = { trimAttrName };
