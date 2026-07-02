import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildCodexReasoningEffortConfigOverrides,
  buildHeadlessPlan
} from "../packages/agent-launch-cli/src/lib/workspace-agent-codex-role-adapter.mjs";
import {
  resolveLauncherProfile
} from "../packages/agent-launch-cli/src/lib/agent-launch-profiles.mjs";

async function makeCodexEffortFixture(t, { effort = "high" } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "codex-effort-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = path.join(base, "repo");
  const sourceHome = path.join(base, "source-home");
  const runtimeDir = path.join(base, "runtime");
  await mkdir(path.join(repo, "wiki"), { recursive: true });
  await mkdir(path.join(repo, "docs"), { recursive: true });
  await mkdir(sourceHome, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(
    path.join(repo, "agent-launch.toml"),
    [
      "[roles.worker]",
      'model = "gpt-5.5"',
      `effort = "${effort}"`,
      ""
    ].join("\n")
  );
  return {
    repo,
    env: {
      PATH: "/usr/bin",
      CODEX_SOURCE_HOME: sourceHome,
      CODEX_ORCH_RUNTIME_DIR: runtimeDir
    }
  };
}

function configOverrideValues(args, key) {
  const values = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === "-c" && args[index + 1].startsWith(`${key}=`)) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

test("WK-1283 SLICE-001: non-orchestrator Codex headless argv emits mapped high reasoning effort via -c", async (t) => {
  const { repo, env } = await makeCodexEffortFixture(t, { effort: "high" });
  const plan = await buildHeadlessPlan({
    role: "worker",
    subject: "WK-1283#SLICE-001",
    repo,
    env,
    logPrefix: "codex-effort",
    verbose: false,
    argsPrefix: ["-p", "worker", "exec", "--ignore-rules"],
    prompt: "PROMPT",
    model: "gpt-5.5"
  });
  assert.equal(plan.mode, "headless");
  assert.deepEqual(
    configOverrideValues(plan.args, "model_reasoning_effort"),
    ["model_reasoning_effort=high"]
  );
  assert.equal(plan.args[plan.args.length - 1], "PROMPT");
});

test("WK-1283 SLICE-001: non-orchestrator Codex xhigh emits as -c and does not switch to orchestrator_xhigh profile", async (t) => {
  const { repo, env } = await makeCodexEffortFixture(t, { effort: "xhigh" });
  const plan = await buildHeadlessPlan({
    role: "worker",
    subject: "WK-1283#SLICE-001",
    repo,
    env,
    logPrefix: "codex-effort",
    verbose: false,
    argsPrefix: ["-p", "worker", "exec", "--ignore-rules"],
    prompt: "PROMPT",
    model: "gpt-5.5"
  });
  assert.deepEqual(
    configOverrideValues(plan.args, "model_reasoning_effort"),
    ["model_reasoning_effort=xhigh"]
  );
  assert.equal(
    plan.args.includes("orchestrator_xhigh"),
    false,
    "non-orchestrator effort must not select the orchestrator_xhigh profile"
  );
  assert.equal(
    configOverrideValues(plan.args, "model_reasoning_effort").length,
    1,
    "reasoning effort must be emitted exactly once"
  );
});

test("WK-1283 SLICE-001: Codex neutral max clamps to xhigh for non-orchestrator roles", async (t) => {
  const { repo } = await makeCodexEffortFixture(t, { effort: "max" });
  assert.deepEqual(
    buildCodexReasoningEffortConfigOverrides({
      role: "worker",
      repo,
      model: "gpt-5.5"
    }),
    ["model_reasoning_effort=xhigh"]
  );
});

test("WK-1283 SLICE-001: orchestrator_xhigh profile path remains profile-owned", () => {
  const resolved = resolveLauncherProfile({
    role: "orchestrator",
    profileName: "orchestrator_xhigh",
    model: "gpt-5.5",
    env: {}
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.value.profile_name, "orchestrator_xhigh");
  assert.equal(resolved.value.backend_profile_key, "orchestrator_xhigh");
});
