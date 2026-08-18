import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) {
      throw new Error('Usage: --base <dir> --local <dir> --target <dir>');
    }
    values[key.slice(2)] = path.resolve(value);
  }
  for (const key of ['base', 'local', 'target']) {
    if (!values[key]) throw new Error(`Missing --${key}`);
  }
  return values;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyLocalDelta(base, local, upstream) {
  if (sameValue(base, local)) return upstream;

  if (isRecord(base) && isRecord(local)) {
    const result = isRecord(upstream) ? structuredClone(upstream) : {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
      if (!(key in local)) {
        delete result[key];
        continue;
      }
      if (!(key in base)) {
        result[key] = structuredClone(local[key]);
        continue;
      }
      result[key] = applyLocalDelta(base[key], local[key], result[key]);
    }
    return result;
  }

  return structuredClone(local);
}

const directories = parseArgs(process.argv.slice(2));
await Promise.all(Object.values(directories).map((directory) => access(directory)));

const localeFiles = (await readdir(directories.target))
  .filter((filename) => filename.endsWith('.json'))
  .sort();

for (const filename of localeFiles) {
  const base = JSON.parse(await readFile(path.join(directories.base, filename), 'utf8'));
  const local = JSON.parse(await readFile(path.join(directories.local, filename), 'utf8'));
  const upstream = JSON.parse(await readFile(path.join(directories.target, filename), 'utf8'));
  const merged = applyLocalDelta(base, local, upstream);
  await writeFile(
    path.join(directories.target, filename),
    `${JSON.stringify(merged, null, 2)}\n`,
    'utf8',
  );
}

console.log(`Merged GMD locale deltas into ${localeFiles.length} upstream locale files.`);
