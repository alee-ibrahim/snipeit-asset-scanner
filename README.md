# Snipe-IT Asset Scanner

A Progressive Web App (PWA) for performing physical asset audits with Snipe-IT. Scan QR codes on assets to verify their location matches the recorded location in Snipe-IT.

## Features

- **Robust QR Scanning**: Reads bent/curved, shadowed, low-contrast, small and angled labels (see [Scanner engine](#scanner-engine))
- **Scan from photo**: Take a still photo of a hard label and decode it at full resolution
- **Manual Entry**: Enter asset tag or SAP number manually when scanning isn't available
- **No QR? Add with photo**: Record an asset that has no label - asset number, description and a photo. If the number exists in Snipe-IT the audit is logged there and the photo attached; otherwise it is kept as an *unregistered asset* for review (assets are never created in Snipe-IT)
- **Location Verification**: Compare physical location with Snipe-IT records
- **Audit Logging**: Records sent to both Snipe-IT and local database
- **Admin Dashboard**: View all audits, export to Excel, manage records
- **Unaudited Assets View**: See assets that haven't been audited (never, this year, or overdue)
- **User Export**: Users can export their own audit history
- **PWA Support**: Install on mobile devices for quick access

## Requirements

- Node.js 22+
- Access to a Snipe-IT instance
- Snipe-IT Personal API Token with appropriate permissions

## Installation

1. Clone or download this repository

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your configuration:
   ```
   PORT=3000
   SNIPEIT_URL=https://your-snipeit-instance.com
   ADMIN_PASSWORD=your-secure-password
   ```

5. Create the database directory:
   ```bash
   mkdir db
   ```

6. Start the server:
   ```bash
   pnpm start
   ```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `SNIPEIT_URL` | Your Snipe-IT instance URL (no trailing slash) | - |
| `ADMIN_PASSWORD` | Password for admin dashboard | admin123 |

## Usage

### Scanner App

1. Open `http://localhost:3000` on your mobile device
2. Enter your Snipe-IT Personal API Token
3. Select your current physical location
4. Tap **Start scanning** and point the camera at the label (the whole frame is scanned; tap to focus, use the light / zoom controls if offered)
   - **Type tag / SAP #**: enter an asset tag or SAP number manually
   - **Scan from photo**: take a photo of a hard-to-read label
   - **No QR? Add with photo**: asset number + description + photo for items without a label
5. Review asset details and the match / wrong-location banner
6. Add optional notes and log the audit

### Admin Dashboard

1. Open `http://localhost:3000/admin`
2. Enter the admin password
3. Enter your Snipe-IT API Token (for fetching unaudited assets)

**Audit Records Tab:**
- View all audit records
- Filter by status (match/mismatch)
- Search by asset tag, name, or location
- Delete individual records
- Export all audits to Excel

**No-QR Assets Tab:**
- Every record added with "No QR? Add with photo"
- Photo thumbnails with a full-size lightbox
- Filter registered (found in Snipe-IT) vs unregistered, search, sort, delete
- Included in the Excel export as a second sheet ("No-QR Assets") with a clickable photo link

**Unaudited Assets Tab:**
- View assets never audited
- View assets not audited this year
- View assets with overdue audits
- Filter by category
- Search assets
- Export filtered list to CSV
- Data is cached for 10 minutes (use Refresh to update)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/locations` | GET | Get Snipe-IT locations |
| `/api/assets/:id` | GET | Get asset by ID |
| `/api/assets/search` | GET | Search asset by tag or SAP number |
| `/api/user` | GET | Get current user info |
| `/api/audit` | POST | Submit an audit |
| `/api/audits` | GET | Get all audits (admin) |
| `/api/audits/user/:username` | GET | Get user's audits |
| `/api/audits/export` | GET | Export audits to Excel (admin) |
| `/api/audits/export/user/:username` | GET | Export user's audits |
| `/api/snipeit/assets` | GET | Get all assets from Snipe-IT (admin) |
| `/api/audits/:id` | DELETE | Delete audit record (admin) |
| `/api/audits/resolve` | POST | Resolve mismatches - update location in Snipe-IT (admin) |
| `/api/manual-assets` | POST | Save a no-QR record (asset number, description, photo data URL, location, user) |
| `/api/manual-assets` | GET | List no-QR records with signed photo URLs (admin) |
| `/api/manual-assets/:id` | DELETE | Delete a no-QR record and its photo (admin) |
| `/api/photos/:file?sig=` | GET | Serve a stored photo (HMAC-signed link or admin header) |
| `/api/admin/verify` | POST | Verify admin password |

## Security Notes

- API tokens are stored in browser localStorage and sent via headers
- Admin password is checked server-side
- The `.env` file contains sensitive data and is excluded from git
- Ensure proper firewall rules when exposing the app

## Scanner engine

The scanner uses [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (ZXing-C++ compiled to WebAssembly), self-hosted from
`node_modules` at `/vendor/zxing-wasm` - no CDN needed. Decoding runs in a Web Worker so the preview stays smooth.

- **Camera**: ideal 1920x1080, continuous autofocus, torch toggle, zoom slider and tap-to-focus where the device supports them, and a camera switch button on phones with several rear cameras (the choice is remembered).
- **Whole frame**: no small scan box - the overlay is only a guide.
- **Native first**: where the browser has `BarcodeDetector` with QR support (Android Chrome) it runs on every frame alongside zxing.
- **Rotating zxing passes** (all with `tryHarder`, `tryRotate`, `tryInvert`, `tryDownscale`):
  1. full frame, LocalAverage binarizer
  2. centre crop at native resolution (small or distant codes)
  3. grayscale + contrast stretch, GlobalHistogram binarizer (faded / low contrast)
  4. adaptive (Bradley) threshold (shadows, glare, curved or bent labels)
  5. wider crop with denoise (noisy low-light frames)
- **Formats**: QR, Micro QR, DataMatrix, Code 128. Snipe-IT label URLs (`/hardware/<id>`) are opened directly; a plain-text code is looked up as an asset tag / SAP number.
- **Scan from photo** runs the same passes on a full-resolution still - the fallback for the hardest labels.

## No-QR records

Stored in the `manual_assets` table in `db/audits.db`; photos are compressed in the browser (max 1600 px, JPEG) and saved
under `db/photos/`, so the existing `/app/db` volume persists both.

| Column | Meaning |
|--------|---------|
| `asset_number`, `description`, `notes` | What the user entered |
| `photo_file` | File name in `db/photos/` |
| `location_id`, `location_name`, `user_name`, `created_at` | Where, who, when |
| `registered` | 1 if the number matched a Snipe-IT asset tag or SAP number |
| `snipeit_asset_id`, `snipeit_asset_tag`, `snipeit_asset_name`, `sap_asset_number`, `expected_location_name` | Matched asset details |
| `audit_status`, `audit_id` | match / mismatch, and the row created in `audits` |
| `snipeit_audit_posted`, `snipeit_photo_uploaded` | Whether Snipe-IT accepted the audit and the photo (`POST /api/v1/hardware/{id}/files`) |

When the asset exists, a normal audit row is also written (notes prefixed `[No QR]`), so it shows in Audit Records and can be resolved like any other mismatch.
Photo links in the admin UI and Excel export are signed with an HMAC derived from `ADMIN_PASSWORD`; changing the password invalidates old links.

## Snipe-IT API Token

To generate a Personal API Token in Snipe-IT:

1. Log in to Snipe-IT as your user
2. Click your name in the top right
3. Select "Manage API Keys"
4. Click "Create New Token"
5. Copy the generated token

Required permissions:
- View assets
- Audit assets
- View locations
- Edit assets / upload files (only needed to attach no-QR photos and to resolve mismatches)

## Docker Deployment

### Using Docker Compose (Recommended)

1. Create a `.env` file with your configuration:
   ```
   SNIPEIT_URL=https://your-snipeit-instance.com
   ADMIN_PASSWORD=your-secure-password
   PORT=3000
   ```

2. Build and run:
   ```bash
   docker-compose up -d
   ```

3. Access the app at `http://localhost:3000`

No new environment variables or volumes: the `scanner-data` volume (mounted at `/app/db`) now also holds `photos/`.
Rebuild the image after upgrading (`docker-compose up -d --build`) so `zxing-wasm` is installed. Camera access needs HTTPS
(or `localhost`), e.g. via the Cloudflare Tunnel below.

### Using Docker directly

```bash
docker build -t snipeit-asset-scanner .
docker run -d \
  --name snipeit-scanner \
  -p 3000:3000 \
  -e SNIPEIT_URL=https://your-snipeit-instance.com \
  -e ADMIN_PASSWORD=your-secure-password \
  -v scanner-data:/app/db \
  snipeit-asset-scanner
```

## Exposing via Cloudflare Tunnel

If your Snipe-IT is behind NAT, you can expose this app using Cloudflare Tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

## Project Structure

```
snipe-it-scan/
├── server.js           # Express server with API endpoints
├── package.json        # Node.js dependencies
├── .env                # Configuration (not in git)
├── .env.example        # Example configuration
├── .gitignore          # Git ignore rules
├── db/
│   ├── audits.db       # SQLite database (created on first run)
│   └── photos/         # No-QR asset photos
└── public/
    ├── index.html      # Scanner PWA
    ├── admin.html      # Admin dashboard
    ├── css/base.css    # Shared design tokens + components
    ├── js/scanner.js   # Camera + scan loop (BarcodeDetector + zxing passes)
    ├── js/decoder-worker.js  # zxing-wasm decoder + image preprocessing (Web Worker)
    ├── icons.svg       # SVG icon sprite (Lucide)
    ├── manifest.json   # PWA manifest
    └── sw.js           # Service worker (bump CACHE_NAME on UI releases)
```

## License

ISC
