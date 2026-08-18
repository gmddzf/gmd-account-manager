import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function read(relativePath) {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('pins the installed desktop identity and bundler cache to the GMD build', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const packageJson = JSON.parse(await read('package.json'));
  const schemes = config.plugins?.['deep-link']?.desktop?.schemes ?? [];

  assert.equal(config.productName, 'GMD 账号管理');
  assert.equal(config.version, packageJson.version);
  assert.equal(config.identifier, 'ink.gmd.account-manager');
  assert.equal(config.mainBinaryName, 'gmd-account-manager');
  assert.equal(config.bundle?.useLocalToolsDir, true);
  assert.deepEqual(config.bundle?.externalBin, [
    '../sidecars/cockpit-cliproxy/bin/gmd-cliproxy',
  ]);
  assert.ok(schemes.includes('gmd-account-manager'));
  assert.ok(schemes.includes('gmdaccountmanager'));
  assert.ok(!schemes.includes('cockpit-tools'));
  assert.ok(!schemes.includes('cockpittools'));
});

test('keeps branded Windows and macOS release targets on the GMD updater', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const infoPlist = await read('src-tauri/Info.plist');
  const buildMatrix = await read('.github/workflows/build-matrix.yml');
  const releaseWorkflow = await read('.github/workflows/release.yml');

  assert.equal(config.bundle?.macOS?.bundleName, 'GMD 账号管理');
  assert.match(infoPlist, /<string>GMD 账号管理<\/string>/);
  assert.match(buildMatrix, /--target aarch64-apple-darwin/);
  assert.match(buildMatrix, /--target x86_64-apple-darwin/);
  assert.match(buildMatrix, /--target universal-apple-darwin/);
  assert.match(releaseWorkflow, /build-macos-aarch64:/);
  assert.match(releaseWorkflow, /build-macos-x86_64:/);
  assert.match(releaseWorkflow, /build-macos-universal:/);
  assert.ok(
    config.plugins?.updater?.endpoints?.some((endpoint) =>
      endpoint.endsWith('/latest-{{target}}.json'),
    ),
  );
});

test('uses GMD defaults for new customer-visible files and diagnostics', async () => {
  const cargoToml = await read('src-tauri/Cargo.toml');
  const webdavUi = await read('src/components/SettingsWebdavSyncSection.tsx');
  const configModule = await read('src-tauri/src/modules/config.rs');
  const updateChecker = await read('src-tauri/src/modules/update_checker.rs');
  const diagnostics = await read('src-tauri/src/modules/diagnostics.rs');
  const localAccess = await read('src-tauri/src/modules/codex_local_access.rs');
  const prepareTauri = await read('scripts/prepare-tauri.cjs');

  assert.match(cargoToml, /^name = "gmd-account-manager"$/m);
  assert.match(webdavUi, /useState\('gmd-account-manager'\)/);
  assert.match(configModule, /"gmd-account-manager"\.to_string\(\)/);
  assert.match(updateChecker, /\.join\("gmd-account-manager"\)/);
  assert.match(diagnostics, /GMD_SENTRY_DSN/);
  assert.doesNotMatch(diagnostics, /COCKPIT_SENTRY_DSN/);
  assert.match(localAccess, /SIDECAR_BIN_NAME: &str = "gmd-cliproxy"/);
  assert.match(prepareTauri, /target', 'debug', 'gmd-account-manager\.exe'/);
});

test('limits updater endpoints to the GMD release host', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const endpoints = config.plugins?.updater?.endpoints ?? [];
  const productionEnv = await read('.env.production');

  assert.ok(endpoints.length > 0);
  assert.ok(
    endpoints.every((endpoint) =>
      endpoint.startsWith('https://subapi.gmd.ink/gmd-account-manager/releases/'),
    ),
  );
  assert.match(productionEnv, /^VITE_GMD_UPDATER_ENABLED=true$/m);
});

test('keeps model relay addresses customer-defined and separate from updater hosting', async () => {
  const relayLinks = await read('src/utils/apikeyFunLinks.ts');
  const relayConfig = await read('src/utils/gmdRelayConfig.ts');
  const relayPage = await read('src/pages/ApiKeyFunPage.tsx');
  const providerPresets = await read('src/utils/codexProviderPresets.ts');
  const accountModule = await read('src-tauri/src/modules/codex_account.rs');
  const localAccessModule = await read('src-tauri/src/modules/codex_local_access.rs');
  const runtimeSources = [
    relayLinks,
    relayConfig,
    relayPage,
    providerPresets,
    accountModule,
    localAccessModule,
  ].join('\n');

  assert.match(relayLinks, /APIKEY_FUN_GLOBAL_ENDPOINT = ''/);
  assert.match(relayLinks, /APIKEY_FUN_DIRECT_ENDPOINT = ''/);
  assert.match(runtimeSources, /subapi\.gmd\.ink/i);
  assert.match(runtimeSources, /api\.gmd\.ink/i);
  assert.doesNotMatch(runtimeSources, /api\.apikey\.fun/i);
  assert.doesNotMatch(runtimeSources, /APIKEY\.FUN/i);
  assert.match(relayConfig, /GMD_RELAY_ENDPOINTS_STORAGE_KEY/);
  assert.match(relayConfig, /resolveGmdRelayIntegrationType/);
  assert.match(relayPage, /支持中国\/海外地址|China or overseas/);
  assert.match(relayPage, /integrationType: relayIntegrationType/);
  assert.match(relayPage, /data-tour="gmd-relay-config"/);
  assert.doesNotMatch(runtimeSources, /chongcodex\.cn/i);
});

test('mounts the first-run tutorial and keeps the relay page to four requested metrics', async () => {
  const app = await read('src/App.tsx');
  const tour = await read('src/components/OnboardingTour.tsx');
  const relayPage = await read('src/pages/ApiKeyFunPage.tsx');

  assert.match(app, /<OnboardingTour version=\{1\} \/>/);
  assert.match(tour, /gmd\.onboarding\.completed\.v1/);
  assert.match(tour, /gmd-relay-config/);
  assert.doesNotMatch(relayPage, /apiKeyFun\.usage\.todayTokens/);
  assert.doesNotMatch(relayPage, /apiKeyFun\.usage\.totalTokens/);
  assert.match(relayPage, /apiKeyFun\.usage\.todayRequests/);
  assert.match(relayPage, /apiKeyFun\.usage\.totalRequests/);
});

test('removes upstream referral links from provider presets', async () => {
  const providerPresets = (
    await Promise.all([
      read('src/utils/codexProviderPresets.ts'),
      read('src/utils/claudeProviderPresets.ts'),
      read('src/utils/claudeDesktopProviderPresets.ts'),
    ])
  ).join('\n');

  assert.doesNotMatch(providerPresets, /\/i\/[A-Za-z0-9_-]+/i);
  assert.doesNotMatch(
    providerPresets,
    /[?&](?:aff|code|from|invite|invitecode|rc|ref|source|utm_[^=]*)=/i,
  );
  assert.doesNotMatch(providerPresets, /CCSWITCH|drGuwc9k|02rw5X/i);
});

test('ships the GMD relay entry without top ads or sponsor cards', async () => {
  const announcements = JSON.parse(await read('announcements.json'));

  assert.equal(announcements.topRightAd, null);
  assert.equal(announcements.topRightAdsEnabled, false);
  assert.deepEqual(announcements.topRightAds, []);
  assert.deepEqual(announcements.sponsorModule?.sponsors, []);
  assert.equal(announcements.sponsorModule?.locales?.['zh-CN']?.title, 'GMD 中转管理');
  assert.equal(announcements.sponsorModule?.locales?.['zh-TW']?.title, 'GMD 中轉管理');
});

test('keeps bundled release history free of inherited partner promotions', async () => {
  const changelogs = await Promise.all([
    read('CHANGELOG.md'),
    read('CHANGELOG.zh-CN.md'),
  ]);
  const forbidden =
    /APIKEY\.FUN|apikey\.fun|affiliate|invitecode|referral|utm_|discount|coupon|promotion|sponsor|partner relay|邀请码|折扣|返利|推广|赞助|合作中转/i;
  changelogs.forEach((changelog) => assert.doesNotMatch(changelog, forbidden));
});
