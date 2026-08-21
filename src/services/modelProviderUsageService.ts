import { invoke } from '@tauri-apps/api/core';

export type ModelProviderUsageIntegrationType = 'sub2api' | 'new_api';
export type ModelProviderUsageMode =
  | ModelProviderUsageIntegrationType
  | 'deepseek'
  | 'token_plan';

export interface ModelProviderModel {
  id: string;
  displayName?: string | null;
}

export interface ModelProviderModelsResult {
  models: ModelProviderModel[];
  latencyMs: number;
}

export interface ModelProviderUsageSummary {
  mode?: string | null;
  isValid?: boolean | null;
  status?: string | null;
  planName?: string | null;
  remaining?: number | null;
  balance?: number | null;
  unit?: string | null;
  quotaUnlimited?: boolean | null;
  quotaLimit?: number | null;
  quotaUsed?: number | null;
  quotaRemaining?: number | null;
  todayRequests?: number | null;
  todayTotalTokens?: number | null;
  todayCost?: number | null;
  totalRequests?: number | null;
  totalTotalTokens?: number | null;
  totalCost?: number | null;
  modelStatsCount: number;
  latencyMs: number;
  details?: Array<{
    key: string;
    label: string;
    value: string;
  }>;
}

export interface NewApiQuotaSnapshot {
  granted: number | null;
  available: number | null;
  expiresAt: number | null;
}

export interface NewApiDailyBalanceState {
  day: string;
  lastRemaining: number;
  consumed: number;
  sampledAt: number;
}

export interface NewApiDailyBalanceUpdate {
  state: NewApiDailyBalanceState;
  todayCost: number;
}

interface NewApiDailyBalanceStore {
  version: 1;
  entries: Record<string, NewApiDailyBalanceState>;
}

const NEW_API_DAILY_BALANCE_STORAGE_KEY =
  'agtools.model_provider.new_api_daily_balance.v1';

function finiteUsageNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function usageDetailNumber(
  summary: ModelProviderUsageSummary | undefined,
  key: string,
): number | null {
  return finiteUsageNumber(summary?.details?.find((item) => item.key === key)?.value);
}

export function resolveNewApiQuotaSnapshot(
  summary?: ModelProviderUsageSummary,
): NewApiQuotaSnapshot {
  const used =
    finiteUsageNumber(summary?.quotaUsed) ??
    finiteUsageNumber(summary?.totalCost);
  // Billing fields are already in the display currency. Token allocation
  // details are retained only as a legacy fallback for deployments that do not
  // expose billing limits.
  const granted =
    finiteUsageNumber(summary?.quotaLimit) ??
    usageDetailNumber(summary, 'hardLimitUsd') ??
    usageDetailNumber(summary, 'softLimitUsd') ??
    usageDetailNumber(summary, 'systemHardLimitUsd') ??
    usageDetailNumber(summary, 'totalGranted');
  const available =
    finiteUsageNumber(summary?.quotaRemaining) ??
    (granted != null && used != null ? Math.max(0, granted - used) : null) ??
    usageDetailNumber(summary, 'totalAvailable');
  const expiresAt =
    usageDetailNumber(summary, 'expiresAt') ??
    usageDetailNumber(summary, 'accessUntil');

  return { granted, available, expiresAt };
}

export function buildUsageBaseUrlCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl.trim();
  if (!trimmed) return [];
  const candidates = [trimmed];
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, '');
    if (path === '' || path === '/') {
      // Sub2API-compatible services may expose /usage at either the host root
      // or under /v1. Try the user's URL first, then the conventional prefix.
      const usageUrl = `${parsed.origin}/v1`;
      if (!candidates.includes(usageUrl)) candidates.push(usageUrl);
    }
  } catch {
    // keep the original value and let the backend return the validation error
  }
  return candidates;
}

function nonNegativeUsageNumber(value: unknown): number | null {
  const parsed = finiteUsageNumber(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

export function formatLocalUsageDay(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function normalizeNewApiDailyBalanceState(
  value: unknown,
): NewApiDailyBalanceState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<NewApiDailyBalanceState>;
  if (typeof candidate.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.day)) {
    return null;
  }
  const lastRemaining = nonNegativeUsageNumber(candidate.lastRemaining);
  const consumed = nonNegativeUsageNumber(candidate.consumed);
  const sampledAt = nonNegativeUsageNumber(candidate.sampledAt);
  if (lastRemaining == null || consumed == null || sampledAt == null) return null;
  return { day: candidate.day, lastRemaining, consumed, sampledAt };
}

/**
 * Update today's consumption from two currency-balance samples.
 *
 * Balance decreases are accumulated as spend. Balance increases (for example,
 * a recharge) only replace the comparison baseline and never reduce spend that
 * was already observed. A new local calendar day starts with a zero baseline.
 */
export function updateNewApiDailyBalance(
  previous: NewApiDailyBalanceState | null | undefined,
  currentRemaining: number,
  day: string,
  sampledAt: number,
  directTodayCost?: number | null,
): NewApiDailyBalanceUpdate {
  const normalizedRemaining = nonNegativeUsageNumber(currentRemaining) ?? 0;
  const normalizedSampledAt = nonNegativeUsageNumber(sampledAt) ?? 0;
  const normalizedDirectCost = nonNegativeUsageNumber(directTodayCost);
  const normalizedPrevious = normalizeNewApiDailyBalanceState(previous);

  if (!normalizedPrevious || normalizedPrevious.day !== day) {
    const todayCost = normalizedDirectCost ?? 0;
    return {
      state: {
        day,
        lastRemaining: normalizedRemaining,
        consumed: todayCost,
        sampledAt: normalizedSampledAt,
      },
      todayCost,
    };
  }

  // A slower, older request must not overwrite a newer balance sample.
  if (normalizedSampledAt < normalizedPrevious.sampledAt) {
    return {
      state: normalizedPrevious,
      todayCost: normalizedPrevious.consumed,
    };
  }

  const observedDecrease = Math.max(
    0,
    normalizedPrevious.lastRemaining - normalizedRemaining,
  );
  const todayCost =
    normalizedDirectCost ?? normalizedPrevious.consumed + observedDecrease;
  return {
    state: {
      day,
      lastRemaining: normalizedRemaining,
      consumed: todayCost,
      sampledAt: normalizedSampledAt,
    },
    todayCost,
  };
}

function resolveNewApiCurrencyRemaining(
  summary: ModelProviderUsageSummary,
): number | null {
  // New API's token endpoint may expose raw quota units. Only use the billing
  // balance fields that the backend has already normalized to the display unit.
  return (
    nonNegativeUsageNumber(summary.quotaRemaining) ??
    nonNegativeUsageNumber(summary.remaining) ??
    nonNegativeUsageNumber(summary.balance)
  );
}

export function applyNewApiDailyBalanceSnapshot(
  summary: ModelProviderUsageSummary,
  usageIdentity: string | null | undefined,
  sampledAt: number,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): ModelProviderUsageSummary {
  const identity = usageIdentity?.trim();
  if (summary.mode !== 'new_api' || !identity) return summary;
  const currentRemaining = resolveNewApiCurrencyRemaining(summary);
  if (currentRemaining == null) return summary;

  try {
    const day = formatLocalUsageDay(new Date(sampledAt));
    const raw = storage.getItem(NEW_API_DAILY_BALANCE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<NewApiDailyBalanceStore>) : null;
    const previous = normalizeNewApiDailyBalanceState(parsed?.entries?.[identity]);
    const update = updateNewApiDailyBalance(
      previous,
      currentRemaining,
      day,
      sampledAt,
      summary.todayCost,
    );
    const entries: Record<string, NewApiDailyBalanceState> = {};
    if (parsed?.entries && typeof parsed.entries === 'object') {
      for (const [key, value] of Object.entries(parsed.entries)) {
        const normalized = normalizeNewApiDailyBalanceState(value);
        if (normalized?.day === day) entries[key] = normalized;
      }
    }
    entries[identity] = update.state;
    storage.setItem(
      NEW_API_DAILY_BALANCE_STORAGE_KEY,
      JSON.stringify({ version: 1, entries } satisfies NewApiDailyBalanceStore),
    );
    return { ...summary, todayCost: update.todayCost };
  } catch {
    // Usage queries must remain available if browser storage is blocked or the
    // saved snapshot is malformed. In that case, keep the server summary.
    return summary;
  }
}

function decorateNewApiDailyBalance(
  summary: ModelProviderUsageSummary,
  usageIdentity: string | null | undefined,
  sampledAt: number,
): ModelProviderUsageSummary {
  if (typeof window === 'undefined') return summary;
  return applyNewApiDailyBalanceSnapshot(
    summary,
    usageIdentity,
    sampledAt,
    window.localStorage,
  );
}

const KNOWN_GMD_RELAY_USAGE_TYPES: Readonly<
  Record<string, ModelProviderUsageIntegrationType>
> = {
  'api.gmd.ink': 'new_api',
  'subapi.gmd.ink': 'sub2api',
};

/**
 * Resolve the authoritative usage contract for the user's known relay hosts.
 *
 * Keep this allowlist exact: an arbitrary OpenAI-compatible endpoint must not
 * receive billing probes merely because its hostname looks similar.  URL paths
 * such as `/v1` do not change which host-level usage API is available.
 */
export function resolveKnownGmdRelayUsageIntegrationType(
  baseUrl?: string | null,
): ModelProviderUsageIntegrationType | null {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return KNOWN_GMD_RELAY_USAGE_TYPES[parsed.hostname.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

export type ModelProviderUsageErrorKind =
  | 'authorization'
  | 'network'
  | 'unavailable'
  | 'invalid_url'
  | 'unknown';

export async function queryModelProviderUsage(input: {
  baseUrl: string;
  apiKey: string;
  integrationType?: ModelProviderUsageIntegrationType | null;
  usageIdentity?: string | null;
}): Promise<ModelProviderUsageSummary> {
  const candidates = buildUsageBaseUrlCandidates(input.baseUrl);
  const sampledAt = Date.now();
  let lastError: unknown = null;
  for (const baseUrl of candidates) {
    try {
      const summary = await invoke<ModelProviderUsageSummary>(
        'codex_query_model_provider_usage',
        {
        baseUrl,
        apiKey: input.apiKey,
        integrationType: input.integrationType ?? null,
        },
      );
      return decorateNewApiDailyBalance(summary, input.usageIdentity, sampledAt);
    } catch (error) {
      lastError = error;
      if (!isModelProviderUsageUnavailableError(error)) {
        throw error;
      }
    }
  }
  throw lastError ?? new Error('PROVIDER_BASE_URL_INVALID');
}

export async function listModelProviderModels(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<ModelProviderModelsResult> {
  return await invoke('codex_list_model_provider_models', {
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
  });
}

export function classifyModelProviderUsageError(error: unknown): ModelProviderUsageErrorKind {
  const message = String(error).replace(/^Error:\s*/, '').toUpperCase();
  if (
    message.includes('MISSING_API_KEY') ||
    message.includes('HTTP_401') ||
    message.includes('HTTP_403') ||
    message.includes('INVALID_API_KEY') ||
    message.includes('INVALID TOKEN') ||
    message.includes('UNAUTHORIZED')
  ) {
    return 'authorization';
  }
  if (message.includes('NETWORK_FAILED') || message.includes('TIMEOUT') || message.includes('CONNECTION')) {
    return 'network';
  }
  if (
    message.includes('HTTP_404') ||
    message.includes('TYPE_UNSUPPORTED') ||
    message.includes('PRESENTATION') ||
    message.includes('SERVICE_UNAVAILABLE')
  ) {
    return 'unavailable';
  }
  if (message.includes('BASE_URL_INVALID')) return 'invalid_url';
  return 'unknown';
}

export function isModelProviderUsageUnavailableError(error: unknown): boolean {
  const message = String(error).replace(/^Error:\s*/, '');
  return (
    message.includes('PROVIDER_USAGE_DETECT_FAILED') ||
    message.includes('PROVIDER_USAGE_HTTP_404') ||
    message.includes('PROVIDER_USAGE_TYPE_UNSUPPORTED')
  );
}

export function resolveModelProviderUsageMode(
  summary?: ModelProviderUsageSummary,
): ModelProviderUsageMode | null {
  if (!summary) return null;
  if (
    summary.mode === 'new_api' ||
    summary.mode === 'sub2api' ||
    summary.mode === 'deepseek' ||
    summary.mode === 'token_plan'
  ) {
    return summary.mode;
  }
  if (
    typeof summary.todayRequests === 'number' ||
    typeof summary.todayTotalTokens === 'number' ||
    typeof summary.todayCost === 'number'
  ) {
    return 'sub2api';
  }
  const detailKeys = new Set((summary.details ?? []).map((item) => item.key));
  if (
    detailKeys.has('todayRequests') ||
    detailKeys.has('todayTokens') ||
    detailKeys.has('todayCost') ||
    detailKeys.has('remaining')
  ) {
    return 'sub2api';
  }
  if (
    detailKeys.has('totalGranted') ||
    detailKeys.has('totalAvailable') ||
    detailKeys.has('expiresAt')
  ) {
    return 'new_api';
  }
  return null;
}

export function formatModelProviderUsageMoney(
  value?: number | null,
  unit?: string | null,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  const normalizedUnit = unit?.trim() || 'USD';
  if (normalizedUnit === '%') {
    return `${Math.round(value)}%`;
  }
  const formatted = value.toFixed(value >= 100 ? 0 : 2);
  if (normalizedUnit === 'USD') return `$${formatted}`;
  if (normalizedUnit === 'CNY') return `¥${formatted}`;
  return `${formatted} ${normalizedUnit}`;
}

export function formatModelProviderUsageInteger(value?: number | null): string {
  const normalized =
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    normalized,
  );
}

export function formatModelProviderUsageTokenCount(value?: number | null): string {
  const normalized =
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (normalized >= 100_000_000) {
    return `${(normalized / 100_000_000)
      .toFixed(normalized >= 1_000_000_000 ? 1 : 2)
      .replace(/\.?0+$/, '')}亿`;
  }
  if (normalized >= 10_000) {
    return `${(normalized / 10_000)
      .toFixed(normalized >= 100_000 ? 1 : 2)
      .replace(/\.?0+$/, '')}万`;
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    normalized,
  );
}
