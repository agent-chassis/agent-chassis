import assert from "node:assert/strict";
import { chmodSync, mkdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { observeExecutable } from "../../packages/wiki-core/src/lib/runtime-inputs/executable-lookup.mjs";
import { withTestFixture } from "../helpers/test-fixture.mjs";

function directory(root, name) {
  const result = path.join(root, name);
  mkdirSync(result);
  return result;
}

function executable(file, mode = 0o755) {
  writeFileSync(file, "fixture", { mode });
  chmodSync(file, mode);
  return file;
}

test("executable lookup searches only ordered absolute PATH entries", async () => {
  await withTestFixture(({ rootPath }) => {
    const first = directory(rootPath, "first");
    const second = directory(rootPath, "second");
    const target = executable(path.join(rootPath, "target"));
    const link = path.join(second, "probe");
    symlinkSync(target, link);
    executable(path.join(directory(rootPath, "later"), "probe"));
    const missingParent = path.join(rootPath, "missing", "child");
    const nonDirectory = executable(path.join(rootPath, "non-directory"));
    const observed = observeExecutable({ command: "probe",
      searchPath: ["", "relative", first, missingParent, nonDirectory, second,
        path.join(rootPath, "later")].join(":") });
    assert.equal(observed.status, "found");
    assert.equal(observed.requested_path, link);
    assert.equal(observed.resolved_path, target);
    assert.notEqual(observed.requested_path, observed.resolved_path);
    const stat = statSync(target);
    assert.deepEqual(observed.identity, { dev: stat.dev, ino: stat.ino, size: stat.size,
      mtime_ms: stat.mtimeMs, ctime_ms: stat.ctimeMs });
    assert.deepEqual(observeExecutable({ command: "probe", searchPath: ":relative:" }),
      { status: "absent", searched_paths: [] });
    assert.deepEqual(observeExecutable({ command: "probe", searchPath: first }),
      { status: "absent", searched_paths: [path.join(first, "probe")] });
  });
});

test("executable lookup does not confuse invalid candidates with absence", async () => {
  await withTestFixture(({ rootPath }) => {
    const early = directory(rootPath, "early");
    const later = directory(rootPath, "later");
    executable(path.join(later, "probe"));
    const candidate = path.join(early, "probe");
    executable(candidate, 0o644);
    const searchPath = `${early}:${later}`;
    let observed = observeExecutable({ command: "probe", searchPath });
    assert.equal(observed.status, "failed");
    assert.equal(observed.operation, "access");
    assert.equal(observed.path, candidate);
    assert.equal(observed.errno, "EACCES");
    assert.equal(observed.cause.code, "EACCES");
    assert.match(observed.correction, /probe/);
    chmodSync(candidate, 0o755);
    mkdirSync(path.join(early, "directory"));
    executable(path.join(later, "directory"));
    observed = observeExecutable({ command: "directory", searchPath });
    assert.equal(observed.status, "failed");
    assert.equal(observed.operation, "stat");
    assert.equal(observed.path, path.join(early, "directory"));
    assert.equal(observed.errno, null);
    assert.equal(observed.code, "runtime_input_executable_invalid");
    const loop = path.join(early, "cycle");
    symlinkSync(loop, loop);
    executable(path.join(later, "cycle"));
    observed = observeExecutable({ command: "cycle", searchPath });
    assert.equal(observed.status, "failed");
    assert.equal(observed.operation, "realpath");
    assert.equal(observed.path, loop);
    assert.equal(observed.errno, "ELOOP");
  });
});

test("configured executable observation never searches PATH", async () => {
  await withTestFixture(({ rootPath }) => {
    const valid = executable(path.join(rootPath, "valid"));
    const link = path.join(rootPath, "link");
    symlinkSync(valid, link);
    assert.deepEqual(observeExecutable({ executable: path.join(rootPath, "missing") }),
      { status: "absent", searched_paths: [path.join(rootPath, "missing")] });
    for (const executable of ["relative", "", rootPath]) {
      const observed = observeExecutable({ executable });
      assert.equal(observed.status, "failed");
      assert.equal(observed.code, "runtime_input_executable_invalid");
    }
    const denied = path.join(rootPath, "denied");
    writeFileSync(denied, "x", { mode: 0o644 });
    const observed = observeExecutable({ executable: denied });
    assert.equal(observed.operation, "access");
    assert.equal(observed.errno, "EACCES");
    assert.equal(observeExecutable({ executable: link }).resolved_path, valid);
    assert.equal(observeExecutable({ executable: valid, command: "valid", searchPath: rootPath }).status,
      "failed");
  });
});

test("executable observations reflect replacement without cached state", async () => {
  await withTestFixture(({ rootPath }) => {
    const first = executable(path.join(rootPath, "first"));
    const second = executable(path.join(rootPath, "second"));
    const link = path.join(rootPath, "probe");
    symlinkSync(first, link);
    const before = observeExecutable({ executable: link });
    assert.equal(before.status, "found");
    unlinkSync(link);
    symlinkSync(second, link);
    const after = observeExecutable({ executable: link });
    assert.equal(after.status, "found");
    assert.equal(after.requested_path, before.requested_path);
    assert.notEqual(after.resolved_path, before.resolved_path);
    assert.notEqual(after.identity.ino, before.identity.ino);
  });
});
