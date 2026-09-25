

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import deno from "../../packages/agent-launch-cli/src/lib/test-execution/runner-integrations/deno.mjs";

const WORK = "/agent-validation-tmp/work/deno";
const plan = (hostProjectDir) => deno.invocation({ runtime: { executables: { deno: "/opt/deno/bin/deno" } },
  hostProjectDir, projectDir: WORK, entry: "/agent-validation-tmp/.launcher-test-proof/deno-entry.js",
  writablePaths: ["/agent-validation-tmp/.launcher-test-proof/channel.jsonl"] });
const configArguments = (args) => {
  const index = args.indexOf("--config");
  return index < 0 ? null : args[index + 1];
};

test("Deno configuration is detected in the host project and named in the working copy", (t) => {
  const host = mkdtempSync(path.join(tmpdir(), "deno-plan-"));
  t.after(() => rmSync(host, { recursive: true, force: true }));

  const bare = plan(host);
  assert.equal(configArguments(bare.args), null);
  assert.equal(bare.cwd, WORK);

  writeFileSync(path.join(host, "deno.jsonc"), "{}\n");
  assert.equal(configArguments(plan(host).args), `${WORK}/deno.jsonc`);
  writeFileSync(path.join(host, "deno.json"), "{}\n");
  const configured = plan(host);
  assert.equal(configArguments(configured.args), `${WORK}/deno.json`, "deno.json is preferred");
  assert.deepEqual(configured.args.slice(0, 4), ["test", "--frozen", "--cached-only", "--no-prompt"]);
  assert.equal(configured.args.at(-1), "/agent-validation-tmp/.launcher-test-proof/deno-entry.js");
  assert.ok(configured.args.every((arg) => !arg.startsWith(host)), "no host path reaches the sandboxed run");
});

const DENO = "/opt/deno/bin/deno";
const probe = (projectDir) => deno.setupProbe({ runtime: { executables: { deno: DENO } }, projectDir });
const CONFORMANCE_LOCK = readFileSync(path.join(import.meta.dirname, "../fixtures/provider-conformance/deno/deno.lock"),
  "utf8");

test("the Deno setup probe checks every locked dependency and only a dependency-free lock selects info", (t) => {
  const host = mkdtempSync(path.join(tmpdir(), "deno-probe-"));
  t.after(() => rmSync(host, { recursive: true, force: true }));
  writeFileSync(path.join(host, "deno.json"), "{}\n");

  writeFileSync(path.join(host, "deno.lock"), CONFORMANCE_LOCK);
  const locked = probe(host);
  assert.equal(locked.command, DENO);
  assert.deepEqual(locked.args, ["check", "--cached-only", "--frozen", "--config", path.join(host, "deno.json"),
    "jsr:@std/assert@1.0.19"]);

  writeFileSync(path.join(host, "deno.lock"), JSON.stringify({ version: "5" }));
  assert.deepEqual(probe(host).args, ["info", "--json"], "an empty lock selects the no-dependency check");
  writeFileSync(path.join(host, "deno.lock"), JSON.stringify({ version: "5", workspace: { dependencies: [] },
    remote: {}, jsr: {}, npm: {} }));
  assert.deepEqual(probe(host).args, ["info", "--json"], "empty dependency sections are dependency-free");
});

test("an unreadable, unparseable or uncheckable Deno lock fails the setup probe with its diagnostic",
  (t) => {
    const host = mkdtempSync(path.join(tmpdir(), "deno-probe-failure-"));
    t.after(() => {
      try { chmodSync(path.join(host, "deno.lock"), 0o644); } catch {}
      rmSync(host, { recursive: true, force: true });
    });
    const lock = path.join(host, "deno.lock");
    const refused = (code, message) => assert.throws(() => probe(host), (error) => {
      assert.equal(error.code, code);
      assert.match(error.message, message);
      assert.ok(error.message.includes(lock), error.message);
      return true;
    });

    refused("test_runtime_dependency_lock_missing", /could not be read: ENOENT/u);

    writeFileSync(lock, "{ \"version\": \"5\", ");
    refused("test_runtime_manifest_invalid", /is not valid JSON: /u);

    for (const text of ["null", "[]", "\"5\""]) {
      writeFileSync(lock, text);
      refused("test_runtime_manifest_invalid", /is not a JSON object/u);
    }

    const recorded = JSON.parse(CONFORMANCE_LOCK);
    delete recorded.workspace;
    writeFileSync(lock, JSON.stringify(recorded));
    refused("test_runtime_runner_probe_unsupported",
      /no supported check target: .* records 2 package\(s\) but no direct dependency specifier; this is a limitation of the probe, not a finding that the lock is invalid/u);
    writeFileSync(lock, JSON.stringify({ version: "4", packages: { npm: { "ms@2.1.3": {} } } }));
    refused("test_runtime_runner_probe_unsupported", /records 1 package\(s\)/u);

    writeFileSync(lock, CONFORMANCE_LOCK);
    chmodSync(lock, 0o000);
    if (process.getuid?.() !== 0) refused("test_runtime_manifest_invalid", /could not be read: EACCES/u);
  });
