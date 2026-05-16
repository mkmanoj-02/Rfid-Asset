/** Full path e.g. "Site A › Building 1 › Room 101" from flat location list */
export function buildLocationPath(locations, locationId) {
  if (!locationId || !locations?.length) return '';
  const byId = new Map(locations.map((l) => [String(l.id), l]));
  const parts = [];
  let cur = byId.get(String(locationId));
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    const pid = cur.parent_id;
    cur = pid != null && pid !== '' ? byId.get(String(pid)) : null;
  }
  return parts.join(' › ');
}

export function flattenLocationTree(nodes, depth = 0, out = []) {
  if (!nodes?.length) return out;
  for (const node of nodes) {
    out.push({ ...node, _depth: depth });
    if (node.children?.length) flattenLocationTree(node.children, depth + 1, out);
  }
  return out;
}
