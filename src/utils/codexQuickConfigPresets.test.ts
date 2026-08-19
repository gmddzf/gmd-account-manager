import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODEX_QUICK_CONFIG_PRESETS,
  parsePositiveInteger,
  resolveCodexQuickConfigPresetId,
} from './codexQuickConfigPresets.ts';

test('272K cost guard compacts before the long-context pricing threshold', () => {
  assert.deepEqual(CODEX_QUICK_CONFIG_PRESETS.preset_272k, {
    modelContextWindow: 272_000,
    autoCompactTokenLimit: 240_000,
  });
  assert.equal(resolveCodexQuickConfigPresetId(272_000, 240_000), 'preset_272k');
});

test('full context and default presets remain available', () => {
  assert.deepEqual(CODEX_QUICK_CONFIG_PRESETS.preset_1m, {
    modelContextWindow: 1_000_000,
    autoCompactTokenLimit: 900_000,
  });
  assert.equal(resolveCodexQuickConfigPresetId(1_000_000, 900_000), 'preset_1m');
  assert.equal(resolveCodexQuickConfigPresetId(null, null), 'default');
});

test('legacy and partial values stay custom instead of being overwritten', () => {
  assert.equal(resolveCodexQuickConfigPresetId(516_000, 460_000), 'custom');
  assert.equal(resolveCodexQuickConfigPresetId(272_000, null), 'custom');
});

test('custom numeric inputs require positive integers', () => {
  assert.equal(parsePositiveInteger('272000'), 272_000);
  assert.equal(parsePositiveInteger('0'), null);
  assert.equal(parsePositiveInteger('not-a-number'), null);
});
