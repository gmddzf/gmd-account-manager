# GMD Desktop Updater

The customer build uses the Tauri updater protocol and only accepts packages signed with the GMD updater key.

## Reserved feed paths

- `https://subapi.gmd.ink/gmd-account-manager/releases/latest-{{target}}.json`
- `https://subapi.gmd.ink/gmd-account-manager/releases/latest.json`

The first path is the target-specific manifest. The second path is the legacy fallback manifest.

## Signing material

- Private key: `.tools/gmd-updater.key`
- Public key: `.tools/gmd-updater.key.pub`

Keep the private key private. Do not commit it, attach it to release notes, or send it to customers.

For a GitHub Actions release, add these repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the private key content or a secure path supplied by the release runner.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: only when a password was set for the key.

The existing release workflow creates signed updater artifacts when run in CI. Publish the generated installer, signature, target-specific `latest-*.json`, and fallback `latest.json` to the reserved feed paths before enabling update checks for the release build.

Update checks are disabled by default. Enable them only for a signed production build by setting:

```powershell
$env:VITE_GMD_UPDATER_ENABLED = 'true'
```

The app only exposes manual release links hosted below `https://subapi.gmd.ink/gmd-account-manager/releases/`. Updater manifest release notes must contain GMD content only.

## First production release

1. Increase the version in `package.json`.
2. Add GMD-only release notes to `CHANGELOG.zh-CN.md` and `CHANGELOG.md`.
3. Build signed updater artifacts with the GMD private key.
4. Publish the files to the reserved feed paths.
5. Set `VITE_GMD_UPDATER_ENABLED=true` in the release build environment.
6. Verify from an installed older build that it detects the update, displays GMD-only notes, downloads, and installs successfully.

## Customer-hosted update manifests

Customer releases should point updater manifests at the GMD release host, not at
GitHub or an upstream project. Stage the signed bundle assets first, then build
target manifests with an explicit asset base URL:

```powershell
$version = '1.3.21'
$assetBaseUrl = "https://subapi.gmd.ink/gmd-account-manager/releases/v$version"
node scripts/release/build_target_latest_json.cjs `
  --version $version `
  --repo gmd/account-manager `
  --assets-dir .release\staged `
  --notes-file .release\notes-v$version.md `
  --published-at (Get-Date).ToUniversalTime().ToString('o') `
  --output-dir .release\manifests `
  --targets windows-x86_64-nsis,darwin-aarch64-app,darwin-x86_64-app `
  --asset-base-url $assetBaseUrl
```

Publish the package files under:

```text
https://subapi.gmd.ink/gmd-account-manager/releases/v1.3.21/
```

Then publish the generated manifests as:

```text
https://subapi.gmd.ink/gmd-account-manager/releases/latest-windows-x86_64-nsis.json
https://subapi.gmd.ink/gmd-account-manager/releases/latest-darwin-aarch64-app.json
https://subapi.gmd.ink/gmd-account-manager/releases/latest-darwin-x86_64-app.json
https://subapi.gmd.ink/gmd-account-manager/releases/latest.json
```

`latest.json` must be JSON, not the web frontend HTML shell. If the URL returns
`text/html`, the installed app cannot detect the update.
