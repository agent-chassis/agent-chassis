

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
