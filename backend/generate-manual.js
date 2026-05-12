const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ShadingType, Header, Footer, PageNumber,
  NumberFormat, convertInchesToTwip, UnderlineType
} = require('docx');
const fs = require('fs');

const BRAND = '#1a1f36';
const ACCENT = '#7c8cf8';

function h1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    border: { bottom: { color: 'CCCCCC', size: 6, style: BorderStyle.SINGLE } },
  });
}

function h2(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
  });
}

function h3(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22, ...opts })],
    spacing: { after: 120 },
  });
}

function bold(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22 })],
    spacing: { after: 100 },
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    text,
    bullet: { level },
    spacing: { after: 80 },
    indent: { left: convertInchesToTwip(0.25 * (level + 1)) },
  });
}

function note(text) {
  return new Paragraph({
    children: [new TextRun({ text: `ℹ  ${text}`, italics: true, size: 20, color: '555555' })],
    spacing: { after: 120, before: 80 },
    indent: { left: convertInchesToTwip(0.3) },
  });
}

function spacer() {
  return new Paragraph({ text: '', spacing: { after: 100 } });
}

function makeTable(headers, rows, shadeHeader = true) {
  const headerRow = new TableRow({
    children: headers.map(h => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: h, bold: true, size: 20, color: 'FFFFFF' })],
        alignment: AlignmentType.LEFT,
      })],
      shading: shadeHeader ? { fill: '1a1f36', type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    })),
    tableHeader: true,
  });

  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map(cell => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: String(cell), size: 20 })],
      })],
      shading: ri % 2 === 0 ? { fill: 'F7F8FC', type: ShadingType.CLEAR } : undefined,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  }));

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: { top: 0, bottom: 200 },
  });
}

function codeBlock(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Courier New', size: 18, color: '333333' })],
    shading: { fill: 'F0F2F5', type: ShadingType.CLEAR },
    spacing: { before: 80, after: 80 },
    indent: { left: convertInchesToTwip(0.3), right: convertInchesToTwip(0.3) },
    border: {
      left: { color: '7c8cf8', size: 12, style: BorderStyle.SINGLE },
    },
  });
}

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22 } },
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1',
        run: { bold: true, size: 32, color: '1a1f36', font: 'Calibri' },
      },
      {
        id: 'Heading2', name: 'Heading 2',
        run: { bold: true, size: 26, color: '7c8cf8', font: 'Calibri' },
      },
      {
        id: 'Heading3', name: 'Heading 3',
        run: { bold: true, size: 23, color: '333333', font: 'Calibri' },
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        margin: {
          top: convertInchesToTwip(1),
          bottom: convertInchesToTwip(1),
          left: convertInchesToTwip(1.2),
          right: convertInchesToTwip(1.2),
        },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [new TextRun({ text: 'RFID Asset Management System — User Manual', size: 18, color: '888888' })],
          alignment: AlignmentType.RIGHT,
          border: { bottom: { color: 'CCCCCC', size: 4, style: BorderStyle.SINGLE } },
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          children: [
            new TextRun({ text: 'Page ', size: 18, color: '888888' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '888888' }),
            new TextRun({ text: ' of ', size: 18, color: '888888' }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '888888' }),
          ],
          alignment: AlignmentType.CENTER,
        })],
      }),
    },
    children: [
      // ── TITLE PAGE ──────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: 'RFID Asset Management System', bold: true, size: 52, color: '1a1f36' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 1200, after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'User Manual', size: 36, color: '7c8cf8' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Version 1.0', size: 22, color: '888888' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
      }),
      spacer(), spacer(), spacer(),

      // ── TABLE OF CONTENTS ────────────────────────────────────
      h1('Table of Contents'),
      ...[
        '1.  Getting Started',
        '2.  Login',
        '3.  Dashboard',
        '4.  Asset Management',
        '    4.1  Assets',
        '    4.2  Asset Types',
        '    4.3  Locations',
        '5.  Tracking',
        '    5.1  Trace History',
        '    5.2  Rules & Alerts',
        '6.  Data — Import',
        '7.  Reports',
        '8.  Manage Users',
        '9.  System Requirements & Setup',
      ].map(t => para(t)),
      spacer(),

      // ── 1. GETTING STARTED ───────────────────────────────────
      h1('1. Getting Started'),
      para('The RFID Asset Management System is a web-based application for tracking physical assets using RFID tags. It supports full asset lifecycle management — from adding assets and assigning locations, to tracking movements, setting alert rules, importing bulk data, and generating reports.'),
      spacer(),
      makeTable(['Component', 'Technology'], [
        ['Frontend', 'React 18'],
        ['Backend', 'Node.js / Express'],
        ['Database', 'MySQL 8'],
        ['Default URL', 'http://localhost:3000'],
      ]),

      // ── 2. LOGIN ─────────────────────────────────────────────
      h1('2. Login'),
      para('Open the application in your browser. You will be presented with the login screen.'),
      spacer(),
      makeTable(['Field', 'Description'], [
        ['Username', 'Your assigned username'],
        ['Password', 'Your password'],
      ]),
      spacer(),
      bold('Default Administrator Credentials:'),
      bullet('Username: administrator'),
      bullet('Password: admin'),
      spacer(),
      h3('Profile Types'),
      makeTable(['Profile', 'Access Level'], [
        ['Super Administrator', 'Full access including Manage Users'],
        ['Administrator', 'Full access except Manage Users. Can import data.'],
        ['Normal', 'Read-only access. Cannot add, edit, or delete any records.'],
      ]),
      note('After login, your username and profile type are shown at the bottom of the sidebar. Click Sign Out to log out.'),

      // ── 3. DASHBOARD ─────────────────────────────────────────
      h1('3. Dashboard'),
      para('The Dashboard provides a real-time overview of your asset inventory.'),
      spacer(),
      h3('Inventory Summary (left panel)'),
      bullet('Total Inventory — total number of assets in the system'),
      bullet('Missing Inventory — assets with inactive status'),
      bullet('Scanned Today — assets with recent movement activity'),
      bullet('Asset Types — number of asset type categories'),
      spacer(),
      h3('Recent Alerts (left panel)'),
      para('Displays the last 3 triggered alerts. Unread alerts appear in red.'),
      spacer(),
      h3('Global Asset Map (right panel)'),
      para('An interactive map area where you can upload a floor plan, site map, or world map image.'),
      bullet('Click Upload Map to select an image file (JPG, PNG, etc.)'),
      bullet('The image is saved in your browser and persists across sessions'),
      bullet('Click Clear to remove the uploaded map'),
      spacer(),
      h3('Recent Movements (bottom)'),
      para('Shows the last 3 asset location changes with asset name, RFID tag, from/to location, and timestamp.'),

      // ── 4. ASSET MANAGEMENT ──────────────────────────────────
      h1('4. Asset Management'),

      h2('4.1 Assets'),
      para('Navigate to Asset Management → Assets to view and manage all assets.'),
      spacer(),
      h3('Asset List'),
      para('The list displays: Asset Serial, Name, RFID Tag, Type, Location, Status.'),
      bullet('Click a column header to sort by that column (toggle ascending/descending)'),
      bullet('Use the Sorted By dropdown and Asc/Desc button for quick sorting'),
      bullet('Use the checkbox on each row to select assets for bulk actions'),
      spacer(),
      h3('Bulk Actions'),
      makeTable(['Button', 'Action'], [
        ['Change Location (n)', 'Move all selected assets to a new location at once'],
        ['Update Attribute (n)', 'Set an attribute value across all selected assets'],
      ]),
      spacer(),
      h3('Add Asset'),
      para('Click + Add Asset to open the Add Asset form.'),
      makeTable(['Field', 'Required', 'Description'], [
        ['Asset Serial', '✓', 'Unique serial number'],
        ['Asset Name', '✓', 'Display name'],
        ['RFID', '', 'Scan from RFID reader or enter manually'],
        ['Location', '', 'Current location (defaults to Default)'],
        ['Asset Type', '✓', 'Category of the asset'],
        ['Status', '', 'Active / Inactive / Maintenance'],
        ['Description', '', 'Optional notes'],
        ['Attributes', '', 'Shown automatically based on selected Asset Type. Pre-filled with default values if set.'],
      ]),
      spacer(),
      h3('Asset Detail View'),
      para('Click an asset name or View to open the asset detail screen.'),
      bullet('Info Card — Name, RFID Tag, Asset Type, Last Known Location, Status, Created date'),
      bullet('Trace History tab — full movement history with Duration column'),
      bullet('Attributes tab — view and edit attribute values. Click Save Attributes to save.'),
      bullet('Edit Asset — edit Serial, Name, RFID, Location, Asset Type, Status'),
      bullet('Change Location — move the asset and log a movement history entry'),
      spacer(),
      h3('Trace History Duration'),
      para('The Duration column shows how long an asset stayed at each location before moving. The current location shows time elapsed since arrival, displayed in blue.'),
      note('Duration format examples: 3 Mins 17 Secs · 2 Days 17 Hours · 1 Week 2 Days · 7 Months 3 Weeks'),

      h2('4.2 Asset Types'),
      para('Navigate to Asset Management → Asset Types to manage asset categories.'),
      spacer(),
      h3('Add Asset Type'),
      para('Click + Add Asset Type, enter a Name and optional Description, then click Save.'),
      spacer(),
      h3('Attributes'),
      para('Each asset type can have custom attributes. Click Attributes on an asset type card to expand.'),
      makeTable(['Attribute Type', 'Description'], [
        ['String', 'Text value'],
        ['Double', 'Numeric value'],
        ['Date', 'Date picker'],
        ['List', 'Dropdown with predefined options'],
      ]),
      spacer(),
      para('Click + Add Attribute, enter a name, select a type, optionally set a default value, and save.'),
      bullet('For List type: add options one by one using the Add button'),
      bullet('Default Value — pre-fills the attribute when adding a new asset of this type'),

      h2('4.3 Locations'),
      para('Navigate to Asset Management → Locations to manage physical locations.'),
      para('Locations support a tree hierarchy — a location can have a parent location (e.g. Building → Floor → Room).'),
      spacer(),
      h3('Add Location'),
      para('Click + Add Location, enter a Name, optional Description, and optionally select a Parent Location.'),
      spacer(),
      h3('Location Tree'),
      para('The left panel shows the location hierarchy. Click a location to view its details on the right.'),

      // ── 5. TRACKING ──────────────────────────────────────────
      h1('5. Tracking'),

      h2('5.1 Trace History'),
      para('Navigate to Tracking → Trace History to view all asset movements across the system.'),
      spacer(),
      makeTable(['Column', 'Description'], [
        ['Asset', 'Asset name'],
        ['RFID Tag', 'RFID identifier'],
        ['From', 'Previous location'],
        ['To', 'New location'],
        ['Date & Time', 'When the movement occurred'],
        ['Duration', 'How long the asset stayed at the "To" location. Current location shows time elapsed since arrival (in blue).'],
      ]),
      note('Use the All Assets dropdown to filter movements by a specific asset.'),

      h2('5.2 Rules & Alerts'),
      para('Navigate to Tracking → Rules & Alerts to manage automated alert rules.'),
      spacer(),
      h3('Alerts Tab'),
      para('Displays triggered alerts grouped by type: Asset · Inventory · Maintenance.'),
      bullet('Unread alerts are highlighted in yellow'),
      bullet('Click Mark All Read to clear the unread count'),
      bullet('Click Clear All to delete all alerts'),
      bullet('Click × on a row to delete a single alert'),
      bullet('The unread count badge on the sidebar updates every 3 seconds'),
      spacer(),
      h3('Rules Tab'),
      para('Displays all configured rules. Toggle the Active checkbox to enable/disable a rule without deleting it.'),
      spacer(),
      h3('Create Rule — 4-Step Wizard'),
      spacer(),
      bold('Step 1: Filter Type'),
      makeTable(['Filter', 'Triggers when...'], [
        ['Asset Filter', 'An asset enters, exits, stays at, is missing from, is added to, or is deleted from a location'],
        ['Inventory Filter', 'The count of assets at a location meets a condition (equal to / greater than / less than a number)'],
        ['Maintenance Filter', 'A date attribute on an asset is within a specified time window before or after the date'],
      ]),
      spacer(),
      bold('Step 2: Location & Asset Type'),
      bullet('Select a specific location or leave as "Any Location"'),
      bullet('Optionally check Include Sub-Locations to include child locations'),
      bullet('Select a specific asset type or leave as "Any Asset Type"'),
      spacer(),
      bold('Step 3: Condition'),
      spacer(),
      para('Asset Filter conditions:'),
      makeTable(['Action', 'Description'], [
        ['Enters', 'Asset moves into the selected location'],
        ['Exits', 'Asset moves out of the selected location'],
        ['Stays At', 'Asset has been at the location for more/less than a duration'],
        ['Not Scanned', 'Asset has not been scanned for a duration'],
        ['Is Missing', 'Asset has been missing for a duration'],
        ['Is Added', 'A new asset is created'],
        ['Is Deleted', 'An asset is deleted'],
      ]),
      spacer(),
      para('Inventory Filter: Set condition (equal to / greater than / less than) and a count value.'),
      spacer(),
      para('Maintenance Filter: Select a date attribute, enter an alert lead time (e.g. 7 days), and choose Before or After.'),
      note('Example: Alert 7 days Before the warranty date → fires when the warranty date is within 7 days.'),
      spacer(),
      bold('Step 4: Action & Save'),
      makeTable(['Action Type', 'Description'], [
        ['System Alert', 'Creates an in-app alert visible in the Alerts tab'],
        ['Email Alert', 'Sends an email to the specified address (requires SMTP configuration)'],
        ['Both', 'System alert + email'],
      ]),
      note('Alerts for Enters/Exits fire within seconds of a location change. Maintenance and Inventory rules are checked every 30 seconds.'),

      // ── 6. IMPORT ────────────────────────────────────────────
      h1('6. Data — Import'),
      para('Navigate to Data → Import to bulk import assets, asset types, or locations from a spreadsheet.'),
      note('Available to Administrator and Super Administrator only.'),
      spacer(),
      h3('Supported File Formats'),
      para('CSV · XLS · XLSX'),
      spacer(),
      h3('Import Tabs'),
      bullet('Import Assets'),
      bullet('Import Asset Types'),
      bullet('Import Locations'),
      spacer(),
      h3('Import Process — 3 Steps'),
      spacer(),
      bold('Step 1: Upload File'),
      bullet('Click ... to browse and select your file'),
      bullet('Click ⬇ Download sample spreadsheet to get a blank template with the correct headers'),
      spacer(),
      bold('Step 2: Map Fields'),
      para('The system auto-maps columns by matching header names. Review and adjust if needed.'),
      makeTable(['Column Type', 'Mapping'], [
        ['Known fields (Serial, Name, etc.)', 'Mapped to system fields via dropdown'],
        ['Extra columns', 'Shown as Attribute rows — select data type (String / Double / Date / List) or choose -Skip- to ignore'],
      ]),
      note('Mappings are remembered per import type. Next time you upload the same sheet format, they are pre-filled.'),
      spacer(),
      bold('Step 3: Preview'),
      makeTable(['Row Colour', 'Meaning'], [
        ['Green', 'New record — will be inserted'],
        ['Blue', 'Existing record — will be updated'],
        ['Red', 'Error — will be skipped (see Notes column for reason)'],
      ]),
      spacer(),
      bold('Smart Fix (Assets only):'),
      para('If asset types or locations in the file do not exist in the system, a dialog appears showing missing items.'),
      makeTable(['Button', 'Action'], [
        ['Smart Fix', 'Automatically creates the missing asset types and locations, then proceeds to preview'],
        ['Ignore', 'Skips creation — affected rows will show as errors in preview'],
        ['Abort', 'Cancels and returns to the mapping step'],
      ]),
      note('Click Import to execute. A summary shows Inserted / Updated / Errors counts.'),

      // ── 7. REPORTS ───────────────────────────────────────────
      h1('7. Reports'),
      para('Navigate to Reports for analytical views of your asset data.'),
      spacer(),
      h2('Dashboard Reports Tab'),
      makeTable(['Chart / Table', 'Description'], [
        ['Inventory / Missing', 'Pie chart showing active vs missing assets with percentages'],
        ['Assets by Type', 'Pie chart of asset distribution across types'],
        ['Assets by Location', 'Horizontal bar chart — top 10 locations by asset count, scrollable'],
        ['Most Transacted Assets', 'Table of assets with the most location changes (In/Out counts)'],
        ['Top Unscanned Locations', 'Locations where assets have not moved recently, with duration'],
      ]),
      spacer(),
      h2('Tagging Progress Reports Tab'),
      para('Shows how many assets were added to the system over time.'),
      bullet('Set a From and To date range and click Go'),
      bullet('Tagging Progress By Date — line chart of assets added per day'),
      bullet('Cumulative Tagging Progress — running total line chart'),

      // ── 8. MANAGE USERS ──────────────────────────────────────
      h1('8. Manage Users'),
      para('Navigate to Asset Management → Users (Super Administrator only).'),
      spacer(),
      h3('User List'),
      para('The left panel lists all users with their profile type. Click a user to view their details on the right.'),
      spacer(),
      h3('Add User'),
      para('Click + Add User to open the form.'),
      makeTable(['Field', 'Required', 'Description'], [
        ['User Name', '✓', 'Login username'],
        ['Email', '', 'Optional email address'],
        ['Profile Type', '✓', 'Super Administrator / Administrator / Normal (default: Administrator)'],
        ['Password', '✓ (new)', 'Login password'],
        ['Confirm Password', '', 'Must match password'],
      ]),
      spacer(),
      h3('Privileges'),
      spacer(),
      bold('Location Privileges'),
      bullet('Click ... to open the location picker'),
      bullet('Select specific locations or leave as "Any (All)"'),
      bullet('Check Modify / Delete to allow those operations'),
      spacer(),
      bold('Asset Type Privileges'),
      bullet('Click ... to select specific asset types or allow all'),
      bullet('Check Modify / Delete as needed'),
      spacer(),
      bold('Asset Privileges (Attribute-based)'),
      bullet('Click ... to open the attribute-based filter'),
      bullet('Select an attribute and enter a value, then click Add Attribute'),
      bullet('Add multiple attribute+value pairs — user sees only assets matching ALL conditions'),
      bullet('Combined with Location and Asset Type privileges for fine-grained access control'),
      note('When a user logs in, all data (assets, locations, asset types) is automatically filtered based on their privileges.'),
      spacer(),
      h3('Edit / Delete User'),
      para('Select a user from the list and click Edit or Delete in the detail panel.'),

      // ── 9. SETUP ─────────────────────────────────────────────
      h1('9. System Requirements & Setup'),

      h3('Prerequisites'),
      bullet('Node.js v18 or higher'),
      bullet('MySQL Server 8.0 or higher'),
      spacer(),
      h3('Database Setup'),
      para('Run the schema files in order from the server/ folder:'),
      codeBlock('mysql -u root -p < server/schema.sql'),
      codeBlock('mysql -u root -p asset_management < server/schema_v2.sql'),
      codeBlock('mysql -u root -p asset_management < server/schema_v3.sql'),
      codeBlock('mysql -u root -p asset_management < server/schema_v4.sql'),
      codeBlock('mysql -u root -p asset_management < server/schema_v5.sql'),
      codeBlock('mysql -u root -p asset_management < server/schema_v6.sql'),
      codeBlock('mysql -u root -p asset_management < server/schema_v7.sql'),
      codeBlock('mysql -u root -p asset_management < server/schema_v8.sql'),
      spacer(),
      para('Then seed the default admin user:'),
      codeBlock('cd server'),
      codeBlock('node seed-admin.js'),
      spacer(),
      h3('Backend Configuration'),
      para('Edit server/.env:'),
      codeBlock('DB_HOST=localhost'),
      codeBlock('DB_USER=root'),
      codeBlock('DB_PASSWORD=your_mysql_password'),
      codeBlock('DB_NAME=asset_management'),
      codeBlock('PORT=5000'),
      codeBlock(''),
      codeBlock('# Email alerts (optional)'),
      codeBlock('SMTP_HOST=smtp.gmail.com'),
      codeBlock('SMTP_PORT=587'),
      codeBlock('SMTP_USER=your-email@gmail.com'),
      codeBlock('SMTP_PASS=your-app-password'),
      codeBlock('SMTP_FROM=your-email@gmail.com'),
      spacer(),
      h3('Start the Application'),
      spacer(),
      bold('Terminal 1 — Backend:'),
      codeBlock('cd server'),
      codeBlock('npm install'),
      codeBlock('npm run dev'),
      para('Server runs on http://localhost:5000'),
      spacer(),
      bold('Terminal 2 — Frontend:'),
      codeBlock('cd client'),
      codeBlock('npm install'),
      codeBlock('npm start'),
      para('App runs on http://localhost:3000'),
      spacer(),
      h3('Email Alerts Setup (Gmail)'),
      bullet('Enable 2-Factor Authentication on your Google account'),
      bullet('Go to Google Account → Security → App Passwords'),
      bullet('Generate an App Password for "Mail"'),
      bullet('Use that password as SMTP_PASS in server/.env'),
      bullet('Restart the server'),
      spacer(), spacer(),
      new Paragraph({
        children: [new TextRun({ text: 'RFID Asset Management System — Internal Documentation', size: 18, color: '888888', italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
      }),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('RFID-Asset-Management-Manual.docx', buffer);
  console.log('✅ Manual generated: RFID-Asset-Management-Manual.docx');
});
