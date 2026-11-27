import type { Asset, SnipeUser } from './api'

// ---- Token storage with 1 month expiry (same keys/format as the vanilla app) ----
const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

export function getStoredToken(key: string): string | null {
  const data = localStorage.getItem(key)
  if (!data) return null
  try {
    const parsed = JSON.parse(data) as { token?: string; expiry?: number }
    if (parsed.expiry && Date.now() > parsed.expiry) {
      localStorage.removeItem(key)
      return null
    }
    return parsed.token ?? null
  } catch {
    return data // legacy plain string
  }
}

export function setStoredToken(key: string, token: string) {
  localStorage.setItem(key, JSON.stringify({ token, expiry: Date.now() + TOKEN_EXPIRY_MS }))
}

export function removeStoredToken(key: string) {
  localStorage.removeItem(key)
}

export function displayName(user: SnipeUser | null): string {
  if (!user) return 'Unknown'
  return `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'Unknown'
}

export function initials(user: SnipeUser | null): string {
  if (!user) return 'U'
  const i = `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase()
  return i || (user.username || 'U')[0].toUpperCase()
}

export function extractSap(asset: Asset | null): string | null {
  if (!asset?.custom_fields) return null
  const direct = asset.custom_fields['SAP Asset Number / ID'] || asset.custom_fields['SAP Asset Number']
  if (direct) return direct.value || null
  for (const [name, data] of Object.entries(asset.custom_fields)) {
    if (name.toLowerCase().includes('sap') || data?.field?.toLowerCase().includes('sap')) return data?.value || null
  }
  return null
}

// SQLite CURRENT_TIMESTAMP is UTC with no zone marker; Snipe-IT dates are local strings or objects.
export function formatDate(input: unknown, utcDb = false): string {
  if (!input) return '–'
  let value = input
  if (typeof value === 'object') {
    const o = value as { formatted?: string; datetime?: string }
    if (o.formatted) return o.formatted
    if (!o.datetime) return '–'
    value = o.datetime
  }
  const s = String(value)
  const date = utcDb && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? new Date(s.replace(' ', 'T') + 'Z') : new Date(s)
  if (isNaN(date.getTime())) return s
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

async function loadImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { /* next */ }
  try { return await createImageBitmap(file) } catch { /* <img> fallback */ }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

// Resize to <= maxSide on the long side and re-encode as JPEG (data URL for the JSON API).
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.82) {
  const src = await loadImage(file)
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height
  const scale = Math.min(1, maxSide / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height)
  if ('close' in src) src.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encode failed'))), 'image/jpeg', quality))
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
  return { dataUrl, bytes: blob.size, width: canvas.width, height: canvas.height }
}
