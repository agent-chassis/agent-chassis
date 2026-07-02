

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { createMcpSession as createBoundedMcpSession } from "./fixtures/mcp-stdio-session.mjs";

import { bootstrapRepo } from "../packages/wiki-core/src/index.mjs";

const REPO_ROOT = process.cwd();
const INITIALIZE_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: {
    name: "agent-chassis-test",
    version: "1.0.0"
  }
};

async function withTempDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-chassis-interface-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function cleanupInterfaceSmokeArtifacts() {
  const testsDir = path.join(REPO_ROOT, "tests");
  const entries = await readdir(testsDir, { withFileTypes: true });
  const targets = entries
    .filter(
      (entry) =>
        entry.name === ".probe-interface-smoke.json" ||
        entry.name.startsWith("tmp-interface-smoke-")
    )
    .map((entry) => path.join(testsDir, entry.name));

  await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true })));
}

afterEach(cleanupInterfaceSmokeArtifacts);

function createMcpSession({ env = {}, prelude = "" } = {}) {
  return createBoundedMcpSession({ env, prelude, repoRoot: REPO_ROOT });
}

test("MCP workspace_agent_dispatch_identity_contract publishes the WK-0532 contract and refuses caller-supplied identity", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/identity-demo" });

    const session = createMcpSession({
      env: {
        WIKI_MCP_TOOL_PROFILE: "agent-safe",
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const reviewMissing = await session.request(2, "tools/call", {
        name: "workspace_agent_dispatch_identity_contract",

        arguments: { verbose: true }
      });
      const contract = reviewMissing.structuredContent;
      assert.equal(contract.schema_version, "agent-dispatch-identity.v1");
      assert.ok(contract.caller_role_kinds.includes("human_operator"));
      assert.ok(contract.caller_role_kinds.includes("worker"));
      assert.ok(contract.caller_role_kinds.includes("reviewer"));

      assert.equal(contract.mcp_dispatch_reviewer_available, true);

      assert.equal(contract.graph_impact_persistence_available, true);

      assert.equal(contract.bootstrap_review.state, "bootstrap_exception_consumed");
      assert.equal(contract.bootstrap_review.blocking, false);
      assert.equal(contract.refusal, null);

      const exceptionActive = await session.request(3, "tools/call", {
        name: "workspace_agent_dispatch_identity_contract",
        arguments: { review_evidence_recorded: true }
      });
      assert.equal(
        exceptionActive.structuredContent.bootstrap_review.state,
        "bootstrap_exception_consumed"
      );

      const graphRequiredExceptionActive = await session.request(4, "tools/call", {
        name: "workspace_agent_dispatch_identity_contract",
        arguments: { graph_impact_required: true, review_evidence_recorded: true }
      });
      assert.equal(
        graphRequiredExceptionActive.structuredContent.bootstrap_review.state,
        "bootstrap_exception_consumed"
      );
      assert.equal(
        graphRequiredExceptionActive.structuredContent.graph_impact_persistence_available,
        true
      );

      const refused = await session.request(5, "tools/call", {
        name: "workspace_agent_dispatch_identity_contract",
        arguments: { env: { AGENT_ROLE: "worker" } }
      });
      assert.equal(
        refused.structuredContent.refusal.refusal_code,
        "agent_dispatch_identity.caller_supplied_role.v1"
      );

      const refusedArgv = await session.request(6, "tools/call", {
        name: "workspace_agent_dispatch_identity_contract",
        arguments: { argv: { role: "worker" } }
      });
      assert.equal(
        refusedArgv.structuredContent.refusal.refusal_code,
        "agent_dispatch_identity.caller_supplied_role.v1"
      );
      assert.equal(
        refusedArgv.structuredContent.refusal.detail.carrier,
        "argv.role"
      );

      const refusedClaimed = await session.request(7, "tools/call", {
        name: "workspace_agent_dispatch_identity_contract",
        arguments: { claimed_identity: { role: "worker" } }
      });
      assert.equal(
        refusedClaimed.structuredContent.refusal.refusal_code,
        "agent_dispatch_identity.caller_supplied_role.v1"
      );
      assert.equal(
        refusedClaimed.structuredContent.refusal.detail.carrier,
        "claimed_identity.role"
      );
    } finally {
      await session.close();
    }
  });
});

test("MCP workspace_runtime_blocker_taxonomy publishes the WK-0529 taxonomy", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/runtime-blocker-demo" });

    const session = createMcpSession({
      env: {
        WIKI_MCP_TOOL_PROFILE: "agent-safe",
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const result = await session.request(2, "tools/call", {
        name: "workspace_runtime_blocker_taxonomy",

        arguments: { verbose: true }
      });
      const taxonomy = result.structuredContent;
      assert.equal(taxonomy.schema_version, "runtime-blocker-codes.v1");
      assert.equal(taxonomy.owner, "IN-0016");
      assert.equal(
        Object.prototype.hasOwnProperty.call(taxonomy, "generated_at"),
        false,
        "runtime blocker taxonomy should not expose generated_at"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(taxonomy, "targetDir"),
        false,
        "runtime blocker taxonomy should not expose targetDir"
      );
      const codeValues = taxonomy.codes.map((entry) => entry.code);
      for (const required of [
        "role_policy_violation",
        "caller_role_mismatch",
        "caller_supplied_identity",
        "work_record_readiness_failure",
        "missing_structured_transport",
        "backend_unavailable",
        "read_only_mount",
        "sandbox_write_denial",
        "validation_failure",
        "unsupported_route",
        "hidden_route_reached",
        "mandatory_review_transport_blocked",
        "bootstrap_exception_active",
        "bootstrap_review_missing",
        "bootstrap_exception_consumed",
        "graph_impact_unavailable",
        "graph_impact_rebuild_required",
        "graph_impact_degraded_overlay",
        "graph_impact_persistence_unavailable",
        "operator_recovery_needed"
      ]) {
        assert.ok(codeValues.includes(required), `taxonomy must publish ${required}`);
      }
      for (const bootstrapCode of taxonomy.wk_0532_bootstrap_subset) {
        assert.ok(codeValues.includes(bootstrapCode));
      }
      assert.ok(taxonomy.graph_impact_state_map);
      assert.ok(Array.isArray(taxonomy.graph_impact_state_map.rules));
    } finally {
      await session.close();
    }
  });
});

test("MCP workspace_coordination_preflight reports role boundary and refuses caller-supplied identity", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/preflight-demo" });

    const session = createMcpSession({
      env: {
        WIKI_MCP_TOOL_PROFILE: "agent-safe",
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const ok = await session.request(2, "tools/call", {
        name: "workspace_coordination_preflight",

        arguments: { role: "coordinator", subject: "WK-0529", verbose: true }
      });
      const envelope = ok.structuredContent;
      assert.equal(envelope.schema_version, "coordination-preflight.v1");
      assert.equal(envelope.role, "coordinator");
      assert.equal(envelope.subject, "WK-0529");
      assert.equal(envelope.implementation_test_edits_forbidden, true);
      assert.ok(Array.isArray(envelope.allowed_write_surfaces));
      assert.ok(envelope.allowed_write_surfaces.includes("docs/"));
      assert.ok(envelope.allowed_write_surfaces.includes("wiki/"));
      assert.ok(envelope.forbidden_write_surfaces.includes("packages/"));

      assert.equal(envelope.mcp_dispatch_reviewer_available, true);
      const codes = envelope.blockers.map((entry) => entry.code);
      assert.equal(
        codes.includes("missing_structured_transport"),
        false,
        "workspace_agent_dispatch registered means structured transport is live"
      );
      assert.equal(
        codes.includes("mandatory_review_transport_blocked"),
        false,
        "reviewer dispatch live means mandatory review transport is not blocked"
      );

      assert.equal(envelope.repo_mount_writable, true);
      assert.equal(envelope.docs_writable, true);
      assert.equal(envelope.wiki_writable, true);
      assert.equal(
        Object.prototype.hasOwnProperty.call(envelope, "targetDir"),
        false,
        "compact preflight output must not expose targetDir"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(envelope, "source_digest"),
        false,
        "compact preflight output must not expose source_digest"
      );
      assert.equal(
        codes.includes("read_only_mount"),
        false,
        "writable mount must not report a filesystem blocker"
      );

      const refused = await session.request(3, "tools/call", {
        name: "workspace_coordination_preflight",
        arguments: { env: { AGENT_ROLE: "coordinator" } }
      });
      assert.equal(refused.structuredContent.refused, true);
      assert.equal(
        refused.structuredContent.refusal.refusal_code,
        "agent_dispatch_identity.caller_supplied_role.v1"
      );

      const refusedClaimed = await session.request(4, "tools/call", {
        name: "workspace_coordination_preflight",
        arguments: { claimed_identity: { role: "coordinator" } }
      });
      assert.equal(refusedClaimed.structuredContent.refused, true);
      assert.equal(
        refusedClaimed.structuredContent.refusal.detail.carrier,
        "claimed_identity.role"
      );

      const degraded = await session.request(5, "tools/call", {
        name: "workspace_coordination_preflight",
        arguments: {
          role: "coordinator",
          graph_impact_state: { graph_state: "unavailable" }
        }
      });
      const degradedCodes = degraded.structuredContent.blockers.map((entry) => entry.code);
      assert.ok(degradedCodes.includes("graph_impact_unavailable"));
    } finally {
      await session.close();
    }
  });
});

test("WK-0641 workspace_coordination_preflight accepts coordinator worker-dispatch target role", async () => {

  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/coordinator-dispatch-preflight" });

    await chmod(tempDir, 0o555);
    const session = createMcpSession({
      env: {
        WIKI_MCP_TOOL_PROFILE: "agent-safe",
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const workerDispatch = await session.request(2, "tools/call", {
        name: "workspace_coordination_preflight",
        arguments: {
          role: "coordinator",
          target_dispatch_role: "worker",
          subject: "WK-0641",

          verbose: true
        }
      });
      const envelope = workerDispatch.structuredContent;
      assert.equal(envelope.schema_version, "coordination-preflight.v1");
      assert.equal(envelope.role, "coordinator");
      assert.equal(envelope.target_dispatch_role, "worker", "target_dispatch_role echoed in envelope");
      assert.equal(envelope.repo_mount_writable, false, "repo root is read-only in this session");
      assert.equal(envelope.docs_writable, true, "docs/ remains writable for coordinator conclusions");
      assert.equal(envelope.wiki_writable, true, "wiki/ remains writable for coordinator conclusions");
      assert.equal(envelope.blocking, false, "coordinator worker-dispatch must not block on read-only repo root");

      const codes = envelope.blockers.map((b) => b.code);
      assert.equal(
        codes.includes("read_only_mount"),
        false,
        "no read_only_mount blocker for coordinator worker-dispatch with writable docs/wiki"
      );
      assert.equal(
        codes.includes("caller_role_mismatch"),
        false,
        "no caller_role_mismatch: coordinator caller with coordinator role"
      );

      const dispatchEvidence = envelope.filesystem_diagnostics.find(
        (e) => e.kind === "read_only_mount_evidence" && e.classification === "coordinator_worker_dispatch"
      );
      assert.ok(dispatchEvidence, "coordinator_worker_dispatch evidence entry must be present");
      assert.equal(dispatchEvidence.carveout_applied, true);
      assert.equal(dispatchEvidence.coordinator_dispatching_worker, true);

      const directWrite = await session.request(3, "tools/call", {
        name: "workspace_coordination_preflight",
        arguments: { role: "coordinator", subject: "WK-0641" }
      });
      const directEnvelope = directWrite.structuredContent;
      assert.equal(directEnvelope.blocking, true, "coordinator direct write must block on read-only repo root");
      const directCodes = directEnvelope.blockers.map((b) => b.code);
      assert.ok(
        directCodes.includes("read_only_mount"),
        "omitting target_dispatch_role must produce read_only_mount blocker"
      );
    } finally {
      await session.close();

      await chmod(tempDir, 0o755);
    }
  });
});
