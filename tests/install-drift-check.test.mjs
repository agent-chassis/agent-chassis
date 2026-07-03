

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";

import { runInstallDriftCheck } from "../packages/agent-launch-cli/src/commands/install-drift-check.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIR = path.join(REPO_ROOT, "packages", "agent-launch-cli");
const PACKAGE_JSON_PATH = path.join(PACKAGE_DIR, "package.json");

async function readPackageBinMap() {
  const pkg = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8"));
  return normalizeBinMap(pkg.bin ?? {});
}

function normalizeBinMap(binMap) {
  return Object.fromEntries(
    Object.entries(binMap).map(([name, relPath]) => [
      name,
      typeof relPath === "string" && relPath.startsWith("./")
        ? relPath.slice(2)
        : relPath
    ])
  );
}

async function withTempTargetDir(fn) {

  const dir = await mkdtemp(path.join(os.tmpdir(), "install-drift-check-"));
  try {
    return await fn(dir);
  } finally {

    try {
      const { readdir, lstat } = await import("node:fs/promises");
      const names = await readdir(dir);
      for (const name of names) {
        const p = path.join(dir, name);
        try {
          const s = await lstat(p);
          if (s.isSymbolicLink()) continue;
          await chmod(p, s.isDirectory() ? 0o755 : 0o644);
        } catch {

        }
      }
    } catch {

    }
    await rm(dir, { recursive: true, force: true });
  }
}

async function runAndCapture(argv, seam = {}) {
  const lines = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  console.log = (...args) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  process.exitCode = 0;
  let exitCode;
  try {
    await runInstallDriftCheck(argv, seam);
    exitCode = process.exitCode ?? 0;
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }
  return { stdout: lines.join("\n"), exitCode };
}

async function runJson(targetDir, seam = {}) {
  const { stdout, exitCode } = await runAndCapture(
    ["--target-dir", targetDir, "--json"],
    seam
  );
  const parsed = JSON.parse(stdout);
  return { output: parsed, exitCode };
}

async function withFixturePackage(fn) {
  const pkgDir = await mkdtemp(path.join(os.tmpdir(), "install-drift-fixture-pkg-"));
  try {
    await mkdir(path.join(pkgDir, "bin"));
    await mkdir(path.join(pkgDir, "src"));
    const binMap = {
      "agent-launch": "./src/index.mjs",
      "fixture-shim": "./bin/fixture-shim"
    };
    await writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@fixture/agent-launch-cli", bin: binMap }, null, 2)
    );
    await writeFile(path.join(pkgDir, "src", "index.mjs"), "#!/usr/bin/env node\n");
    await writeFile(
      path.join(pkgDir, "bin", "fixture-shim"),
      "#!/usr/bin/env bash\nexit 0\n"
    );
    await chmod(path.join(pkgDir, "bin", "fixture-shim"), 0o755);
    return await fn({ pkgDir, binMap });
  } finally {
    await rm(pkgDir, { recursive: true, force: true });
  }
}

async function populateFixtureSymlinks(targetDir, pkgDir, binMap) {
  for (const [name, relativeBin] of Object.entries(binMap)) {
    await symlink(path.resolve(pkgDir, relativeBin), path.join(targetDir, name));
  }
}

function findEntry(output, name) {
  const entry = output.entries.find((candidate) => candidate.name === name);
  assert.ok(entry, `expected entry for declared bin ${name} in install-drift-check output`);
  return entry;
}

function assertEntryShape(entry) {
  assert.equal(typeof entry.name, "string", "entry.name must be a string");
  assert.equal(typeof entry.package_bin_path, "string", "entry.package_bin_path must be a string");
  assert.equal(typeof entry.target_path, "string", "entry.target_path must be a string");
  assert.ok(
    entry.drift_kind === null || typeof entry.drift_kind === "string",
    "entry.drift_kind must be null or a string"
  );
  assert.ok(
    entry.detail === null || typeof entry.detail === "object",
    "entry.detail must be an object (may be empty) or null"
  );
}

function assertOutputShape(output, targetDir) {
  assert.equal(typeof output.ok, "boolean", "ok must be boolean");
  assert.equal(output.target_dir, targetDir, "target_dir must echo the passed --target-dir");
  assert.equal(output.package_dir, PACKAGE_DIR, "package_dir must point at the real package directory");
  assert.ok(Array.isArray(output.entries), "entries must be an array");
  assert.equal(typeof output.drift_count, "number", "drift_count must be a number");
  for (const entry of output.entries) {
    assertEntryShape(entry);
  }
  const actualDrifts = output.entries.filter((entry) => entry.drift_kind !== null);
  assert.equal(
    output.drift_count,
    actualDrifts.length,
    "drift_count must equal the number of non-null drift_kind entries"
  );
}

async function populateCleanSymlinks(targetDir, binMap) {
  for (const [name, relativeBin] of Object.entries(binMap)) {
    const source = path.resolve(PACKAGE_DIR, relativeBin);
    await symlink(source, path.join(targetDir, name));
  }
}

async function populateCleanByteCopies(targetDir, binMap) {
  for (const [name, relativeBin] of Object.entries(binMap)) {
    const source = path.resolve(PACKAGE_DIR, relativeBin);
    await copyFile(source, path.join(targetDir, name));
  }
}

test("install-drift-check: clean fixture with canonical symlinks reports ok and exits 0", async () => {
  const binMap = await readPackageBinMap();
  await withTempTargetDir(async (targetDir) => {
    await populateCleanSymlinks(targetDir, binMap);
    const { output, exitCode } = await runJson(targetDir);
    assertOutputShape(output, targetDir);
    assert.equal(output.ok, true, "clean symlink fixture must report ok=true");
    assert.equal(output.drift_count, 0, "clean symlink fixture must report drift_count=0");
    assert.equal(output.entries.length, Object.keys(binMap).length, "every declared bin must appear in entries");
    for (const entry of output.entries) {
      assert.equal(
        entry.drift_kind,
        null,
        `clean symlink fixture must report drift_kind=null for ${entry.name}, got ${entry.drift_kind}`
      );
    }
    assert.equal(exitCode, 0, "clean fixture must exit 0");
  });
});

test("install-drift-check: clean fixture with byte-identical regular file copies reports ok and exits 0", async () => {
  const binMap = await readPackageBinMap();
  await withTempTargetDir(async (targetDir) => {
    await populateCleanByteCopies(targetDir, binMap);
    const { output, exitCode } = await runJson(targetDir);
    assertOutputShape(output, targetDir);
    assert.equal(output.ok, true, "byte-identical copies must report ok=true");
    assert.equal(output.drift_count, 0, "byte-identical copies must report drift_count=0");
    for (const entry of output.entries) {
      assert.equal(
        entry.drift_kind,
        null,
        `byte-identical copy must be clean for ${entry.name}, got ${entry.drift_kind}`
      );
      assert.match(
        String(entry.detail?.message ?? ""),
        /regular file/,
        `byte-identical copy detail must describe the regular file disposition for ${entry.name}`
      );
    }
    assert.equal(exitCode, 0, "byte-identical clean fixture must exit 0");
  });
});

test("install-drift-check: empty target dir reports every declared bin as missing and exits non-zero", async () => {
  const binMap = await readPackageBinMap();
  await withTempTargetDir(async (targetDir) => {
    const { output, exitCode } = await runJson(targetDir);
    assertOutputShape(output, targetDir);
    assert.equal(output.ok, false, "empty target dir must report ok=false");
    assert.equal(output.drift_count, Object.keys(binMap).length, "every declared bin must be classified missing");
    for (const entry of output.entries) {
      assert.equal(
        entry.drift_kind,
        "missing",
        `empty target dir must report drift_kind=missing for ${entry.name}, got ${entry.drift_kind}`
      );
      assert.match(
        String(entry.detail?.message ?? ""),
        /absent/,
        `missing detail must mention absence for ${entry.name}`
      );
    }
    assert.notEqual(exitCode, 0, "drift fixture must exit non-zero");
  });
});

test("install-drift-check: symlink to nonexistent path is classified dangling-symlink", async () => {
  const binMap = await readPackageBinMap();
  const targetName = Object.keys(binMap)[0];
  await withTempTargetDir(async (targetDir) => {

    await populateCleanSymlinks(targetDir, binMap);

    await rm(path.join(targetDir, targetName));
    const nonexistent = path.join(targetDir, "does-not-exist-anywhere");
    await symlink(nonexistent, path.join(targetDir, targetName));

    const { output, exitCode } = await runJson(targetDir);
    assertOutputShape(output, targetDir);
    const entry = findEntry(output, targetName);
    assert.equal(entry.drift_kind, "dangling-symlink", "dangling target must classify as dangling-symlink");
    assert.equal(entry.detail.link_target, nonexistent, "detail.link_target must echo the readlink result");
    assert.equal(
      entry.detail.resolved_link_target,
      nonexistent,
      "detail.resolved_link_target must resolve absolute link targets directly"
    );
    assert.match(
      String(entry.detail.message),
      /does not exist/i,
      "dangling detail must describe the nonexistent resolution"
    );
    assert.notEqual(exitCode, 0, "drift fixture must exit non-zero");
  });
});

test("install-drift-check: symlink-to-sibling-package-bin is classified stale-symlink, not clean", async () => {
  const binMap = await readPackageBinMap();
  const names = Object.keys(binMap);

  const driftedName = "agent-launch-filesystem-mcp-backend";
  const siblingName = "agent-launch";
  assert.ok(names.includes(driftedName), `package must declare ${driftedName}`);
  assert.ok(names.includes(siblingName), `package must declare ${siblingName}`);

  await withTempTargetDir(async (targetDir) => {
    await populateCleanSymlinks(targetDir, binMap);

    await rm(path.join(targetDir, driftedName));
    await symlink(
      path.resolve(PACKAGE_DIR, binMap[siblingName]),
      path.join(targetDir, driftedName)
    );

    const { output, exitCode } = await runJson(targetDir);
    assertOutputShape(output, targetDir);
    const entry = findEntry(output, driftedName);
    assert.equal(
      entry.drift_kind,
      "stale-symlink",
      "sibling-package-bin symlink must classify as stale-symlink"
    );
    assert.equal(
      entry.detail.expected_real_target,
      path.resolve(PACKAGE_DIR, binMap[driftedName]),
      "stale-symlink detail.expected_real_target must be the canonical package wrapper for the name"
    );
    assert.equal(
      entry.detail.real_target,
      path.resolve(PACKAGE_DIR, binMap[siblingName]),
      "stale-symlink detail.real_target must be the sibling package wrapper"
    );
    assert.match(
      String(entry.detail.message),
      /does not resolve/i,
      "stale-symlink detail must describe the realpath mismatch"
    );

    const sibling = findEntry(output, siblingName);
    assert.equal(sibling.drift_kind, null, "the sibling bin's own target must remain clean");
    assert.notEqual(exitCode, 0, "drift fixture must exit non-zero");
  });
});

test("install-drift-check: regular file with mismatched bytes is classified hand-copied", async () => {
  const binMap = await readPackageBinMap();
  const targetName = "agent-launch-filesystem-mcp-backend";
  assert.ok(Object.keys(binMap).includes(targetName), `package must declare ${targetName}`);

  await withTempTargetDir(async (targetDir) => {
    await populateCleanSymlinks(targetDir, binMap);
    await rm(path.join(targetDir, targetName));
    const handCopiedBytes = "#!/usr/bin/env bash\n# operator hand-copied stale shim\nexit 0\n";
    await writeFile(path.join(targetDir, targetName), handCopiedBytes);

    const { output, exitCode } = await runJson(targetDir);
    assertOutputShape(output, targetDir);
    const entry = findEntry(output, targetName);
    assert.equal(entry.drift_kind, "hand-copied", "mismatched regular file must classify as hand-copied");
    assert.equal(
      typeof entry.detail.package_bin_bytes,
      "number",
      "hand-copied detail must include numeric package_bin_bytes"
    );
    assert.equal(
      entry.detail.target_bytes,
      Buffer.byteLength(handCopiedBytes),
      "hand-copied detail.target_bytes must echo the operator file size"
    );
    assert.match(
      String(entry.detail.message),
      /hand-copied|byte-for-byte/i,
      "hand-copied detail must describe the byte mismatch"
    );
    assert.notEqual(exitCode, 0, "drift fixture must exit non-zero");
  });
});

test("install-drift-check: orphan files in target dir not declared in package bin are ignored", async () => {
  const binMap = await readPackageBinMap();
  await withTempTargetDir(async (targetDir) => {
    await populateCleanSymlinks(targetDir, binMap);

    await writeFile(path.join(targetDir, "not-in-bin-map"), "#!/bin/sh\necho orphan\n");
    await writeFile(path.join(targetDir, "operator-tool"), "#!/bin/sh\necho operator\n");
    await symlink("/usr/bin/env", path.join(targetDir, "env-link"));

    const { output, exitCode } = await runJson(targetDir);
    assertOutputShape(output, targetDir);
    const declaredNames = new Set(Object.keys(binMap));
    for (const entry of output.entries) {
      assert.ok(
        declaredNames.has(entry.name),
        `install-drift-check must only report entries for declared bins, got orphan ${entry.name}`
      );
    }
    assert.equal(output.entries.length, declaredNames.size, "entries must match declared bin count");
    assert.equal(output.ok, true, "orphan-only additions must not produce drift");
    assert.equal(output.drift_count, 0, "orphan files must not contribute to drift_count");
    assert.equal(exitCode, 0, "clean+orphan fixture must exit 0");
  });
});

test("install-drift-check: --json output shape pins clean and drift envelopes plus per-entry fields", async () => {
  const binMap = await readPackageBinMap();

  await withTempTargetDir(async (targetDir) => {
    await populateCleanSymlinks(targetDir, binMap);
    const { output } = await runJson(targetDir);
    const cleanKeys = new Set(Object.keys(output));
    for (const key of ["ok", "target_dir", "package_dir", "entries", "drift_count"]) {
      assert.ok(cleanKeys.has(key), `clean --json output must include top-level key ${key}`);
    }
    for (const entry of output.entries) {
      const entryKeys = new Set(Object.keys(entry));
      for (const key of ["name", "package_bin_path", "target_path", "drift_kind", "detail"]) {
        assert.ok(entryKeys.has(key), `clean entry must include per-entry key ${key}`);
      }
    }
  });

  await withTempTargetDir(async (targetDir) => {
    const { output } = await runJson(targetDir);
    const driftKeys = new Set(Object.keys(output));
    for (const key of ["ok", "target_dir", "package_dir", "entries", "drift_count"]) {
      assert.ok(driftKeys.has(key), `drift --json output must include top-level key ${key}`);
    }
    assert.equal(output.ok, false, "drift envelope must set ok=false");
    assert.ok(output.drift_count > 0, "drift envelope must report drift_count > 0");
    for (const entry of output.entries) {
      const entryKeys = new Set(Object.keys(entry));
      for (const key of ["name", "package_bin_path", "target_path", "drift_kind", "detail"]) {
        assert.ok(entryKeys.has(key), `drift entry must include per-entry key ${key}`);
      }
    }
  });
});

test("install-drift-check: unreadable regular file target is classified unreadable (L1 disposition)", async () => {
  const binMap = await readPackageBinMap();
  const targetName = "agent-launch-filesystem-mcp-backend";
  await withTempTargetDir(async (targetDir) => {
    await populateCleanSymlinks(targetDir, binMap);
    await rm(path.join(targetDir, targetName));
    const filePath = path.join(targetDir, targetName);
    await writeFile(filePath, "operator copy that will be made unreadable\n");
    await chmod(filePath, 0o000);

    const { output, exitCode } = await runJson(targetDir);
    assertOutputShape(output, targetDir);
    const entry = findEntry(output, targetName);
    assert.equal(
      entry.drift_kind,
      "unreadable",
      "chmod-0 regular file must classify as unreadable per current source behavior"
    );
    assert.equal(typeof entry.detail.code, "string", "unreadable detail must include errno code");
    assert.match(
      String(entry.detail.message),
      /unreadable/i,
      "unreadable detail message must describe the read failure"
    );
    assert.notEqual(exitCode, 0, "drift fixture must exit non-zero");

    await chmod(filePath, 0o644);
  });
});

test("install-drift-check: directory target is classified hand-copied with 'neither symlink nor regular file' detail (L2 disposition)", async () => {
  const binMap = await readPackageBinMap();
  const targetName = "agent-launch-filesystem-mcp-backend";
  await withTempTargetDir(async (targetDir) => {
    await populateCleanSymlinks(targetDir, binMap);
    await rm(path.join(targetDir, targetName));
    await mkdir(path.join(targetDir, targetName));

    const { output, exitCode } = await runJson(targetDir);
    assertOutputShape(output, targetDir);
    const entry = findEntry(output, targetName);
    assert.equal(
      entry.drift_kind,
      "hand-copied",
      "directory target is currently classified hand-copied per source behavior"
    );
    assert.match(
      String(entry.detail.message),
      /neither a symlink nor a regular file/i,
      "directory-target detail must describe the unexpected file type"
    );
    assert.notEqual(exitCode, 0, "drift fixture must exit non-zero");
  });
});

test("install-drift-check: executable-mode policy: every declared package bin lives under ./bin/", async () => {
  const binMap = await readPackageBinMap();
  for (const [name, relPath] of Object.entries(binMap)) {
    assert.ok(
      relPath.startsWith("bin/"),
      `${name}: every declared bin must live under ./bin/ (got ${relPath})`
    );
  }
});

test("install-drift-check: every declared shim under ./bin/ carries the user-executable mode bit on disk", async () => {
  const binMap = await readPackageBinMap();
  const offenders = [];
  for (const [name, relPath] of Object.entries(binMap)) {
    if (!relPath.startsWith("bin/")) continue;
    const absolute = path.resolve(PACKAGE_DIR, relPath);
    const s = await stat(absolute);
    if ((s.mode & 0o100) === 0) {
      offenders.push({ name, mode: (s.mode & 0o777).toString(8) });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "declared package bin(s) under ./bin/ are not executable on disk; " +
      "operator symlinks in PATH will fail with Permission denied: " +
      offenders.map((o) => `${o.name} (mode ${o.mode})`).join(", ")
  );
});

test("install-drift-check: non-executable package bin under ./bin/ is reported as non-executable-package-bin (fixture-package seam)", async () => {

  await withFixturePackage(async ({ pkgDir, binMap }) => {
    await chmod(path.join(pkgDir, "bin", "fixture-shim"), 0o644);
    await withTempTargetDir(async (targetDir) => {
      await populateFixtureSymlinks(targetDir, pkgDir, binMap);
      const { output, exitCode } = await runJson(targetDir, { packageDir: pkgDir });
      assert.equal(
        output.package_dir,
        pkgDir,
        "seam output must echo the fixture package_dir"
      );
      const entry = findEntry(output, "fixture-shim");
      assert.equal(
        entry.drift_kind,
        "non-executable-package-bin",
        "stripping +x on the package bin must classify as non-executable-package-bin"
      );
      assert.equal(
        typeof entry.detail.mode,
        "number",
        "non-executable-package-bin detail must include numeric mode"
      );
      assert.match(
        String(entry.detail.message),
        /executable|Permission denied/i,
        "non-executable-package-bin detail must describe the +x policy"
      );
      const agentLaunch = findEntry(output, "agent-launch");
      assert.equal(
        agentLaunch.drift_kind,
        null,
        "agent-launch Node entrypoint must remain clean despite the ./bin/ shim losing +x"
      );
      assert.notEqual(exitCode, 0, "drift fixture must exit non-zero");
    });
  });
});

test("install-drift-check: non-executable installed regular file (byte-identical copy) is reported as non-executable-target", async () => {
  const binMap = await readPackageBinMap();
  const targetName = "agent-launch-filesystem-mcp-backend";
  await withTempTargetDir(async (targetDir) => {
    await populateCleanSymlinks(targetDir, binMap);
    await rm(path.join(targetDir, targetName));
    await copyFile(
      path.resolve(PACKAGE_DIR, binMap[targetName]),
      path.join(targetDir, targetName)
    );
    await chmod(path.join(targetDir, targetName), 0o644);

    const { output, exitCode } = await runJson(targetDir);
    const entry = findEntry(output, targetName);
    assert.equal(
      entry.drift_kind,
      "non-executable-target",
      "byte-identical but non-executable target must classify as non-executable-target"
    );
    assert.equal(
      typeof entry.detail.mode,
      "number",
      "non-executable-target detail must include numeric mode"
    );
    assert.notEqual(exitCode, 0, "drift fixture must exit non-zero");
  });
});

test("install-drift-check: agent-launch package bin carries +x like the other shipped shims", async () => {
  const binMap = await readPackageBinMap();
  const agentLaunchPath = path.resolve(PACKAGE_DIR, binMap["agent-launch"]);
  const s = await stat(agentLaunchPath);
  assert.notEqual(
    s.mode & 0o100,
    0,
    "agent-launch package bin must carry the user-executable bit"
  );
  await withTempTargetDir(async (targetDir) => {
    await populateCleanSymlinks(targetDir, binMap);
    const { output, exitCode } = await runJson(targetDir);
    const entry = findEntry(output, "agent-launch");
    assert.equal(
      entry.drift_kind,
      null,
      "agent-launch must be clean when its installed target points at the executable package bin"
    );
    assert.equal(exitCode, 0, "clean fixture must exit 0");
  });
});
