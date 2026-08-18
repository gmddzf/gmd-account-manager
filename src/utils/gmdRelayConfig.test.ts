import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGmdRelayClaudeBaseUrl,
  isSameGmdRelayBaseUrl,
  normalizeGmdRelayEndpointProfiles,
  resolveGmdRelayIntegrationType,
  upsertGmdRelayEndpointProfile,
  validateGmdRelayBaseUrl,
} from './gmdRelayConfig.ts';

test('normalizes root and versioned relay addresses to one OpenAI base URL', () => {
  assert.deepEqual(validateGmdRelayBaseUrl('https://relay.example.cn/'), {
    ok: true,
    baseUrl: 'https://relay.example.cn/v1',
    claudeBaseUrl: 'https://relay.example.cn',
  });
  assert.equal(
    isSameGmdRelayBaseUrl('https://relay.example.cn', 'https://relay.example.cn/v1/'),
    true,
  );
});

test('preserves a provider path while avoiding duplicate v1 segments', () => {
  assert.deepEqual(validateGmdRelayBaseUrl('https://relay.example.cn/openai/v1/'), {
    ok: true,
    baseUrl: 'https://relay.example.cn/openai/v1',
    claudeBaseUrl: 'https://relay.example.cn/openai',
  });
  assert.equal(
    buildGmdRelayClaudeBaseUrl('https://relay.example.cn/openai/v1'),
    'https://relay.example.cn/openai',
  );
});

test('requires HTTPS for remote relays but permits loopback development URLs', () => {
  assert.deepEqual(validateGmdRelayBaseUrl('http://relay.example.cn'), {
    ok: false,
    error: 'https_required',
  });
  assert.deepEqual(validateGmdRelayBaseUrl('http://127.0.0.1:8080/v1'), {
    ok: true,
    baseUrl: 'http://127.0.0.1:8080/v1',
    claudeBaseUrl: 'http://127.0.0.1:8080',
  });
});

test('rejects embedded credentials and malformed addresses', () => {
  assert.deepEqual(validateGmdRelayBaseUrl('https://name:secret@example.cn/v1'), {
    ok: false,
    error: 'credentials_not_allowed',
  });
  assert.deepEqual(validateGmdRelayBaseUrl('example.cn'), {
    ok: false,
    error: 'invalid',
  });
});

test('keeps multiple customer relay addresses and deduplicates normalized paths', () => {
  const profiles = normalizeGmdRelayEndpointProfiles([
    { id: 'global', name: 'Global', baseUrl: 'https://relay.example.cn', createdAt: 1, lastUsedAt: 1 },
    { id: 'global-duplicate', name: 'Duplicate', baseUrl: 'https://relay.example.cn/v1/', createdAt: 2, lastUsedAt: 2 },
    { id: 'china', name: 'China', baseUrl: 'https://relay.example.cn/cn/v1', createdAt: 3, lastUsedAt: 3 },
    { id: 'unsafe', name: 'Unsafe', baseUrl: 'http://remote.example.cn', createdAt: 4, lastUsedAt: 4 },
  ]);
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0]?.baseUrl, 'https://relay.example.cn/cn/v1');
  assert.equal(profiles[1]?.baseUrl, 'https://relay.example.cn/v1');
});

test('upserts a selected relay address without changing other saved addresses', () => {
  const initial = normalizeGmdRelayEndpointProfiles([
    { id: 'global', name: 'Global', baseUrl: 'https://global.example.cn/v1', createdAt: 1, lastUsedAt: 1 },
  ]);
  const next = upsertGmdRelayEndpointProfile(initial, 'https://cn.example.cn', 'China', 10);
  assert.equal(next.length, 2);
  assert.equal(next[0]?.name, 'China');
  assert.equal(next[0]?.baseUrl, 'https://cn.example.cn/v1');
  assert.equal(next[1]?.baseUrl, 'https://global.example.cn/v1');
});

test('selects the matching usage contract for both GMD relay platforms', () => {
  assert.equal(resolveGmdRelayIntegrationType('https://subapi.gmd.ink/v1'), 'sub2api');
  assert.equal(resolveGmdRelayIntegrationType('https://api.gmd.ink'), 'new_api');
  assert.equal(resolveGmdRelayIntegrationType('https://relay.example.cn/v1'), null);
});
