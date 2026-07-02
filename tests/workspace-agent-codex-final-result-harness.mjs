

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { createWorkspaceAgentDispatchBackend } from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import { createCodexWorkspaceAgentLaunchExecutor } from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-codex-executor.mjs";
import {
  buildCodexChildRuntimeForLauncherOwnedSourceToolSurface,
  buildScopedChildToolSurfaceDescriptorFromAgentBackendRequest
} from "../packages/agent-launch-cli/src/lib/agent-child-tool-surface.mjs";

export class FakeChild extends EventEmitter {
  constructor({ pid = 12345 } = {}) {
    super();
    this.pid = pid;
  }
}

export function fakeBwrapPlan() {
  return Object.freeze({
    schemaVersion: "bubblewrap-launch-plan.v1",
    bwrapPath: "/usr/bin/bwrap",
    bwrapArgs: ["--unshare-user", "--die-with-parent"]
  });
}

export function fakePlanForRole(role) {
  return {
    mode: role === "worker" ? "headless" : "headless",
    role,
    subject: "WK-0553#codex-executor-core",
    repo: "/tmp/fake-repo",
    command: "codex",
    args: ["--disable", "shell_snapshot"],
    env: { AGENT_ROLE: role === "worker" ? "worker" : (role === "review" ? "reviewer" : "redteam") },
    isolation: { schema_version: "codex-role-isolation.v1" }
  };
}

export const FAKE_ACCEPTANCE_CRITERIA = Object.freeze(["fake acceptance criterion"]);
export const FAKE_ACCEPTANCE_VALIDATION = Object.freeze(["fake validation command"]);

export async function fakeLoadWorkRecord({ id }) {
  return {
    valid: true,
    record: {
      id,
      title: `${id} test record`,
      acceptance: {
        criteria: [...FAKE_ACCEPTANCE_CRITERIA],
        validation: [...FAKE_ACCEPTANCE_VALIDATION]
      },
      slices: [
        {
          id: "codex-executor-core",
          title: "Codex executor core",
          acceptance: {
            criteria: [...FAKE_ACCEPTANCE_CRITERIA],
            validation: [...FAKE_ACCEPTANCE_VALIDATION]
          }
        },
        {
          id: "x",
          title: "Generic test slice",
          acceptance: {
            criteria: [...FAKE_ACCEPTANCE_CRITERIA],
            validation: [...FAKE_ACCEPTANCE_VALIDATION]
          }
        }
      ]
    }
  };
}

export function buildHarness({
  planResult,
  planThrow,
  bwrapPlan = fakeBwrapPlan(),
  spawnImpl,
  assertBwrapImpl,
  ensureRootsImpl,
  captureFinalResult,
  prepareSourceToolSurface,
  loadWorkRecord = fakeLoadWorkRecord
} = {}) {
  const calls = {
    buildPlan: [],
    buildBwrapPlan: [],
    ensureWriteRoots: [],
    assertBwrap: [],
    spawn: [],
    captureFinalResult: []
  };
  const executorOptions = {
    buildPlan: async (args) => {
      calls.buildPlan.push(args);
      if (planThrow) throw planThrow;
      return planResult;
    },
    buildBwrapPlan: (plan) => {
      calls.buildBwrapPlan.push(plan);
      return bwrapPlan;
    },
    ensureWriteRoots: async (repo, roots, role) => {
      calls.ensureWriteRoots.push({ repo, roots, role });
      if (ensureRootsImpl) return ensureRootsImpl({ repo, roots, role });
      return undefined;
    },
    assertBwrap: (opts) => {
      calls.assertBwrap.push(opts);
      if (assertBwrapImpl) return assertBwrapImpl(opts);
      return { bwrapPath: "/usr/bin/bwrap" };
    },
    spawn: (plan, options) => {
      calls.spawn.push({ plan, options });
      if (spawnImpl) return spawnImpl(plan, options);
      return new FakeChild();
    },
    env: { PATH: "/usr/bin" },
    cwd: "/tmp/fake-repo",
    loadWorkRecord,

    resolvedProfile: { model: "harness-default-model" }
  };
  if (captureFinalResult) {
    executorOptions.captureFinalResult = (input) => {
      calls.captureFinalResult.push(input);
      return captureFinalResult(input);
    };
  }

  if (prepareSourceToolSurface) {
    calls.prepareSourceToolSurface = [];
    executorOptions.prepareSourceToolSurface = async (input) => {
      calls.prepareSourceToolSurface.push(input);
      return prepareSourceToolSurface(input);
    };
  }
  const executor = createCodexWorkspaceAgentLaunchExecutor(executorOptions);
  return { executor, calls };
}

export function createCodexTestBackend(options = {}) {
  return createWorkspaceAgentDispatchBackend({
    ...options,
    prepareSourceToolSurface: async () => fakeSourceToolSurface()
  });
}

export function fakeSourceToolSurface(overrides = {}) {
  const request = {
    schema_version: "agent-backend-request.v1",
    backend_kind: "filesystem_mcp",
    subject: {
      kind: "work_unit",
      repo: "agent-chassis",
      unit: {
        record_id: "WK-0860",
        slice_id: "codex-single-launcher-worker-source-rework",
        address: "WK-0860#codex-single-launcher-worker-source-rework"
      }
    },
    agent: { family: "codex", role: "worker", profile: "filesystem-mcp-default", model: null },
    scope: {
      read_scope: [
        "AGENTS.md",
        "packages/agent-launch-core/src/lib/work-record-launch-prompt.mjs"
      ],
      write_scope: [
        "packages/agent-launch-core/src/lib/work-record-launch-prompt.mjs"
      ]
    },
    validation: {
      commands: [{ form: "argv", argv: ["node", "--test", "tests/work-record-wrapper-gates.test.mjs"] }]
    },
    environment_policy: { mode: "closed", allowed_keys: [] },
    provenance_destination: {
      kind: "launcher_owned",
      run_id: "wkdb_tool_surface"
    },
    tools: {
      raw_exec_enabled: false,
      filesystem_mcp: { read: true, write: true, structured_validation: true, final_report: true }
    },
    evidence: {}
  };
  const descriptor = buildScopedChildToolSurfaceDescriptorFromAgentBackendRequest(request);
  assert.equal(descriptor.accepted, true);
  const handshakeDigest = overrides.handshake_digest ?? "sha256:test-source-handshake";
  const backendProof = {
    schema_version: "agent-backend-handshake-result.v1",
    backend_kind: "filesystem_mcp",
    backend_id: "portfolio-filesystem-mcp",
    backend_version: "0.1.0",
    challenge_nonce: "test-source-challenge",
    status: "available",
    mode: "enforced",
    raw_exec_enabled: false,
    tool_surface: { read: true, write: true, structured_validation: true, final_report: true },
    scope_binding: true,
    scope_digest: descriptor.descriptor_digest,
    validation_transport: "argv",
    provenance_sink: "launcher_owned",
    handshake_digest: null,
    expires_at: null
  };
  const { codexRuntime = true, childMount: childMountOverride, ...surfaceOverrides } = overrides;
  const childMount = "childMount" in overrides
    ? childMountOverride
    : {
        transport: "stdio",
        command: "node",
        args: ["/launcher/owned/filesystem-mcp-server.mjs", "--enforced"],
        env: { FILESYSTEM_MCP_BACKEND_PROFILE: "filesystem-mcp-default" }
      };
  const surface = {
    schema_version: "workspace-agent-dispatch-source-tool-surface.v1",
    backend_kind: "filesystem_mcp",
    accepted: true,
    descriptor,
    backend_proof: backendProof,
    request,
    decision: {
      schema_version: "agent-backend-decision.v1",
      backend_kind: "filesystem_mcp",
      allowed: true,
      decision_code: "agent_backend.filesystem_mcp.allowed.v1",
      accepted_handshake_digest: handshakeDigest
    },
    handshake: {
      schema_version: "agent-backend-handshake-result.v1",
      accepted: true,
      backend_kind: "filesystem_mcp",
      backend_id: "portfolio-filesystem-mcp",
      backend_version: "0.1.0",
      challenge_nonce: backendProof.challenge_nonce,
      status: "available",
      mode: "enforced",
      raw_exec_enabled: false,
      tool_surface: { read: true, write: true, structured_validation: true, final_report: true },
      scope_binding: true,
      scope_digest: descriptor.descriptor_digest,
      handshake_digest: handshakeDigest
    },
    ...surfaceOverrides
  };
  return codexRuntime
    ? buildCodexChildRuntimeForLauncherOwnedSourceToolSurface(surface, { childMount })
    : surface;
}

export const SAMPLE_INPUT = Object.freeze({
  caller_session_id: "session-X",
  role: "worker",
  subject: "WK-0553#codex-executor-core",
  workspace_alias: "default",
  workspace_dir: "/tmp/fake-repo",
  readiness: { dispatchable: true },
  run_id: "wkdb_test",
  monitor_handle: "wkmh_test",
  app: "codex",
  source_tool_surface: fakeSourceToolSurface()
});

export function planWithFinalPath(role, finalPath, logPath = "/tmp/fake-repo/run.log") {
  return {
    ...fakePlanForRole(role),
    finalPath,
    logPath,
    runDir: "/tmp/fake-repo/runDir"
  };
}

export function makeStreamingFakeChild({ pid = 5151 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.finish = ({ code = 0, signal = null, stdout = "", stderr = "" } = {}) => {
    if (stdout.length > 0) child.stdout.emit("data", stdout);
    if (stderr.length > 0) child.stderr.emit("data", stderr);
    child.emit("exit", code, signal);
    child.emit("close", code, signal);
  };
  return child;
}
