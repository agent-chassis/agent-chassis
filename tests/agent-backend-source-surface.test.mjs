
import test from "node:test";
import assert from "node:assert/strict";
import {
  createLauncherOwnedSourceToolSurfacePreparer
} from "../packages/agent-launch-cli/src/lib/agent-backend.mjs";
import {
  assertCodexCallableSourceToolSurface,
  isScopedChildToolSurfaceRefusal
} from "../packages/agent-launch-cli/src/lib/agent-child-tool-surface.mjs";
import {
  loadVerifierFixture,
  baseRegistry,
  REGISTRY_BACKEND_KEY,
  REGISTRY_PROFILE_NAME
} from "./agent-backend-test-helpers.mjs";

test("WK-0862 source surface preparer bounds slice authority to the selected slice scope only", async () => {
  const fixture = await loadVerifierFixture();
  const captured = {};
  try {
    const preparer = createLauncherOwnedSourceToolSurfacePreparer({
      registry: baseRegistry(),
      backendProfile: REGISTRY_PROFILE_NAME,
      verifierCapability: fixture.capability,
      verifierNonceStore: fixture.resultNonceStore,
      loadWorkRecord: async () => ({
        valid: true,
        diagnostics: [],
        record: {
          schema_version: "work-record.v1",
          id: "WK-9999",
          repo: "agent-chassis/agent-chassis",
          title: "Tracker with parent and slice scope",
          record_kind: "work_item",
          work_kind: "tracker",
          status: "todo",
          priority: "high",
          owner: "codex",
          read_scope: ["docs/parent.md"],
          repo_paths: ["packages/parent-read.mjs"],
          write_scope: ["packages/parent-write.mjs"],
          acceptance: { validation: ["node --test tests/parent.test.mjs"] },
          slices: [
            {
              id: "slice-a",
              title: "Slice A",
              work_kind: "implementation",
              status: "todo",
              read_scope: ["docs/slice-a.md"],
              repo_paths: ["packages/slice-a-read.mjs"],
              write_scope: ["packages/slice-a-write.mjs"],
              acceptance: { validation: ["node --test tests/slice-a.test.mjs"] }
            }
          ]
        }
      }),
      validateDispatch: async () => ({ dispatchable: true }),
      proveSourceToolSurfaceWithBackend: async ({ authority, descriptor, challenge, request }) => {
        captured.request = request;
        captured.descriptor = descriptor;
        return {
          schema_version: "agent-backend-handshake-result.v1",
          backend_kind: "filesystem_mcp",
          backend_id: authority.backend_id,
          backend_version: authority.backend_version,
          challenge_nonce: challenge.challenge_nonce,
          status: "available",
          mode: "enforced",
          raw_exec_enabled: false,
          tool_surface: descriptor.tool_surface,
          scope_binding: true,
          scope_digest: descriptor.descriptor_digest,
          validation_transport: challenge.validation_transport,
          provenance_sink: challenge.provenance_sink,
          handshake_digest: null,
          expires_at: null
        };
      }
    });

    const surface = await preparer({
      subject: "WK-9999#slice-a",
      workspace_dir: "/tmp/fake-repo",
      workspace_alias: "agent-chassis",
      run_id: "wkdb_WK9999"
    });

    assert.equal(surface.accepted, true);
    assert.deepEqual(captured.request.scope.write_scope, ["packages/slice-a-write.mjs"]);
    assert.deepEqual(captured.request.scope.read_scope, [
      "docs/slice-a.md",
      "packages/slice-a-read.mjs",
      "packages/slice-a-write.mjs"
    ]);
    assert.equal(captured.request.scope.write_scope.includes("packages/parent-write.mjs"), false);
    assert.equal(captured.request.scope.read_scope.includes("docs/parent.md"), false);
    assert.equal(captured.request.scope.read_scope.includes("packages/parent-read.mjs"), false);
    assert.deepEqual(surface.backend_proof.tool_surface, captured.descriptor.tool_surface);
    assert.equal(surface.backend_proof.scope_digest, captured.descriptor.descriptor_digest);
    assert.equal(surface.codex_child_runtime.schema_version, "codex-child-source-tool-runtime.v1");
    assert.equal(surface.codex_child_runtime.transport, "mcp");
    assert.equal(surface.codex_child_runtime.backend_kind, "filesystem_mcp");
    assert.equal(surface.codex_child_runtime.mcp_server_name, "filesystem_mcp");
    assert.equal(surface.codex_child_runtime.tool_namespace, "filesystem_mcp");
    assert.equal(surface.codex_child_runtime.descriptor_digest, captured.descriptor.descriptor_digest);
    assert.equal(surface.codex_child_runtime.handshake_digest, surface.decision.accepted_handshake_digest);
    assert.equal(surface.codex_child_runtime.raw_exec_enabled, false);
    assert.equal(surface.codex_child_runtime.scope_binding, true);
    assert.ok(surface.codex_child_runtime.callable_tools.includes("filesystem_mcp.read"));
    assert.ok(surface.codex_child_runtime.callable_tools.includes("filesystem_mcp.write"));

    const mount = surface.codex_child_runtime.child_mount;
    assert.equal(mount.transport, "stdio");
    assert.equal(mount.mcp_server_name, "filesystem_mcp");
    assert.equal(mount.command, "node");
    assert.deepEqual(mount.args, ["/launcher/owned/filesystem-mcp-server.mjs", "--enforced"]);
    assert.equal(
      mount.env.AGENT_LAUNCH_SOURCE_TOOL_SURFACE_DIGEST,
      captured.descriptor.descriptor_digest
    );
    assert.equal(
      mount.env.AGENT_LAUNCH_SOURCE_TOOL_SURFACE_HANDSHAKE_DIGEST,
      surface.decision.accepted_handshake_digest
    );
    assert.equal(mount.env.AGENT_LAUNCH_SOURCE_TOOL_SURFACE_RAW_EXEC, "false");
    assert.equal(mount.env.FILESYSTEM_MCP_BACKEND_PROFILE, REGISTRY_PROFILE_NAME);

    const callable = assertCodexCallableSourceToolSurface(surface);
    assert.equal(callable.accepted, true);
  } finally {
    await fixture.cleanup();
  }
});

test("WK-0862 source surface preparer fails closed when the backend authority has no child mount", async () => {
  const fixture = await loadVerifierFixture();
  try {
    const preparer = createLauncherOwnedSourceToolSurfacePreparer({
      registry: baseRegistry({
        mutateData: (data) => {
          delete data.filesystem_mcp_backends[REGISTRY_BACKEND_KEY].child_mount;
        }
      }),
      backendProfile: REGISTRY_PROFILE_NAME,
      verifierCapability: fixture.capability,
      verifierNonceStore: fixture.resultNonceStore,
      loadWorkRecord: async () => ({
        valid: true,
        diagnostics: [],
        record: {
          schema_version: "work-record.v1",
          id: "WK-9999",
          repo: "agent-chassis/agent-chassis",
          title: "Record scope",
          record_kind: "work_item",
          work_kind: "implementation",
          status: "todo",
          priority: "high",
          owner: "codex",
          read_scope: ["docs/read.md"],
          repo_paths: ["packages/read.mjs"],
          write_scope: ["packages/write.mjs"],
          acceptance: { validation: ["node --test tests/unit.test.mjs"] }
        }
      }),
      validateDispatch: async () => ({ dispatchable: true }),
      proveSourceToolSurfaceWithBackend: async ({ authority, descriptor, challenge }) => ({
        schema_version: "agent-backend-handshake-result.v1",
        backend_kind: "filesystem_mcp",
        backend_id: authority.backend_id,
        backend_version: authority.backend_version,
        challenge_nonce: challenge.challenge_nonce,
        status: "available",
        mode: "enforced",
        raw_exec_enabled: false,
        tool_surface: descriptor.tool_surface,
        scope_binding: true,
        scope_digest: descriptor.descriptor_digest,
        validation_transport: challenge.validation_transport,
        provenance_sink: challenge.provenance_sink,
        handshake_digest: null,
        expires_at: null
      })
    });

    const surface = await preparer({
      subject: "WK-9999",
      workspace_dir: "/tmp/fake-repo",
      workspace_alias: "agent-chassis",
      run_id: "wkdb_WK9999"
    });

    assert.equal(surface.accepted, true);
    assert.equal(surface.codex_child_runtime.child_mount, undefined);
    const callable = assertCodexCallableSourceToolSurface(surface);
    assert.ok(isScopedChildToolSurfaceRefusal(callable));
    assert.equal(callable.detail.required, "codex_child_runtime.child_mount");
  } finally {
    await fixture.cleanup();
  }
});

test("WK-0862 source surface preparer refuses before signing when backend surface cannot prove scoped tools", async () => {
  const fixture = await loadVerifierFixture();
  try {
    const preparer = createLauncherOwnedSourceToolSurfacePreparer({
      registry: baseRegistry(),
      backendProfile: REGISTRY_PROFILE_NAME,
      verifierCapability: fixture.capability,
      verifierNonceStore: fixture.resultNonceStore,
      loadWorkRecord: async () => ({
        valid: true,
        diagnostics: [],
        record: {
          schema_version: "work-record.v1",
          id: "WK-9999",
          repo: "agent-chassis/agent-chassis",
          title: "Record scope",
          record_kind: "work_item",
          work_kind: "implementation",
          status: "todo",
          priority: "high",
          owner: "codex",
          read_scope: ["docs/read.md"],
          repo_paths: ["packages/read.mjs"],
          write_scope: ["packages/write.mjs"],
          acceptance: { validation: ["node --test tests/unit.test.mjs"] }
        }
      }),
      validateDispatch: async () => ({ dispatchable: true }),
      proveSourceToolSurfaceWithBackend: async ({ authority, challenge }) => ({
        schema_version: "agent-backend-handshake-result.v1",
        backend_kind: "filesystem_mcp",
        backend_id: authority.backend_id,
        backend_version: authority.backend_version,
        challenge_nonce: challenge.challenge_nonce,
        status: "unavailable",
        mode: "enforced",
        raw_exec_enabled: false,
        tool_surface: null,
        scope_binding: false,
        scope_digest: null,
        validation_transport: "unsupported",
        provenance_sink: null,
        handshake_digest: null,
        expires_at: null
      })
    });

    const surface = await preparer({
      subject: "WK-9999",
      workspace_dir: "/tmp/fake-repo",
      workspace_alias: "agent-chassis",
      run_id: "wkdb_WK9999"
    });

    assert.equal(surface.accepted, false);
    assert.equal(surface.refusal_code, "agent_child_tool_surface.source_surface_not_proven.v1");
    assert.match(surface.refusal_message, /did not prove an available enforced scoped surface/);
  } finally {
    await fixture.cleanup();
  }
});
