import assert from "node:assert/strict";
import test from "node:test";

import {
  readCodexImportSyncApiService,
  writeCodexImportSyncApiService,
} from "./codexImportPreferences.ts";

function installLocalStorage(initial?: string) {
  let stored = initial;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => stored ?? null,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    },
  });
}

test("first OAuth import defaults to API service sync", () => {
  installLocalStorage();
  assert.equal(readCodexImportSyncApiService(), true);
});

test("an explicit opt-out remains disabled", () => {
  installLocalStorage();
  writeCodexImportSyncApiService(false);
  assert.equal(readCodexImportSyncApiService(), false);
});

test("an explicit opt-in remains enabled", () => {
  installLocalStorage("false");
  writeCodexImportSyncApiService(true);
  assert.equal(readCodexImportSyncApiService(), true);
});
