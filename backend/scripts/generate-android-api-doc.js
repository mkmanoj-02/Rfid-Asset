/**
 * Generates docs/Android_Mobile_API.docx — Android handheld APIs (login, catalog, sync, tag assign, edit).
 * Usage: node scripts/generate-android-api-doc.js
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
const OUT_FILE = path.join(OUT_DIR, 'Android_Mobile_API.docx');
const BASE_URL = 'https://testrfidasset.2cqr.in';

const METHOD_COLORS = {
  GET: '2E7D32',
  POST: '1565C0',
  PUT: 'EF6C00',
  PATCH: '6A1B9A',
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

function cell(text, { bold = false, color, fill } = {}) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold, size: 19, color })] })],
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
  if (spec.badge) out.push(para(spec.badge, { bold: true, color: spec.badge.startsWith('NEW') ? '2E7D32' : 'EF6C00' }));
  if (spec.description) out.push(para(spec.description));
  out.push(para(`Auth: ${spec.auth === false ? 'None (public)' : 'Bearer access token required'}${spec.permission ? ` · ${spec.permission}` : ''}`, { italics: true, color: '555555' }));

  if (spec.params) {
    out.push(label('Path parameters'));
    out.push(table(['Name', 'Type', 'Description'], spec.params));
  }
  if (spec.query) {
    out.push(label('Query parameters'));
    out.push(table(['Name', 'Type', 'Description'], spec.query));
  }
  if (spec.fields) {
    out.push(label('Body fields'));
    out.push(table(['Field', 'Type', 'Description'], spec.fields));
  }
  if (spec.request !== undefined) {
    out.push(label(spec.requestLabel || 'Request body'));
    out.push(...codeBlock(typeof spec.request === 'string' ? spec.request : json(spec.request)));
  }
  if (spec.notes?.length) {
    out.push(label('Behaviour'));
    for (const n of spec.notes) out.push(bullet(n));
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

const UNAUTH = [
  {
    code: 401,
    desc: 'Missing Authorization header',
    body: { status: false, message: 'Access token required. Use Authorization: Bearer <token>' },
  },
  {
    code: 403,
    desc: 'Access token expired — call Refresh Token',
    body: { status: false, message: 'Access token expired', code: 'TOKEN_EXPIRED' },
  },
];

const NO_MODIFY = {
  code: 403,
  desc: 'User has no asset modify permission',
  body: { message: 'You do not have permission to modify assets' },
};

const ID_PARAM = [['id', 'integer', 'Asset id (server id)']];

const ASSET = {
  id: 1234,
  serial: 'AST-20001',
  name: 'Dell Latitude 5440',
  assetTypeId: 3,
  locationId: 7,
  rfid: 'E28000000000000000000001',
  description: 'Assigned to IT',
  imageUrl: `${BASE_URL}/uploads/asset-types/laptop.png`,
  attachmentUrl: `${BASE_URL}/uploads/attachments/1759040000000-123456.pdf`,
  attachmentName: 'warranty.pdf',
  attributes: { manufacturer: 'Dell', model: 'Latitude 5440', warranty_expiry: '2027-03-31' },
  status: 'INVENTORIED',
  inventoryStatus: 'inventory',
  lastSeenAt: 1759040000000,
  updatedAt: 1759040000000,
};

const UNTAGGED_ASSET = {
  ...ASSET,
  id: 1240,
  serial: 'AST-20010',
  name: 'HP Monitor 24"',
  rfid: null,
  attachmentUrl: null,
  attachmentName: null,
  attributes: { manufacturer: 'HP' },
  status: 'UNTAGGED',
};

const ASSET_FIELDS_TABLE = table(['Field', 'Type', 'Description'], [
  ['id', 'integer', 'Server asset id'],
  ['serial', 'string', 'Asset serial number (unique)'],
  ['name', 'string', 'Asset name'],
  ['assetTypeId', 'integer', 'Asset type id (see Asset Types)'],
  ['locationId', 'integer', 'Current location id'],
  ['rfid', 'string | null', 'RFID EPC. null when untagged'],
  ['description', 'string', 'Empty string when not set'],
  ['imageUrl', 'string | null', 'Full URL of the asset image (custom or inherited from the asset type)'],
  ['attachmentUrl', 'string | null', 'Full URL of the attachment'],
  ['attachmentName', 'string | null', 'Display name of the attachment'],
  ['attributes', 'object', '{ key: value } — keys match attributeDefs[].key of the asset type'],
  ['status', 'string', 'UNTAGGED (no rfid) | MISSING | INVENTORIED'],
  ['inventoryStatus', 'string', 'inventory | missing (not-in-inventory assets are reported as missing)'],
  ['lastSeenAt', 'number | null', 'Epoch ms of the latest movement'],
  ['updatedAt', 'number | null', 'Epoch ms of the last update'],
]);

// ── Sections ───────────────────────────────────────────────────

const intro = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'RFID Asset — Android Mobile API', bold: true, size: 40, color: '1a1f36' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [new TextRun({ text: 'Login, catalog download, dashboard sync, tag assign, asset details & edit', size: 22, color: '666666' })],
  }),

  h1('Overview'),
  para(`Base URL: ${BASE_URL}`),
  para('All bodies are JSON unless stated otherwise (image / attachment uploads use multipart/form-data). Every endpoint except Login, Refresh Token and Logout needs:'),
  ...codeBlock('Authorization: Bearer <accessToken>'),
  bullet('Run Login, store accessToken and refreshToken.'),
  bullet('When a request returns 401 / 403 TOKEN_EXPIRED, call Refresh Token and retry.'),
  bullet('Results respect the user\'s location, asset type and attribute privileges (same as the web app).'),
  bullet('IDs are integers. Timestamps in responses are epoch milliseconds.'),

  h2('Changes summary'),
  table(['Endpoint', 'Change'], [
    ['GET /api/public/locations (+ /list, /tree)', 'CHANGED — now requires the access token (URL unchanged)'],
    ['GET /api/mobile/asset-types', 'NEW'],
    ['GET /api/mobile/assets', 'NEW — supports since, untagged, q'],
    ['GET /api/mobile/assets/lookup', 'NEW'],
    ['GET /api/mobile/assets/{id}', 'NEW'],
    ['POST /api/mobile/assets', 'NEW'],
    ['PATCH /api/mobile/assets/{id}', 'NEW'],
    ['POST /api/mobile/assets/{id}/tag', 'NEW'],
    ['DELETE /api/mobile/assets/{id}/rfid', 'NEW'],
    ['POST /api/mobile/assets/{id}/image', 'NEW'],
    ['POST /api/mobile/assets/{id}/attachments', 'NEW'],
    ['POST /api/mobile/sync', 'NEW'],
  ]),

  h2('Status codes'),
  table(['Code', 'Meaning'], [
    ['200 OK', 'Request succeeded'],
    ['201 Created', 'Asset created'],
    ['400 Bad Request', 'Validation failed — see message'],
    ['401 Unauthorized', 'Missing token or wrong credentials'],
    ['403 Forbidden', 'Token expired, no permission, or location / type / asset not allowed'],
    ['404 Not Found', 'Asset / location not found (or outside the user\'s scope)'],
    ['409 Conflict', 'Serial or RFID already used by another asset'],
    ['500 Server Error', '{ "message": "..." }'],
  ]),

  h2('Asset object'),
  para('Returned by every asset endpoint.'),
  ASSET_FIELDS_TABLE,
  ...codeBlock(json(ASSET)),
];

const authSection = [
  endpoint({
    method: 'POST',
    path: '/api/auth/login',
    title: 'Login',
    auth: false,
    request: { username: 'administrator', password: 'admin' },
    success: [{
      code: 200,
      desc: 'Logged in',
      body: {
        status: true,
        message: 'Login successful',
        user: {
          id: 1,
          username: 'administrator',
          email: 'admin@example.com',
          profile_type: 'super_admin',
          asset_can_modify: true,
          asset_can_delete: true,
        },
        accessToken: '<jwt>',
        refreshToken: '<jwt>',
      },
    }],
    failures: [
      { code: 400, desc: 'Missing fields', body: { status: false, message: 'Username and password are required' } },
      { code: 401, desc: 'Wrong credentials', body: { status: false, message: 'Invalid username or password' } },
    ],
  }),
  endpoint({
    method: 'POST',
    path: '/api/auth/refresh-token',
    title: 'Refresh Token',
    auth: false,
    request: { refreshToken: '<jwt>' },
    success: [{
      code: 200,
      desc: 'New tokens (refresh token is rotated)',
      body: { status: true, message: 'Token refreshed', accessToken: '<jwt>', refreshToken: '<jwt>' },
    }],
    failures: [
      { code: 403, desc: 'Expired / revoked', body: { status: false, message: 'Invalid or revoked refresh token' } },
    ],
  }),
  endpoint({
    method: 'POST',
    path: '/api/auth/logout',
    title: 'Logout',
    auth: false,
    request: { refreshToken: '<jwt>' },
    success: [{ code: 200, desc: 'Refresh token revoked' }],
  }),
  endpoint({
    method: 'GET',
    path: '/api/auth/me',
    title: 'Current user',
    success: [{ code: 200, desc: 'User profile', body: { status: true, user: { id: 1, username: 'administrator', profile_type: 'super_admin' } } }],
    failures: UNAUTH,
  }),
];

const catalogSection = [
  endpoint({
    method: 'GET',
    path: '/api/mobile/asset-types',
    title: 'Asset types with attribute definitions',
    badge: 'NEW',
    notes: [
      'fieldType: TEXT | NUMBER | DATE | LIST. LIST attributes include options.',
      'image is the full URL of the asset type image (null when none).',
      'key is derived from the attribute name (lowercase, underscores) and is used in asset.attributes.',
    ],
    success: [{
      code: 200,
      desc: 'Asset types',
      body: {
        assetTypes: [
          {
            id: 3,
            name: 'Laptop',
            image: `${BASE_URL}/uploads/asset-types/laptop.png`,
            attributeDefs: [
              { id: 12, key: 'manufacturer', label: 'Manufacturer', fieldType: 'TEXT' },
              { id: 13, key: 'warranty_expiry', label: 'Warranty Expiry', fieldType: 'DATE' },
              { id: 14, key: 'ram_gb', label: 'RAM GB', fieldType: 'NUMBER' },
              { id: 15, key: 'condition', label: 'Condition', fieldType: 'LIST', options: ['New', 'Good', 'Damaged'] },
            ],
          },
        ],
      },
    }],
    failures: UNAUTH,
  }),
  endpoint({
    method: 'GET',
    path: '/api/mobile/assets',
    title: 'Assets catalog / search',
    badge: 'NEW',
    description: 'Every asset the user is allowed to see (all assigned locations).',
    query: [
      ['since', 'ISO 8601 datetime', 'Optional. Only assets updated after this time (incremental sync)'],
      ['untagged', 'true', 'Optional. Only assets without an RFID tag'],
      ['q', 'string', 'Optional. Search serial, name, or attribute value'],
    ],
    requestLabel: 'Examples',
    request: [
      'GET /api/mobile/assets',
      'GET /api/mobile/assets?since=2026-09-01T00:00:00Z',
      'GET /api/mobile/assets?untagged=true&q=monitor',
    ].join('\n'),
    success: [{ code: 200, desc: 'Assets', body: { assets: [ASSET, UNTAGGED_ASSET] } }],
    failures: [
      { code: 400, desc: 'Invalid since', body: { message: 'Invalid since; use ISO 8601 datetime' } },
      ...UNAUTH,
    ],
  }),
  endpoint({
    method: 'GET',
    path: '/api/public/locations',
    title: 'Locations list + tree',
    badge: 'CHANGED — now requires access token',
    query: [['location', 'integer', 'Optional. Return assets at this location (including sub-locations) instead']],
    success: [
      {
        code: 200,
        desc: 'Without location',
        body: {
          status: true,
          list: [{ id: 1, name: 'HQ', parent_id: null }, { id: 7, name: 'IT Room', parent_id: 1 }],
          tree: [{ id: 1, name: 'HQ', children: [{ id: 7, name: 'IT Room', children: [] }] }],
        },
      },
      {
        code: 200,
        desc: 'With ?location=7',
        body: { status: true, location: { id: 7, name: 'IT Room' }, assets: ['...'], asset_count: 1, location_scope_ids: [7] },
      },
    ],
    failures: [
      { code: 404, desc: 'Unknown location', body: { status: false, message: 'Location not found' } },
      ...UNAUTH,
    ],
  }),
  para('Also available with the token: GET /api/public/locations/list and GET /api/public/locations/tree → { status: true, data: [...] }.'),
];

const syncSection = [
  endpoint({
    method: 'POST',
    path: '/api/mobile/sync',
    title: 'Dashboard sync',
    badge: 'NEW',
    permission: 'asset modify permission',
    description: 'Send every asset still marked pending. The server applies them and returns the Sync Report.',
    fields: [
      ['deviceName', 'string', 'Handheld name (written to the audit log)'],
      ['assets[]', 'array', 'Pending assets'],
      ['assets[].id', 'string | integer', 'Local id for new assets, server id for existing ones'],
      ['assets[].clientAction', 'string', 'CREATE or UPDATE'],
      ['assets[].serial, name, assetTypeId, locationId', '', 'Required for CREATE; optional for UPDATE'],
      ['assets[].rfid', 'string | null', 'Any length; must be unique'],
      ['assets[].description, attributes', '', 'Optional'],
      ['assets[].status', 'string', 'INVENTORIED | MISSING | UNTAGGED (UNTAGGED clears the RFID)'],
      ['assets[].newlyTagged', 'boolean', 'Listed in newlyTaggedAssets when true'],
    ],
    request: {
      deviceName: 'Warehouse Handheld 3',
      syncedAt: 1759040000000,
      assets: [
        {
          id: 'asset-9f3a',
          clientAction: 'CREATE',
          serial: 'AST-20001',
          name: 'New Laptop',
          assetTypeId: 3,
          locationId: 7,
          rfid: 'E2800003E89999',
          description: '',
          attributes: { manufacturer: 'Dell', model: 'Latitude 5440' },
          status: 'INVENTORIED',
          lastSeenAt: 1759040000000,
          newlyTagged: true,
          updatedAt: 1759040000000,
        },
        { id: 1188, clientAction: 'UPDATE', status: 'MISSING' },
      ],
    },
    notes: [
      'CREATE inserts a new asset. If the serial already exists, that asset is updated instead (safe retries).',
      'UPDATE (or no action) finds the asset by numeric id, then by serial, and updates only the fields sent.',
      'Location / RFID changes are recorded in movement history.',
      'One failing asset does not stop the others — it is returned in errors.',
      'inventoriedCount / missingCount count the synced assets by their status.',
      'newlyTaggedAssets: replace the local id with serverId on the device.',
      'lastSyncTime: time of this sync in India time (IST), "YYYY-MM-DD HH:MM:SS". Store it as the device\'s last sync time.',
    ],
    success: [{
      code: 200,
      desc: 'Sync report',
      body: {
        inventoriedCount: 1,
        missingCount: 1,
        newlyTaggedAssets: [{ id: 'asset-9f3a', serverId: 1234, serial: 'AST-20001', name: 'New Laptop' }],
        errors: [],
        lastSyncTime: '2026-10-08 09:50:15',
      },
    }, {
      code: 200,
      desc: 'With a failed asset',
      body: {
        inventoriedCount: 0,
        missingCount: 0,
        newlyTaggedAssets: [],
        errors: [{ id: 'asset-7b2c', serial: 'AST-20009', message: 'RFID "E2800003E89999" is already used by asset 1234' }],
        lastSyncTime: '2026-10-08 09:50:15',
      },
    }],
    failures: [
      { code: 400, desc: 'assets missing', body: { message: 'assets array is required' } },
      NO_MODIFY,
      ...UNAUTH,
    ],
  }),
];

const tagSection = [
  endpoint({
    method: 'GET',
    path: '/api/mobile/assets?untagged=true&q={text}',
    title: 'Search untagged assets',
    badge: 'NEW',
    description: 'Same endpoint as the assets catalog, filtered to assets without an RFID tag and searched by serial, name, or attribute value.',
    success: [{ code: 200, desc: 'Untagged assets', body: { assets: [UNTAGGED_ASSET] } }],
    failures: UNAUTH,
  }),
  endpoint({
    method: 'GET',
    path: '/api/mobile/assets/lookup?rfid={epc}',
    title: 'Duplicate-tag check',
    badge: 'NEW',
    description: 'Call before saving a tag. 200 with the asset that already has the tag, or 404 if the tag is free.',
    success: [
      { code: 200, desc: 'Tag in use (asset in user scope)', body: ASSET },
      {
        code: 200,
        desc: 'Tag in use (asset outside user scope)',
        body: { id: 1300, serial: 'AST-30001', name: 'Forklift', rfid: 'E28000000000000000000001', inScope: false },
      },
    ],
    failures: [
      { code: 404, desc: 'Tag is free', body: { message: 'Tag is not assigned to any asset' } },
      { code: 400, desc: 'rfid missing', body: { message: 'rfid query parameter is required' } },
      ...UNAUTH,
    ],
  }),
  endpoint({
    method: 'POST',
    path: '/api/mobile/assets',
    title: 'Create asset',
    badge: 'NEW',
    permission: 'asset modify permission',
    description: 'Body matches the asset object including attributes. Status is always set to INVENTORIED.',
    fields: [
      ['serial', 'string', 'Required, unique'],
      ['name', 'string', 'Required'],
      ['assetTypeId', 'integer', 'Required'],
      ['locationId', 'integer', 'Required'],
      ['rfid', 'string', 'Optional, unique, any length'],
      ['description', 'string', 'Optional'],
      ['attributes', 'object', 'Optional { key: value }'],
    ],
    request: {
      serial: 'AST-20001',
      name: 'Dell Latitude 5440',
      assetTypeId: 3,
      locationId: 7,
      rfid: 'E28000000000000000000001',
      description: 'Assigned to IT',
      attributes: { manufacturer: 'Dell', model: 'Latitude 5440' },
    },
    success: [{ code: 201, desc: 'Created — returns the asset object', body: ASSET }],
    failures: [
      { code: 400, desc: 'Missing fields', body: { message: 'Missing required fields: serial, locationId' } },
      { code: 403, desc: 'Location / type not allowed', body: { message: 'Location not allowed for this user' } },
      { code: 409, desc: 'Serial or RFID in use', body: { message: 'Serial "AST-20001" is already used by asset 1234' } },
      NO_MODIFY,
      ...UNAUTH,
    ],
  }),
  endpoint({
    method: 'POST',
    path: '/api/mobile/assets/{id}/tag',
    title: 'Assign tag',
    badge: 'NEW',
    permission: 'asset modify permission',
    params: ID_PARAM,
    request: { rfid: 'E28000000000000000000001' },
    notes: [
      'Assigns the tag to the asset (replaces any existing tag) and sets it to INVENTORIED.',
      'Records an "RFID tagged" movement and removes the tag from unprocessed tags.',
      'If another asset has the tag → 409. Call DELETE /assets/{otherId}/rfid after the user confirms, then retry.',
    ],
    success: [{ code: 200, desc: 'Updated asset', body: ASSET }],
    failures: [
      {
        code: 409,
        desc: 'Tag already on another asset',
        body: {
          message: 'RFID "E28000000000000000000001" is already assigned to asset 1300',
          asset: { id: 1300, serial: 'AST-30001', name: 'Forklift', rfid: 'E28000000000000000000001' },
        },
      },
      { code: 400, desc: 'rfid missing', body: { message: 'rfid is required' } },
      { code: 403, desc: 'Asset outside user scope', body: { message: 'Asset not allowed for this user' } },
      { code: 404, desc: 'Unknown asset', body: { message: 'Asset not found' } },
      NO_MODIFY,
    ],
  }),
  endpoint({
    method: 'DELETE',
    path: '/api/mobile/assets/{id}/rfid',
    title: 'Remove tag',
    badge: 'NEW',
    permission: 'asset modify permission',
    params: ID_PARAM,
    description: 'Used when the user confirms replacing a tag that is already on another asset. No body.',
    success: [{ code: 200, desc: 'Asset without tag', body: { ...ASSET, id: 1300, serial: 'AST-30001', name: 'Forklift', rfid: null, status: 'UNTAGGED' } }],
    failures: [
      { code: 403, desc: 'Asset outside user scope', body: { message: 'Asset not allowed for this user' } },
      { code: 404, desc: 'Unknown asset', body: { message: 'Asset not found' } },
      NO_MODIFY,
    ],
  }),
  endpoint({
    method: 'POST',
    path: '/api/mobile/assets/{id}/image',
    title: 'Upload image',
    badge: 'NEW',
    permission: 'asset modify permission',
    params: ID_PARAM,
    description: 'multipart/form-data. Allowed: jpg, jpeg, png, webp, gif, svg. Max 5 MB. Replaces the asset image.',
    fields: [['file', 'file', 'Image file']],
    requestLabel: 'Request (multipart/form-data)',
    request: 'file = <photo.jpg>',
    success: [{ code: 200, desc: 'Uploaded', body: { imageUrl: `${BASE_URL}/uploads/assets/1759040000000-123456.jpg` } }],
    failures: [
      { code: 400, desc: 'No file / wrong type / too large', body: { message: 'File too large. Maximum size is 5MB.' } },
      { code: 404, desc: 'Unknown asset', body: { message: 'Asset not found' } },
      NO_MODIFY,
    ],
  }),
  endpoint({
    method: 'POST',
    path: '/api/mobile/assets/{id}/attachments',
    title: 'Upload attachment',
    badge: 'NEW',
    permission: 'asset modify permission',
    params: ID_PARAM,
    description: 'multipart/form-data. Allowed: pdf, jpg, jpeg, png, webp, doc, docx, xls, xlsx, csv, txt. Max 10 MB. One attachment per asset — a new upload replaces the old one.',
    fields: [
      ['file', 'file', 'Attachment file'],
      ['name', 'string', 'Optional display name (defaults to the file name)'],
    ],
    requestLabel: 'Request (multipart/form-data)',
    request: 'file = <warranty.pdf>\nname = warranty.pdf',
    success: [{
      code: 200,
      desc: 'Uploaded',
      body: { attachmentUrl: `${BASE_URL}/uploads/attachments/1759040000000-123456.pdf`, attachmentName: 'warranty.pdf' },
    }],
    failures: [
      { code: 400, desc: 'No file / wrong type / too large', body: { message: 'File too large. Maximum size is 10MB.' } },
      { code: 404, desc: 'Unknown asset', body: { message: 'Asset not found' } },
      NO_MODIFY,
    ],
  }),
];

const editSection = [
  endpoint({
    method: 'GET',
    path: '/api/mobile/assets/{id}',
    title: 'Asset details',
    badge: 'NEW',
    params: ID_PARAM,
    description: 'Open Asset Details when the record is not already local.',
    success: [{ code: 200, desc: 'Asset', body: ASSET }],
    failures: [
      { code: 404, desc: 'Unknown or outside user scope', body: { message: 'Asset not found' } },
      ...UNAUTH,
    ],
  }),
  endpoint({
    method: 'PATCH',
    path: '/api/mobile/assets/{id}',
    title: 'Update location (Search → context menu)',
    badge: 'NEW',
    permission: 'asset modify permission',
    params: ID_PARAM,
    request: { locationId: 12 },
    notes: [
      'Records a "Handheld location update" movement and runs alert rules.',
      'Sending the current location changes nothing.',
      'Removing a row from search results on the device does not call the server.',
    ],
    success: [{ code: 200, desc: 'Updated asset', body: { ...ASSET, locationId: 12 } }],
    failures: [
      { code: 400, desc: 'Invalid locationId', body: { message: 'Invalid locationId' } },
      { code: 403, desc: 'Location not allowed for user', body: { message: 'Location not allowed for this user' } },
      { code: 404, desc: 'Unknown location', body: { message: 'Location 12 not found' } },
      NO_MODIFY,
    ],
  }),
  endpoint({
    method: 'PATCH',
    path: '/api/mobile/assets/{id}',
    title: 'Edit asset',
    badge: 'NEW',
    permission: 'asset modify permission',
    params: ID_PARAM,
    fields: [
      ['name', 'string', 'Optional, cannot be empty'],
      ['description', 'string', 'Optional, empty string clears it'],
      ['attributes', 'object', 'Optional { key: value }; keys not sent stay unchanged'],
      ['serial, assetTypeId, rfid, imageUrl', '', 'Ignored (read-only on Edit)'],
    ],
    request: {
      name: 'Dell Latitude 5440',
      description: 'Assigned to IT',
      attributes: { manufacturer: 'Dell', model: 'Latitude 5440' },
    },
    notes: [
      'Only fields that are sent are changed.',
      'For a new image, upload it first with POST /api/mobile/assets/{id}/image.',
    ],
    success: [{ code: 200, desc: 'Updated asset', body: ASSET }],
    failures: [
      { code: 400, desc: 'Empty name', body: { message: 'name cannot be empty' } },
      { code: 403, desc: 'Asset outside user scope', body: { message: 'Asset not allowed for this user' } },
      { code: 404, desc: 'Unknown asset', body: { message: 'Asset not found' } },
      NO_MODIFY,
    ],
  }),
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
            new TextRun({ text: 'RFID Asset — Android Mobile API   |   Page ', size: 18, color: '888888' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '888888' }),
          ],
        })],
      }),
    },
    children: [
      ...intro,
      h1('1. Authentication'),
      ...authSection.flat(),
      h1('2. Catalog Download'),
      ...catalogSection.flat(),
      h1('3. Dashboard Sync'),
      ...syncSection.flat(),
      h1('4. Tag Assign'),
      ...tagSection.flat(),
      h1('5. Asset Details & Edit'),
      ...editSection.flat(),
    ],
  }],
});

fs.mkdirSync(OUT_DIR, { recursive: true });
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT_FILE, buf);
  console.log(`Written ${OUT_FILE}`);
});
