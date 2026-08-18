import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGmdRelayPrefillPayload } from './apiKeyFunPrefill.ts';

test('uses the selected relay URL for Codex prefill', () => {
  const payload = buildGmdRelayPrefillPayload({
    target: 'codex',
    apiKey: 'sk-customer',
    relayBaseUrl: 'https://cn-relay.example/v1',
    modelCatalog: ['gpt-test'],
  });
  assert.equal(payload?.baseUrl, 'https://cn-relay.example/v1');
  assert.equal(payload?.sourceTag, 'gmd_api');
  assert.equal(payload?.wireApi, 'responses');
});

test('uses the same selected relay root for Claude prefill', () => {
  const payload = buildGmdRelayPrefillPayload({
    target: 'claude_cli',
    apiKey: 'sk-customer',
    relayBaseUrl: 'https://cn-relay.example/openai/v1',
    modelCatalog: ['claude-test'],
  });
  assert.equal(payload?.baseUrl, 'https://cn-relay.example/openai');
  assert.deepEqual(payload?.modelCatalog, ['claude-test']);
});

test('does not build a prefill payload for an unsafe relay URL', () => {
  assert.equal(
    buildGmdRelayPrefillPayload({
      target: 'codex',
      apiKey: 'sk-customer',
      relayBaseUrl: 'http://remote-relay.example',
    }),
    null,
  );
});
