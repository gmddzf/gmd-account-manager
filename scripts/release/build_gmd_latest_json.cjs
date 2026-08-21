#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_TARGETS = [
  "darwin-aarch64-app",
  "darwin-x86_64-app",
  "windows-x86_64-nsis",
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function requiredArg(args, key) {
  const value = args[key];
  if (!value) throw new Error(`Missing required argument --${key}`);
  return value;
}

function readTargetManifest(manifestsDir, target) {
  const manifestPath = path.join(manifestsDir, `latest-${target}.json`);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing target manifest: ${manifestPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid target manifest ${manifestPath}: ${error.message}`);
  }
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Target manifest is not an object: ${manifestPath}`);
  }
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error(`Target manifest has no version: ${manifestPath}`);
  }
  if (typeof manifest.url !== "string" || !manifest.url.trim()) {
    throw new Error(`Target manifest has no asset URL: ${manifestPath}`);
  }
  if (typeof manifest.signature !== "string" || !manifest.signature.trim()) {
    throw new Error(`Target manifest has no signature: ${manifestPath}`);
  }
  return manifest;
}

function clonePlatformEntry(manifest) {
  return {
    signature: manifest.signature,
    url: manifest.url,
  };
}

function buildGmdLatestJson(options) {
  const manifests = Object.fromEntries(
    REQUIRED_TARGETS.map((target) => [
      target,
      readTargetManifest(options.manifestsDir, target),
    ]),
  );
  const windows = manifests["windows-x86_64-nsis"];
  const expectedVersion = options.version || windows.version;

  for (const [target, manifest] of Object.entries(manifests)) {
    if (manifest.version !== expectedVersion) {
      throw new Error(
        `Target manifest version mismatch for ${target}: expected ${expectedVersion}, got ${manifest.version}`,
      );
    }
    if (manifest.notes !== windows.notes || manifest.pub_date !== windows.pub_date) {
      throw new Error(`Target manifest metadata mismatch for ${target}`);
    }
  }

  const darwinAarch64 = clonePlatformEntry(
    manifests["darwin-aarch64-app"],
  );
  const darwinX64 = clonePlatformEntry(manifests["darwin-x86_64-app"]);
  const windowsNsis = clonePlatformEntry(windows);
  const latest = {
    version: expectedVersion,
    notes: windows.notes,
    pub_date: windows.pub_date,
    platforms: {
      "darwin-aarch64": darwinAarch64,
      "darwin-aarch64-app": { ...darwinAarch64 },
      "darwin-x86_64": darwinX64,
      "darwin-x86_64-app": { ...darwinX64 },
      "windows-x86_64": windowsNsis,
      "windows-x86_64-nsis": { ...windowsNsis },
    },
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(latest, null, 2)}\n`);
  return latest;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = args.output || "latest.json";
  const latest = buildGmdLatestJson({
    manifestsDir: requiredArg(args, "manifests-dir"),
    output,
    version: args.version,
  });
  console.log(`GMD legacy latest.json generated at ${output}`);
  console.log(`platform count=${Object.keys(latest.platforms).length}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[build_gmd_latest_json] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  REQUIRED_TARGETS,
  buildGmdLatestJson,
};
