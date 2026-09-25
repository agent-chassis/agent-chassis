

import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import {
  projectSliceReviewReceiptContracts
} from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";

import {
  createDispatchToolRegistry,
  readStructuredResult
} from "../../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import { registerMcpContentReferenceTools } from
  "../../packages/wiki-mcp/src/lib/mcp-content-reference-tools.mjs";
import { errorContent, jsonContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

export const WK_ID = "WK-1537";
export const SLICE_ID = "SLICE-004";
export const SUBJECT = `${WK_ID}#${SLICE_ID}`;
export const BASE = "a".repeat(40);
export const TIP = "b".repeat(40);
export const CANDIDATE = "c".repeat(40);
export const REPOSITORY = "agent-chassis";

export const GENERATION_REPOSITORY_ROOT = "/srv/workspaces/agent-chassis";

function coordinationEntries() {
  return Array.from({ length: 24 }, (_, index) => ({
    id: index + 1,
    title: `coordination entry ${index + 1}`,
    text: `Recorded coordination evidence for entry ${index + 1}. `.repeat(28)
  }));
}

export function authoredRecord({ padding = "" } = {}) {
  const slice = (ordinal, extra) => ({
    id: `SLICE-00${ordinal}`,
    title: `slice ${ordinal}`,
    work_kind: "implementation",
    status: ordinal === 4 ? "review" : "done",
    write_scope: [`packages/example/src/slice-${ordinal}.mjs`],
    repo_paths: ["packages/example"],
    acceptance: {
      criteria: [`slice ${ordinal} criterion`],
      validation: [{
        operation: "node_test",
        target: `tests/unit/slice-${ordinal}.test.mjs`,
        verification_ids: []
      }]
    },
    ...(extra === "" ? {} : { notes: extra })
  });
  return {
    schema_version: "work-record.v1",
    id: WK_ID,
    repo: REPOSITORY,
    initiative: "IN-0021",
    title: "authored parent contract",
    record_kind: "work",
    work_kind: "implementation",
    status: "review",
    owner: "coordinator",
    read_scope: ["docs/mcp-dispatch-monitoring-and-ownership.md"],
    repo_paths: ["packages/example"],
    write_scope: ["packages/example/src"],
    acceptance: {
      criteria: Array.from({ length: 19 }, (_, index) => `parent criterion ${index + 1}`),
      validation: [{
        operation: "node_test",
        target: "tests/unit/parent.test.mjs",
        verification_ids: []
      }]
    },

    proof_posture: {
      classification: "controlled_acceptance_opt_out",
      classification_rationale:
        "Operator-authorized expedited exception. " .repeat(24)
    },
    sections: {
      summary: `parent summary${padding}`,
      scope: { in_scope: ["a"], out_of_scope: ["b"] },
      entries: coordinationEntries()
    },
    slices: [slice(1, padding), slice(2, padding), slice(3, padding), slice(4, "")],
    updated: "2026-09-19T00:00:00.000Z"
  };
}

const GENERATION_DIGEST_PREFIX = "sha256:";

function digestOf(bytes) {
  return `${GENERATION_DIGEST_PREFIX}${createHash("sha256").update(bytes).digest("hex")}`;
}

export function controlledGeneration({ descriptorCount = 2, body = "",
  repository = GENERATION_REPOSITORY_ROOT } = {}) {
  const descriptors = Array.from({ length: descriptorCount }, (_, index) => {
    const ordinal = String(index + 1).padStart(3, "0");
    const basename = `${WK_ID}--unit-slice-${ordinal}.controlled-contract.json`;
    const bytes = Buffer.from(JSON.stringify({
      schema_version: "controlled-acceptance-contract.v1",
      wk_id: WK_ID,
      slice: `SLICE-${ordinal}`,
      body: `${body}obligation ${ordinal}`
    }), "utf8");
    return {
      path: `wiki/contracts/${basename}`,
      basename,
      carrier_kind: "controlled_contract",
      focus: `SLICE-${ordinal}`,
      pack_digest: digestOf(Buffer.from(`pack-${ordinal}`, "utf8")),
      content_digest: digestOf(bytes),
      byte_length: bytes.byteLength,
      bytes_base64: bytes.toString("base64")
    };
  });
  const manifestBytes = Buffer.from(JSON.stringify({
    schema_version: "controlled-contract-carrier-set-manifest.v1",
    wk_id: WK_ID,
    members: descriptors.map((descriptor) => descriptor.path)
  }), "utf8");
  const manifestDescriptors = [{
    path: `wiki/contracts/${WK_ID}.carrier-set-manifest.json`,
    content_digest: digestOf(manifestBytes),
    byte_length: manifestBytes.byteLength,
    bytes_base64: manifestBytes.toString("base64")
  }];
  const generationDigest = digestOf(Buffer.from(
    descriptors.map((descriptor) => descriptor.content_digest).join("\n"), "utf8"));
  return {
    schema_version: "controlled-contract-authenticated-generation.v1",
    repository,
    wk_id: WK_ID,
    record_source_digest: digestOf(Buffer.from(`record-source-${WK_ID}`, "utf8")),
    wk_tip_sha: TIP,
    generation_digest: generationDigest,
    count: descriptors.length,
    manifest_identity: digestOf(Buffer.concat([manifestBytes, Buffer.from(generationDigest)])),
    manifest_descriptors: manifestDescriptors,
    descriptors
  };
}

export function controlledGenerationIdentity(generation) {
  return {
    schema_version: "controlled-contract-authenticated-generation-metadata.v1",
    wk_id: generation.wk_id,
    generation_digest: generation.generation_digest,
    count: generation.count,
    manifest_identity: generation.manifest_identity,
    descriptors: generation.descriptors.map(({ path: carrierPath, content_digest }) => ({
      path: carrierPath, content_digest
    }))
  };
}

export function versionDecision({ generation, candidate = CANDIDATE, versionIdentity = "1" }) {
  return {
    schema_version: "agent_launch.terminal_wk_candidate.version_decision.v1",
    state: "selected",
    repository_digest: digestOf(Buffer.from(REPOSITORY, "utf8")),
    canonical_wk_id: WK_ID,
    version_identity: versionIdentity,
    immutable_version_ref: `refs/terminal-candidate-versions/${WK_ID}/${versionIdentity}`,
    immutable_version_target: candidate,
    current_selection_ref: `refs/terminal-candidates/${WK_ID}/1`,
    current_selection_observation: candidate,
    candidate,
    base: BASE,
    wk: TIP,
    controlled_generation: controlledGenerationIdentity(generation),
    tree: "e".repeat(40),
    candidate_format: "terminal-wk-candidate.v3"
  };
}

export function terminalCandidate(record, { generation = null, reviewUnit = true } = {}) {
  const contracts = projectSliceReviewReceiptContracts(record, SLICE_ID);
  const decision = versionDecision({ generation: generation ?? controlledGeneration() });
  return {
    binding: {
      schema_version: "terminal-wk-candidate.v3",
      candidate: CANDIDATE,
      candidate_ref: `refs/terminal-candidates/${WK_ID}/1`,
      base: BASE,
      base_ref: "main",
      wk_ref: `refs/heads/wk/IN-0021/${WK_ID}`,
      wk_tip: TIP,
      ...(generation === null ? {} : { controlled_generation: generation }),
      version_decision: decision
    },
    materialization: { state: "materialized", root: `/worktrees/.terminal-candidates/${WK_ID}` },
    dependency_proof: { state: "verified", dependencies: [] },
    ...(reviewUnit ? {
      review_unit: {
        record_id: WK_ID,
        slice_id: SLICE_ID,
        subject: SUBJECT,
        initiative: "IN-0021",
        parent_status: record.status,
        contract_source: "exact_candidate_tree",
        canonical_parent_wk_contract: contracts.canonical_parent_wk_contract,
        review_unit_contract: contracts.slice_review_contract
      }
    } : {}),
    canonical_targets: ["tests/unit/parent.test.mjs"],
    canonical_validation_bindings: [],
    validation_runtime_root: `/worktrees/.terminal-validation/${WK_ID}`,
    version_decision: decision,
    contracts
  };
}

export function finalizedLifecycle(candidate, { transitionRecord = null } = {}) {
  const { contracts, ...published } = candidate;
  return {
    invoked: true,
    phase: "finalized",
    integrated: true,
    wk_transitioned_to_review: true,
    integration: {
      schema_version: "slice-integration.v1",
      integrated: true,
      previous_wk_sha: BASE,
      slice_ref: `refs/heads/slice/IN-0021/${WK_ID}/${SLICE_ID}`,
      slice_sha: TIP,
      delivery_sha: TIP,
      wk_ref: `refs/heads/wk/IN-0021/${WK_ID}`,
      wk_sha: TIP,
      review_target: {
        schema_version: "slice-integration.v1",
        ref: `refs/heads/wk/IN-0021/${WK_ID}`,
        sha: TIP,
        diff_base_sha: BASE,
        diff_head_sha: TIP,
        complete_parent_wk_contract: true,
        accumulated_wk_diff: true
      },
      transition: {
        valid: true,
        written: true,
        ...(transitionRecord === null ? {} : { record: transitionRecord })
      }
    },
    terminal_candidate: published,
    delivery_state: "delivery_finalized",
    cleanup_pending: false,
    cleanup: {
      state: "complete",
      integration_cleanup_state: "complete",
      managed_identity_retirement: { state: "complete", retired: true, code: null }
    }
  };
}

export const MALFORMED_FINAL_RESULT = Object.freeze({
  schema_version: "workspace-agent-final-result.v1",
  kind: "worker_delivery",
  full_response: {
    text: "Tests never ran: go.mod was outside the declared visible scope. " +
      "Proof lookup refused obligation_coverage_source_not_found/ENOENT."
  },
  structured_role_result: {
    valid: false,
    diagnostics: [{ code: "structured_result_ambiguous_candidates" }],
    finding_counts: { total: 0, blocking: 0, medium: 0 }
  }
});

export function unfailedAttemptSelection(status) {
  return Object.freeze({
    ok: true,
    selected: Object.freeze({
      dispatch_tuple: Object.freeze({
        assigned_unit: status.subject,
        launch_ref: status.monitor_handle,
        run_id: status.run_id,
        retry_id: 0
      }),
      failures: Object.freeze([])
    })
  });
}

export function syntheticRecordedInvocation({ rows = 1, status = "unproven",
  limitation = "test_proof_registry_falsification_unsupported", recoveryText = "" } = {}) {
  const digest = (label) => `sha256:${createHash("sha256").update(label).digest("hex")}`;
  const proofs = Array.from({ length: rows }, (_, index) => ({
    test_proof_id: `test-proof-${String(index).padStart(40, "0")}`,
    verification_id: `claim-${String(index).padStart(40, "0")}`,
    status: index === 0 ? status : "proven",
    readiness_status: "ready",
    execution_status: "completed",
    selected_test: { test_id: `test-${"a".repeat(64)}`, file: `tests/case-${index}.test.mjs`,
      name: "selected" },
    selected_status: index === 0 && status !== "proven" ? "failed" : "passed",
    mutation_evidence: { status: "unavailable", unavailable: 1 },
    declared_target: `tests/case-${index}.test.mjs`,
    capability_limitations: [limitation],
    ...(index === 0 && status !== "proven" ? { reason: "reason-1" } : {}),
    obligations: [{ obligation_id: `OBL-${index}`, status: index === 0 ? status : "proven",
      ...(index === 0 && status !== "proven" ? { reason: "reason-1" } : {}) }]
  }));
  return {
    invocation_id: "verify-proof-invocation-synthetic",
    sequence: 3,
    event_digest: digest("event"),
    record_identity: digest("record"),
    requested_unit: SUBJECT,
    assigned_unit: SUBJECT,
    outcome: "completed",
    status,
    reason_code: null,
    selected_proof_count: rows,
    tested_source: { wk_id: WK_ID, selected_unit: SLICE_ID, focus: null,
      candidate: `run-worker-${"b".repeat(64)}`, source_snapshot_digest: digest("tested-source"),
      contract_generation: digest("generation"), canonical_contract_digest: digest("canonical"),
      contract_digest: digest("contract"), binding_digest: digest("binding") },
    result_digest: digest("record"),
    outcome_summary: {
      schema_version: "workspace-verify-proof-outcome-summary.v1",
      subject: { requested: SUBJECT, kind: "slice", canonical_id: SUBJECT },
      subject_binding: { wk_id: WK_ID, contract_generation: digest("generation"),
        contract_content_digest: digest("canonical"), candidate_identity: digest("tested-source") },
      status,
      counts: { proofs: { total: rows, proven: rows - (status === "proven" ? 0 : 1),
        unproven: status === "proven" ? 0 : 1, not_executable: 0, ready: rows, nonready: 0,
        execution_not_started: 0 } },
      proofs,
      proofs_returned: rows,
      proofs_omitted: 0,
      proofs_omitted_by_status: { proven: 0, unproven: 0, not_executable: 0 },
      reasons: status === "proven" ? {} : { "reason-1": { reason_code: "verify_proof.selected_test_failed.v1",
        recovery: { next_step: `rerun after correcting the selected test ${recoveryText}` } } },
      diagnostic_count: 0,
      diagnostic_codes: [],
      diagnostic_codes_omitted: 0,
      diagnostic_redaction_count: 0,
      result_digest: digest("record")
    },
    coverage_scope: "requested_selection_only",
    grants_authority: false
  };
}

export function observationBackend({
  status, lifecycle, recordedCount = 0, lastRecordedInvocation = null, onLifecycle = () => {},
  onDetail = () => {}
}) {
  return {
    getRunStatus: async () => ({ ...status }),
    waitForRunStatus: async () => ({ ...status, timed_out: false }),
    runPostWorkerSliceLifecycle: async () => { onLifecycle(); return lifecycle; },
    readManagedRunObservation: async (input) => {
      if (input?.detail === undefined) return unfailedAttemptSelection(status);
      onDetail(input.detail);
      return {
        ok: true,
        attempt_id: status.run_id,
        summary: {
          recorded_count: recordedCount,
          outcome_counts: recordedCount === 0 ? {} : lastRecordedInvocation === null
            ? { refused: recordedCount } : { completed: recordedCount },
          status_counts: recordedCount === 0 ? {} : lastRecordedInvocation === null
            ? { not_executable: recordedCount }
            : { [lastRecordedInvocation.status]: recordedCount },
          ...(lastRecordedInvocation === null ? {}
            : { last_recorded_invocation: lastRecordedInvocation })
        },
        snapshot: { cursor: "snapshot-1" }
      };
    }
  };
}

export function terminalWorkerStatus(overrides = {}) {
  return {
    accepted: true,
    timed_out: false,
    run_id: "run-worker-2691",
    monitor_handle: "wkmh_worker_2691",
    role: "worker",
    subject: SUBJECT,
    status: "succeeded",
    terminal: true,
    started_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:01:00.000Z",
    final_result: MALFORMED_FINAL_RESULT,
    ...overrides
  };
}

export async function observe(tools, args) {
  const result = await tools.get("workspace_agent_run_status").handler(args);
  return {
    structured: readStructuredResult(result),

    bytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
    requestBytes: Buffer.byteLength(JSON.stringify(args), "utf8"),
    result
  };
}

export async function retrievalRegistry(scope, label, backend) {
  const dir = await scope.acquire(`${label}-spill`,
    () => mkdtempSync(path.join(os.tmpdir(), "wk2691-retained-")),
    (created) => rmSync(created, { recursive: true, force: true }));
  const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir };
  const tools = createDispatchToolRegistry({ backend, responseEnv: env });
  registerMcpContentReferenceTools({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    z,
    jsonContent,
    errorContent,
    env
  });
  return { tools, dir, env };
}

export function retainedArtifacts(dir) {
  return readdirSync(dir).filter((name) => !name.endsWith(".meta.json"));
}

export async function followRetrievalCall(tools, retrieval) {
  const reader = tools.get("workspace_read_mcp_content_reference").handler;
  let callArguments = { ...retrieval.retained_source_read.arguments };
  const chunks = [];
  let pages = 0;
  let readerDigest = null;
  let totalBytes = null;
  let maxLength = null;
  const encodedPages = [];
  for (;;) {
    const page = readStructuredResult(await reader(callArguments));
    encodedPages.push(page.data_base64);

    chunks.push(Buffer.from(page.data_base64, "base64"));
    pages += 1;
    readerDigest = page.sha256;
    totalBytes = page.total_bytes;
    maxLength = page.max_length;
    if (page.next_offset === null) break;
    callArguments = { ...callArguments, offset: page.next_offset };
  }
  return { bytes: Buffer.concat(chunks), pages, readerDigest, totalBytes, maxLength, encodedPages };
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
