import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BACKEND_REFUSAL_CODES,
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  createLauncherOwnedSourceToolSurfacePreparer
} from "../packages/agent-launch-cli/src/lib/agent-backend.mjs";
import {
  loadLauncherVerifierCapability
} from "../packages/agent-launch-cli/src/lib/agent-backend-verifier.mjs";
import {
  createTestDispatchBackend
} from "./workspace-agent-dispatch-backend-shared.mjs";

const CANONICAL_WRITE_SCOPE = [
  "tests/workspace-agent-dispatch-backend-write-scope-binding.test.mjs"
];
const CALLER_WRITE_SCOPE_MARKER = "caller-write-scope-carrier";
const CALLER_WRITE_BIND_MARKER = "caller-write-bind-carrier";
const BACKEND_PROFILE = "filesystem-mcp-worker";

function enforcedFilesystemMcpRegistry() {
  return {
    path: "/tmp/wk1176-launchers.v1.json",
    hash: "sha256:wk1176-fake",
    data: {
      schema_version: 1,
      filesystem_mcp_backend_default: "primary",
      filesystem_mcp_backends: {
        primary: {
          backend_id: "portfolio-filesystem-mcp",
          backend_version: "0.1.0",
          mode: "enforced",
          endpoint: { kind: "spawn", argv: ["agent-launch-filesystem-mcp-backend"] },
          supported_profiles: [
            {
              agent_family: "codex",
              profile: BACKEND_PROFILE,
              roles: ["worker", "code_review", "redteam"]
            }
          ],
          handshake_source: { kind: "spawn_stdout" },
          child_mount: {
            transport: "stdio",
            command: "node",
            args: ["/launcher/owned/filesystem-mcp-server.mjs", "--enforced"],
            env: { FILESYSTEM_MCP_BACKEND_PROFILE: BACKEND_PROFILE }
          }
        }
      }
    }
  };
}

function buildAcceptedBackendProof({ authority, descriptor, challenge }) {
  return {
    schema_version: "agent-backend-handshake-result.v1",
    backend_kind: "filesystem_mcp",
    backend_id: authority.backend_id,
    backend_version: authority.backend_version,
    challenge_nonce: challenge.challenge_nonce,
    status: "available",
    mode: "enforced",
    raw_exec_enabled: false,
    scope_binding: true,
    scope_digest: descriptor.descriptor_digest,
    tool_surface: descriptor.tool_surface
  };
}

function createCanonicalSourceSurfacePreparer({
  runtimeStateDir,
  capturedRequest,
  verifierCapability,
  verifierNonceStore
}) {
  return createLauncherOwnedSourceToolSurfacePreparer({
    registry: enforcedFilesystemMcpRegistry(),
    backendProfile: BACKEND_PROFILE,
    env: { AGENT_LAUNCH_RUNTIME_STATE_DIR: runtimeStateDir },
    verifierCapability,
    verifierNonceStore,
    loadWorkRecord: async ({ id }) => ({
      valid: true,
      diagnostics: [],
        record: {
          schema_version: "work-record.v1",
          id,
          repo: "agent-chassis/agent-chassis",
          title: "Fix structured worker write-scope EROFS in launcher child sessions",
        record_kind: "work_item",
        work_kind: "implementation",
        status: "todo",
        slices: [
          {
            id: "slice-007",
            title: "Remediate backend write-scope regression review blockers",
            write_scope: CANONICAL_WRITE_SCOPE,
            read_scope: [
              "AGENTS.md",
              "docs/agent-launch-quickstart.md",
              "docs/mcp-integration.md"
            ],
            repo_paths: [
              "tests/workspace-agent-dispatch-backend-write-scope-binding.test.mjs"
            ],
            acceptance: {
              validation: [
                "node --test tests/workspace-agent-dispatch-backend-write-scope-binding.test.mjs"
              ]
            }
          }
        ]
      }
    }),
    proveSourceToolSurfaceWithBackend: async ({ authority, request, descriptor, challenge }) => {
      capturedRequest.value = request;
      return buildAcceptedBackendProof({ authority, descriptor, challenge });
    }
  });
}

function createSupportedExecutorShapes(executor) {
  return [
    {
      label: "launchExecutor",
      config: { launchExecutor: executor }
    },
    {
      label: "launchExecutors.codex function",
      config: { launchExecutors: { codex: executor } }
    },
    {
      label: "launchExecutors.codex.executor",
      config: { launchExecutors: { codex: { executor } } }
    }
  ];
}

test("WK-1176 SLICE-007 codex worker: supported executor shapes keep the canonical write scope in the launcher-owned source request and return host_write_authority_substrate_unavailable", async () => {
  const executorCalls = [];
  const executor = async (input) => {
    executorCalls.push(input);
    assert.ok(input?.source_tool_surface, "executor must receive a launcher-owned source tool surface");
    assert.ok(
      input.source_tool_surface?.request,
      "executor must receive the launcher-owned source-surface request"
    );
    assert.deepEqual(
      input.source_tool_surface.request.scope.write_scope,
      CANONICAL_WRITE_SCOPE,
      "launcher-owned source scope must stay bound to the canonical WK slice write_scope"
    );
    assert.equal(
      input.source_tool_surface.request.scope.write_scope.includes(CALLER_WRITE_SCOPE_MARKER),
      false,
      "caller-supplied write_scope carrier must not leak into the launcher-owned request"
    );
    assert.equal(
      input.source_tool_surface.request.scope.write_scope.includes(CALLER_WRITE_BIND_MARKER),
      false,
      "caller-supplied write_bind carrier must not leak into the launcher-owned request"
    );

    return {
      accepted: false,
      refusal: {
        code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
        reason: HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON,
        detail: {
          substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
          diagnostic_code: "agent_launch.isolation.writable_file_namespace_read_only.v1"
        }
      }
    };
  };

  for (const { label, config } of createSupportedExecutorShapes(executor)) {
    executorCalls.length = 0;
    const runtimeStateDir = mkdtempSync(join(tmpdir(), `wk1176-slice007-${label.replaceAll(/[^a-z0-9]+/gi, "-")}-`));
    const capturedRequest = { value: null };
    const verifierNonceStore = {
      checkAndMark: async () => true
    };
    const verifierCapability = await loadLauncherVerifierCapability({
      secret: "wk1176-test-secret",
      nonceStore: verifierNonceStore
    });

    const backend = createTestDispatchBackend({
      ...config,
      prepareSourceToolSurface: createCanonicalSourceSurfacePreparer({
        runtimeStateDir,
        capturedRequest,
        verifierCapability,
        verifierNonceStore
      })
    });

    const result = await backend.startLaunch({
      caller_session_id: "session-WK-1176-SLICE-007",
      role: "worker",
      app: "codex",
      subject: "WK-1176#slice-007",
      workspace_alias: "agent-chassis",
      workspace_dir: runtimeStateDir,
      readiness: { dispatchable: true, decision_code: "dispatchable_ready" },
      write_scope: [CALLER_WRITE_SCOPE_MARKER],
      writeScope: [CALLER_WRITE_SCOPE_MARKER],
      write_bind: [CALLER_WRITE_BIND_MARKER],
      writeBind: [CALLER_WRITE_BIND_MARKER]
    });

    assert.equal(result.accepted, false, `${label} must fail closed on the host-write substrate path`);
    assert.equal(result.refusal.code, BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE);
    assert.equal(result.refusal.reason, HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON);
    assert.ok(result.refusal.detail, `${label} must carry refusal detail for the host-write substrate path`);
    assert.equal(
      result.refusal.detail.substrate_id,
      HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
      `${label} refusal must name the host-write authority substrate`
    );
    assert.equal(
      result.refusal.detail.diagnostic_code,
      "agent_launch.isolation.writable_file_namespace_read_only.v1",
      `${label} refusal must preserve the host-write / canonical-write-scope seam diagnostic`
    );

    assert.ok(capturedRequest.value, `${label} must capture the launcher-owned source-surface request`);
    assert.deepEqual(
      capturedRequest.value.scope.write_scope,
      CANONICAL_WRITE_SCOPE,
      `${label} must bind the canonical WK slice write_scope in the launcher-owned request`
    );
    assert.equal(
      capturedRequest.value.scope.write_scope.includes(CALLER_WRITE_SCOPE_MARKER),
      false,
      `${label} must ignore caller-supplied write_scope carriers`
    );
    assert.equal(
      capturedRequest.value.scope.write_scope.includes(CALLER_WRITE_BIND_MARKER),
      false,
      `${label} must ignore caller-supplied write_bind carriers`
    );
    assert.equal(executorCalls.length, 1);
  }
});

test("WK-1176 SLICE-007 codex worker: setup-invalid inputs refuse with launch_refused instead of backend_unavailable", async () => {
  let executorCalls = 0;
  const backend = createTestDispatchBackend({
    launchExecutors: {
      codex: async () => {
        executorCalls += 1;
        return { accepted: true, status: "launching" };
      }
    }
  });

  const cases = [
    {
      label: "missing caller_session_id",
      input: {
        role: "worker",
        app: "codex",
        subject: "WK-1176#SLICE-007",
        workspace_alias: "agent-chassis",
        workspace_dir: "/tmp/repo",
        readiness: { dispatchable: true, decision_code: "dispatchable_ready" }
      },
      reason: "caller_session_id_required"
    },
    {
      label: "missing app",
      input: {
        caller_session_id: "session-WK-1176-SLICE-007",
        role: "worker",
        subject: "WK-1176#SLICE-007",
        workspace_alias: "agent-chassis",
        workspace_dir: "/tmp/repo",
        readiness: { dispatchable: true, decision_code: "dispatchable_ready" }
      },
      reason: "worker_model_unset"
    },
    {
      label: "unsupported app",
      input: {
        caller_session_id: "session-WK-1176-SLICE-007",
        role: "worker",
        app: "not-a-supported-app",
        subject: "WK-1176#SLICE-007",
        workspace_alias: "agent-chassis",
        workspace_dir: "/tmp/repo",
        readiness: { dispatchable: true, decision_code: "dispatchable_ready" }
      },
      reason: "unsupported_app"
    }
  ];

  for (const { label, input, reason } of cases) {
    const result = await backend.startLaunch(input);

    assert.equal(result.accepted, false, `${label} must refuse before any executor runs`);
    assert.equal(result.refusal.code, BACKEND_REFUSAL_CODES.LAUNCH_REFUSED);
    assert.equal(result.refusal.reason, reason);
  }

  assert.equal(executorCalls, 0, "setup-invalid inputs must not reach the executor");
});
