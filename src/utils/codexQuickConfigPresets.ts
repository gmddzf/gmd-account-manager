export const CODEX_DEFAULT_AUTO_COMPACT_TOKEN_LIMIT = 900_000;
export const CODEX_CONTEXT_WINDOW_272K = 272_000;
export const CODEX_AUTO_COMPACT_TOKEN_LIMIT_272K = 240_000;
export const CODEX_CONTEXT_WINDOW_1M = 1_000_000;
export const CODEX_AUTO_COMPACT_TOKEN_LIMIT_1M = 900_000;

export type CodexQuickConfigBuiltInPresetId =
  | 'default'
  | 'preset_272k'
  | 'preset_1m';
export type CodexQuickConfigPresetId = CodexQuickConfigBuiltInPresetId | 'custom';

export interface CodexQuickConfigTarget {
  modelContextWindow: number | null;
  autoCompactTokenLimit: number | null;
}

export const CODEX_QUICK_CONFIG_PRESETS: Record<
  CodexQuickConfigBuiltInPresetId,
  CodexQuickConfigTarget
> = {
  default: {
    modelContextWindow: null,
    autoCompactTokenLimit: null,
  },
  preset_272k: {
    modelContextWindow: CODEX_CONTEXT_WINDOW_272K,
    autoCompactTokenLimit: CODEX_AUTO_COMPACT_TOKEN_LIMIT_272K,
  },
  preset_1m: {
    modelContextWindow: CODEX_CONTEXT_WINDOW_1M,
    autoCompactTokenLimit: CODEX_AUTO_COMPACT_TOKEN_LIMIT_1M,
  },
};

export function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function resolveCodexQuickConfigPresetId(
  modelContextWindow: number | null,
  autoCompactTokenLimit: number | null,
): CodexQuickConfigPresetId {
  if (modelContextWindow === null && autoCompactTokenLimit === null) {
    return 'default';
  }
  if (
    modelContextWindow === CODEX_QUICK_CONFIG_PRESETS.preset_272k.modelContextWindow &&
    autoCompactTokenLimit === CODEX_QUICK_CONFIG_PRESETS.preset_272k.autoCompactTokenLimit
  ) {
    return 'preset_272k';
  }
  if (
    modelContextWindow === CODEX_QUICK_CONFIG_PRESETS.preset_1m.modelContextWindow &&
    autoCompactTokenLimit === CODEX_QUICK_CONFIG_PRESETS.preset_1m.autoCompactTokenLimit
  ) {
    return 'preset_1m';
  }
  return 'custom';
}
