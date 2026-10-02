

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LITELLM_LAUNCH_ERROR_CODES,
  ensureAgentLaunchLiteLlmGateway,
  provisionLiteLlmRuntime
} from "../../packages/agent-launch-cli/src/lib/litellm-gateway-launch.mjs";
import {
  LITELLM_PINNED_VERSION,
  LITELLM_RUNTIME_LOCK_PATH
} from "../../packages/agent-launch-core/src/lib/litellm-gateway.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

function stateRoot(t) {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const dir = mkdtempSync(path.join(os.tmpdir(), "wk2689-runtime-"));
  scope.add("state-root", () => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "litellm");
}

const PYTHON = Object.freeze({ found: "/usr/bin/python3", real: "/usr/bin/python3.12" });

function ok(stdout = "") {
  return { ok: true, code: 0, signal: null, timed_out: false, cancelled: false,
    output_overflow: null, spawn_error: null, stdout, stderr: "" };
}

function failed(stderr) {
  return { ok: false, code: 1, signal: null, timed_out: false, cancelled: false,
    output_overflow: null, spawn_error: null, stdout: "Collecting litellm\n", stderr };
}

function fakeRunner({ version = "3.12.3", pip = true, install = "ok" } = {}) {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, env: options.env });
    if (args.some((arg) => arg.includes("import sys, venv"))) return ok(`${version}\n`);
    if (args.join(" ").includes("-m pip --version")) return pip ? ok("pip 24.0\n") : failed("No module named pip");
    if (args.includes("venv") && args.includes("--without-pip")) {
      mkdirSync(path.join(args.at(-1), "bin"), { recursive: true });
      return ok();
    }
    if (args.includes("install")) {
      if (install !== "ok") return failed(`noise line\nERROR: ${install}\n`);
      const venvPython = args[args.indexOf("--python") + 1];
      writeFileSync(path.join(path.dirname(venvPython), "litellm"), "#!/bin/sh\n", { mode: 0o700 });
      return ok();
    }
    if (args.some((arg) => arg.includes("import importlib.metadata"))) return ok(`${LITELLM_PINNED_VERSION}\n`);
    throw new Error(`unexpected setup process ${command} ${args.join(" ")}`);
  };
  return { run, calls };
}

test("the packaged lock pins the qualified LiteLLM release with exact hashes", () => {
  const lock = readFileSync(LITELLM_RUNTIME_LOCK_PATH, "utf8");
  assert.match(lock, new RegExp(`^litellm==${LITELLM_PINNED_VERSION.replaceAll(".", "\\.")} \\\\$`, "m"));
  assert.match(lock, /^google-auth==/m);

  assert.match(lock, /^google-cloud-aiplatform==/m);
  const pins = lock.split("\n").filter((line) => /^[A-Za-z0-9]/.test(line));
  assert.ok(pins.length > 50);
  for (const pin of pins) assert.match(pin, /^[A-Za-z0-9._\[\]-]+==[^ ]+ \\$/, pin);
  assert.ok(lock.split("--hash=sha256:").length > pins.length);
});

test("first use installs a private venv with hash-locked host pip and publishes readiness once", async (t) => {
  const root = stateRoot(t);
  const runner = fakeRunner();
  const first = await provisionLiteLlmRuntime({
    stateRoot: root, env: { HTTPS_PROXY: "http://proxy:3128", GOOGLE_APPLICATION_CREDENTIALS: "/x" },
    runProcess: runner.run, findExecutable: () => PYTHON
  });
  assert.equal(first.executable, path.join(root, "runtimes", first.generation, "venv", "bin", "litellm"));
  const install = runner.calls.find((call) => call.args.includes("install"));
  for (const flag of ["--require-hashes", "--no-deps", "--only-binary=:all:", "--isolated", "--no-cache-dir"]) {
    assert.ok(install.args.includes(flag), flag);
  }
  assert.equal(install.command, PYTHON.real, "the host interpreter drives pip against the private venv");
  assert.equal(install.env.PIP_CONFIG_FILE, "/dev/null");
  assert.equal(install.env.HTTPS_PROXY, "http://proxy:3128");
  assert.equal(install.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  const ready = path.join(root, "runtimes", `${first.generation}.ready.json`);
  assert.equal(statSync(ready).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(root, "runtimes")).mode & 0o777, 0o700);

  const callsAfterFirst = runner.calls.length;
  const second = await provisionLiteLlmRuntime({ stateRoot: root, runProcess: runner.run, findExecutable: () => PYTHON });
  assert.equal(second.generation, first.generation);
  assert.equal(runner.calls.filter((call) => call.args.includes("install")).length, 1);
  assert.equal(runner.calls.length - callsAfterFirst, 2, "reuse only re-identifies the interpreter");
});

test("concurrent first launches converge on one install", async (t) => {
  const root = stateRoot(t);
  const runner = fakeRunner();
  const results = await Promise.all([1, 2, 3].map(() =>
    provisionLiteLlmRuntime({ stateRoot: root, runProcess: runner.run, findExecutable: () => PYTHON })));
  assert.equal(new Set(results.map((result) => result.generation)).size, 1);
  assert.equal(runner.calls.filter((call) => call.args.includes("install")).length, 1);
});

test("missing or unsupported host Python refuses with an actionable correction and no install", async (t) => {
  const root = stateRoot(t);
  await assert.rejects(
    provisionLiteLlmRuntime({ stateRoot: root, runProcess: fakeRunner().run, findExecutable: () => null }),
    (error) => error.code === LITELLM_LAUNCH_ERROR_CODES.PYTHON_MISSING && /install CPython 3\.12/.test(error.correction));
  const older = fakeRunner({ version: "3.10.12" });
  await assert.rejects(
    provisionLiteLlmRuntime({ stateRoot: root, runProcess: older.run, findExecutable: () => PYTHON }),
    (error) => error.code === LITELLM_LAUNCH_ERROR_CODES.PYTHON_UNSUPPORTED && error.detail.python_version === "3.10.12");
  const noPip = fakeRunner({ pip: false });
  await assert.rejects(
    provisionLiteLlmRuntime({ stateRoot: root, runProcess: noPip.run, findExecutable: () => PYTHON }),
    (error) => error.code === LITELLM_LAUNCH_ERROR_CODES.PIP_MISSING);
  for (const runner of [older, noPip]) {
    assert.equal(runner.calls.some((call) => call.args.includes("install")), false);
  }
});

test("a failed install removes only its own generation and reports a distilled cause", async (t) => {
  const root = stateRoot(t);
  const runner = fakeRunner({ install: "Could not find a version that satisfies the requirement litellm" });
  let generation = null;
  await assert.rejects(
    provisionLiteLlmRuntime({ stateRoot: root, runProcess: runner.run, findExecutable: () => PYTHON }),
    (error) => {
      assert.equal(error.code, LITELLM_LAUNCH_ERROR_CODES.INSTALL_FAILED);
      assert.equal(error.detail.step, "install_locked_packages");
      assert.equal(error.detail.tool_error, "ERROR: Could not find a version that satisfies the requirement litellm");
      assert.equal(JSON.stringify(error.detail).includes("Collecting"), false, "no raw output");
      return true;
    });
  const runtimes = path.join(root, "runtimes");
  const leftovers = (await import("node:fs")).readdirSync(runtimes);
  generation = leftovers.find((name) => /^[0-9a-f]{32}$/.test(name)) ?? null;
  assert.equal(generation, null, "the incomplete generation was removed");
  assert.equal(leftovers.some((name) => name.endsWith(".lock")), false, "the provisioning lock was released");
});

test("an unpublished generation left on disk is refused, not adopted", async (t) => {
  const root = stateRoot(t);
  const runner = fakeRunner();
  const first = await provisionLiteLlmRuntime({ stateRoot: root, runProcess: runner.run, findExecutable: () => PYTHON });
  rmSync(path.join(root, "runtimes", `${first.generation}.ready.json`));
  await assert.rejects(
    provisionLiteLlmRuntime({ stateRoot: root, runProcess: runner.run, findExecutable: () => PYTHON }),
    (error) => error.code === LITELLM_LAUNCH_ERROR_CODES.GENERATION_INCOMPLETE &&
      error.correction.includes(first.generation));
  assert.ok(existsSync(path.join(root, "runtimes", first.generation)));
});

function writeKey(dir, name, body, mode = 0o600) {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(body), { mode });
  return file;
}

test("the declared service-account key is checked before setup and supplies the project", async (t) => {
  const root = stateRoot(t);
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const key = writeKey(root, "sa.json", { type: "service_account", project_id: "key-project-01" });
  const gateway = (overrides = {}) => ({ gateway: { host: "127.0.0.1", port: 4000, credentials_file: key,
    vertex_project: null, vertex_location: "global", ...overrides } });
  const seen = [];
  const ensureGateway = async (request) => { seen.push(request); return { key_path: "/k" }; };
  const noProvision = () => { throw new Error("not reached"); };
  await ensureAgentLaunchLiteLlmGateway({ route: gateway(), stateRoot: root, ensureGateway, provisionRuntime: noProvision });
  assert.equal(seen[0].settings.vertex_project, "key-project-01");
  assert.equal(seen[0].settings.credentials_file, key);
  await ensureAgentLaunchLiteLlmGateway({ route: gateway({ vertex_project: "explicit-proj" }), stateRoot: root, ensureGateway });
  assert.equal(seen[1].settings.vertex_project, "explicit-proj");

  const refusals = [
    [writeKey(root, "open.json", { type: "service_account", project_id: "key-project-01" }, 0o644), /group or others/],
    [writeKey(root, "user.json", { type: "authorized_user" }), /not a service-account JSON key/],
    [path.join(root, "missing.json"), /cannot be read/],
    [root, /not a regular file/]
  ];
  for (const [file, message] of refusals) {
    await assert.rejects(
      ensureAgentLaunchLiteLlmGateway({ route: gateway({ credentials_file: file }), stateRoot: root, ensureGateway }),
      (error) => error.code === LITELLM_LAUNCH_ERROR_CODES.VERTEX_CREDENTIALS_INVALID && message.test(error.message) &&
        /chmod 600/.test(error.correction));
  }
  const noProject = writeKey(root, "noproj.json", { type: "service_account" });
  await assert.rejects(
    ensureAgentLaunchLiteLlmGateway({ route: gateway({ credentials_file: noProject }), stateRoot: root, ensureGateway }),
    (error) => error.code === LITELLM_LAUNCH_ERROR_CODES.VERTEX_PROJECT_UNRESOLVED);
  assert.equal(seen.length, 2, "a refused key never reaches gateway setup");
});

test("a seeded private interpreter and wheelhouse are preferred, and the install stays hash-locked and offline", async (t) => {
  const root = stateRoot(t);
  const seededBin = path.join(root, "python", "bin");
  mkdirSync(seededBin, { recursive: true, mode: 0o700 });
  mkdirSync(path.join(root, "wheelhouse"), { recursive: true, mode: 0o700 });
  const runner = fakeRunner();
  const searched = [];
  const findExecutable = (command, searchPath) => {
    searched.push(searchPath);
    return { found: path.join(seededBin, command), real: path.join(seededBin, "python3.12") };
  };
  await provisionLiteLlmRuntime({ stateRoot: root, runProcess: runner.run, findExecutable });
  assert.ok(searched[0].startsWith(`${seededBin}:`), "the seeded interpreter directory is searched first");
  const install = runner.calls.find((call) => call.args.includes("install"));
  assert.equal(install.command, path.join(seededBin, "python3.12"));
  const at = install.args.indexOf("--find-links");
  assert.ok(install.args.includes("--no-index"));
  assert.equal(install.args[at + 1], path.join(root, "wheelhouse"));
  assert.ok(install.args.includes("--require-hashes"));
});
