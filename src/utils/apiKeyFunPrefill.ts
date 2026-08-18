import type { Page } from '../types/navigation';
import {
  GMD_RELAY_SOURCE_TAG,
  validateGmdRelayBaseUrl,
} from './gmdRelayConfig.ts';

export const APIKEY_FUN_PREFILL_EVENT = 'app:apikey-fun-prefill';

export type ApiKeyFunPrefillTarget = 'codex' | 'claude_desktop' | 'claude_cli';

export interface ApiKeyFunPrefillPayload {
  target: ApiKeyFunPrefillTarget;
  apiKey: string;
  apiKeyName?: string | null;
  providerName?: string | null;
  baseUrl?: string | null;
  sourceTag?: string | null;
  wireApi?: 'responses' | 'chat_completions' | null;
  integrationType?: 'sub2api' | 'new_api' | null;
  modelCatalog?: string[] | null;
}

export function buildGmdRelayPrefillPayload(input: {
  target: ApiKeyFunPrefillTarget;
  apiKey: string;
  apiKeyName?: string | null;
  providerName?: string | null;
  relayBaseUrl: string;
  integrationType?: 'sub2api' | 'new_api' | null;
  modelCatalog?: string[] | null;
}): ApiKeyFunPrefillPayload | null {
  const apiKey = input.apiKey.trim();
  const validation = validateGmdRelayBaseUrl(input.relayBaseUrl);
  if (!apiKey || !validation.ok) return null;

  return {
    target: input.target,
    apiKey,
    apiKeyName: input.apiKeyName?.trim() || null,
    providerName: input.providerName?.trim() || 'GMD API',
    baseUrl:
      input.target === 'codex' ? validation.baseUrl : validation.claudeBaseUrl,
    sourceTag: GMD_RELAY_SOURCE_TAG,
    wireApi: 'responses',
    integrationType: input.integrationType ?? null,
    modelCatalog: input.modelCatalog ?? null,
  };
}

let pendingPrefill: ApiKeyFunPrefillPayload | null = null;

export function getApiKeyFunPrefillPage(target: ApiKeyFunPrefillTarget): Page {
  if (target === 'codex') return 'codex';
  return target === 'claude_desktop' ? 'claude' : 'claude-cli';
}

export function dispatchApiKeyFunPrefillEvent(payload: ApiKeyFunPrefillPayload): void {
  pendingPrefill = payload;
  window.dispatchEvent(
    new CustomEvent<ApiKeyFunPrefillPayload>(APIKEY_FUN_PREFILL_EVENT, {
      detail: payload,
    }),
  );
}

export function consumeApiKeyFunPrefill(
  target: ApiKeyFunPrefillTarget,
): ApiKeyFunPrefillPayload | null {
  if (!pendingPrefill || pendingPrefill.target !== target) {
    return null;
  }
  const payload = pendingPrefill;
  pendingPrefill = null;
  return payload;
}
