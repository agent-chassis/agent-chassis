import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runWorker,
  dispatchWorkerSharedPipeline
} from "../packages/agent-launch-cli/src/commands/worker.mjs";
import {
  runReview,
  dispatchReviewSharedPipeline
} from "../packages/agent-launch-cli/src/commands/review.mjs";
import {
  runRedteam,
  dispatchRedteamSharedPipeline
} from "../packages/agent-launch-cli/src/commands/redteam.mjs";

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

test("WK-0764 live dispatch: worker shared pipeline forwards typed model to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchWorkerSharedPipeline(
      { resolved: { app: "claude" }, parsed: { unitAddress: "WK-0001", model: "claude-3-opus", promptArgs: [] } },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "claude-3-opus", "typed model must reach startLaunch via worker shared pipeline");
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
        parsed: { unitAddress: "WK-0001", model: "claude-3-5-sonnet", promptArgs: [], agentBackendOptions: [] }
      },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "claude-3-5-sonnet", "typed model must reach startLaunch via review shared pipeline");
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
        parsed: { unitAddress: "WK-0001", model: "claude-3-opus", promptArgs: [], agentBackendOptions: [] },
        subject: "WK-0001"
      },
      io,
      { backend: mockBackend }
    );
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "claude-3-opus", "typed model must reach startLaunch via redteam shared pipeline");
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
    await runWorker(["WK-0001", "--app", "claude", "--model", "claude-3-opus"], io, { backend: mockBackend });
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "claude-3-opus", "runWorker --model must reach startLaunch end-to-end");
  assert.equal(calls[0].app, "claude");
  assert.equal(calls[0].role, "worker");
  assert.equal(calls[0].subject, "WK-0001");
});

test("WK-0764 live dispatch end-to-end: runWorker without --model passes null to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await runWorker(["WK-0001", "--app", "claude"], io, { backend: mockBackend });
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "runWorker without --model must pass null to startLaunch");
});

test("WK-0764 live dispatch end-to-end: runReview --model forwards typed model to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await runReview(["WK-0001", "--app", "claude", "--model", "claude-3-5-sonnet"], io, { backend: mockBackend });
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "claude-3-5-sonnet", "runReview --model must reach startLaunch end-to-end");
  assert.equal(calls[0].app, "claude");
  assert.equal(calls[0].role, "reviewer");
  assert.equal(calls[0].subject, "WK-0001");
});

test("WK-0764 live dispatch end-to-end: runReview without --model passes null to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await runReview(["WK-0001", "--app", "claude"], io, { backend: mockBackend });
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "runReview without --model must pass null to startLaunch");
});

test("WK-0764 live dispatch end-to-end: runRedteam --model forwards typed model to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await runRedteam(["WK-0001", "--app", "claude", "--model", "claude-3-opus"], io, { backend: mockBackend });
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.equal(calls[0].model, "claude-3-opus", "runRedteam --model must reach startLaunch end-to-end");
  assert.equal(calls[0].app, "claude");
  assert.equal(calls[0].role, "redteam");
  assert.equal(calls[0].subject, "WK-0001");
});

test("WK-0764 live dispatch end-to-end: runRedteam without --model passes null to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await runRedteam(["WK-0001", "--app", "claude"], io, { backend: mockBackend });
  } finally {
    process.exitCode = savedExitCode;
  }
  assert.equal(calls.length, 1, "startLaunch must be called once");
  assert.strictEqual(calls[0].model, null, "runRedteam without --model must pass null to startLaunch");
});

test("WK-0764 anti-regression: worker resolved.model is NOT forwarded as model hint to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchWorkerSharedPipeline(
      {
        resolved: { app: "codex", model: "codex-5.3-spark" },
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
    "resolved.model (profile default) must NOT be forwarded as model hint; only parsed.model is"
  );
});

test("WK-0764 anti-regression: review resolved.model is NOT forwarded as model hint to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchReviewSharedPipeline(
      {
        resolved: { app: "codex", model: "some-profile-default" },
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

test("WK-0764 anti-regression: redteam resolved.model is NOT forwarded as model hint to startLaunch", async () => {
  const calls = [];
  const mockBackend = makeModelCapturingBackend(calls);
  const io = makeSilentIo();
  const savedExitCode = process.exitCode;
  try {
    await dispatchRedteamSharedPipeline(
      {
        resolved: { app: "codex", model: "some-profile-default" },
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
