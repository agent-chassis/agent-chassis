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
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await runWorker(["WK-0001"], io, { backend: mockBackend });
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "configured selection must not become an explicit model hint");
});

test("WK-0764 live dispatch end-to-end: runReview --model forwards typed model to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await runReview(["WK-0001", "--app", "claude", "--model", "sonnet"], io, { backend: mockBackend });
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
    await runReview(["WK-0001"], io, { backend: mockBackend });
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "configured selection must not become an explicit model hint");
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
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchWorkerSharedPipeline(
      {
        resolved: { app: "codex", model: "gpt-5.6-luna", model_source: "role_config" },
        parsed: { unitAddress: "WK-0001", model: null, promptArgs: [] }
      },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(
    calls[0].model,
    null,
    "configured resolved.model must NOT be forwarded as model hint; only parsed.model is"
  );
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
