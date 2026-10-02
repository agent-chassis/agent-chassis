import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { TOOLCHAIN_DESCRIPTIONS } from
  "../../packages/wiki-core/src/lib/runtime-inputs/toolchain-descriptions.mjs";
import { observeToolchainInstallation } from
  "../../packages/wiki-core/src/lib/runtime-inputs/toolchain-observation.mjs";
import { withTestFixture } from "../helpers/test-fixture.mjs";

const BASE = "/usr/bin:/bin";

function tool(file, mode = 0o755) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "fixture", { mode });
  return file;
}

function outcome(fields) {
  return { ok: false, command: "fixture", code: null, signal: null, timed_out: false, cancelled: false,
    output_overflow: null, spawn_error: null, stdout: "", stderr: "", ...fields };
}
const ok = (stdout) => outcome({ ok: true, code: 0, stdout });

function scripted(results) {
  const calls = [];
  return { calls, probe: async (request) => {
    calls.push(request);
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next;
  } };
}

function observe(rootPath, name, executable, results, fields = {}) {
  const { probe, calls } = scripted([...results]);
  const description = TOOLCHAIN_DESCRIPTIONS[name];
  return observeToolchainInstallation({ description, executable, source: "host",
    requiredRoles: Object.keys(description.executables), probe,
    probeContext: { cwd: rootPath, timeoutMs: 60000, env: { root: { PATH: BASE },
      describe: { PATH: BASE, PYTHONDONTWRITEBYTECODE: "1" }, version: { PATH: BASE } } },
    ...fields }).then((result) => ({ result, calls }));
}

const pythonFacts = (root) => ({ executable: path.join(root, "bin/python3.12"), version: "3.12.1",
  prefix: root, stdlib: path.join(root, "lib/python3.12") });

test("shared installation observation preserves five runtime layouts", async () => {
  await withTestFixture(async ({ rootPath }) => {
    const at = (...parts) => path.join(rootPath, ...parts);
    const py = pythonFacts(at("py"));
    tool(py.executable);
    for (const file of ["node/bin/node", "go/bin/go", "go/bin/gofmt", "rust/bin/cargo",
      "rust/bin/rustc", "host/rustc", "deno/deno", "py/bin/python3"]) tool(at(file));
    const cases = [
      ["node", at("node/bin/node"), [ok("v20.1.2\n")], at("node"), { node: at("node/bin/node") },
        [at("node/bin/node")], [], "20.1.2", [[at("node/bin/node"), ["--version"]]]],
      ["python", at("py/bin/python3"), [ok(JSON.stringify(py))], py.prefix, { python: py.executable },
        [py.executable, py.stdlib], ["__pycache__", "site-packages", "dist-packages"], "3.12.1",
        [[at("py/bin/python3"), ["-I", "-B", "-c"]]]],
      ["go", at("go/bin/go"), [ok("go version go1.23.4 linux/amd64")], at("go"),
        { go: at("go/bin/go"), gofmt: at("go/bin/gofmt") }, [at("go")], [], "1.23.4",
        [[at("go/bin/go"), ["version"]]]],
      ["rust", at("host/rustc"), [ok(`${at("rust")}\n`), ok("cargo 1.84.0 (abc 2025-01-01)")], at("rust"),
        { cargo: at("rust/bin/cargo"), rustc: at("rust/bin/rustc") }, [at("rust")], [], "1.84.0",
        [[at("host/rustc"), ["--print", "sysroot"]], [at("rust/bin/cargo"), ["--version"]]]],
      ["deno", at("deno/deno"), [ok("deno 2.1.0 (stable)")], at("deno"), { deno: at("deno/deno") },
        [at("deno/deno")], [], "2.1.0", [[at("deno/deno"), ["--version"]]]]
    ];
    for (const [name, executable, results, root, executables, population, exclude, version, argv] of cases) {
      const { result, calls } = await observe(rootPath, name, executable, results);
      assert.deepEqual(result, { status: "observed", root, executables, population,
        population_exclude: exclude, version, source: "host" }, name);
      assert.deepEqual(calls.map(({ command, args }) => [command, args.slice(0, argv[0][1].length)]), argv, name);
    }
    const { calls: [pythonCall] } = await observe(rootPath, "python", at("py/bin/python3"), [ok(JSON.stringify(py))]);
    assert.match(pythonCall.args[3], /sys\.base_prefix/u);
    assert.deepEqual(pythonCall.env, { PATH: BASE, PYTHONDONTWRITEBYTECODE: "1" });
    const { calls: rustCalls } = await observe(rootPath, "rust", at("host/rustc"),
      [ok(at("rust")), ok("cargo 1.84.0 (abc)")]);
    assert.deepEqual(rustCalls.map(({ env }) => env), [{ PATH: BASE },
      { PATH: `${at("rust/bin")}:${BASE}`, RUSTC: at("rust/bin/rustc") }]);
  });
});

test("required roles distinguish missing components from lookup failures", async () => {
  await withTestFixture(async ({ rootPath }) => {
    const go = tool(path.join(rootPath, "go/bin/go"));
    const version = ok("go version go1.23.4 linux/amd64");
    const goOnly = await observe(rootPath, "go", go, [version], { requiredRoles: ["go"] });
    assert.equal(goOnly.result.status, "observed");
    assert.deepEqual(goOnly.result.executables, { go });
    const gofmt = path.join(rootPath, "go/bin/gofmt");
    const missing = await observe(rootPath, "go", go, [version]);
    assert.equal(missing.result.code, "runtime_input_installation_components_missing");
    assert.deepEqual(missing.result.missing, [{ role: "gofmt", path: gofmt }]);
    assert.deepEqual(missing.calls, []);
    const alone = await observe(rootPath, "go", go, [version], { requiredRoles: ["gofmt"] });
    assert.deepEqual(alone.result.missing, [{ role: "gofmt", path: gofmt }]);
    tool(gofmt, 0o644);
    const denied = await observe(rootPath, "go", go, [version]);
    assert.equal(denied.result.code, "runtime_input_installation_component_lookup_failed");
    assert.equal(denied.result.phase, "components");
    assert.equal(denied.result.observation.operation, "access");
    assert.equal(denied.result.observation.errno, "EACCES");
    assert.equal(denied.result.cause, denied.result.observation.cause);
    assert.deepEqual(denied.calls, []);
    for (const requiredRoles of [["go", "cargo"], [], "go"]) {
      const invalid = await observe(rootPath, "go", go, [version], { requiredRoles });
      assert.equal(invalid.result.code, "runtime_input_installation_invalid");
      assert.deepEqual(invalid.calls, []);
    }
  });
});

test("installation probes preserve caller context and bounded outcomes", async () => {
  await withTestFixture(async ({ rootPath }) => {
    const rustc = tool(path.join(rootPath, "host/rustc"));
    const { signal } = new AbortController();
    const before = Date.now();
    const context = { cwd: rootPath, timeoutMs: 5000, signal,
      env: { root: { PATH: "/root-only" }, describe: {}, version: { PATH: BASE } } };
    const { calls } = await observe(rootPath, "rust", rustc, [outcome({ code: 2 })], { probeContext: context });
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.deepEqual({ ...call, deadline: 0 }, { command: rustc, args: ["--print", "sysroot"], cwd: rootPath,
      env: { PATH: "/root-only" }, deadline: 0, signal, output: "text" });
    assert.ok(Number.isFinite(call.deadline) && call.deadline >= before + 5000 &&
      call.deadline <= Date.now() + 5000);
    const thrown = new Error("capability broke");
    for (const failed of [outcome({ timed_out: true }), outcome({ cancelled: true }),
      outcome({ output_overflow: "stdout" }), outcome({ spawn_error: "ENOENT" }),
      outcome({ code: 3, stderr: "boom" }), thrown]) {
      const probed = await observe(rootPath, "rust", rustc, [failed, ok("cargo 1.84.0 (x)")]);
      assert.equal(probed.result.code, "runtime_input_installation_probe_failed");
      assert.equal(probed.result.phase, "root");
      if (failed === thrown) assert.equal(probed.result.cause, thrown);
      else assert.equal(probed.result.result, failed);
      assert.equal(probed.calls.length, 1, "no probe follows a failed probe");
    }
    const node = tool(path.join(rootPath, "node/bin/node"));
    const late = await observe(rootPath, "node", node, [outcome({ timed_out: true })]);
    assert.equal(late.result.phase, "version");
    assert.equal(late.result.root, path.join(rootPath, "node"));
    assert.equal(late.result.result.timed_out, true);
  });
});

test("malformed installation output never becomes observed", async () => {
  await withTestFixture(async ({ rootPath }) => {
    const python = tool(path.join(rootPath, "py/bin/python3"));
    const facts = pythonFacts(path.join(rootPath, "py"));
    const pythonCases = [["{not json", "not JSON"], ["[]", "not a JSON object"],
      ...[["executable", undefined], ["prefix", 7], ["stdlib", "lib/python3"], ["executable", ""],
        ["version", 3.12], ["version", "three"], ["version", ""]]
        .map(([field, value]) => [JSON.stringify({ ...facts, [field]: value }), field])];
    for (const [stdout, reason] of pythonCases) {
      const { result } = await observe(rootPath, "python", python, [ok(stdout)]);
      assert.equal(result.code, "runtime_input_installation_output_invalid", stdout);
      assert.equal(result.phase, "describe");
      assert.ok(result.message.includes(python) && result.message.includes(reason), result.message);
      assert.match(result.correction, /python/u);
      assert.equal(result.result.stdout, stdout);
      if (reason === "not JSON") assert.ok(result.cause instanceof SyntaxError);
    }
    const rustc = tool(path.join(rootPath, "host/rustc"));
    for (const root of ["", "   ", "relative/root"]) {
      const { result, calls } = await observe(rootPath, "rust", rustc, [ok(root), ok("cargo 1.84.0 (x)")]);
      assert.equal(result.code, "runtime_input_installation_output_invalid");
      assert.equal(result.phase, "root");
      assert.match(result.message, /toolchain root/u);
      assert.equal(calls.length, 1);
    }
    const node = tool(path.join(rootPath, "node/bin/node"));
    const { result } = await observe(rootPath, "node", node, [ok("node twenty")]);
    assert.equal(result.code, "runtime_input_installation_output_invalid");
    assert.equal(result.phase, "version");
    assert.ok(result.message.includes(node) && result.correction.includes(node));
    assert.equal(result.result.stdout, "node twenty");
  });
});
