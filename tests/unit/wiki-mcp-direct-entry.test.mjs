import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  NON_ENTRY_REALPATH_ERROR_CODES,
  isDirectModuleEntry
} from "../../packages/wiki-mcp/src/lib/direct-entry.mjs";

const MODULE_PATH = "/srv/app/packages/wiki-mcp/src/server.mjs";
const MODULE_URL = pathToFileURL(MODULE_PATH).href;
const LINKED_PATH = "/srv/current/packages/wiki-mcp/src/server.mjs";

function realpathError(code) {
  const error = new Error(`${code}: canonicalization failed`);
  error.code = code;
  return error;
}

function neverCalled() {
  return () => {
    assert.fail("realpath must not be consulted once the paths already match");
  };
}

test("an exact entry path is the entry without consulting realpath", () => {
  assert.equal(
    isDirectModuleEntry(MODULE_URL, { argv1: MODULE_PATH, realpath: neverCalled() }),
    true
  );
});

test("an entry path that canonicalizes to this module is the entry", () => {
  const seen = [];
  assert.equal(
    isDirectModuleEntry(MODULE_URL, {
      argv1: LINKED_PATH,
      realpath: (value) => { seen.push(value); return MODULE_PATH; }
    }),
    true
  );
  assert.deepEqual(seen, [LINKED_PATH]);
});

test("a relative entry path resolves against the working directory before comparison", () => {
  const relative = path.relative(process.cwd(), fileURLToPath(MODULE_URL));
  assert.equal(
    isDirectModuleEntry(MODULE_URL, { argv1: relative, realpath: neverCalled() }),
    true
  );
});

test("an entry path that canonicalizes elsewhere is not the entry", () => {
  assert.equal(
    isDirectModuleEntry(MODULE_URL, {
      argv1: "/srv/app/packages/core/bin/wiki-mcp",
      realpath: () => "/srv/app/packages/core/bin/wiki-mcp"
    }),
    false
  );
});

test("an absent entry path is not the entry", () => {
  for (const argv1 of ["", null, 7]) {
    assert.equal(
      isDirectModuleEntry(MODULE_URL, { argv1, realpath: neverCalled() }),
      false,
      `argv1=${JSON.stringify(argv1)} must not claim entry`
    );
  }
});

test("the default entry path is read from process.argv", () => {
  assert.equal(
    isDirectModuleEntry(MODULE_URL, { realpath: (value) => value }),
    false
  );
});

test("a canonicalization failure that answers the question reports not-the-entry", () => {
  for (const code of NON_ENTRY_REALPATH_ERROR_CODES) {
    assert.equal(
      isDirectModuleEntry(MODULE_URL, {
        argv1: LINKED_PATH,
        realpath: () => { throw realpathError(code); }
      }),
      false,
      `${code} must report not-the-entry`
    );
  }
});

test("an unexpected canonicalization failure propagates instead of answering", () => {
  for (const code of ["EACCES", "EIO", "EMFILE", "EPERM", undefined]) {
    assert.throws(
      () => isDirectModuleEntry(MODULE_URL, {
        argv1: LINKED_PATH,
        realpath: () => { throw realpathError(code); }
      }),
      (error) => error.code === code,
      `${code} must propagate rather than be reported as not-the-entry`
    );
  }
  assert.equal(NON_ENTRY_REALPATH_ERROR_CODES.includes("EACCES"), false);
});

test("a missing module url refuses rather than guessing", () => {
  for (const moduleUrl of [undefined, "", null]) {
    assert.throws(
      () => isDirectModuleEntry(moduleUrl, { argv1: MODULE_PATH }),
      TypeError
    );
  }
});
