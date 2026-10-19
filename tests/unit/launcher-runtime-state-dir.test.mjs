import assert from "node:assert/strict";
import test from "node:test";

import {
  LAUNCHER_RUNTIME_STATE_DIR_ENV,
  LAUNCHER_RUNTIME_STATE_UNAVAILABLE_CODE,
  resolveLauncherRuntimeStateDirForWorkspace
} from "../../packages/agent-launch-core/src/lib/launcher-runtime-state-dir.mjs";

const workspaceBasis = "/workspace/repository";
const workspaceDigest = "b7a886d0cdd17479";
const defaultResult = {
  ok: true,
  dir: `/tmp/agent-launch-runtime/${workspaceDigest}`,
  source: "tmpdir_default"
};

test("default launcher state ignores harness temp settings without changing the environment", (t) => {
  const names = [LAUNCHER_RUNTIME_STATE_DIR_ENV, "TMPDIR", "TMP", "TEMP"];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  for (const temp of [
    { TMPDIR: `${workspaceBasis}/harness temp`, TMP: "relative-temp", TEMP: "" },
    { TMP: `${workspaceBasis}/tmp`, TEMP: `${workspaceBasis}/temp` },
    { TEMP: `${workspaceBasis}/temp` },
    { TMPDIR: "", TMP: "", TEMP: "", [LAUNCHER_RUNTIME_STATE_DIR_ENV]: "" },
    {}
  ]) {
    for (const name of names) {
      if (Object.hasOwn(temp, name)) process.env[name] = temp[name]; else delete process.env[name];
    }
    const env = Object.freeze({ ...temp, HOME: "/prepared/home", PATH: "bin::/usr/bin",
      NODE_OPTIONS: "--no-warnings" });
    const before = { ...env };
    const ambientBefore = { ...process.env };
    assert.deepEqual(resolveLauncherRuntimeStateDirForWorkspace({ workspaceBasis, env }), defaultResult);
    assert.deepEqual(resolveLauncherRuntimeStateDirForWorkspace({ workspaceBasis }), defaultResult,
      "the default must also ignore ambient process temp settings");
    assert.deepEqual(env, before);
    assert.deepEqual({ ...process.env }, ambientBefore);
  }
});

test("default launcher state is stable for one workspace and separate for another", () => {
  const env = Object.freeze({});
  const first = resolveLauncherRuntimeStateDirForWorkspace({ workspaceBasis, env });
  assert.deepEqual(first, defaultResult);
  assert.deepEqual(resolveLauncherRuntimeStateDirForWorkspace({ workspaceBasis, env }), first);
  const other = resolveLauncherRuntimeStateDirForWorkspace({ workspaceBasis: "/workspace/other", env });
  assert.equal(other.ok, true);
  assert.match(other.dir, /^\/tmp\/agent-launch-runtime\/[0-9a-f]{16}$/u);
  assert.notEqual(other.dir, first.dir);
});

test("an explicit absolute launcher state root retains precedence and workspace partitioning", () => {
  const env = Object.freeze({ [LAUNCHER_RUNTIME_STATE_DIR_ENV]: " /selected/launcher-state ",
    TMPDIR: `${workspaceBasis}/harness-temp`, TMP: "", TEMP: "relative-temp" });
  const before = { ...env };
  const first = resolveLauncherRuntimeStateDirForWorkspace({ workspaceBasis, env });
  assert.deepEqual(first, { ok: true, dir: `/selected/launcher-state/${workspaceDigest}`, source: "env" });
  const other = resolveLauncherRuntimeStateDirForWorkspace({ workspaceBasis: "/workspace/other", env });
  assert.equal(other.ok, true);
  assert.match(other.dir, /^\/selected\/launcher-state\/[0-9a-f]{16}$/u);
  assert.notEqual(other.dir, first.dir);
  assert.deepEqual(env, before);
});

test("an explicit relative launcher state root retains its refusal", () => {
  for (const value of ["relative-state", "./state", " ../state "]) {
    const env = Object.freeze({ [LAUNCHER_RUNTIME_STATE_DIR_ENV]: value, TMPDIR: "/prepared/temp" });
    const before = { ...env };
    assert.deepEqual(resolveLauncherRuntimeStateDirForWorkspace({ workspaceBasis, env }), {
      ok: false,
      code: LAUNCHER_RUNTIME_STATE_UNAVAILABLE_CODE,
      reason: `${LAUNCHER_RUNTIME_STATE_DIR_ENV} must be an absolute path; received a relative value`
    });
    assert.deepEqual(env, before);
  }
});
