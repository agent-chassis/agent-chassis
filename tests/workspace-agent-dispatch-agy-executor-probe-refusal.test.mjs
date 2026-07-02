

import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_REFUSAL_CODES,
  BACKEND_SUPPORTED_APPS
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  AGY_APP_ID,
  AGY_EXECUTOR_REFUSAL_REASONS,
  AGY_FINAL_OUTPUT_FINDINGS_SCHEMA_VERSION,
  AGY_WORKSPACE_AGENT_LAUNCH_EXECUTOR_SCHEMA_VERSION,
  DEFAULT_AGY_BINARY_PATH,
  createAgyWorkspaceAgentLaunchExecutor,
  defaultProbeAgyRuntime
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-agy-executor.mjs";
import {
  SAMPLE_INPUT
} from "./workspace-agent-dispatch-agy-executor-shared.mjs";

const AGY_BACKEND_FAMILY_INACTIVE_SKIP_REASON =
  "Agy backend family is not in the current active BACKEND_SUPPORTED_APPS set; re-enable when an accepted IN-0017 support-change WK reactivates Agy.";

const agyBackendInactiveTest = (name, fn) => {
  test(name, { skip: AGY_BACKEND_FAMILY_INACTIVE_SKIP_REASON }, fn);
};

agyBackendInactiveTest("Agy app id matches the backend-supported-apps vocabulary", () => {
  assert.equal(AGY_APP_ID, "agy");
  assert.equal(BACKEND_SUPPORTED_APPS.includes(AGY_APP_ID), true);
});

agyBackendInactiveTest("schema versions are stable", () => {
  assert.equal(
    AGY_WORKSPACE_AGENT_LAUNCH_EXECUTOR_SCHEMA_VERSION,
    "agy-workspace-agent-launch-executor.v1"
  );
  assert.equal(AGY_FINAL_OUTPUT_FINDINGS_SCHEMA_VERSION, "agy-final-output.v1");
});

agyBackendInactiveTest("default Agy CLI binary path points at the canonical install location", () => {
  assert.equal(DEFAULT_AGY_BINARY_PATH, "/home/user/.local/bin/agy");
});

agyBackendInactiveTest("refusal-reason vocabulary names the missing CLI component and is distinct from the old scaffold blanket", () => {

  assert.equal(
    AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_PATH_NOT_SET,
    "agy_cli_binary_path_not_set"
  );
  assert.equal(
    AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_NOT_FOUND,
    "agy_cli_binary_not_found"
  );
  assert.equal(
    AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_NOT_EXECUTABLE,
    "agy_cli_binary_not_executable"
  );
  assert.equal(
    AGY_EXECUTOR_REFUSAL_REASONS.RUNTIME_NOT_CONFIGURED,
    "agy_runtime_not_configured"
  );
  assert.equal(
    AGY_EXECUTOR_REFUSAL_REASONS.PROBE_THREW,
    "agy_runtime_probe_threw"
  );
});

agyBackendInactiveTest("defaultProbeAgyRuntime refuses with cli_binary_path_not_set when no path is supplied", async () => {
  const probe = await defaultProbeAgyRuntime({ agyBinaryPath: null });
  assert.equal(probe.available, false);
  assert.equal(
    probe.reason_detail,
    AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_PATH_NOT_SET
  );
});

agyBackendInactiveTest("defaultProbeAgyRuntime refuses with cli_binary_not_found when the binary is absent", async () => {
  const probe = await defaultProbeAgyRuntime({
    agyBinaryPath: "/tmp/does-not-exist/agy-fake-binary",
    accessFn: async () => {
      const err = new Error("ENOENT: no such file or directory");
      err.code = "ENOENT";
      throw err;
    }
  });
  assert.equal(probe.available, false);
  assert.equal(
    probe.reason_detail,
    AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_NOT_FOUND
  );
  assert.equal(
    probe.detail.agy_cli_binary_path,
    "/tmp/does-not-exist/agy-fake-binary"
  );
});

agyBackendInactiveTest("defaultProbeAgyRuntime refuses with cli_binary_not_executable on EACCES", async () => {
  const probe = await defaultProbeAgyRuntime({
    agyBinaryPath: "/tmp/non-exec/agy",
    accessFn: async () => {
      const err = new Error("EACCES: permission denied");
      err.code = "EACCES";
      throw err;
    }
  });
  assert.equal(probe.available, false);
  assert.equal(
    probe.reason_detail,
    AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_NOT_EXECUTABLE
  );
});

agyBackendInactiveTest("defaultProbeAgyRuntime resolves to available with the configured binary path", async () => {
  const probe = await defaultProbeAgyRuntime({
    agyBinaryPath: "/tmp/installed/agy",
    accessFn: async () => undefined
  });
  assert.equal(probe.available, true);
  assert.equal(probe.agyBinary, "/tmp/installed/agy");
});

agyBackendInactiveTest("executor refuses with cli_binary_path_not_set when no path is configured", async () => {
  const executor = createAgyWorkspaceAgentLaunchExecutor({
    agyBinaryPath: null
  });
  const result = await executor(SAMPLE_INPUT);
  assert.equal(result.accepted, false);
  assert.equal(result.refusal.code, BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE);
  assert.equal(result.refusal.reason, BACKEND_FAMILY_UNAVAILABLE_REASONS[AGY_APP_ID]);
  assert.equal(
    result.refusal.detail.reason_detail,
    AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_PATH_NOT_SET
  );
  assert.equal(result.refusal.detail.app, "agy");
  assert.equal(
    result.refusal.detail.missing_backend,
    "workspace_agent_dispatch_backend.launch_executors.agy"
  );

  assert.notEqual(
    result.refusal.detail.reason_detail,
    AGY_EXECUTOR_REFUSAL_REASONS.RUNTIME_NOT_CONFIGURED
  );
});

agyBackendInactiveTest("executor refuses with cli_binary_not_found when the configured CLI is missing", async () => {
  const executor = createAgyWorkspaceAgentLaunchExecutor({
    agyBinaryPath: "/tmp/not-installed/agy"
  });

  const result = await executor({
    ...SAMPLE_INPUT
  });
  assert.equal(result.accepted, false);
  assert.equal(result.refusal.code, BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE);

  assert.equal(
    result.refusal.detail.reason_detail,
    AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_NOT_FOUND
  );
  assert.equal(
    result.refusal.detail.probe_detail.agy_cli_binary_path,
    "/tmp/not-installed/agy"
  );
});

agyBackendInactiveTest("custom probe reporting unavailable with a known reason_detail flows through unchanged", async () => {
  const executor = createAgyWorkspaceAgentLaunchExecutor({
    probeAgyRuntime: () => ({
      available: false,
      reason_detail: AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_NOT_EXECUTABLE,
      detail: { agy_cli_binary_path: "/opt/agy/bin/agy", code: "EACCES" }
    })
  });
  const result = await executor(SAMPLE_INPUT);
  assert.equal(result.accepted, false);
  assert.equal(
    result.refusal.detail.reason_detail,
    AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_NOT_EXECUTABLE
  );
  assert.deepEqual(result.refusal.detail.probe_detail, {
    agy_cli_binary_path: "/opt/agy/bin/agy",
    code: "EACCES"
  });
});

agyBackendInactiveTest("custom probe with an unknown reason_detail degrades to runtime_not_configured", async () => {
  const executor = createAgyWorkspaceAgentLaunchExecutor({
    probeAgyRuntime: () => ({
      available: false,
      reason_detail: "totally_made_up_reason",
      detail: { note: "should be ignored" }
    })
  });
  const result = await executor(SAMPLE_INPUT);
  assert.equal(
    result.refusal.detail.reason_detail,
    AGY_EXECUTOR_REFUSAL_REASONS.RUNTIME_NOT_CONFIGURED
  );
});

agyBackendInactiveTest("probe throw is contained as agy_runtime_probe_threw and never escapes the executor", async () => {
  const executor = createAgyWorkspaceAgentLaunchExecutor({
    probeAgyRuntime: () => {
      throw new Error("disk full");
    }
  });
  const result = await executor(SAMPLE_INPUT);
  assert.equal(result.accepted, false);
  assert.equal(
    result.refusal.detail.reason_detail,
    AGY_EXECUTOR_REFUSAL_REASONS.PROBE_THREW
  );
  assert.equal(result.refusal.detail.probe_detail.message, "disk full");
});

agyBackendInactiveTest("probe receives the structured dispatch context and the agy app marker", async () => {
  let observed = null;
  const executor = createAgyWorkspaceAgentLaunchExecutor({
    probeAgyRuntime: (ctx) => {
      observed = ctx;
      return { available: false };
    },
    agyBinaryPath: "/configured/agy"
  });
  await executor(SAMPLE_INPUT);
  assert.deepEqual(observed, {
    role: "worker",
    subject: "WK-0556#agy-production-executor-core",
    workspace_alias: "default",
    workspace_dir: "/tmp/fake-repo",
    app: "agy",
    agyBinaryPath: "/configured/agy"
  });
});

agyBackendInactiveTest("non-object/null probe results degrade to runtime_not_configured", async () => {
  for (const value of [null, undefined, "available", 42]) {
    const executor = createAgyWorkspaceAgentLaunchExecutor({
      probeAgyRuntime: () => value
    });
    const result = await executor(SAMPLE_INPUT);
    assert.equal(result.accepted, false);
    assert.equal(
      result.refusal.detail.reason_detail,
      AGY_EXECUTOR_REFUSAL_REASONS.RUNTIME_NOT_CONFIGURED
    );
  }
});
