/**
 * Generates docs/Reader_FloorPlan_API.docx — Login, Reader Locations, Zones, Readers, Floor Plan.
 * Usage: node scripts/generate-reader-api-doc.js
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ShadingType, Footer, PageNumber,
  convertInchesToTwip,
} = require('docx');

const OUT_DIR = path.join(__dirname, '..', 'docs');
const OUT_FILE = path.join(OUT_DIR, 'Reader_FloorPlan_API.docx');

const METHOD_COLORS = {
  GET: '2E7D32',
  POST: '1565C0',
  PUT: 'EF6C00',
  DELETE: 'C62828',
};

function json(value) {
  return JSON.stringify(value, null, 2);
}

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
  return new Paragraph({
    children: [new TextRun({ text, size: 22, ...opts })],
    spacing: { after: 120 },
  });
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
    children: [new Paragraph({
      children: [new TextRun({ text: String(text), bold, size: 19, color, font })],
    })],
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

function endpointTitle(method, urlPath, title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 280, after: 80 },
    children: [
      new TextRun({ text: `${method} `, bold: true, color: METHOD_COLORS[method] || '000000' }),
      new TextRun({ text: urlPath, font: 'Consolas' }),
      new TextRun({ text: `  —  ${title}`, color: '555555' }),
    ],
  });
}

function statusLine(code, desc) {
  const ok = code < 300;
  return new Paragraph({
    spacing: { before: 100, after: 40 },
    children: [
      new TextRun({ text: `${code} `, bold: true, color: ok ? '2E7D32' : 'C62828', size: 21 }),
      new TextRun({ text: desc, size: 21 }),
    ],
  });
}

function endpoint(spec) {
  const out = [endpointTitle(spec.method, spec.path, spec.title)];
  if (spec.description) out.push(para(spec.description));
  out.push(para(`Auth: ${spec.auth === false ? 'None (public)' : 'Bearer access token required'}`, { italics: true, color: '555555' }));

  if (spec.params) {
    out.push(label('Path parameters'));
    out.push(table(['Name', 'Type', 'Description'], spec.params));
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

// ── Shared samples ─────────────────────────────────────────────

const UNAUTH_FAILURES = [
  {
    code: 401,
    desc: 'Missing Authorization header',
    body: { status: false, message: 'Access token required. Use Authorization: Bearer <token>' },
  },
  {
    code: 403,
    desc: 'Access token expired',
    body: { status: false, message: 'Access token expired', code: 'TOKEN_EXPIRED' },
  },
];

const ID_PARAM = [['id', 'integer', 'Record id (auto increment)']];

const READER_BODY = {
  name: 'Dock 1',
  readerType: 'IR-Reader',
  ipAddress: '192.168.1.20',
  port: 2022,
  location: 'Receiving dock',
  zoneType: 'DOOR',
  mode: 'IN',
  antennaCount: 4,
  txPower: 30,
  readDuration: 1000,
  itemSeen: 20,
  itemSeenEnabled: true,
  antennas: [
    { number: 1, txPower: 30, enabled: true },
    { number: 2, txPower: 30, enabled: true },
  ],
};

function antenna(n, extra = {}) {
  return {
    id: n,
    readerId: 1,
    number: n,
    txPower: 30,
    enabled: true,
    placed: false,
    positionX: 0,
    positionY: 0,
    ...extra,
  };
}

const READER_RESPONSE = {
  id: 1,
  name: 'Dock 1',
  readerType: 'IR-Reader',
  ipAddress: '192.168.1.20',
  port: 2022,
  location: 'Receiving dock',
  zoneType: 'DOOR',
  mode: 'IN',
  antennaCount: 4,
  txPower: 30,
  readDuration: 1000,
  itemSeen: 20,
  itemSeenEnabled: true,
  connectionStatus: 'DISCONNECTED',
  placed: false,
  positionX: 0,
  positionY: 0,
  floorPlan: '',
  createdAt: '2026-09-28T04:45:00.000Z',
  updatedAt: '2026-09-28T04:45:00.000Z',
  antennas: [antenna(1), antenna(2), antenna(3), antenna(4)],
};

const READER_NOT_FOUND = { code: 404, desc: 'Unknown reader id', body: { message: 'Reader not found' } };

const FLOOR_ZONE = {
  id: 1,
  type: 'DOOR',
  name: 'Door Zone',
  x: 80,
  y: 80,
  width: 220,
  height: 120,
  minimized: false,
};

// ── Sections ───────────────────────────────────────────────────

const authSection = [
  endpoint({
    method: 'POST',
    path: '/api/auth/login',
    title: 'Login',
    auth: false,
    description: 'Signs in and returns an access token (send as Bearer on every other request) and a refresh token.',
    request: { username: 'administrator', password: 'admin' },
    success: [{
      code: 200,
      desc: 'Login successful',
      body: {
        status: true,
        message: 'Login successful',
        user: {
          id: 1,
          username: 'administrator',
          email: 'admin@example.com',
          profile_type: 'super_admin',
        },
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    }],
    failures: [
      { code: 400, desc: 'Username or password missing', body: { status: false, message: 'Username and password are required' } },
      { code: 401, desc: 'Unknown user or wrong password', body: { status: false, message: 'Invalid username or password' } },
    ],
  }),
  endpoint({
    method: 'POST',
    path: '/api/auth/refresh-token',
    title: 'Refresh access token',
    auth: false,
    description: 'Exchanges a valid refresh token for a new access token. The refresh token is rotated.',
    request: { refreshToken: '<refreshToken>' },
    success: [{
      code: 200,
      desc: 'Token refreshed',
      body: { status: true, message: 'Token refreshed', accessToken: '<new access token>', refreshToken: '<new refresh token>' },
    }],
    failures: [
      { code: 400, desc: 'refreshToken missing', body: { status: false, message: 'refreshToken is required' } },
      { code: 403, desc: 'Expired, invalid, or revoked token', body: { status: false, message: 'Invalid or revoked refresh token' } },
    ],
  }),
  endpoint({
    method: 'POST',
    path: '/api/auth/logout',
    title: 'Logout',
    auth: false,
    request: { refreshToken: '<refreshToken>' },
    success: [{ code: 200, desc: 'Session revoked', body: { status: true, message: 'Logout successful' } }],
    failures: [
      { code: 400, desc: 'refreshToken missing', body: { status: false, message: 'refreshToken is required' } },
    ],
  }),
];

function catalogSection({ basePath, entity, sample, renamed, cascadeField }) {
  const notFound = { code: 404, desc: `Unknown ${entity.toLowerCase()} id`, body: { message: `${entity} not found` } };
  return [
    endpoint({
      method: 'GET',
      path: basePath,
      title: `List ${entity.toLowerCase()}s`,
      description: 'Sorted by name ascending.',
      success: [{ code: 200, desc: 'OK', body: sample.list }],
      failures: UNAUTH_FAILURES,
    }),
    endpoint({
      method: 'POST',
      path: basePath,
      title: `Create ${entity.toLowerCase()}`,
      request: { name: sample.create },
      success: [{ code: 201, desc: 'Created', body: { id: sample.newId, name: sample.create } }],
      failures: [
        { code: 400, desc: 'Name empty after trim', body: { message: 'Name is required' } },
        { code: 400, desc: 'Name longer than 120 characters', body: { message: 'Name is too long (max 120 characters)' } },
        { code: 409, desc: 'Name already exists (case-insensitive)', body: { message: `${entity} "${sample.create}" already exists` } },
        ...UNAUTH_FAILURES,
      ],
    }),
    endpoint({
      method: 'PUT',
      path: `${basePath}/{id}`,
      title: `Rename ${entity.toLowerCase()}`,
      description: `Every reader whose ${cascadeField} still stores the old name is updated to the new name.`,
      params: ID_PARAM,
      request: { name: renamed },
      success: [{ code: 200, desc: 'Updated', body: { id: sample.newId, name: renamed } }],
      failures: [
        { code: 400, desc: 'Name empty after trim', body: { message: 'Name is required' } },
        notFound,
        { code: 409, desc: 'Another record already has this name', body: { message: `${entity} "${renamed}" already exists` } },
        ...UNAUTH_FAILURES,
      ],
    }),
    endpoint({
      method: 'DELETE',
      path: `${basePath}/{id}`,
      title: `Delete ${entity.toLowerCase()}`,
      description: `Readers that used this name get ${cascadeField} set to an empty string.`,
      params: ID_PARAM,
      success: [{ code: 204, desc: 'Deleted — no response body' }],
      failures: [notFound, ...UNAUTH_FAILURES],
    }),
  ];
}

const locationsSection = catalogSection({
  basePath: '/api/reader-locations',
  entity: 'Location',
  cascadeField: 'location',
  renamed: 'North dock',
  sample: {
    create: 'Loading bay',
    newId: 8,
    list: [
      { id: 3, name: 'Aisle 4' },
      { id: 4, name: 'Cold storage' },
      { id: 2, name: 'North gate' },
      { id: 1, name: 'Receiving dock' },
      { id: 6, name: 'Stock room' },
      { id: 5, name: 'Warehouse dock' },
      { id: 7, name: 'Yard lane' },
    ],
  },
});

const zonesSection = catalogSection({
  basePath: '/api/zones',
  entity: 'Zone',
  cascadeField: 'zone_type',
  renamed: 'GATE',
  sample: {
    create: 'DOCK',
    newId: 3,
    list: [
      { id: 2, name: 'DOOR' },
      { id: 1, name: 'GENERIC' },
    ],
  },
});

const PLACEMENT_FAILURES = [
  { code: 400, desc: 'placed missing', body: { message: 'placed is required' } },
  { code: 400, desc: 'Non-numeric position', body: { message: 'positionX and positionY must be integers' } },
];

const readersSection = [
  endpoint({
    method: 'GET',
    path: '/api/readers',
    title: 'List readers',
    description: 'Every reader with its antennas, sorted by name.',
    success: [{ code: 200, desc: 'OK', body: [READER_RESPONSE] }],
    failures: UNAUTH_FAILURES,
  }),
  endpoint({
    method: 'GET',
    path: '/api/readers/{id}',
    title: 'Get one reader',
    params: ID_PARAM,
    success: [{ code: 200, desc: 'OK', body: READER_RESPONSE }],
    failures: [READER_NOT_FOUND, ...UNAUTH_FAILURES],
  }),
  endpoint({
    method: 'POST',
    path: '/api/readers',
    title: 'Create reader',
    description: 'Antenna rows are created up to antennaCount. Entries in antennas[] override txPower / enabled for that number; missing numbers use the reader txPower and enabled = true. connectionStatus always starts as DISCONNECTED.',
    request: READER_BODY,
    success: [{ code: 201, desc: 'Created — returns the saved reader', body: READER_RESPONSE }],
    failures: [
      { code: 400, desc: 'name missing', body: { message: 'Name is required' } },
      { code: 400, desc: 'ipAddress missing', body: { message: 'IP address is required' } },
      { code: 400, desc: 'readerType missing', body: { message: 'Reader type is required' } },
      { code: 400, desc: 'Invalid readerType', body: { message: 'Reader type must be IR-Reader or 4-Port Reader' } },
      { code: 400, desc: 'Invalid mode', body: { message: 'Mode must be IN, OUT, or MONITORING' } },
      { code: 400, desc: 'antennaCount outside 1–32', body: { message: 'Antenna count must be between 1 and 32' } },
      { code: 400, desc: 'Invalid port', body: { message: 'Port must be an integer between 1 and 65535' } },
      { code: 400, desc: 'location not in catalog', body: { message: 'Unknown location "Dock 9"' } },
      { code: 400, desc: 'zoneType not in catalog', body: { message: 'Unknown zone "GATE 9"' } },
      { code: 409, desc: 'Reader name already exists', body: { message: 'Reader "Dock 1" already exists' } },
      ...UNAUTH_FAILURES,
    ],
  }),
  endpoint({
    method: 'PUT',
    path: '/api/readers/{id}',
    title: 'Update reader',
    description: 'Same body as create. Changing antennaCount rebuilds antenna rows: numbers above the new count are removed, existing rows within range are kept, new numbers are added. Does not change connectionStatus or map placement.',
    params: ID_PARAM,
    request: { ...READER_BODY, readerType: '4-Port Reader', mode: 'OUT', antennaCount: 2 },
    success: [{
      code: 200,
      desc: 'Updated — returns the saved reader',
      body: { ...READER_RESPONSE, readerType: '4-Port Reader', mode: 'OUT', antennaCount: 2, antennas: [antenna(1), antenna(2)] },
    }],
    failures: [
      { code: 400, desc: 'Validation error (same rules as create)', body: { message: 'Name is required' } },
      READER_NOT_FOUND,
      { code: 409, desc: 'Another reader has this name', body: { message: 'Reader "Dock 2" already exists' } },
      ...UNAUTH_FAILURES,
    ],
  }),
  endpoint({
    method: 'DELETE',
    path: '/api/readers/{id}',
    title: 'Delete reader',
    description: 'Antennas are deleted with the reader.',
    params: ID_PARAM,
    success: [{ code: 204, desc: 'Deleted — no response body' }],
    failures: [READER_NOT_FOUND, ...UNAUTH_FAILURES],
  }),
  endpoint({
    method: 'POST',
    path: '/api/readers/{id}/start',
    title: 'Start reader',
    params: ID_PARAM,
    success: [{ code: 200, desc: 'connectionStatus set to CONNECTED', body: { ...READER_RESPONSE, connectionStatus: 'CONNECTED' } }],
    failures: [READER_NOT_FOUND, ...UNAUTH_FAILURES],
  }),
  endpoint({
    method: 'POST',
    path: '/api/readers/{id}/stop',
    title: 'Stop reader',
    params: ID_PARAM,
    success: [{ code: 200, desc: 'connectionStatus set to DISCONNECTED', body: READER_RESPONSE }],
    failures: [READER_NOT_FOUND, ...UNAUTH_FAILURES],
  }),
  endpoint({
    method: 'POST',
    path: '/api/readers/start-all',
    title: 'Start all readers',
    success: [{ code: 200, desc: 'Every reader set to CONNECTED', body: { message: 'All readers connected', count: 3 } }],
    failures: UNAUTH_FAILURES,
  }),
  endpoint({
    method: 'POST',
    path: '/api/readers/stop-all',
    title: 'Stop all readers',
    success: [{ code: 200, desc: 'Every reader set to DISCONNECTED', body: { message: 'All readers disconnected', count: 3 } }],
    failures: UNAUTH_FAILURES,
  }),
  endpoint({
    method: 'PUT',
    path: '/api/readers/{id}/placement',
    title: 'Place / remove reader on map',
    description: 'When placed is true the current floor plan image URL is copied into floorPlan. To take the reader off the map send { "placed": false, "positionX": 0, "positionY": 0 } — the reader row is kept.',
    params: ID_PARAM,
    request: { placed: true, positionX: 120, positionY: 80 },
    success: [{
      code: 200,
      desc: 'Returns the updated reader',
      body: { ...READER_RESPONSE, placed: true, positionX: 120, positionY: 80, floorPlan: '/uploads/floor-plan/1759034700000-123456789.png' },
    }],
    failures: [...PLACEMENT_FAILURES, READER_NOT_FOUND, ...UNAUTH_FAILURES],
  }),
  endpoint({
    method: 'PUT',
    path: '/api/readers/{id}/antennas/{number}/placement',
    title: 'Place / remove antenna on map',
    description: 'To take the antenna off the map send { "placed": false, "positionX": 0, "positionY": 0 }.',
    params: [['id', 'integer', 'Reader id'], ['number', 'integer', 'Antenna number (1–32)']],
    request: { placed: true, positionX: 160, positionY: 90 },
    success: [{ code: 200, desc: 'Returns the updated antenna', body: antenna(1, { placed: true, positionX: 160, positionY: 90 }) }],
    failures: [
      ...PLACEMENT_FAILURES,
      READER_NOT_FOUND,
      { code: 404, desc: 'No antenna with that number on the reader', body: { message: 'Antenna not found' } },
      ...UNAUTH_FAILURES,
    ],
  }),
];

const ZONE_NOT_FOUND = { code: 404, desc: 'Unknown floor zone id', body: { message: 'Zone not found' } };

const floorPlanSection = [
  endpoint({
    method: 'GET',
    path: '/api/floor-plan',
    title: 'Get layout',
    description: 'There is a single layout. imageUrl is an empty string when no image is uploaded.',
    success: [{
      code: 200,
      desc: 'OK',
      body: {
        imageUrl: '/uploads/floor-plan/1759034700000-123456789.png',
        zones: [FLOOR_ZONE, { ...FLOOR_ZONE, id: 2, type: 'BIN', name: 'Bin Zone', x: 104, y: 104 }],
      },
    }],
    failures: UNAUTH_FAILURES,
  }),
  endpoint({
    method: 'POST',
    path: '/api/floor-plan/image',
    title: 'Upload floor plan image',
    description: 'multipart/form-data with the file in field "image". JPG, JPEG, PNG, WebP, GIF, or SVG, max 5 MB. Replaces (and deletes) the previous image.',
    request: 'Content-Type: multipart/form-data\n\nimage = <file floor.png>',
    success: [{ code: 200, desc: 'Uploaded', body: { imageUrl: '/uploads/floor-plan/1759034700000-123456789.png' } }],
    failures: [
      { code: 400, desc: 'No file in field "image"', body: { message: 'Image file is required' } },
      { code: 400, desc: 'Unsupported file type', body: { message: 'Invalid file type. Allowed image types: .jpg, .jpeg, .png, .webp, .gif, .svg' } },
      { code: 400, desc: 'File larger than 5 MB', body: { message: 'File too large. Maximum size is 5MB.' } },
      ...UNAUTH_FAILURES,
    ],
  }),
  endpoint({
    method: 'DELETE',
    path: '/api/floor-plan/image',
    title: 'Remove floor plan image',
    success: [{ code: 204, desc: 'Image URL cleared — no response body' }],
    failures: UNAUTH_FAILURES,
  }),
  endpoint({
    method: 'POST',
    path: '/api/floor-plan/zones',
    title: 'Add door / bin zone',
    description: 'New zones are 220 × 120. The first door is "Door Zone", then "Door Zone 2", "Door Zone 3"… (same for "Bin Zone"). The first zone is at 80, 80 and each new zone shifts by 24 px on both axes.',
    request: { type: 'DOOR' },
    success: [{ code: 201, desc: 'Created', body: FLOOR_ZONE }],
    failures: [
      { code: 400, desc: 'type not DOOR or BIN', body: { message: 'type must be DOOR or BIN' } },
      ...UNAUTH_FAILURES,
    ],
  }),
  endpoint({
    method: 'PUT',
    path: '/api/floor-plan/zones/{id}',
    title: 'Move / resize / minimize zone',
    description: 'Send only the fields that changed. Move and resize send rounded integers. Minimize sends { "minimized": true }.',
    params: ID_PARAM,
    request: { x: 132, y: 96, width: 260, height: 140 },
    success: [{ code: 200, desc: 'Updated', body: { ...FLOOR_ZONE, x: 132, y: 96, width: 260, height: 140 } }],
    failures: [
      { code: 400, desc: 'x or y not an integer', body: { message: 'x must be an integer' } },
      { code: 400, desc: 'width or height below 1', body: { message: 'width must be a positive integer' } },
      ZONE_NOT_FOUND,
      ...UNAUTH_FAILURES,
    ],
  }),
  endpoint({
    method: 'DELETE',
    path: '/api/floor-plan/zones/{id}',
    title: 'Delete zone',
    params: ID_PARAM,
    success: [{ code: 204, desc: 'Deleted — no response body' }],
    failures: [ZONE_NOT_FOUND, ...UNAUTH_FAILURES],
  }),
  endpoint({
    method: 'POST',
    path: '/api/floor-plan/save',
    title: 'Save layout',
    description: 'Copies the current floor plan image URL onto every reader (readers.floor_plan).',
    success: [{
      code: 200,
      desc: 'Saved',
      body: { imageUrl: '/uploads/floor-plan/1759034700000-123456789.png', readersUpdated: 3 },
    }],
    failures: UNAUTH_FAILURES,
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
    children: [new TextRun({ text: 'Readers, Zones & Floor Plan API Reference', size: 32, color: '7c8cf8' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [new TextRun({ text: `Generated ${new Date().toISOString().slice(0, 10)}`, size: 20, color: '888888' })],
  }),

  h1('Overview'),
  para('Base URL (local): http://localhost:5004'),
  para('All request and response bodies are JSON unless stated otherwise. Every endpoint except Login, Refresh, and Logout needs the header:'),
  ...codeBlock('Authorization: Bearer <accessToken>'),
  para('IDs are auto-increment integers.'),

  h2('Status codes'),
  table(['Code', 'Meaning'], [
    ['200 OK', 'Request succeeded, body returned'],
    ['201 Created', 'Record created, body returns the new record'],
    ['204 No Content', 'Succeeded, no response body (deletes)'],
    ['400 Bad Request', 'Validation failed — see message'],
    ['401 Unauthorized', 'Missing token or wrong credentials'],
    ['403 Forbidden', 'Token expired / invalid, or refresh token revoked'],
    ['404 Not Found', 'Record id or endpoint does not exist'],
    ['409 Conflict', 'Duplicate name'],
    ['500 Server Error', 'Unexpected error — { "message": "..." }'],
  ]),

  h2('Catalog cascade rules'),
  bullet('Renaming a reader location updates every reader that still stores the old name in location.'),
  bullet('Deleting a reader location sets location to an empty string on readers that used it.'),
  bullet('Renaming a zone updates every reader that still stores the old name in zone_type.'),
  bullet('Deleting a zone sets zone_type to an empty string on readers that used it.'),
  bullet('Default locations: Receiving dock, North gate, Aisle 4, Cold storage, Warehouse dock, Stock room, Yard lane.'),
  bullet('Default zones: GENERIC, DOOR.'),
];

const readerFieldTable = [
  h2('Reader fields'),
  table(['Field', 'Type', 'Rules'], [
    ['name', 'string', 'Required, unique, max 120'],
    ['readerType', 'string', 'IR-Reader or 4-Port Reader (required on create)'],
    ['ipAddress', 'string', 'Required'],
    ['port', 'integer', 'Default 2022'],
    ['location', 'string', 'Must match a reader location name, or empty'],
    ['zoneType', 'string', 'Must match a zone name, or empty'],
    ['mode', 'string', 'IN, OUT, or MONITORING. Default IN'],
    ['antennaCount', 'integer', '1–32. Default 4'],
    ['txPower', 'integer', 'Default 30'],
    ['readDuration', 'integer', 'Milliseconds. Default 1000'],
    ['itemSeen', 'integer', 'Seconds. Default 20'],
    ['itemSeenEnabled', 'boolean', 'Default true'],
    ['antennas[]', 'array', '{ number, txPower, enabled } overrides per antenna'],
    ['connectionStatus', 'string', 'Read-only. Changed only by start / stop'],
    ['placed, positionX, positionY', 'bool / int', 'Read-only on save. Changed by placement endpoints'],
    ['floorPlan', 'string', 'Read-only. Image URL copied on placement or layout save'],
  ]),
];

const doc = new Document({
  styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
  sections: [{
    properties: {
      page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'RFID Asset — Readers & Floor Plan API   |   Page ', size: 18, color: '888888' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '888888' }),
          ],
        })],
      }),
    },
    children: [
      ...intro,
      h1('1. Authentication'),
      ...authSection.flat(),
      h1('2. Reader Locations'),
      para('Catalog names shown in the reader Location dropdown.'),
      ...locationsSection.flat(),
      h1('3. Zones'),
      para('Catalog names shown in the reader Zone dropdown. These are not the door and bin rectangles on the floor plan.'),
      ...zonesSection.flat(),
      h1('4. Readers'),
      ...readerFieldTable,
      ...readersSection.flat(),
      h1('5. Floor Plan'),
      para('One layout: one image, door and bin rectangles, and positions on readers and antennas.'),
      ...floorPlanSection.flat(),
    ],
  }],
});

fs.mkdirSync(OUT_DIR, { recursive: true });
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT_FILE, buf);
  console.log(`Written ${OUT_FILE}`);
});
