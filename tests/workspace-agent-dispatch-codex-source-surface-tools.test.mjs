

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createWorkspaceAgentDispatchBackend
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  createLauncherOwnedSourceToolSurfacePreparer
} from "../packages/agent-launch-cli/src/lib/agent-backend.mjs";

import {
  buildFamilyExecutorRegistryEntry,
  LAUNCHER_SOURCE_READ_MODE_LAUNCHER_TOOL_SURFACE
} from "../packages/agent-launch-cli/src/lib/workspace-agent-launch-adapter-contract.mjs";
import {
  loadLauncherVerifierCapability
} from "../packages/agent-launch-cli/src/lib/agent-backend-verifier.mjs";
import {
  LAUNCHER_OWNED_SOURCE_TOOL_SURFACE_SCHEMA_VERSION,
  CODEX_SOURCE_TOOL_SURFACE_MCP_SERVER_NAME,
  CODEX_SOURCE_TOOL_SURFACE_CHILD_MOUNT_TRANSPORT,
  CODEX_SOURCE_TOOL_SURFACE_DESCRIPTOR_DIGEST_ENV,
  CODEX_SOURCE_TOOL_SURFACE_HANDSHAKE_DIGEST_ENV,
  CODEX_SOURCE_TOOL_SURFACE_RAW_EXEC_ENV
} from "../packages/agent-launch-cli/src/lib/agent-child-tool-surface.mjs";

const TARGET_SOURCE_PATH = "packages/wiki-core/src/lib/work-record-admission.mjs";

const REPO_PATH_ONLY = "packages/wiki-core/src/lib/work-record-admission-policy.mjs";

const READ_ONLY_REFS = ["AGENTS.md", "docs/mcp-integration.md"];

const FIXTURE_READ_SCOPE = [...READ_ONLY_REFS];
const FIXTURE_REPO_PATHS = [REPO_PATH_ONLY, TARGET_SOURCE_PATH];
const FIXTURE_WRITE_SCOPE = [TARGET_SOURCE_PATH];

const BACKEND_PROFILE = "filesystem-mcp-worker";

const SUBJECT = "WK-1163#slice-008";
const FIXTURE_SLICE_ID = "slice-008";

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

const EXPECTED_READ_AUTHORITY = uniqueSorted([
  ...FIXTURE_READ_SCOPE,
  ...FIXTURE_REPO_PATHS,
  ...FIXTURE_WRITE_SCOPE
]);
const EXPECTED_WRITE_AUTHORITY = uniqueSorted(FIXTURE_WRITE_SCOPE);

function enforcedFilesystemMcpRegistry() {
  return {
    path: "/tmp/wk1176-slice017-launchers.v1.json",
    hash: "sha256:wk1176-slice017-fake",
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
            transport: CODEX_SOURCE_TOOL_SURFACE_CHILD_MOUNT_TRANSPORT,
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

function buildCanonicalWk1163WorkRecord(id) {

  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/agent-chassis",
    title: "WK-1163 worker-admission source target fixture",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "high",
    owner: "unassigned",
    read_scope: ["docs/agent-launch-quickstart.md"],
    slices: [
      {
        id: FIXTURE_SLICE_ID,
        title: "Worker-admission source target",
        read_scope: [...FIXTURE_READ_SCOPE],
        repo_paths: [...FIXTURE_REPO_PATHS],
        write_scope: [...FIXTURE_WRITE_SCOPE],
        acceptance: {
          validation: ["node --test tests/wiki-mcp-structured-validation-tools.test.mjs"]
        }
      }
    ]
  };
}

async function createCanonicalSourceSurfacePreparer({ runtimeStateDir, capturedRequest }) {
  const verifierNonceStore = { checkAndMark: async () => true };
  const verifierCapability = await loadLauncherVerifierCapability({
    secret: "wk1176-slice017-test-secret",
    nonceStore: verifierNonceStore
  });

  return createLauncherOwnedSourceToolSurfacePreparer({
    registry: enforcedFilesystemMcpRegistry(),
    backendProfile: BACKEND_PROFILE,
    env: { AGENT_LAUNCH_RUNTIME_STATE_DIR: runtimeStateDir },
    verifierCapability,
    verifierNonceStore,
    loadWorkRecord: async ({ id }) => ({
      valid: true,
      diagnostics: [],
      record: buildCanonicalWk1163WorkRecord(id)
    }),
    proveSourceToolSurfaceWithBackend: async ({ authority, request, descriptor, challenge }) => {
      capturedRequest.value = request;
      return buildAcceptedBackendProof({ authority, descriptor, challenge });
    }
  });
}

async function dispatchCodexWorker({ extraStartLaunchInput = {} } = {}) {
  const runtimeStateDir = mkdtempSync(join(tmpdir(), "wk1176-slice017-rt-"));
  const capturedRequest = { value: null };
  const executorInputs = [];

  const backend = createWorkspaceAgentDispatchBackend({
    launchExecutors: {
      codex: buildFamilyExecutorRegistryEntry({
        executor: async (input) => {
          executorInputs.push(input);
          return { accepted: true, status: "launching", probe: async () => ({ status: "running" }) };
        },
        sourceReadMode: LAUNCHER_SOURCE_READ_MODE_LAUNCHER_TOOL_SURFACE
      })
    },
    prepareSourceToolSurface: await createCanonicalSourceSurfacePreparer({
      runtimeStateDir,
      capturedRequest
    }),

    proveAssignedSourceReadable: async () => ({ ok: true })
  });

  const result = await backend.startLaunch({
    caller_session_id: "session-WK-1176-SLICE-017",
    role: "worker",
    app: "codex",
    subject: SUBJECT,
    workspace_alias: "agent-chassis",
    workspace_dir: runtimeStateDir,
    readiness: { dispatchable: true, decision_code: "dispatchable_ready" },
    ...extraStartLaunchInput
  });

  return { result, capturedRequest, executorInputs };
}

test("WK-1176 SLICE-017 codex worker: launcher-owned source surface exposes the WK-1163#SLICE-008 target and scope-binds the child runtime", async () => {
  assert.ok(
    EXPECTED_READ_AUTHORITY.includes(TARGET_SOURCE_PATH),
    "fixture must place packages/wiki-core/src/lib/work-record-admission.mjs in the computed source read scope"
  );

  const { result, capturedRequest, executorInputs } = await dispatchCodexWorker();

  assert.equal(result.accepted, true, "an admitted codex worker with a proven enforced surface must launch");
  assert.equal(executorInputs.length, 1, "the codex executor must be reached exactly once");

  assert.ok(capturedRequest.value, "the launcher must compute a scoped source-surface request");
  assert.deepEqual(
    uniqueSorted(capturedRequest.value.scope.read_scope),
    EXPECTED_READ_AUTHORITY,
    "read authority must equal read_scope ∪ repo_paths ∪ write_scope"
  );
  assert.deepEqual(
    uniqueSorted(capturedRequest.value.scope.write_scope),
    EXPECTED_WRITE_AUTHORITY,
    "write authority must equal write_scope exactly"
  );
  assert.ok(
    capturedRequest.value.scope.read_scope.includes(TARGET_SOURCE_PATH),
    "the assigned source target must be readable as source (WK-1163#SLICE-008 blocker)"
  );
  assert.ok(
    capturedRequest.value.scope.read_scope.includes(REPO_PATH_ONLY),
    "a repo_paths-only implementation target must be readable as source"
  );
  assert.equal(
    capturedRequest.value.scope.write_scope.includes(REPO_PATH_ONLY),
    false,
    "a repo_paths-only target must NOT become writable"
  );

  const surface = executorInputs[0].source_tool_surface;
  assert.ok(surface, "the codex executor must receive a launcher-owned source tool surface");
  assert.equal(
    surface.schema_version,
    LAUNCHER_OWNED_SOURCE_TOOL_SURFACE_SCHEMA_VERSION,
    "the forwarded surface must be the launcher-owned source tool surface"
  );
  assert.equal(surface.backend_kind, "filesystem_mcp");

  assert.deepEqual(
    uniqueSorted(surface.request.scope.read_scope),
    EXPECTED_READ_AUTHORITY,
    "the forwarded surface read authority must equal the launcher-computed union"
  );
  assert.deepEqual(
    uniqueSorted(surface.request.scope.write_scope),
    EXPECTED_WRITE_AUTHORITY,
    "the forwarded surface write authority must stay write_scope-only"
  );

  const runtime = surface.codex_child_runtime;
  assert.ok(runtime, "a callable codex child runtime must be mounted for a launcher-tool-surface worker");
  assert.equal(runtime.schema_version, "codex-child-source-tool-runtime.v1");
  assert.equal(runtime.raw_exec_enabled, false, "the child runtime must be raw-exec disabled");
  assert.equal(runtime.scope_binding, true, "the child runtime must report scope binding");

  assert.equal(typeof runtime.descriptor_digest, "string");
  assert.ok(runtime.descriptor_digest.length > 0, "descriptor digest must be present");
  assert.equal(
    runtime.descriptor_digest,
    surface.descriptor.descriptor_digest,
    "the child runtime descriptor digest must be bound to the launcher descriptor"
  );

  assert.equal(typeof runtime.handshake_digest, "string");
  assert.ok(runtime.handshake_digest.length > 0, "handshake digest must be present");
  assert.equal(
    runtime.handshake_digest,
    surface.decision.accepted_handshake_digest,
    "the child runtime handshake digest must be bound to the accepted decision"
  );

  const mount = runtime.child_mount;
  assert.ok(mount, "a launcher-derived child_mount must be present for the filesystem_mcp surface");
  assert.equal(mount.transport, CODEX_SOURCE_TOOL_SURFACE_CHILD_MOUNT_TRANSPORT);
  assert.equal(mount.mcp_server_name, CODEX_SOURCE_TOOL_SURFACE_MCP_SERVER_NAME);
  assert.equal(runtime.mcp_server_name, CODEX_SOURCE_TOOL_SURFACE_MCP_SERVER_NAME);
  assert.equal(mount.command, "node", "the launcher registry child_mount command must be used");
  assert.deepEqual(
    mount.args,
    ["/launcher/owned/filesystem-mcp-server.mjs", "--enforced"],
    "the launcher registry child_mount args must be used verbatim"
  );
  assert.equal(
    mount.env[CODEX_SOURCE_TOOL_SURFACE_DESCRIPTOR_DIGEST_ENV],
    surface.descriptor.descriptor_digest,
    "the child mount env must pin the descriptor digest"
  );
  assert.equal(
    mount.env[CODEX_SOURCE_TOOL_SURFACE_HANDSHAKE_DIGEST_ENV],
    surface.decision.accepted_handshake_digest,
    "the child mount env must pin the handshake digest"
  );
  assert.equal(
    mount.env[CODEX_SOURCE_TOOL_SURFACE_RAW_EXEC_ENV],
    "false",
    "the child mount env must pin raw exec to false"
  );
});

test("WK-1176 SLICE-017 codex worker: caller-supplied carriers cannot broaden source or write authority", async () => {
  const forgedBroadSurface = {
    schema_version: LAUNCHER_OWNED_SOURCE_TOOL_SURFACE_SCHEMA_VERSION,
    backend_kind: "filesystem_mcp",
    accepted: true,
    descriptor: { accepted: true, read_scope: ["/etc", "/"], write_scope: ["/"] }
  };

  const { result, capturedRequest, executorInputs } = await dispatchCodexWorker({
    extraStartLaunchInput: {

      read_scope: ["__caller_read_scope__"],
      repo_paths: ["__caller_repo_path__"],
      write_scope: ["__caller_write_scope__"],
      source_tool_surface: forgedBroadSurface,
      child_mount: "__caller_child_mount__",
      mcp_servers: { filesystem_mcp: "__caller_filesystem_mcp__" },
      env: { CALLER_ENV: "__caller_env__" },
      argv: ["__caller_argv__"],
      prompt: "__caller_prompt__"
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(executorInputs.length, 1);

  assert.deepEqual(
    uniqueSorted(capturedRequest.value.scope.read_scope),
    EXPECTED_READ_AUTHORITY,
    "read authority must come from the launcher-owned record, not caller carriers"
  );
  assert.deepEqual(
    uniqueSorted(capturedRequest.value.scope.write_scope),
    EXPECTED_WRITE_AUTHORITY,
    "write authority must come from the launcher-owned record, not caller carriers"
  );

  const surface = executorInputs[0].source_tool_surface;
  assert.equal(
    surface.schema_version,
    LAUNCHER_OWNED_SOURCE_TOOL_SURFACE_SCHEMA_VERSION,
    "the executor must receive the launcher-owned surface"
  );

  const serializedSurface = JSON.stringify(surface);
  assert.equal(
    serializedSurface.includes("/etc"),
    false,
    "the forged caller-supplied surface must not reach the family executor"
  );
  for (const sentinel of [
    "__caller_read_scope__",
    "__caller_repo_path__",
    "__caller_write_scope__",
    "__caller_child_mount__",
    "__caller_filesystem_mcp__",
    "__caller_env__",
    "__caller_argv__",
    "__caller_prompt__"
  ]) {
    assert.equal(
      serializedSurface.includes(sentinel),
      false,
      `caller-supplied carrier must not leak into the launcher-owned surface: ${sentinel}`
    );
  }

  const runtime = surface.codex_child_runtime;
  assert.ok(runtime, "the launcher-owned callable child runtime must still be mounted");
  assert.equal(runtime.raw_exec_enabled, false);
  assert.equal(runtime.child_mount.command, "node");
  assert.equal(runtime.child_mount.mcp_server_name, CODEX_SOURCE_TOOL_SURFACE_MCP_SERVER_NAME);
});
