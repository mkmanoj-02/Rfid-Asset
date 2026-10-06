/**
 * Generates docs/RFID_Middleware_API_Changes.docx — implemented / changed RFID middleware APIs
 * (Readers, Tag Reads, Reader Status, RFID Dashboard, Floor Layout & Plans, Service).
 * Usage: node scripts/generate-rfid-middleware-api-doc.js
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ShadingType, Footer, PageNumber,
  convertInchesToTwip,
} = require('docx');

const BASE_URL = 'https://testrfidasset.2cqr.in';
const OUT_DIR = path.join(__dirname, '..', '..', 'docs');
const OUT_FILE = path.join(OUT_DIR, 'RFID_Middleware_API_Changes.docx');

const METHOD_COLORS = { GET: '2E7D32', POST: '1565C0', PUT: 'EF6C00', DELETE: 'C62828' };

const json = (value) => JSON.stringify(value, null, 2);

function h1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    border: { bottom: { color: 'CCCCCC', size: 6, style: BorderStyle.SINGLE } },
  });
}

function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 } });
}

function label(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 21, color: '1a1f36' })],
    spacing: { before: 160, after: 60 },
  });
}

function para(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, size: 22, ...opts })], spacing: { after: 120 } });
}

function bullet(text) {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 60 } });
}

function codeBlock(text) {
  return text.split('\n').map((line, i, arr) => new Paragraph({
    children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18, color: '333333' })],
    shading: { fill: 'F0F2F5', type: ShadingType.CLEAR },
    spacing: { before: i === 0 ? 60 : 0, after: i === arr.length - 1 ? 100 : 0 },
    indent: { left: convertInchesToTwip(0.2), right: convertInchesToTwip(0.2) },
    border: { left: { color: '7c8cf8', size: 12, style: BorderStyle.SINGLE } },
  }));
}

function cell(text, { bold = false, color, fill, font } = {}) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold, size: 19, color, font })] })],
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

function table(headers, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h) => cell(h, { bold: true, color: 'FFFFFF', fill: '1a1f36' })),
      }),
      ...rows.map((row, ri) => new TableRow({
        children: row.map((c) => cell(c, { fill: ri % 2 === 0 ? 'F7F8FC' : undefined })),
      })),
    ],
  });
}

function endpointTitle(method, urlPath, title, tag) {
  const children = [
    new TextRun({ text: `${method} `, bold: true, color: METHOD_COLORS[method] || '000000' }),
    new TextRun({ text: urlPath, font: 'Consolas' }),
    new TextRun({ text: `  —  ${title}`, color: '555555' }),
  ];
  if (tag) children.push(new TextRun({ text: `  [${tag}]`, bold: true, color: tag === 'NEW' ? '2E7D32' : 'EF6C00', size: 18 }));
  return new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 280, after: 80 }, children });
}

function statusLine(code, desc) {
  return new Paragraph({
    spacing: { before: 100, after: 40 },
    children: [
      new TextRun({ text: `${code} `, bold: true, color: code < 300 ? '2E7D32' : 'C62828', size: 21 }),
      new TextRun({ text: desc, size: 21 }),
    ],
  });
}

function endpoint(spec) {
  const out = [endpointTitle(spec.method, spec.path, spec.title, spec.tag)];
  out.push(para(`URL: ${BASE_URL}${spec.path}`, { font: 'Consolas', size: 18, color: '555555' }));
  if (spec.description) out.push(para(spec.description));
  if (spec.notes) spec.notes.forEach((n) => out.push(bullet(n)));
  out.push(para(`Auth: ${spec.auth === false ? 'None (public)' : 'Bearer access token required'}`, { italics: true, color: '555555' }));
  if (spec.params) {
    out.push(label('Path parameters'));
    out.push(table(['Name', 'Type', 'Description'], spec.params));
  }
  if (spec.query) {
    out.push(label('Query parameters (all optional)'));
    out.push(table(['Name', 'Type', 'Description'], spec.query));
  }
  if (spec.request !== undefined) {
    out.push(label('Request body'));
    out.push(...codeBlock(typeof spec.request === 'string' ? spec.request : json(spec.request)));
  }
  out.push(label('Success response'));
  for (const s of spec.success) {
    out.push(statusLine(s.code, s.desc));
    if (s.body !== undefined) out.push(...codeBlock(typeof s.body === 'string' ? s.body : json(s.body)));
  }
  if (spec.failures?.length) {
    out.push(label('Failure cases'));
    for (const f of spec.failures) {
      out.push(statusLine(f.code, f.desc));
      if (f.body !== undefined) out.push(...codeBlock(json(f.body)));
    }
  }
  return out;
}

const ok = (message, data = null) => ({ status: true, message, data });
const err = (message, field) => ({ status: false, message, data: field ? { field } : null });

// ── Shared samples ─────────────────────────────────────────────

const UNAUTH = [
  { code: 401, desc: 'Missing / invalid Authorization header', body: { status: false, message: 'Access token required. Use Authorization: Bearer <token>' } },
  { code: 403, desc: 'Access token expired — call refresh-token, then retry', body: { status: false, message: 'Access token expired', code: 'TOKEN_EXPIRED' } },
];

const ID_PARAM = [['id', 'integer', 'Reader id']];
const PLAN_PARAM = [['id', 'string', 'Floor plan id (e.g. floor-1 or a UUID)']];

const READER = {
  id: 1,
  name: 'Dock-01',
  readerType: 'IR-Reader',
  ipAddress: '192.168.1.50',
  port: 2022,
  enabled: true,
  mode: 'IN',
  antennaCount: 4,
  txPower: 30,
  sameTxPower: false,
  readDuration: 1000,
  itemSeen: 20000,
  itemSeenEnabled: true,
  itemIn: 20000,
  itemOut: 20000,
  status: 'STOPPED',
  connectionStatus: 'DISCONNECTED',
  lastSeen: '2026-10-01T12:07:49.003+00:00',
  tagsReadCount: 5,
  error: null,
  antennas: [
    { number: 1, txPower: 30, rxSensitivity: -70, enabled: true },
    { number: 2, txPower: 30, rxSensitivity: -70, enabled: true },
    { number: 3, txPower: 30, rxSensitivity: -70, enabled: false },
    { number: 4, txPower: 28, rxSensitivity: -70, enabled: true },
  ],
};

const READER_BODY = {
  name: 'Dock-01',
  readerType: 'IR-Reader',
  ipAddress: '192.168.1.50',
  port: 2022,
  enabled: true,
  mode: 'IN',
  antennaCount: 4,
  txPower: 30,
  sameTxPower: false,
  readDuration: 1000,
  itemSeen: 20000,
  itemSeenEnabled: true,
  itemIn: 20000,
  itemOut: 20000,
  antennas: [
    { number: 1, txPower: 30, rxSensitivity: -70, enabled: true },
    { number: 2, txPower: 30, rxSensitivity: -70, enabled: true },
    { number: 3, txPower: 30, rxSensitivity: -70, enabled: true },
    { number: 4, txPower: 30, rxSensitivity: -70, enabled: true },
  ],
};

const READER_NOT_FOUND = { code: 404, desc: 'Unknown reader id', body: err('Reader not found') };

const ZONE = { id: '8d1c2a40-1b2e-4c3a-9f10-a1b2c3d4e5f6', type: 'DOOR', name: 'Door Zone', x: 80, y: 80, width: 220, height: 120 };
const PLAN = {
  id: 'floor-1',
  name: 'Floor 1',
  imageUrl: '/uploads/floor-plan/1759034700000-123456789.png',
  zones: [ZONE],
  placements: [{ readerName: 'Dock-01', placed: true, x: 120, y: 110, antennas: [{ number: 1, x: 200, y: 140 }] }],
};
const PLAN_NOT_FOUND = { code: 404, desc: 'Unknown floor plan id', body: err('Floor plan not found') };

// ── Sections ───────────────────────────────────────────────────

const authSection = [
  endpoint({
    method: 'POST',
    path: '/api/auth/login',
    title: 'Login (unchanged)',
    auth: false,
    description: 'Existing login API. The RFID middleware service and the RFID UI sign in here and send the accessToken as a Bearer token on every RFID request.',
    request: { username: '<username>', password: '<password>' },
    success: [{
      code: 200,
      desc: 'Login successful',
      body: {
        status: true,
        message: 'Login successful',
        user: { id: 1, username: 'admin', email: 'admin@example.com', profile_type: 'super_admin' },
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    }],
    failures: [{ code: 401, desc: 'Wrong username or password', body: { status: false, message: 'Invalid username or password' } }],
  }),
  endpoint({
    method: 'POST',
    path: '/api/auth/refresh-token',
    title: 'Refresh access token (unchanged)',
    auth: false,
    description: 'Call when an RFID request returns 403 TOKEN_EXPIRED. The refresh token is rotated.',
    request: { refreshToken: '<refreshToken>' },
    success: [{ code: 200, desc: 'Token refreshed', body: { status: true, message: 'Token refreshed', accessToken: '<new>', refreshToken: '<new>' } }],
  }),
];

const readersSection = [
  endpoint({
    method: 'GET',
    path: '/api/readers',
    title: 'List readers',
    tag: 'CHANGED',
    description: 'Every reader with configuration, runtime state and antennas, sorted by name. Response is now wrapped in the envelope: readers are in data.readers (previously a bare array).',
    success: [{ code: 200, desc: 'OK', body: ok('Success', { readers: [READER] }) }],
    failures: UNAUTH,
  }),
  endpoint({
    method: 'GET',
    path: '/api/readers/{id}',
    title: 'Get one reader',
    tag: 'CHANGED',
    params: ID_PARAM,
    success: [{ code: 200, desc: 'data = reader object', body: ok('Success', READER) }],
    failures: [READER_NOT_FOUND, ...UNAUTH],
  }),
  endpoint({
    method: 'POST',
    path: '/api/readers',
    title: 'Create reader',
    tag: 'CHANGED',
    notes: [
      'name and ipAddress are required (whitespace trimmed). name max 128, ipAddress max 64.',
      'readerType: IR-Reader | 4-Port Reader. mode: IN | OUT | MONITORING. port 1–65535. antennaCount 1–32.',
      'Only the first antennaCount antennas are kept. If sameTxPower is true, txPower is saved on every antenna.',
      'New readers start with status STOPPED, connectionStatus DISCONNECTED, tagsReadCount 0.',
      'Defaults when omitted: port 2022, enabled true, mode IN, antennaCount 4, txPower 30, sameTxPower false, readDuration 1000, itemSeen / itemIn / itemOut 20000, itemSeenEnabled true, rxSensitivity -70.',
    ],
    request: READER_BODY,
    success: [{ code: 201, desc: 'Reader created — data = full reader', body: ok('Reader created', { ...READER, lastSeen: null, tagsReadCount: 0 }) }],
    failures: [
      { code: 400, desc: 'name and ipAddress missing', body: err('Name and IP address are required.', 'name') },
      { code: 400, desc: 'Invalid readerType', body: err('Reader type must be IR-Reader or 4-Port Reader.', 'readerType') },
      { code: 400, desc: 'Invalid mode', body: err('Mode must be IN, OUT, or MONITORING.', 'mode') },
      { code: 400, desc: 'Invalid port', body: err('Port must be an integer between 1 and 65535.', 'port') },
      { code: 400, desc: 'Name longer than 128', body: err('Name is too long (max 128 characters).', 'name') },
      { code: 409, desc: 'Name already exists (case-insensitive)', body: err('A reader named Dock-01 already exists') },
      ...UNAUTH,
    ],
  }),
  endpoint({
    method: 'PUT',
    path: '/api/readers/{id}',
    title: 'Update reader',
    tag: 'CHANGED',
    description: 'Same body and validation as create. Runtime fields (status, connectionStatus, lastSeen, tagsReadCount, error) are never changed by this call, even if sent.',
    params: ID_PARAM,
    request: { ...READER_BODY, antennaCount: 2, sameTxPower: true, txPower: 28, antennas: undefined },
    success: [{ code: 200, desc: 'Reader updated — data = full reader', body: ok('Reader updated', { ...READER, antennaCount: 2, sameTxPower: true, txPower: 28, antennas: READER.antennas.slice(0, 2).map((a) => ({ ...a, txPower: 28 })) }) }],
    failures: [
      { code: 400, desc: 'Validation error (same rules as create)', body: err('IP address is required.', 'ipAddress') },
      READER_NOT_FOUND,
      { code: 409, desc: 'Another reader has this name', body: err('A reader named Gate-02 already exists') },
      ...UNAUTH,
    ],
  }),
  endpoint({
    method: 'DELETE',
    path: '/api/readers/{id}',
    title: 'Delete reader',
    tag: 'CHANGED',
    description: 'Deletes the reader, its antennas and its floor placements. Tag history is kept. Now returns 200 with a body (previously 204).',
    params: ID_PARAM,
    success: [{ code: 200, desc: 'Deleted', body: ok('Reader deleted', { deleted: 'Dock-01' }) }],
    failures: [READER_NOT_FOUND, ...UNAUTH],
  }),
];

const READ_SAMPLE = {
  epc: 'E2801160600002048B2A1C1E',
  tid: 'E2801160600002048B2A1C1E',
  antennaPort: 1,
  rssi: -54,
  readerName: 'Dock-01',
  readerType: 'IR-Reader',
  ipAddress: '192.168.1.50',
  mode: 'IN',
  location: '',
  zoneName: '',
  previousZoneName: '',
  eventType: 'IN',
  timestamp: '2026-09-30T09:52:11.123+00:00',
};

const tagReadsSection = [
  endpoint({
    method: 'POST',
    path: '/api/tag-reads',
    title: 'Upload a batch of tag events',
    tag: 'NEW',
    description: 'Called by the RFID middleware service. The service retries failed batches, so the same batch may arrive more than once — repeated events are counted as duplicates and never create a second row. Duplicate key: readerName + tid + eventType + timestamp.',
    notes: [
      '1–100 reads per batch, otherwise 400.',
      'Each read needs epc, tid, readerName and timestamp (ISO 8601). eventType must be IN, OUT or SEEN. mode (optional) must be IN, OUT or MONITORING.',
      'The whole batch is rejected if any read is invalid; data.field names the problem, e.g. reads[2].timestamp.',
      'Side effects: readers.tagsReadCount increases and lastSeen is set for the matching reader; dashboard post counters are updated.',
      'Asset link: when epc or tid matches an asset RFID tag, the asset\'s RFID last-seen time is updated. IN and OUT also add a Trace History (movement) row at the asset\'s current location — the asset location is never changed. SEEN only updates last seen.',
      'Unknown 24-character EPCs are added to Unassigned Tags (source "fixed-reader") so they can be assigned from the Android app.',
      'Reads from a reader name that is not configured are still stored and listed in unknownReaders.',
    ],
    request: { reads: [READ_SAMPLE] },
    success: [{
      code: 200,
      desc: 'Tag reads saved',
      body: ok('Tag reads saved', { accepted: 1, duplicates: 0, assetsMatched: 1, movementsLogged: 1, unassignedTags: 0, unknownReaders: [] }),
    }],
    failures: [
      { code: 400, desc: 'Empty batch', body: err('reads must contain at least one read.', 'reads') },
      { code: 400, desc: 'More than 100 reads', body: err('A batch can contain at most 100 reads.', 'reads') },
      { code: 400, desc: 'Missing epc', body: err('reads[0].epc is required.', 'reads[0].epc') },
      { code: 400, desc: 'Invalid eventType', body: err('eventType must be IN, OUT, or SEEN.', 'reads[0].eventType') },
      { code: 400, desc: 'Invalid timestamp', body: err('timestamp must be an ISO 8601 date-time.', 'reads[0].timestamp') },
      ...UNAUTH,
    ],
  }),
  endpoint({
    method: 'GET',
    path: '/api/tag-reads',
    title: 'Query tag events (Live Tags)',
    tag: 'NEW',
    description: 'Newest first. floor and zone come from where the antenna is placed on a floor plan (antenna position first, then reader position); null when not placed. antenna is "Antenna <n>".',
    query: [
      ['readerId', 'integer', 'Filter by reader id'],
      ['antennaPort', 'integer', 'Filter by antenna port'],
      ['from', 'ISO timestamp', 'Inclusive, e.g. 2026-09-30T00:00:00.000+00:00'],
      ['to', 'ISO timestamp', 'Inclusive'],
      ['eventType', 'string', 'IN | OUT | SEEN'],
      ['limit', 'integer', 'Default 100, max 500 (larger values are capped)'],
      ['offset', 'integer', 'Default 0'],
    ],
    request: undefined,
    success: [{
      code: 200,
      desc: 'OK',
      body: ok('Success', {
        total: 1,
        limit: 100,
        offset: 0,
        reads: [{
          id: 501,
          tid: 'E2801160600002048B2A1C1E',
          epc: 'E2801160600002048B2A1C1E',
          antennaPort: 1,
          rssi: -54,
          readerName: 'Dock-01',
          floor: 'Floor 1',
          zone: 'Door Zone',
          antenna: 'Antenna 1',
          timestamp: '2026-09-30T09:52:11.123+00:00',
          postedToServer: true,
          eventType: 'IN',
        }],
      }),
    }],
    failures: [
      { code: 400, desc: 'Invalid limit / offset / readerId', body: err('limit must be an integer of at least 1.', 'limit') },
      { code: 400, desc: 'Invalid from / to', body: err('from must be an ISO 8601 date-time.', 'from') },
      ...UNAUTH,
    ],
  }),
];

const readerStatusSection = [
  endpoint({
    method: 'GET',
    path: '/api/reader-status',
    title: 'Online / offline state of each reader',
    tag: 'NEW',
    description: 'online when connectionStatus = CONNECTED or status = RUNNING, otherwise offline.',
    success: [{ code: 200, desc: 'OK', body: ok('Success', { readers: [{ id: 1, name: 'Dock-01', status: 'online' }, { id: 2, name: 'Gate-02', status: 'offline' }] }) }],
    failures: UNAUTH,
  }),
  endpoint({
    method: 'POST',
    path: '/api/reader-status',
    title: 'Presence report (first report after service start)',
    tag: 'NEW',
    notes: [
      'POST and PUT behave the same (upsert). Every report is stored in reader_status_log.',
      'online → status RUNNING, connectionStatus CONNECTED, lastSeen = now, error cleared.',
      'offline → status STOPPED, connectionStatus DISCONNECTED, error cleared.',
      'Omit name to apply the status to all readers ("All readers are online").',
    ],
    request: { name: 'Dock-01', status: 'online' },
    success: [{ code: 200, desc: 'OK', body: ok('Dock-01 is online', { readers: [{ id: 1, name: 'Dock-01', status: 'online' }] }) }],
    failures: [
      { code: 400, desc: 'status not online / offline (case-insensitive)', body: err('status must be online or offline.', 'status') },
      { code: 404, desc: 'Unknown reader name', body: err('Reader Dock-99 not found') },
      ...UNAUTH,
    ],
  }),
  endpoint({
    method: 'PUT',
    path: '/api/reader-status',
    title: 'Presence report (subsequent changes)',
    tag: 'NEW',
    description: 'Same body, rules and responses as POST.',
    request: { name: 'Dock-01', status: 'offline' },
    success: [{ code: 200, desc: 'OK', body: ok('Dock-01 is offline', { readers: [{ id: 1, name: 'Dock-01', status: 'offline' }] }) }],
    failures: UNAUTH,
  }),
];

const dashboardSection = [
  endpoint({
    method: 'GET',
    path: '/api/rfid-dashboard',
    title: 'RFID dashboard counters',
    tag: 'NEW',
    description: 'The specification names this GET /dashboard. It is served at /api/rfid-dashboard because /api/dashboard is already the Asset Management dashboard (unchanged). All values are real counts from the database.',
    notes: [
      'running = readers with status RUNNING; stopped = totalReaders - running.',
      'tagsToday = tag events on the current server-local day.',
      'serviceStatus comes from the Service state; server comes from the tag-read post counters.',
    ],
    success: [{
      code: 200,
      desc: 'OK',
      body: ok('Success', {
        totalReaders: 3,
        running: 2,
        stopped: 1,
        tagsToday: 86,
        serviceStatus: 'RUNNING',
        server: { successfulPosts: 40, failedPosts: 1, tagsPosted: 860, lastPost: '2026-09-30T09:52:11.123+00:00' },
        readers: [{ name: 'Dock-01', readerType: 'IR-Reader', ipAddress: '192.168.1.50', port: 2022, status: 'RUNNING' }],
      }),
    }],
    failures: UNAUTH,
  }),
];

const floorSection = [
  endpoint({
    method: 'GET',
    path: '/api/floor-layout',
    title: 'All floor plans, zones and reader placements',
    tag: 'NEW',
    description: 'If there are no plans, a default plan floor-1 / "Floor 1" is returned. Exactly one plan is active (activeId).',
    success: [{ code: 200, desc: 'OK', body: ok('Success', { activeId: 'floor-1', plans: [PLAN] }) }],
    failures: UNAUTH,
  }),
  endpoint({
    method: 'PUT',
    path: '/api/floor-layout',
    title: 'Save the whole floor layout',
    tag: 'NEW',
    notes: [
      'Body = the data object from GET /api/floor-layout. Replaces all plans, zones and placements in one transaction; plans missing from the body are deleted.',
      'At least one plan; activeId must match a plan id; each plan needs id and name; each zone needs id, name and type DOOR or BIN.',
      'Placements whose readerName does not exist are silently dropped.',
    ],
    request: { activeId: 'floor-1', plans: [PLAN] },
    success: [{ code: 200, desc: 'Saved — data = saved layout', body: ok('Floor layout saved', { activeId: 'floor-1', plans: ['...'] }) }],
    failures: [
      { code: 400, desc: 'No plans', body: err('At least one floor plan is required.', 'plans') },
      { code: 400, desc: 'activeId does not match a plan', body: err('activeId must match a plan id.', 'activeId') },
      { code: 400, desc: 'Invalid zone type', body: err('Zone type must be DOOR or BIN.', 'zones.type') },
      ...UNAUTH,
    ],
  }),
  endpoint({
    method: 'POST',
    path: '/api/floor-plans',
    title: 'Create floor plan',
    tag: 'NEW',
    description: 'Generates a UUID id with an empty image and no zones / placements, and makes it the active plan.',
    request: { name: 'Floor 2' },
    success: [{ code: 201, desc: 'Created', body: ok('Floor plan created', { id: 'b7e1c2d0-4f1a-4c8e-9a3b-2d6f0e1c5a77', name: 'Floor 2', imageUrl: '', zones: [], placements: [] }) }],
    failures: [{ code: 400, desc: 'Name missing', body: err('Floor plan name is required.', 'name') }, ...UNAUTH],
  }),
  endpoint({
    method: 'PUT',
    path: '/api/floor-plans/{id}',
    title: 'Update one floor plan',
    tag: 'NEW',
    description: 'Replaces the plan\'s zones and placements (when sent). name and imageUrl are updated when sent.',
    params: PLAN_PARAM,
    request: { name: 'Floor 2', imageUrl: '', zones: [{ ...ZONE, id: '3f2b6c1e-7a4d-4e9b-8c21-0d5e6f7a8b9c', type: 'BIN', name: 'Bin Zone' }], placements: [] },
    success: [{ code: 200, desc: 'Updated — data = plan', body: ok('Floor plan updated', '{ ...plan }') }],
    failures: [PLAN_NOT_FOUND, { code: 400, desc: 'Invalid zone', body: err('Each zone needs a name.', 'zones.name') }, ...UNAUTH],
  }),
  endpoint({
    method: 'DELETE',
    path: '/api/floor-plans/{id}',
    title: 'Delete floor plan',
    tag: 'NEW',
    description: 'If the active plan is deleted, the first remaining plan becomes active. If none remain, a fresh "Floor 1" is created.',
    params: PLAN_PARAM,
    success: [{ code: 200, desc: 'Deleted', body: ok('Floor plan deleted', { activeId: 'floor-1' }) }],
    failures: [PLAN_NOT_FOUND, ...UNAUTH],
  }),
  endpoint({
    method: 'POST',
    path: '/api/floor-plans/{id}/image',
    title: 'Upload floor plan image',
    tag: 'NEW',
    description: 'multipart/form-data, field name "file". JPG, JPEG, PNG, WebP, GIF or SVG, max 5 MB, not empty. The returned imageUrl is public and can be loaded with a plain <img src> (prefix it with the base URL).',
    params: PLAN_PARAM,
    request: 'Content-Type: multipart/form-data\n\nfile = <floor.png>',
    success: [{ code: 200, desc: 'Uploaded', body: ok('Floor image uploaded', { id: 'floor-1', imageUrl: '/uploads/floor-plan/1759034700000-123456789.png' }) }],
    failures: [
      { code: 400, desc: 'No file in field "file"', body: err('An image file is required in the "file" field.', 'file') },
      { code: 400, desc: 'Not an image', body: err('Invalid file type. Allowed image types: .jpg, .jpeg, .png, .webp, .gif, .svg', 'file') },
      { code: 400, desc: 'Larger than 5 MB', body: err('File too large. Maximum size is 5MB.', 'file') },
      PLAN_NOT_FOUND,
      ...UNAUTH,
    ],
  }),
  endpoint({
    method: 'DELETE',
    path: '/api/floor-plans/{id}/image',
    title: 'Remove floor plan image',
    tag: 'NEW',
    params: PLAN_PARAM,
    success: [{ code: 200, desc: 'Removed', body: ok('Floor image removed', { id: 'floor-1', imageUrl: '' }) }],
    failures: [PLAN_NOT_FOUND, ...UNAUTH],
  }),
];

const SERVICE = (status, label) => ({ status, label, updatedAt: '2026-09-30T09:00:00.000+00:00' });
const serviceSection = [
  endpoint({
    method: 'GET',
    path: '/api/service',
    title: 'Middleware service state',
    tag: 'NEW',
    description: 'Labels: NOT_CREATED → "Not created", STOPPED → "Stopped", RUNNING → "Running".',
    success: [{ code: 200, desc: 'OK', body: ok('Success', SERVICE('RUNNING', 'Running')) }],
    failures: UNAUTH,
  }),
  endpoint({
    method: 'POST',
    path: '/api/service',
    title: 'Create service',
    tag: 'NEW',
    description: 'Allowed from NOT_CREATED → STOPPED.',
    success: [{ code: 200, desc: 'Created', body: ok('Service created', SERVICE('STOPPED', 'Stopped')) }],
    failures: [{ code: 409, desc: 'Service already exists', body: err('Delete the current service before creating another.') }, ...UNAUTH],
  }),
  endpoint({
    method: 'POST',
    path: '/api/service/start',
    title: 'Start service',
    tag: 'NEW',
    description: 'Allowed from STOPPED → RUNNING.',
    success: [{ code: 200, desc: 'Started', body: ok('Service started', SERVICE('RUNNING', 'Running')) }],
    failures: [
      { code: 409, desc: 'Already running', body: err('The service is already running.') },
      { code: 409, desc: 'Not created', body: err('The service has not been created.') },
      ...UNAUTH,
    ],
  }),
  endpoint({
    method: 'POST',
    path: '/api/service/stop',
    title: 'Stop service',
    tag: 'NEW',
    description: 'Allowed from RUNNING → STOPPED.',
    success: [{ code: 200, desc: 'Stopped', body: ok('Service stopped', SERVICE('STOPPED', 'Stopped')) }],
    failures: [{ code: 409, desc: 'Not running', body: err('The service is not running.') }, ...UNAUTH],
  }),
  endpoint({
    method: 'DELETE',
    path: '/api/service',
    title: 'Delete service',
    tag: 'NEW',
    description: 'Allowed from STOPPED or RUNNING → NOT_CREATED.',
    success: [{ code: 200, desc: 'Deleted', body: ok('Service deleted', SERVICE('NOT_CREATED', 'Not created')) }],
    failures: [{ code: 409, desc: 'Not created', body: err('The service has not been created.') }, ...UNAUTH],
  }),
];

// ── Document ───────────────────────────────────────────────────

const intro = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 1200, after: 200 },
    children: [new TextRun({ text: 'RFID Asset Management', bold: true, size: 48, color: '1a1f36' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'RFID Middleware API — Implemented & Changed Endpoints', size: 32, color: '7c8cf8' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [new TextRun({ text: `Based on RFID Middleware API Specification v2.0  ·  Generated ${new Date().toISOString().slice(0, 10)}`, size: 20, color: '888888' })],
  }),

  h1('1. Overview'),
  table(['Item', 'Value'], [
    ['Base URL', BASE_URL],
    ['Path prefix', 'All endpoints are under /api (e.g. /api/readers)'],
    ['Content type', 'application/json; charset=utf-8 (image upload: multipart/form-data)'],
    ['Authentication', 'Bearer access token from POST /api/auth/login on every request'],
    ['JSON naming', 'camelCase'],
    ['Timestamps', 'ISO 8601, milliseconds, +00:00 (UTC) — e.g. 2026-09-30T09:52:11.123+00:00'],
    ['Database', 'Existing Asset Management database (no separate rfid_middleware database)'],
  ]),

  h2('Response envelope'),
  para('Every RFID endpoint in this document returns:'),
  ...codeBlock(json({ status: true, message: 'Success', data: {} })),
  para('Errors return status false and data null. Validation errors (400) name the failing field:'),
  ...codeBlock(json({ status: false, message: 'Name and IP address are required.', data: { field: 'name' } })),
  para('Stack traces are never returned. Note: 401 / 403 responses come from the existing authentication layer and contain { status, message } (and code for expired tokens) without data.', { italics: true, color: '555555' }),

  h2('Status codes'),
  table(['Code', 'Meaning'], [
    ['200 OK', 'Success'],
    ['201 Created', 'Reader or floor plan created'],
    ['400 Bad Request', 'Validation error — data.field names the field'],
    ['401 Unauthorized', 'Missing or invalid access token'],
    ['403 Forbidden', 'Access token expired (code TOKEN_EXPIRED) — refresh and retry'],
    ['404 Not Found', 'Reader, floor plan or endpoint not found'],
    ['409 Conflict', 'Duplicate reader name or invalid service state transition'],
    ['500 Server Error', 'Unexpected error'],
  ]),

  h2('Enumerations'),
  table(['Name', 'Allowed values'], [
    ['readerType', 'IR-Reader, 4-Port Reader'],
    ['mode', 'IN, OUT, MONITORING'],
    ['eventType', 'IN, OUT, SEEN'],
    ['reader status', 'STOPPED, RUNNING, CONNECTING, ERROR, DISCONNECTED'],
    ['connectionStatus', 'CONNECTED, DISCONNECTED'],
    ['reader presence', 'online, offline'],
    ['zone type', 'DOOR, BIN'],
    ['service status', 'NOT_CREATED, STOPPED, RUNNING'],
  ]),

  h1('2. Summary of changes'),
  table(['Method', 'Path', 'Status', 'Purpose'], [
    ['GET', '/api/readers', 'CHANGED', 'Envelope (data.readers) + new fields'],
    ['GET', '/api/readers/{id}', 'CHANGED', 'Envelope + new fields'],
    ['POST', '/api/readers', 'CHANGED', 'New fields, sameTxPower, 409 message'],
    ['PUT', '/api/readers/{id}', 'CHANGED', 'New fields, runtime fields read-only'],
    ['DELETE', '/api/readers/{id}', 'CHANGED', '200 { deleted } instead of 204'],
    ['POST', '/api/tag-reads', 'NEW', 'Batch upload from the middleware service'],
    ['GET', '/api/tag-reads', 'NEW', 'Live Tags query'],
    ['GET / POST / PUT', '/api/reader-status', 'NEW', 'Reader presence'],
    ['GET', '/api/rfid-dashboard', 'NEW', 'RFID dashboard counters (spec: /dashboard)'],
    ['GET / PUT', '/api/floor-layout', 'NEW', 'All floor plans'],
    ['POST', '/api/floor-plans', 'NEW', 'Create floor plan'],
    ['PUT / DELETE', '/api/floor-plans/{id}', 'NEW', 'Update / delete floor plan'],
    ['POST / DELETE', '/api/floor-plans/{id}/image', 'NEW', 'Floor plan image'],
    ['GET / POST / DELETE', '/api/service, POST /api/service/start|stop', 'NEW', 'Service state machine'],
  ]),
  para(''),
  bullet('Unchanged: all Asset Management APIs, including /api/dashboard, /api/assets, /api/mobile and /api/auth.'),
  h2('Removed (not in the specification)'),
  bullet('Reader fields location and zoneType, and the reader / antenna placement fields placed, positionX, positionY, floorPlan. Reader positions are saved through PUT /api/floor-layout and PUT /api/floor-plans/{id}.'),
  bullet('POST /api/readers/{id}/start, /api/readers/{id}/stop, /api/readers/start-all, /api/readers/stop-all.'),
  bullet('PUT /api/readers/{id}/placement and PUT /api/readers/{id}/antennas/{n}/placement.'),
  bullet('GET /api/floor-plans and GET /api/floor-plans/{id} (use GET /api/floor-layout).'),
  bullet('The old single-plan /api/floor-plan endpoints and /api/reader-locations.'),

  h2('Asset integration (tag reads)'),
  bullet('Tag reads are matched to assets by RFID tag (epc, then tid).'),
  bullet('IN / OUT events add a Trace History entry at the asset\'s current location (note "RFID reader IN · Dock-01"). The asset location is never changed by a tag read.'),
  bullet('SEEN events only update the asset\'s RFID last-seen time.'),
  bullet('Unknown 24-character EPCs appear in Unassigned Tags with source "fixed-reader".'),
];

const readerFieldTable = [
  h2('Reader object'),
  table(['Field', 'Type', 'Notes'], [
    ['id', 'integer', 'Server-generated'],
    ['name', 'string', 'Required, unique (case-insensitive), max 128'],
    ['readerType', 'string', 'IR-Reader or 4-Port Reader'],
    ['ipAddress', 'string', 'Required, max 64'],
    ['port', 'integer', 'Default 2022'],
    ['enabled', 'boolean', 'NEW. Default true. The service only connects enabled readers'],
    ['mode', 'string', 'IN, OUT, MONITORING'],
    ['antennaCount', 'integer', '1–32, default 4'],
    ['txPower', 'integer', 'dBm, default 30'],
    ['sameTxPower', 'boolean', 'NEW. When true every antenna uses txPower'],
    ['readDuration', 'integer', 'ms, default 1000'],
    ['itemSeen', 'integer', 'Repeat interval for MONITORING, ms, default 20000'],
    ['itemSeenEnabled', 'boolean', 'Default true'],
    ['itemIn / itemOut', 'integer', 'NEW. Repeat interval for IN / OUT, ms, default 20000'],
    ['status', 'string', 'NEW. Runtime, read-only'],
    ['connectionStatus', 'string', 'Runtime, read-only'],
    ['lastSeen', 'string | null', 'NEW. Runtime, read-only'],
    ['tagsReadCount', 'integer', 'NEW. Runtime, read-only'],
    ['error', 'string | null', 'NEW. Runtime, read-only'],
    ['antennas', 'array', '{ number, txPower, rxSensitivity (NEW, default -70), enabled }'],
  ]),
  para('Responses also include createdAt and updatedAt, and per antenna id and readerId.', { italics: true, color: '555555' }),
];

const floorObjects = [
  h2('Floor objects'),
  bullet('FloorLayout — { activeId: string, plans: FloorPlan[] }'),
  bullet('FloorPlan — { id, name, imageUrl, zones: FloorZone[], placements: FloorPlacement[] }'),
  bullet('FloorZone — { id (uuid), type: "DOOR" | "BIN", name, x, y, width, height }'),
  bullet('FloorPlacement — { readerName, placed, x, y, antennas: [{ number, x, y }] }'),
  para('Coordinates are pixels on the floor plan image. Placements reference readers by name in the API.'),
];

const doc = new Document({
  styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
  sections: [{
    properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'RFID Asset — RFID Middleware API   |   Page ', size: 18, color: '888888' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '888888' }),
          ],
        })],
      }),
    },
    children: [
      ...intro,
      h1('3. Authentication'),
      ...authSection.flat(),
      h1('4. Readers'),
      ...readerFieldTable,
      ...readersSection.flat(),
      h1('5. Tag Reads'),
      ...tagReadsSection.flat(),
      h1('6. Reader Status'),
      ...readerStatusSection.flat(),
      h1('7. RFID Dashboard'),
      ...dashboardSection.flat(),
      h1('8. Floor Layout & Floor Plans'),
      ...floorObjects,
      ...floorSection.flat(),
      h1('9. Service Control (browser mode)'),
      para('Stores the middleware service state only — no operating-system process is started or stopped. Invalid transitions return 409.'),
      table(['Call', 'Allowed from', 'Result', 'Otherwise'], [
        ['GET /api/service', 'any', 'current state', '—'],
        ['POST /api/service', 'NOT_CREATED', 'STOPPED', '409'],
        ['POST /api/service/start', 'STOPPED', 'RUNNING', '409'],
        ['POST /api/service/stop', 'RUNNING', 'STOPPED', '409'],
        ['DELETE /api/service', 'STOPPED, RUNNING', 'NOT_CREATED', '409'],
      ]),
      ...serviceSection.flat(),
    ],
  }],
});

fs.mkdirSync(OUT_DIR, { recursive: true });
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT_FILE, buf);
  console.log(`Written ${OUT_FILE}`);
});
