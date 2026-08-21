const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_TARGETS,
  buildGmdLatestJson,
} = require("./build_gmd_latest_json.cjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gmd-latest-test-"));
  const manifestsDir = path.join(root, "manifests");
  fs.mkdirSync(manifestsDir);
  for (const target of REQUIRED_TARGETS) {
    fs.writeFileSync(
      path.join(manifestsDir, `latest-${target}.json`),
      `${JSON.stringify({
        version: "1.3.26",
        notes: "Release notes",
        pub_date: "2026-08-21T00:00:00.000Z",
        url: `https://subapi.gmd.ink/gmd-account-manager/releases/v1.3.26/${target}.bin`,
        signature: `signature-${target}`,
      })}\n`,
    );
  }
  return { root, manifestsDir, output: path.join(root, "latest.json") };
}

test("builds the legacy GMD manifest with updater target aliases", (t) => {
  const sample = fixture();
  t.after(() => fs.rmSync(sample.root, { recursive: true, force: true }));

  const latest = buildGmdLatestJson({
    manifestsDir: sample.manifestsDir,
    output: sample.output,
    version: "1.3.26",
  });

  assert.equal(latest.version, "1.3.26");
  assert.deepEqual(Object.keys(latest.platforms), [
    "darwin-aarch64",
    "darwin-aarch64-app",
    "darwin-x86_64",
    "darwin-x86_64-app",
    "windows-x86_64",
    "windows-x86_64-nsis",
  ]);
  assert.deepEqual(
    latest.platforms["windows-x86_64"],
    latest.platforms["windows-x86_64-nsis"],
  );
  assert.equal(
    JSON.parse(fs.readFileSync(sample.output, "utf8")).platforms[
      "darwin-aarch64-app"
    ].signature,
    "signature-darwin-aarch64-app",
  );
});

test("rejects mixed target-manifest versions", (t) => {
  const sample = fixture();
  t.after(() => fs.rmSync(sample.root, { recursive: true, force: true }));
  const mismatched = path.join(
    sample.manifestsDir,
    "latest-darwin-x86_64-app.json",
  );
  const value = JSON.parse(fs.readFileSync(mismatched, "utf8"));
  value.version = "1.3.25";
  fs.writeFileSync(mismatched, JSON.stringify(value));

  assert.throws(
    () =>
      buildGmdLatestJson({
        manifestsDir: sample.manifestsDir,
        output: sample.output,
        version: "1.3.26",
      }),
    /version mismatch/,
  );
});
