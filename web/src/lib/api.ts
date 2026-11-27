// Typed client for the Express API (server.js). Endpoints are unchanged from the vanilla app.

export interface Location { id: number; name: string; parent_id?: number | null }

export interface SnipeUser { first_name?: string; last_name?: string; username?: string; email?: string }

export interface Asset {
  id: number
  asset_tag: string
  name?: string | null
  serial?: string | null
  model?: { name?: string } | null
  location?: { id: number; name: string } | null
  custom_fields?: Record<string, { value?: string | null; field?: string } | null>
  status?: string
}

export type AuditStatus = 'match' | 'mismatch' | 'resolved'

export interface AuditRecord {
  id: number
  asset_id: number
  asset_tag: string
  asset_name: string | null
  sap_asset_number: string | null
  expected_location_name: string | null
  actual_location_name: string
  status: AuditStatus
  notes: string | null
  user_name: string | null
  snipeit_audit_posted: number
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
}

export interface ManualAsset {
  id: number
  asset_number: string
  description: string
  notes: string | null
  photo_file: string | null
  photo_url: string | null
  location_id: number | null
  location_name: string | null
  user_name: string | null
  registered: number
  snipeit_asset_id: number | null
  snipeit_asset_tag: string | null
  snipeit_asset_name: string | null
  sap_asset_number: string | null
  expected_location_name: string | null
  audit_status: 'match' | 'mismatch' | null
  audit_id: number | null
  snipeit_audit_posted: number
  snipeit_photo_uploaded: number
  created_at: string
}

export interface SnipeAssetRow {
  id: number
  asset_tag: string
  name: string | null
  serial: string | null
  model: string | null
  category: string | null
  location: string | null
  assigned_to: string | null
  status: string | null
  sap_asset_number: string | null
  last_audit_date: string | null
  next_audit_date: string | null
}

export interface SnipeAssetsResponse {
  total: number
  never_audited: SnipeAssetRow[]
  not_audited_this_year: SnipeAssetRow[]
  audit_overdue: SnipeAssetRow[]
  all_assets: SnipeAssetRow[]
  cached: boolean
  cache_age: number
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const details = typeof body.details === 'string' ? body.details : undefined
    throw new ApiError(body.error || details || `Request failed (${res.status})`, res.status)
  }
  return res.json() as Promise<T>
}

const tokenHeaders = (token: string, json = false): HeadersInit => ({
  'X-API-Token': token,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
})

// ---- Scanner ----
export const api = {
  user: (token: string) => request<SnipeUser>('/api/user', { headers: tokenHeaders(token) }),
  locations: (token: string) => request<Location[]>('/api/locations', { headers: tokenHeaders(token) }),
  assetById: (token: string, id: string) => request<Asset>(`/api/assets/${encodeURIComponent(id)}`, { headers: tokenHeaders(token) }),
  searchAsset: (token: string, query: string) =>
    request<Asset>(`/api/assets/search?query=${encodeURIComponent(query)}`, { headers: tokenHeaders(token) }),
  userAudits: (userName: string) => request<AuditRecord[]>(`/api/audits/user/${encodeURIComponent(userName)}`),
  logAudit: (token: string, body: Record<string, unknown>) =>
    request<{ success: boolean; id: number; status: AuditStatus; snipeit_audit_posted: boolean }>('/api/audit', {
      method: 'POST', headers: tokenHeaders(token, true), body: JSON.stringify(body),
    }),
  saveManualAsset: (token: string, body: Record<string, unknown>) =>
    request<ManualAsset & { success: boolean }>('/api/manual-assets', {
      method: 'POST', headers: tokenHeaders(token, true), body: JSON.stringify(body),
    }),
  exportUserAudits: async (userName: string) => {
    const res = await fetch(`/api/audits/export/user/${encodeURIComponent(userName)}`)
    if (!res.ok) throw new ApiError('Export failed', res.status)
    return res.blob()
  },
}

// ---- Admin ----
const adminHeaders = (password: string, token?: string, json = false): HeadersInit => ({
  'X-Admin-Password': password,
  ...(token ? { 'X-Api-Token': token } : {}),
  ...(json ? { 'Content-Type': 'application/json' } : {}),
})

export const adminApi = {
  verify: (password: string) =>
    request<{ success: boolean }>('/api/admin/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    }),
  audits: (password: string) => request<AuditRecord[]>('/api/audits', { headers: adminHeaders(password) }),
  deleteAudit: (password: string, id: number) =>
    request<{ success: boolean }>(`/api/audits/${id}`, { method: 'DELETE', headers: adminHeaders(password) }),
  resolve: (password: string, token: string, ids: number[]) =>
    request<{ success: boolean; resolved: number; failed: number; errors: Array<{ id: number; error: unknown }> }>('/api/audits/resolve', {
      method: 'POST', headers: adminHeaders(password, token, true), body: JSON.stringify({ audit_ids: ids, resolved_by: 'Admin' }),
    }),
  manualAssets: (password: string) => request<ManualAsset[]>('/api/manual-assets', { headers: adminHeaders(password) }),
  deleteManualAsset: (password: string, id: number) =>
    request<{ success: boolean }>(`/api/manual-assets/${id}`, { method: 'DELETE', headers: adminHeaders(password) }),
  snipeAssets: (password: string, token: string, refresh: boolean) =>
    request<SnipeAssetsResponse>(`/api/snipeit/assets${refresh ? '?refresh=true' : ''}`, { headers: adminHeaders(password, token) }),
  exportAll: async (password: string) => {
    const res = await fetch('/api/audits/export', { headers: adminHeaders(password) })
    if (!res.ok) throw new ApiError('Export failed', res.status)
    return res.blob()
  },
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
