import {
  GMD_RELAY_SOURCE_TAG,
  normalizeGmdRelayBaseUrl,
} from './gmdRelayConfig';

// Legacy export names remain for saved-account compatibility. Customer builds
// intentionally have no fixed relay endpoint; users choose it in the GMD relay page.
export const APIKEY_FUN_REGISTER_URL = '';
export const APIKEY_FUN_DOCS_URL = '';
export const APIKEY_FUN_GLOBAL_ENDPOINT = '';
export const APIKEY_FUN_DIRECT_ENDPOINT = '';
export const APIKEY_FUN_SOURCE_TAG = GMD_RELAY_SOURCE_TAG;
export const APIKEY_FUN_DEFAULT_MODEL_CATALOG = [] as const;
export const APIKEY_FUN_PROVIDER_BASE_URL = buildApiKeyFunProviderBaseUrl(
  APIKEY_FUN_GLOBAL_ENDPOINT,
);

export function buildApiKeyFunProviderBaseUrl(endpoint: string): string {
  return normalizeGmdRelayBaseUrl(endpoint);
}

export function normalizeApiKeyFunOfficialUrl(value?: string | null): string {
  return value?.trim() ?? '';
}

export function isApiKeyFunProviderBaseUrl(value?: string | null): boolean {
  return Boolean(
    APIKEY_FUN_PROVIDER_BASE_URL &&
    normalizeGmdRelayBaseUrl(value) === APIKEY_FUN_PROVIDER_BASE_URL,
  );
}

export function resolveApiKeyFunWireApi(
  baseUrl?: string | null,
  wireApi?: 'responses' | 'chat_completions' | null,
): 'responses' | 'chat_completions' | null {
  return isApiKeyFunProviderBaseUrl(baseUrl) ? 'responses' : wireApi ?? null;
}
