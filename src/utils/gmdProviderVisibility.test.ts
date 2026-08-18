import assert from 'node:assert/strict';
import test from 'node:test';

import { isGmdCustomerProviderPreset } from './gmdProviderVisibility.ts';

test('keeps first-party GMD presets even when highlighted', () => {
  assert.equal(
    isGmdCustomerProviderPreset({
      id: 'gmd_api',
      isPartner: true,
      website: 'https://relay.example.cn/',
    }),
    true,
  );
});

test('keeps official and neutral presets', () => {
  assert.equal(
    isGmdCustomerProviderPreset({
      id: 'openai_official',
      website: 'https://platform.openai.com/api-keys',
    }),
    true,
  );
});

test('hides upstream partner and referral presets', () => {
  assert.equal(
    isGmdCustomerProviderPreset({
      id: 'legacy_partner',
      isPartner: true,
      website: 'https://example.com/',
    }),
    false,
  );
  assert.equal(
    isGmdCustomerProviderPreset({
      id: 'legacy_referral',
      apiKeyUrl: 'https://example.com/register?aff=cc-switch',
    }),
    false,
  );
  assert.equal(
    isGmdCustomerProviderPreset({
      id: 'legacy_path_referral',
      apiKeyUrl: 'https://example.com/i/partner-code',
    }),
    false,
  );
});
