#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_PATHS = ["codex.quota.windowAccountCostShort"];

function readPath(value, dottedPath) {
  return dottedPath.split(".").reduce(
    (current, key) =>
      current && typeof current === "object" ? current[key] : undefined,
    value,
  );
}

function validateGmdLocales(localesDir) {
  const files = fs
    .readdirSync(localesDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No locale JSON files found in ${localesDir}`);
  }

  for (const fileName of files) {
    const filePath = path.join(localesDir, fileName);
    let locale;
    try {
      locale = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new Error(`Invalid locale JSON ${filePath}: ${error.message}`);
    }

    for (const requiredPath of REQUIRED_PATHS) {
      const value = readPath(locale, requiredPath);
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${fileName} is missing ${requiredPath}`);
      }
    }
  }

  return files;
}

function main() {
  const localesDir = path.resolve("src/locales");
  const files = validateGmdLocales(localesDir);
  console.log(
    `Validated ${files.length} locale files and ${REQUIRED_PATHS.length} required GMD key.`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[validate_gmd_locales] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  REQUIRED_PATHS,
  readPath,
  validateGmdLocales,
};
