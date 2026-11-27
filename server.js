require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Snipe-IT configuration - update this to your Snipe-IT URL
const SNIPEIT_URL = process.env.SNIPEIT_URL || 'http://localhost:8080';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Asset cache (stores processed assets for 10 minutes)
const assetCache = {
  data: null,
  timestamp: null,
  ttl: 10 * 60 * 1000 // 10 minutes
};

// Middleware
app.use(cors());
// Photos arrive as base64 data URLs (~1600px JPEG, usually < 1 MB), so allow larger JSON bodies
app.use(express.json({ limit: '15mb' }));
// Built React frontend (web/ -> web/dist via `pnpm build`). Hashed assets are immutable;
// HTML, the service worker and the manifest must always revalidate so PWA updates land.
const WEB_DIST = path.join(__dirname, 'web', 'dist');
app.use(express.static(WEB_DIST, {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Data directory (docker volume mounted at /app/db). Photos live next to the SQLite file
// so the existing volume persists both.
const DB_DIR = path.join(__dirname, 'db');
const PHOTO_DIR = path.join(DB_DIR, 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

// Initialize SQLite database
const db = new Database(path.join(DB_DIR, 'audits.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    asset_tag TEXT NOT NULL,
    asset_name TEXT,
    expected_location_id INTEGER,
    expected_location_name TEXT,
    actual_location_id INTEGER NOT NULL,
    actual_location_name TEXT NOT NULL,
    status TEXT NOT NULL,
    notes TEXT,
    user_name TEXT,
    snipeit_audit_posted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolved_by TEXT
  )
`);

// Add resolved columns if they don't exist (for existing databases)
try {
  db.exec(`ALTER TABLE audits ADD COLUMN resolved_at DATETIME`);
} catch (e) { /* Column already exists */ }
try {
  db.exec(`ALTER TABLE audits ADD COLUMN resolved_by TEXT`);
} catch (e) { /* Column already exists */ }
try {
  db.exec(`ALTER TABLE audits ADD COLUMN sap_asset_number TEXT`);
} catch (e) { /* Column already exists */ }

// Assets recorded without a QR code ("No QR / Add manually" flow)
db.exec(`
  CREATE TABLE IF NOT EXISTS manual_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_number TEXT NOT NULL,
    description TEXT NOT NULL,
    notes TEXT,
    photo_file TEXT,
    location_id INTEGER,
    location_name TEXT,
    user_name TEXT,
    registered INTEGER NOT NULL DEFAULT 0,
    snipeit_asset_id INTEGER,
    snipeit_asset_tag TEXT,
    snipeit_asset_name TEXT,
    sap_asset_number TEXT,
    expected_location_name TEXT,
    audit_status TEXT,
    audit_id INTEGER,
    snipeit_audit_posted INTEGER DEFAULT 0,
    snipeit_photo_uploaded INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snipeHeaders(apiToken) {
  return {
    'Authorization': `Bearer ${apiToken}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
}

function isAdmin(req) {
  return req.headers['x-admin-password'] === ADMIN_PASSWORD;
}

// Extract the SAP asset number from Snipe-IT custom fields
function extractSap(asset) {
  if (!asset || !asset.custom_fields) return null;
  const direct = asset.custom_fields['SAP Asset Number / ID'] || asset.custom_fields['SAP Asset Number'];
  if (direct) return direct.value || null;
  for (const [fieldName, fieldData] of Object.entries(asset.custom_fields)) {
    if (fieldName.toLowerCase().includes('sap') ||
        (fieldData && fieldData.field && fieldData.field.toLowerCase().includes('sap'))) {
      return (fieldData && fieldData.value) || null;
    }
  }
  return null;
}

// Find an asset by exact asset tag, or by SAP asset number. Returns the asset or null.
async function findAsset(apiToken, term) {
  const searchTerm = String(term || '').trim();
  if (!searchTerm) return null;
  const lower = searchTerm.toLowerCase();

  try {
    const tagResponse = await axios.get(`${SNIPEIT_URL}/api/v1/hardware/bytag/${encodeURIComponent(searchTerm)}`, {
      headers: snipeHeaders(apiToken)
    });
    if (tagResponse.data && tagResponse.data.id) return tagResponse.data;
  } catch (error) {
    if (error.response?.status === 401) throw error;
    // Not found by tag - fall through to search
  }

  const searchResponse = await axios.get(`${SNIPEIT_URL}/api/v1/hardware`, {
    headers: snipeHeaders(apiToken),
    params: { search: searchTerm, limit: 50 }
  });
  const assets = searchResponse.data.rows || [];

  const exactTag = assets.find(a => a.asset_tag && a.asset_tag.toLowerCase() === lower);
  if (exactTag) return exactTag;

  for (const asset of assets) {
    if (!asset.custom_fields) continue;
    for (const [fieldName, fieldData] of Object.entries(asset.custom_fields)) {
      const isSap = fieldName.toLowerCase().includes('sap') ||
        (fieldData && fieldData.field && fieldData.field.toLowerCase().includes('sap'));
      if (isSap && fieldData && fieldData.value && String(fieldData.value).toLowerCase() === lower) {
        return asset;
      }
    }
  }
  return null;
}

// Post an audit to Snipe-IT. Snipe-IT can answer HTTP 200 with {status:"error"}, so check the payload.
async function postSnipeAudit(apiToken, assetTag, locationId, note) {
  try {
    const response = await axios.post(`${SNIPEIT_URL}/api/v1/hardware/audit`, {
      asset_tag: assetTag,
      location_id: locationId,
      note
    }, { headers: snipeHeaders(apiToken) });
    if (response.data && response.data.status === 'error') {
      console.error('Snipe-IT audit rejected:', response.data.messages);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error posting audit to Snipe-IT:', error.response?.data || error.message);
    return false;
  }
}

// Attach a file to an asset (Snipe-IT: POST /api/v1/hardware/{id}/files, multipart "file[]").
async function uploadAssetPhoto(apiToken, assetId, filePath, notes) {
  try {
    const form = new FormData();
    const buffer = fs.readFileSync(filePath);
    form.append('file[]', new Blob([buffer], { type: 'image/jpeg' }), path.basename(filePath));
    if (notes) form.append('notes', notes);
    const response = await fetch(`${SNIPEIT_URL}/api/v1/hardware/${assetId}/files`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiToken}`, 'Accept': 'application/json' },
      body: form
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status === 'error') {
      console.error('Snipe-IT photo upload failed:', response.status, data.messages || data);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error uploading photo to Snipe-IT:', error.message);
    return false;
  }
}

// Decode a data-URL photo and write it to the photos directory. Returns the file name.
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
function savePhoto(dataUrl) {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
  if (!match) throw Object.assign(new Error('Photo must be a JPEG, PNG or WebP image'), { status: 400 });
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > MAX_PHOTO_BYTES) {
    throw Object.assign(new Error('Photo is empty or larger than 10 MB'), { status: 400 });
  }
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const fileName = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, fileName), buffer);
  return fileName;
}

// Photo links carry an HMAC signature (keyed on the admin password) so <img> tags and
// Excel hyperlinks work without the admin header. Changing ADMIN_PASSWORD revokes them.
function photoSig(fileName) {
  return crypto.createHmac('sha256', `photo:${ADMIN_PASSWORD}`).update(fileName).digest('hex').slice(0, 32);
}

function photoUrl(fileName, base = '') {
  if (!fileName) return null;
  return `${base}/api/photos/${encodeURIComponent(fileName)}?sig=${photoSig(fileName)}`;
}

function requestBase(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.get('host')}`;
}

// API Routes

// Get Snipe-IT locations
app.get('/api/locations', async (req, res) => {
  const apiToken = req.headers['x-api-token'];

  if (!apiToken) {
    return res.status(401).json({ error: 'API token required' });
  }

  try {
    const response = await axios.get(`${SNIPEIT_URL}/api/v1/locations`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    // Return only top-level locations (parent_id is null)
    const locations = response.data.rows.filter(loc => !loc.parent_id);
    res.json(locations);
  } catch (error) {
    console.error('Error fetching locations:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch locations',
      details: error.response?.data || error.message
    });
  }
});

// Search asset by asset tag or SAP number (for manual entry)
app.get('/api/assets/search', async (req, res) => {
  const apiToken = req.headers['x-api-token'];
  const { query } = req.query;

  if (!apiToken) {
    return res.status(401).json({ error: 'API token required' });
  }

  if (!query || query.trim() === '') {
    return res.status(400).json({ error: 'Search query required' });
  }

  try {
    const asset = await findAsset(apiToken, query);
    if (asset) return res.json(asset);
    return res.status(404).json({ error: 'Asset not found. Please check the asset tag or SAP number.' });
  } catch (error) {
    console.error('Error searching asset:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to search asset',
      details: error.response?.data || error.message
    });
  }
});

// Get asset by ID (extracted from QR URL)
app.get('/api/assets/:id', async (req, res) => {
  const apiToken = req.headers['x-api-token'];
  const { id } = req.params;

  if (!apiToken) {
    return res.status(401).json({ error: 'API token required' });
  }

  try {
    const response = await axios.get(`${SNIPEIT_URL}/api/v1/hardware/${id}`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching asset:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch asset',
      details: error.response?.data || error.message
    });
  }
});

// Get current user info
app.get('/api/user', async (req, res) => {
  const apiToken = req.headers['x-api-token'];

  if (!apiToken) {
    return res.status(401).json({ error: 'API token required' });
  }

  try {
    const response = await axios.get(`${SNIPEIT_URL}/api/v1/users/me`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching user:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch user',
      details: error.response?.data || error.message
    });
  }
});

// Post audit to Snipe-IT and save locally
app.post('/api/audit', async (req, res) => {
  const apiToken = req.headers['x-api-token'];
  const {
    asset_id,
    asset_tag,
    asset_name,
    sap_asset_number,
    expected_location_id,
    expected_location_name,
    actual_location_id,
    actual_location_name,
    notes,
    user_name
  } = req.body;

  if (!apiToken) {
    return res.status(401).json({ error: 'API token required' });
  }

  // Determine status
  const status = expected_location_id === actual_location_id ? 'match' : 'mismatch';

  // Post audit to Snipe-IT (continue to save locally even if Snipe-IT fails)
  const snipeitAuditPosted = await postSnipeAudit(
    apiToken, asset_tag, actual_location_id,
    notes || `Audit performed. Status: ${status}. Expected: ${expected_location_name}, Found at: ${actual_location_name}`
  ) ? 1 : 0;

  // Save to local database
  try {
    const stmt = db.prepare(`
      INSERT INTO audits (
        asset_id, asset_tag, asset_name, sap_asset_number,
        expected_location_id, expected_location_name,
        actual_location_id, actual_location_name,
        status, notes, user_name, snipeit_audit_posted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      asset_id, asset_tag, asset_name, sap_asset_number || null,
      expected_location_id, expected_location_name,
      actual_location_id, actual_location_name,
      status, notes, user_name, snipeitAuditPosted
    );

    res.json({
      success: true,
      id: result.lastInsertRowid,
      status,
      snipeit_audit_posted: snipeitAuditPosted === 1
    });
  } catch (error) {
    console.error('Error saving audit:', error.message);
    res.status(500).json({ error: 'Failed to save audit' });
  }
});

// Verify admin password
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Get all audits (for admin dashboard)
app.get('/api/audits', (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Admin password required' });
  }

  try {
    const stmt = db.prepare('SELECT * FROM audits ORDER BY created_at DESC');
    const audits = stmt.all();
    res.json(audits);
  } catch (error) {
    console.error('Error fetching audits:', error.message);
    res.status(500).json({ error: 'Failed to fetch audits' });
  }
});

// Get audits for a specific user (for user export)
app.get('/api/audits/user/:username', (req, res) => {
  const { username } = req.params;
  try {
    const stmt = db.prepare('SELECT * FROM audits WHERE user_name = ? ORDER BY created_at DESC');
    const audits = stmt.all(username);
    res.json(audits);
  } catch (error) {
    console.error('Error fetching user audits:', error.message);
    res.status(500).json({ error: 'Failed to fetch user audits' });
  }
});

// Export audits to Excel (admin - all audits)
app.get('/api/audits/export', (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Admin password required' });
  }

  try {
    const stmt = db.prepare('SELECT * FROM audits ORDER BY created_at DESC');
    const audits = stmt.all();

    // Transform data for Excel
    const exportData = audits.map(audit => ({
      'ID': audit.id,
      'Asset Tag': audit.asset_tag,
      'Asset Name': audit.asset_name,
      'SAP Asset Number': audit.sap_asset_number || '',
      'Expected Location': audit.expected_location_name,
      'Actual Location': audit.actual_location_name,
      'Status': audit.status.toUpperCase(),
      'Notes': audit.notes,
      'Audited By': audit.user_name,
      'Posted to Snipe-IT': audit.snipeit_audit_posted ? 'Yes' : 'No',
      'Date': audit.created_at
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audits');

    const manualRows = db.prepare('SELECT * FROM manual_assets ORDER BY created_at DESC, id DESC').all();
    const manualSheet = XLSX.utils.json_to_sheet(manualAssetSheetRows(manualRows, requestBase(req), true));
    linkPhotoColumn(manualSheet);
    XLSX.utils.book_append_sheet(wb, manualSheet, 'No-QR Assets');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename=audit_report.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting audits:', error.message);
    res.status(500).json({ error: 'Failed to export audits' });
  }
});

// Export audits for specific user (user export)
app.get('/api/audits/export/user/:username', (req, res) => {
  const { username } = req.params;
  try {
    const stmt = db.prepare('SELECT * FROM audits WHERE user_name = ? ORDER BY created_at DESC');
    const audits = stmt.all(username);

    // Transform data for Excel
    const exportData = audits.map(audit => ({
      'ID': audit.id,
      'Asset Tag': audit.asset_tag,
      'Asset Name': audit.asset_name,
      'SAP Asset Number': audit.sap_asset_number || '',
      'Expected Location': audit.expected_location_name,
      'Actual Location': audit.actual_location_name,
      'Status': audit.status.toUpperCase(),
      'Notes': audit.notes,
      'Date': audit.created_at
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'My Audits');

    const myManual = db.prepare('SELECT * FROM manual_assets WHERE user_name = ? ORDER BY created_at DESC, id DESC').all(username);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(manualAssetSheetRows(myManual, '', false)), 'My No-QR Assets');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename=my_audits_${username}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting user audits:', error.message);
    res.status(500).json({ error: 'Failed to export user audits' });
  }
});

// Get all assets from Snipe-IT with audit info (admin only)
app.get('/api/snipeit/assets', async (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  const apiToken = req.headers['x-api-token'];
  const forceRefresh = req.query.refresh === 'true';

  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Admin password required' });
  }

  if (!apiToken) {
    return res.status(401).json({ error: 'Snipe-IT API token required' });
  }

  // Check cache first (unless force refresh requested)
  const now = Date.now();
  if (!forceRefresh && assetCache.data && assetCache.timestamp && (now - assetCache.timestamp) < assetCache.ttl) {
    console.log('Returning cached assets data');
    return res.json({
      ...assetCache.data,
      cached: true,
      cache_age: Math.round((now - assetCache.timestamp) / 1000)
    });
  }

  try {
    console.log('Fetching fresh assets from Snipe-IT...');

    // Fetch all assets from Snipe-IT with pagination
    let allAssets = [];
    let offset = 0;
    const limit = 500;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(`${SNIPEIT_URL}/api/v1/hardware`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: {
          limit: limit,
          offset: offset,
          sort: 'asset_tag',
          order: 'asc'
        }
      });

      const assets = response.data.rows || [];
      allAssets = allAssets.concat(assets);
      console.log(`Fetched ${allAssets.length} of ${response.data.total} assets...`);

      if (assets.length < limit || allAssets.length >= response.data.total) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }

    // Helper to extract date from Snipe-IT format (can be string or { datetime, formatted })
    const extractDate = (dateField) => {
      if (!dateField) return null;
      if (typeof dateField === 'string') return dateField;
      if (typeof dateField === 'object' && dateField.datetime) return dateField.datetime;
      if (typeof dateField === 'object' && dateField.formatted) return dateField.formatted;
      return null;
    };

    const parseDate = (dateField) => {
      const dateStr = extractDate(dateField);
      if (!dateStr) return null;
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date;
    };

    // Process assets to extract audit info
    const currentYear = new Date().getFullYear();
    const currentYearStart = new Date(currentYear, 0, 1);

    const processedAssets = allAssets.map(asset => {
      const lastAuditDate = parseDate(asset.last_audit_date);
      const nextAuditDate = parseDate(asset.next_audit_date);

      // Extract SAP Asset Number from custom fields (field #17)
      let sapAssetNumber = null;
      if (asset.custom_fields && Object.keys(asset.custom_fields).length > 0) {
        // Try exact field name match first
        const sapField = asset.custom_fields['SAP Asset Number / ID'] ||
                         asset.custom_fields['SAP Asset Number'];

        if (sapField) {
          sapAssetNumber = sapField.value || null;
        } else {
          // Search through all custom fields for SAP-related field
          for (const [fieldName, fieldData] of Object.entries(asset.custom_fields)) {
            if (fieldName.toLowerCase().includes('sap') ||
                (fieldData && fieldData.field && fieldData.field.toLowerCase().includes('sap'))) {
              sapAssetNumber = fieldData.value || null;
              break;
            }
          }
        }
      }

      return {
        id: asset.id,
        asset_tag: asset.asset_tag,
        name: asset.name,
        serial: asset.serial,
        model: asset.model?.name || null,
        category: asset.category?.name || null,
        location: asset.location?.name || null,
        location_id: asset.location?.id || null,
        assigned_to: asset.assigned_to?.name || null,
        status: asset.status_label?.name || null,
        sap_asset_number: sapAssetNumber,
        last_audit_date: extractDate(asset.last_audit_date),
        next_audit_date: extractDate(asset.next_audit_date),
        never_audited: !asset.last_audit_date,
        not_audited_this_year: lastAuditDate ? lastAuditDate < currentYearStart : true,
        audit_overdue: nextAuditDate ? nextAuditDate < new Date() : false
      };
    });

    // Separate into categories
    const neverAudited = processedAssets.filter(a => a.never_audited);
    const notAuditedThisYear = processedAssets.filter(a => !a.never_audited && a.not_audited_this_year);
    const auditOverdue = processedAssets.filter(a => a.audit_overdue);

    const result = {
      total: allAssets.length,
      never_audited: neverAudited,
      not_audited_this_year: notAuditedThisYear,
      audit_overdue: auditOverdue,
      all_assets: processedAssets
    };

    // Store in cache
    assetCache.data = result;
    assetCache.timestamp = now;
    console.log(`Cached ${allAssets.length} assets`);

    res.json({
      ...result,
      cached: false,
      cache_age: 0
    });
  } catch (error) {
    console.error('Error fetching assets from Snipe-IT:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch assets from Snipe-IT',
      details: error.response?.data || error.message
    });
  }
});

// Update asset location in Snipe-IT (admin only)
app.patch('/api/assets/:id/location', async (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  const apiToken = req.headers['x-api-token'];
  const { location_id } = req.body;
  const { id } = req.params;

  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Admin password required' });
  }

  if (!apiToken) {
    return res.status(401).json({ error: 'Snipe-IT API token required' });
  }

  if (!location_id) {
    return res.status(400).json({ error: 'location_id is required' });
  }

  try {
    const response = await axios.patch(`${SNIPEIT_URL}/api/v1/hardware/${id}`, {
      rtd_location_id: location_id
    }, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    res.json({ success: true, asset: response.data });
  } catch (error) {
    console.error('Error updating asset location:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to update asset location',
      details: error.response?.data || error.message
    });
  }
});

// Resolve mismatch audits (update location in Snipe-IT and mark as resolved)
app.post('/api/audits/resolve', async (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  const apiToken = req.headers['x-api-token'];
  const { audit_ids, resolved_by } = req.body;

  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Admin password required' });
  }

  if (!apiToken) {
    return res.status(401).json({ error: 'Snipe-IT API token required' });
  }

  if (!audit_ids || !Array.isArray(audit_ids) || audit_ids.length === 0) {
    return res.status(400).json({ error: 'audit_ids array is required' });
  }

  const results = [];
  const errors = [];

  for (const auditId of audit_ids) {
    try {
      // Get the audit record
      const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(auditId);

      if (!audit) {
        errors.push({ id: auditId, error: 'Audit not found' });
        continue;
      }

      if (audit.status !== 'mismatch') {
        errors.push({ id: auditId, error: 'Audit is not a mismatch' });
        continue;
      }

      if (audit.resolved_at) {
        errors.push({ id: auditId, error: 'Already resolved' });
        continue;
      }

      // Update asset location in Snipe-IT
      await axios.patch(`${SNIPEIT_URL}/api/v1/hardware/${audit.asset_id}`, {
        rtd_location_id: audit.actual_location_id
      }, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      // Mark audit as resolved in local DB
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE audits
        SET status = 'resolved', resolved_at = ?, resolved_by = ?
        WHERE id = ?
      `).run(now, resolved_by || 'Admin', auditId);

      results.push({ id: auditId, success: true });
    } catch (error) {
      console.error(`Error resolving audit ${auditId}:`, error.response?.data || error.message);
      errors.push({
        id: auditId,
        error: error.response?.data?.messages || error.message
      });
    }
  }

  res.json({
    success: errors.length === 0,
    resolved: results.length,
    failed: errors.length,
    results,
    errors
  });
});

// ---------------------------------------------------------------------------
// No-QR assets: asset number + description + photo, recorded without scanning
// ---------------------------------------------------------------------------

app.post('/api/manual-assets', async (req, res) => {
  const apiToken = req.headers['x-api-token'];
  if (!apiToken) {
    return res.status(401).json({ error: 'API token required' });
  }

  const assetNumber = String(req.body.asset_number || '').trim();
  const description = String(req.body.description || '').trim();
  const notes = String(req.body.notes || '').trim() || null;
  const locationId = parseInt(req.body.location_id, 10) || null;
  const locationName = req.body.location_name || null;
  const userName = req.body.user_name || 'Unknown';

  if (!assetNumber) return res.status(400).json({ error: 'Asset number is required' });
  if (!description) return res.status(400).json({ error: 'Description is required' });
  if (!req.body.photo) return res.status(400).json({ error: 'A photo of the asset is required' });
  if (!locationId) return res.status(400).json({ error: 'Select your current location first' });

  let photoFile;
  try {
    photoFile = savePhoto(req.body.photo);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }

  // Look the number up in Snipe-IT (asset tag or SAP number). Never create assets there.
  let asset = null;
  try {
    asset = await findAsset(apiToken, assetNumber);
  } catch (error) {
    if (error.response?.status === 401) {
      fs.rmSync(path.join(PHOTO_DIR, photoFile), { force: true });
      return res.status(401).json({ error: 'Snipe-IT rejected the API token' });
    }
    console.error('Lookup failed, saving as unregistered:', error.response?.data || error.message);
  }

  const record = {
    asset_number: assetNumber,
    description,
    notes,
    photo_file: photoFile,
    location_id: locationId,
    location_name: locationName,
    user_name: userName,
    registered: 0,
    snipeit_asset_id: null,
    snipeit_asset_tag: null,
    snipeit_asset_name: null,
    sap_asset_number: null,
    expected_location_name: null,
    audit_status: null,
    audit_id: null,
    snipeit_audit_posted: 0,
    snipeit_photo_uploaded: 0
  };

  if (asset) {
    const expectedId = asset.location?.id ?? null;
    const expectedName = asset.location?.name || 'Not assigned';
    const status = expectedId === locationId ? 'match' : 'mismatch';
    const auditNote = [
      `Audit without QR (photo). Status: ${status}. Expected: ${expectedName}, Found at: ${locationName}.`,
      `Description: ${description}`,
      notes
    ].filter(Boolean).join(' ');

    const posted = await postSnipeAudit(apiToken, asset.asset_tag, locationId, auditNote);
    const photoUploaded = await uploadAssetPhoto(apiToken, asset.id, path.join(PHOTO_DIR, photoFile),
      `Audit photo by ${userName} at ${locationName}`);

    const sap = extractSap(asset);
    const auditResult = db.prepare(`
      INSERT INTO audits (
        asset_id, asset_tag, asset_name, sap_asset_number,
        expected_location_id, expected_location_name,
        actual_location_id, actual_location_name,
        status, notes, user_name, snipeit_audit_posted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      asset.id, asset.asset_tag, asset.name || null, sap,
      expectedId, expectedName, locationId, locationName,
      status, ['[No QR]', description, notes].filter(Boolean).join(' - '), userName, posted ? 1 : 0
    );

    Object.assign(record, {
      registered: 1,
      snipeit_asset_id: asset.id,
      snipeit_asset_tag: asset.asset_tag,
      snipeit_asset_name: asset.name || null,
      sap_asset_number: sap,
      expected_location_name: expectedName,
      audit_status: status,
      audit_id: Number(auditResult.lastInsertRowid),
      snipeit_audit_posted: posted ? 1 : 0,
      snipeit_photo_uploaded: photoUploaded ? 1 : 0
    });
  }

  try {
    const cols = Object.keys(record);
    const result = db.prepare(
      `INSERT INTO manual_assets (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    ).run(...cols.map(c => record[c]));
    res.json({ success: true, id: Number(result.lastInsertRowid), ...record });
  } catch (error) {
    console.error('Error saving manual asset:', error.message);
    res.status(500).json({ error: 'Failed to save record' });
  }
});

// List no-QR records (admin)
app.get('/api/manual-assets', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin password required' });
  const rows = db.prepare('SELECT * FROM manual_assets ORDER BY created_at DESC, id DESC').all();
  res.json(rows.map(row => ({ ...row, photo_url: photoUrl(row.photo_file) })));
});

// Delete a no-QR record and its photo (admin). The linked audit row (if any) is kept.
app.delete('/api/manual-assets/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin password required' });
  const row = db.prepare('SELECT photo_file FROM manual_assets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM manual_assets WHERE id = ?').run(req.params.id);
  if (row.photo_file) fs.rmSync(path.join(PHOTO_DIR, path.basename(row.photo_file)), { force: true });
  res.json({ success: true });
});

// Serve a stored photo. Requires the HMAC signature from photoUrl() (or the admin header).
app.get('/api/photos/:file', (req, res) => {
  const fileName = path.basename(req.params.file);
  const sig = String(req.query.sig || '');
  const expected = photoSig(fileName);
  const validSig = sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!validSig && !isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const filePath = path.join(PHOTO_DIR, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(filePath);
});

function manualAssetSheetRows(rows, base, includePhotoLink) {
  return rows.map(r => {
    const out = {
      'ID': r.id,
      'Asset Number': r.asset_number,
      'Description': r.description,
      'Snipe-IT': r.registered ? 'Registered' : 'Unregistered',
      'Snipe-IT Asset Tag': r.snipeit_asset_tag || '',
      'Snipe-IT Asset Name': r.snipeit_asset_name || '',
      'SAP Asset Number': r.sap_asset_number || '',
      'Expected Location': r.expected_location_name || '',
      'Found At': r.location_name || '',
      'Location Status': r.audit_status ? r.audit_status.toUpperCase() : '',
      'Notes': r.notes || '',
      'Recorded By': r.user_name || '',
      'Audit Posted to Snipe-IT': r.registered ? (r.snipeit_audit_posted ? 'Yes' : 'No') : '',
      'Photo Attached in Snipe-IT': r.registered ? (r.snipeit_photo_uploaded ? 'Yes' : 'No') : '',
      'Date': r.created_at
    };
    if (includePhotoLink) out['Photo'] = r.photo_file ? photoUrl(r.photo_file, base) : '';
    return out;
  });
}

// Turn the Photo column into clickable hyperlinks
function linkPhotoColumn(ws) {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  let photoCol = -1;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell && cell.v === 'Photo') photoCol = c;
  }
  if (photoCol < 0) return;
  for (let r = 1; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: photoCol })];
    if (cell && cell.v) {
      cell.l = { Target: String(cell.v), Tooltip: 'Open photo' };
      cell.v = 'Open photo';
    }
  }
}

// Delete audit record (admin only)
app.delete('/api/audits/:id', (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Admin password required' });
  }

  try {
    const stmt = db.prepare('DELETE FROM audits WHERE id = ?');
    stmt.run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting audit:', error.message);
    res.status(500).json({ error: 'Failed to delete audit' });
  }
});

// Serve the main app
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(WEB_DIST, 'index.html'));
});

// Serve admin dashboard
app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(WEB_DIST, 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Snipe-IT Scan server running on http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
  console.log(`Snipe-IT URL: ${SNIPEIT_URL}`);
});
