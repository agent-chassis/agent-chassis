import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runWorker,
  dispatchWorkerSharedPipeline
} from "../../packages/agent-launch-cli/src/commands/worker.mjs";
import {
  runReview,
  dispatchReviewSharedPipeline
} from "../../packages/agent-launch-cli/src/commands/review.mjs";
import {
  runRedteam,
  dispatchRedteamSharedPipeline
} from "../../packages/agent-launch-cli/src/commands/redteam.mjs";

function makeModelCapturingBackend(calls) {
  return {
    startLaunch: async (input) => {
      calls.push({
        app: input.app,
        role: input.role,
        subject: input.subject,
        model: input.model
      });
      return {
        schema_version: "workspace-agent-dispatch-backend.v1",
        accepted: false,
        refusal: { code: "validation_failure", reason: "test_controlled_refusal", detail: null }
      };
    },
    waitForRunStatus: async () => ({
      accepted: false,
      refusal: { code: "monitor_handle_unknown", reason: null, detail: null }
    })
  };
}

function makeSilentIo() {
  return {
    stdout: { write: () => {} },
    stderr: { write: () => {} }
  };
}

function makeCapturingIo() {
  const stderr = [];
  return {
    io: {
      stdout: { write: () => {} },
      stderr: { write: (chunk) => stderr.push(String(chunk)) }
    },
    stderr
  };
}

const CODEX_RETIRED = /^agent-launch worker: codex_direct_worker_retired: /;
const MANAGED_START = /managed start_agent tool of an orchestrator session/;

async function withRoleSelection(models, body) {
  const repo = await mkdtemp(path.join(tmpdir(), "agent-launch-live-model-forwarding-"));
  const originalCwd = process.cwd();
  const lines = Object.entries(models).flatMap(([role, model]) => [`[roles.${role}]`, `model = "${model}"`]);
  await writeFile(path.join(repo, "agent-launch.toml"), `${lines.join("\n")}\n`, "utf8");
  try {
    process.chdir(repo);
    return await body();
  } finally {
    process.chdir(originalCwd);
    await rm(repo, { recursive: true, force: true });
  }
}

async function observeWorker(run) {
  const calls = [];
  const { io, stderr } = makeCapturingIo();
  const savedExitCode = process.exitCode;
  let exitCode;
  try {
    process.exitCode = undefined;
    await run(io, { backend: makeModelCapturingBackend(calls) });
    exitCode = process.exitCode;
  } finally {
    process.exitCode = savedExitCode;
  }
  return { calls, exitCode, stderr: stderr.join("") };
}

function assertCodexWorkerRetired(observed, label) {
  assert.deepEqual(observed.calls, [], `${label}: the retired route must reach no backend`);
  assert.equal(observed.exitCode, 1, `${label}: the retired route must exit 1`);
  assert.match(observed.stderr, CODEX_RETIRED, label);
  assert.match(observed.stderr, MANAGED_START, label);
}

test("WK-0764 live dispatch: worker shared pipeline forwards typed model to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchWorkerSharedPipeline(
      { resolved: { app: "claude" }, parsed: { unitAddress: "WK-0001", model: "opus", promptArgs: [] } },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "opus", "registered model must reach startLaunch via worker shared pipeline");
  assert.equal(calls[0].role, "worker");
});

test("WK-0764 live dispatch: worker shared pipeline passes null model when parsed.model is null", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchWorkerSharedPipeline(
      { resolved: { app: "claude" }, parsed: { unitAddress: "WK-0001", model: null, promptArgs: [] } },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "absent model must reach startLaunch as null, not undefined");
});

test("WK-0764 live dispatch: review shared pipeline forwards typed model to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchReviewSharedPipeline(
      {
        resolved: { app: "claude" },
        parsed: { unitAddress: "WK-0001", model: "sonnet", promptArgs: [], agentBackendOptions: [] }
      },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "sonnet", "registered model must reach startLaunch via review shared pipeline");
  assert.equal(calls[0].role, "reviewer");
});

test("WK-0764 live dispatch: review shared pipeline passes null model when parsed.model is null", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchReviewSharedPipeline(
      {
        resolved: { app: "claude" },
        parsed: { unitAddress: "WK-0001", model: null, promptArgs: [], agentBackendOptions: [] }
      },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "absent model must reach startLaunch as null, not undefined");
});

test("WK-0764 live dispatch: redteam shared pipeline forwards typed model to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchRedteamSharedPipeline(
      {
        resolved: { app: "claude" },
        parsed: { unitAddress: "WK-0001", model: "opus", promptArgs: [], agentBackendOptions: [] },
        subject: "WK-0001"
      },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "opus", "registered model must reach startLaunch via redteam shared pipeline");
  assert.equal(calls[0].role, "redteam");
});

test("WK-0764 live dispatch: redteam shared pipeline passes null model when parsed.model is null", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchRedteamSharedPipeline(
      {
        resolved: { app: "claude" },
        parsed: { unitAddress: "WK-0001", model: null, promptArgs: [], agentBackendOptions: [] },
        subject: "WK-0001"
      },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "absent model must reach startLaunch as null, not undefined");
});

test("WK-0764 live dispatch end-to-end: runWorker --model forwards typed model to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await runWorker(["WK-0001", "--app", "claude", "--model", "opus"], io, { backend: mockBackend });
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "opus", "runWorker --model must reach startLaunch end-to-end");
  assert.equal(calls[0].app, "claude");
  assert.equal(calls[0].role, "worker");
  assert.equal(calls[0].subject, "WK-0001");
});

test("WK-0764 live dispatch end-to-end: runWorker preserves configured role selection without an explicit model hint", async () => {

  const configured = await withRoleSelection({ worker: "opus" },
    () => observeWorker((io, seam) => runWorker(["WK-0001"], io, seam)));
  assert.equal(configured.calls.length, 1, "startLaunch must be called once");
  assert.deepEqual([configured.calls[0].app, configured.calls[0].role, configured.calls[0].subject], ["claude", "worker", "WK-0001"]);
  assert.strictEqual(configured.calls[0].model, null, "configured selection must not become an explicit model hint");
});

test("the direct live Codex worker is retired however Codex was selected, and reaches no backend", async () => {

  assertCodexWorkerRetired(await withRoleSelection({ worker: "gpt-5.5" },
    () => observeWorker((io, seam) => runWorker(["WK-0001"], io, seam))), "configured Codex selection");

  assertCodexWorkerRetired(await withRoleSelection({ worker: "gpt-5.5" },
    () => observeWorker((io, seam) => runWorker(["WK-0001", "--app", "codex"], io, seam))), "explicit --app codex");

  assertCodexWorkerRetired(await withRoleSelection({ worker: "opus" },
    () => observeWorker((io, seam) => runWorker(["WK-0001", "--model", "gpt-5.5"], io, seam))), "explicit Codex model");

  assertCodexWorkerRetired(await withRoleSelection({ worker: "opus" },
    () => observeWorker((io, seam) => runWorker(["WK-0001", "--spark", "--model", "codex-5.3-spark"], io, seam))), "worker_spark profile");
});

test("WK-0764 live dispatch end-to-end: runReview --model forwards typed model to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await withRoleSelection({ reviewer: "opus" },
      () => runReview(["WK-0001", "--app", "claude", "--model", "sonnet"], io, { backend: mockBackend }));
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "sonnet", "runReview --model must reach startLaunch end-to-end");
  assert.equal(calls[0].app, "claude");
  assert.equal(calls[0].role, "reviewer");
  assert.equal(calls[0].subject, "WK-0001");
});

test("WK-0764 live dispatch end-to-end: runReview preserves configured role selection without an explicit model hint", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await withRoleSelection({ reviewer: "opus" },
      () => runReview(["WK-0001"], io, { backend: mockBackend }));
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "configured selection must not become an explicit model hint");
  assert.equal(calls[0].app, "claude");
  assert.equal(calls[0].role, "reviewer");
});

test("WK-0764 live dispatch end-to-end: runRedteam --model forwards typed model to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await runRedteam(["WK-0001", "--app", "claude", "--model", "opus"], io, { backend: mockBackend });
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "opus", "runRedteam --model must reach startLaunch end-to-end");
  assert.equal(calls[0].app, "claude");
  assert.equal(calls[0].role, "redteam");
  assert.equal(calls[0].subject, "WK-0001");
});

test("WK-0764 live dispatch end-to-end: runRedteam preserves configured role selection without an explicit model hint", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await runRedteam(["WK-0001"], io, { backend: mockBackend });
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "configured selection must not become an explicit model hint");
});

test("unknown explicit models remain refused and are never retried through role configuration", async () => {
  const repo = await mkdtemp(path.join(tmpdir(), "agent-launch-explicit-model-refusal-"));
  const originalCwd = process.cwd();
  const roleConfig = [
    "[roles.worker]",
    'model = "opus"',
    "[roles.reviewer]",
    'model = "opus"',
    "[roles.redteam]",
    'model = "opus"',
    ""
  ].join("\n");
  await writeFile(path.join(repo, "agent-launch.toml"), roleConfig, "utf8");

  const cases = [
    { role: "worker", run: runWorker, reason: "worker_model_unknown" },
    { role: "reviewer", run: runReview, reason: "reviewer_model_unknown" },
    { role: "redteam", run: runRedteam, reason: "redteam_model_unknown" }
  ];

  try {
    process.chdir(repo);
    for (const entry of cases) {
      const calls = [];
      const { io, stderr } = makeCapturingIo();
      const savedExitCode = process.exitCode;
      try {
        await entry.run(
          ["WK-0001", "--app", "claude", "--model", "unknown-vendor-model"],
          io,
          { backend: makeModelCapturingBackend(calls) }
        );
      } finally {
        process.exitCode = savedExitCode;
      }
      assert.equal(calls.length, 0, `${entry.role} must not retry without the explicit model`);
      assert.match(stderr.join(""), new RegExp(entry.reason));
      assert.match(stderr.join(""), /unknown-vendor-model/);
    }
  } finally {
    process.chdir(originalCwd);
    await rm(repo, { recursive: true, force: true });
  }
});

test("WK-0764 anti-regression: worker configured resolved.model is NOT forwarded as model hint to startLaunch", async () => {

  const claude = await observeWorker((io, seam) => dispatchWorkerSharedPipeline(
    {
      resolved: { app: "claude", model: "opus", model_source: "role_config" },
      parsed: { unitAddress: "WK-0001", model: null, promptArgs: [] }
    },
    io,
    seam
  ));
  assert.equal(claude.calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(
    claude.calls[0].model,
    null,
    "configured resolved.model must NOT be forwarded as model hint; only parsed.model is"
  );

  assertCodexWorkerRetired(await observeWorker((io, seam) => dispatchWorkerSharedPipeline(
    {
      resolved: { app: "codex", model: "gpt-5.6-luna", model_source: "role_config" },
      parsed: { unitAddress: "WK-0001", model: null, promptArgs: [] }
    },
    io,
    seam
  )), "configured Codex selection at the shared pipeline");
});

test("WK-0764 anti-regression: reviewer configured resolved.model is NOT forwarded as model hint to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchReviewSharedPipeline(
      {
        resolved: { app: "codex", model: "gpt-5.6-sol", model_source: "role_config" },
        parsed: { unitAddress: "WK-0001", model: null, promptArgs: [], agentBackendOptions: [] }
      },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "resolved.model must NOT be forwarded as model hint");
});

test("WK-0764 anti-regression: redteam configured resolved.model is NOT forwarded as model hint to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchRedteamSharedPipeline(
      {
        resolved: { app: "codex", model: "gpt-5.6-sol", model_source: "role_config" },
        parsed: { unitAddress: "WK-0001", model: null, promptArgs: [], agentBackendOptions: [] },
        subject: "WK-0001"
      },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "resolved.model must NOT be forwarded as model hint");
});
