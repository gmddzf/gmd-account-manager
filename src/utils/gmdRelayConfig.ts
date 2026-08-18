export const GMD_RELAY_SOURCE_TAG = 'gmd_api';
export const GMD_RELAY_BASE_URL_STORAGE_KEY = 'gmd_relay_base_url_v1';
export const GMD_RELAY_MANAGED_KEYS_STORAGE_KEY = 'gmd_relay_managed_keys_v2';
export const GMD_RELAY_LEGACY_KEYS_STORAGE_KEY = 'apikey_fun_managed_keys';
export const GMD_RELAY_ENDPOINTS_STORAGE_KEY = 'gmd_relay_endpoints_v1';

export type GmdRelayIntegrationType = 'sub2api' | 'new_api';

export interface GmdRelayEndpointProfile {
  id: string;
  name: string;
  baseUrl: string;
  createdAt: number;
  lastUsedAt: number;
}

export type GmdRelayBaseUrlValidation =
  | { ok: true; baseUrl: string; claudeBaseUrl: string }
  | { ok: false; error: 'required' | 'invalid' | 'https_required' | 'credentials_not_allowed' };

/**
 * The two GMD gateways expose different account-usage contracts.  Selecting
 * the known contract up front avoids an unnecessary failed probe and keeps
 * the error shown to customers focused on the URL/Key they entered.
 */
export function resolveGmdRelayIntegrationType(
  value?: string | null,
): GmdRelayIntegrationType | null {
  const raw = value?.trim() ?? '';
  if (!raw) return null;
  try {
    const hostname = new URL(raw).hostname.trim().toLowerCase();
    if (hostname === 'subapi.gmd.ink') return 'sub2api';
    if (hostname === 'api.gmd.ink') return 'new_api';
  } catch {
    return null;
  }
  return null;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '[::1]' ||
    normalized.endsWith('.localhost')
  );
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  if (!trimmed) return '/v1';
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function validateGmdRelayBaseUrl(value?: string | null): GmdRelayBaseUrlValidation {
  const raw = value?.trim() ?? '';
  if (!raw) return { ok: false, error: 'required' };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'invalid' };
  }

  if (!parsed.hostname || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return { ok: false, error: 'invalid' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'credentials_not_allowed' };
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    return { ok: false, error: 'https_required' };
  }

  parsed.pathname = normalizePathname(parsed.pathname);
  parsed.search = '';
  parsed.hash = '';
  const baseUrl = parsed.toString().replace(/\/+$/, '');
  return {
    ok: true,
    baseUrl,
    claudeBaseUrl: buildGmdRelayClaudeBaseUrl(baseUrl),
  };
}

export function normalizeGmdRelayBaseUrl(value?: string | null): string {
  const result = validateGmdRelayBaseUrl(value);
  return result.ok ? result.baseUrl : '';
}

export function buildGmdRelayClaudeBaseUrl(value?: string | null): string {
  const raw = value?.trim() ?? '';
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.pathname = parsed.pathname.replace(/\/v1\/?$/i, '').replace(/\/+$/, '') || '/';
    parsed.search = '';
    parsed.hash = '';
    return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return '';
  }
}

export function isSameGmdRelayBaseUrl(left?: string | null, right?: string | null): boolean {
  const normalizedLeft = normalizeGmdRelayBaseUrl(left);
  const normalizedRight = normalizeGmdRelayBaseUrl(right);
  return Boolean(normalizedLeft && normalizedLeft === normalizedRight);
}

export function gmdRelayEndpointDisplayName(baseUrl: string): string {
  const normalized = normalizeGmdRelayBaseUrl(baseUrl);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    const host = parsed.host;
    const path = parsed.pathname.replace(/\/v1\/?$/i, '').replace(/\/$/, '');
    return `${host}${path}`;
  } catch {
    return normalized;
  }
}

function normalizeEndpointProfile(value: unknown): GmdRelayEndpointProfile | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<GmdRelayEndpointProfile>;
  const baseUrl = normalizeGmdRelayBaseUrl(
    typeof item.baseUrl === 'string' ? item.baseUrl : '',
  );
  if (!baseUrl) return null;
  const now = Date.now();
  return {
    id:
      typeof item.id === 'string' && item.id.trim()
        ? item.id.trim().slice(0, 120)
        : `relay-${encodeURIComponent(baseUrl).replace(/%/g, '_')}`,
    name:
      typeof item.name === 'string' && item.name.trim()
        ? item.name.trim().slice(0, 80)
        : gmdRelayEndpointDisplayName(baseUrl),
    baseUrl,
    createdAt:
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
        ? item.createdAt
        : now,
    lastUsedAt:
      typeof item.lastUsedAt === 'number' && Number.isFinite(item.lastUsedAt)
        ? item.lastUsedAt
        : now,
  };
}

export function normalizeGmdRelayEndpointProfiles(value: unknown): GmdRelayEndpointProfile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map(normalizeEndpointProfile)
    .filter((item): item is GmdRelayEndpointProfile => Boolean(item))
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
    .filter((item) => {
      const key = normalizeGmdRelayBaseUrl(item.baseUrl).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function upsertGmdRelayEndpointProfile(
  profiles: readonly GmdRelayEndpointProfile[],
  baseUrl: string,
  name?: string | null,
  now = Date.now(),
): GmdRelayEndpointProfile[] {
  const normalizedBaseUrl = normalizeGmdRelayBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return [...profiles];
  const existing = profiles.find((item) => isSameGmdRelayBaseUrl(item.baseUrl, normalizedBaseUrl));
  const next: GmdRelayEndpointProfile = {
    id: existing?.id ?? `relay-${encodeURIComponent(normalizedBaseUrl).replace(/%/g, '_')}`,
    name: name?.trim() || existing?.name || gmdRelayEndpointDisplayName(normalizedBaseUrl),
    baseUrl: normalizedBaseUrl,
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now,
  };
  return normalizeGmdRelayEndpointProfiles([
    next,
    ...profiles.filter((item) => !isSameGmdRelayBaseUrl(item.baseUrl, normalizedBaseUrl)),
  ]);
}
