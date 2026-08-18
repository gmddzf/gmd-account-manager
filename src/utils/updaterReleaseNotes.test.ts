import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getUpdaterReleaseHighlightLines,
  parseUpdaterReleaseNotes,
  prependUpdaterReleaseHighlights,
  resolveUpdaterDownloadUrl,
} from './updaterReleaseNotes.ts';

test('parses bilingual GMD updater notes', () => {
  const notes = [
    '## 更新日志（中文）',
    '### 新增',
    '- GMD 中文说明',
    '## Changelog (English)',
    '### Added',
    '- GMD English notes',
  ].join('\n');

  assert.deepEqual(parseUpdaterReleaseNotes(notes), {
    releaseNotesZh: '### 新增\n- GMD 中文说明',
    releaseNotes: '### Added\n- GMD English notes',
  });
});

test('does not inject inherited upstream release highlights', () => {
  assert.deepEqual(getUpdaterReleaseHighlightLines('1.3.1', 'zh-CN'), []);
  assert.equal(
    prependUpdaterReleaseHighlights('1.3.1', 'GMD release notes', 'zh-CN'),
    'GMD release notes',
  );
});

test('filters inherited partner and referral copy from updater notes', () => {
  const legacyBrand = ['APIKEY', '.', 'FUN'].join('');
  const notes = [
    '### Added',
    '- GMD relay improvements',
    `- ${legacyBrand} partner discount and referral invitecode`,
    '- Visit https://relay.example/path?aff=abc',
    '- Open https://relay.example/path?ref=abc',
    '- 使用专属链接选购可享优惠',
    '- cockpit tools was renamed',
    '- cockpit dashboard was renamed',
    '- https://github.com/jlcodes99/cockpit-tools/issues/1',
  ].join('\n');

  assert.deepEqual(parseUpdaterReleaseNotes(notes), {
    releaseNotes:
      '### Added\n- GMD relay improvements\n- GMD 账号管理 was renamed\n- GMD dashboard was renamed',
    releaseNotesZh:
      '### Added\n- GMD relay improvements\n- GMD 账号管理 was renamed\n- GMD dashboard was renamed',
  });
});

test('only exposes GMD-hosted manual release links', () => {
  const trusted = 'https://subapi.gmd.ink/gmd-account-manager/releases/v1.3.17/setup.exe';
  assert.equal(resolveUpdaterDownloadUrl('1.3.17', { download_url: trusted }), trusted);

  assert.equal(
    resolveUpdaterDownloadUrl('1.3.17', {
      html_url: 'https://github.com/upstream/project/releases/tag/v1.3.17',
    }),
    'https://subapi.gmd.ink/gmd-account-manager/releases/',
  );
  assert.equal(
    resolveUpdaterDownloadUrl('1.3.17', {
      url: 'https://subapi.gmd.ink.example.com/gmd-account-manager/releases/latest.json',
    }),
    'https://subapi.gmd.ink/gmd-account-manager/releases/',
  );
});
