

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
  parseStructuredTextResponse
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

export function terminalCandidate(record) {
  const contracts = projectSliceReviewReceiptContracts(record, SLICE_ID);
  return {
    binding: {
      schema_version: "terminal-wk-candidate.v3",
      candidate: CANDIDATE,
      candidate_ref: `refs/terminal-candidates/${WK_ID}/1`,
      base: BASE,
      base_ref: "main",
      wk_ref: `refs/heads/wk/IN-0021/${WK_ID}`,
      wk_tip: TIP,
      version_decision: { state: "selected", version: 1 }
    },
    materialization: { state: "materialized", root: `/worktrees/.terminal-candidates/${WK_ID}` },
    dependency_proof: { state: "verified", dependencies: [] },
    review_unit: {
      record_id: WK_ID,
      slice_id: SLICE_ID,
      subject: SUBJECT,
      initiative: "IN-0021",
      parent_status: record.status,
      contract_source: "exact_candidate_tree",
      canonical_parent_wk_contract: contracts.canonical_parent_wk_contract,
      review_unit_contract: contracts.slice_review_contract
    },
    canonical_targets: ["tests/unit/parent.test.mjs"],
    canonical_validation_bindings: [],
    validation_runtime_root: `/worktrees/.terminal-validation/${WK_ID}`,
    version_decision: { state: "selected", version: 1 },
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
      slice_ref: `refs/heads/slice/IN-0021/${WK_ID}/${SLICE_ID}`,
      slice_sha: TIP,
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

export function observationBackend({
  status, lifecycle, recordedCount = 0, onLifecycle = () => {}
}) {
  return {
    getRunStatus: async () => ({ ...status }),
    waitForRunStatus: async () => ({ ...status, timed_out: false }),
    runPostWorkerSliceLifecycle: async () => { onLifecycle(); return lifecycle; },
    readManagedRunObservation: async () => ({
      ok: true,
      attempt_id: status.run_id,
      summary: {
        recorded_count: recordedCount,
        outcome_counts: recordedCount === 0 ? {} : { refused: recordedCount },
        status_counts: recordedCount === 0 ? {} : { not_executable: recordedCount }
      },
      snapshot: { cursor: "snapshot-1" }
    })
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
    structured: parseStructuredTextResponse(result),

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
    const page = parseStructuredTextResponse(await reader(callArguments));
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
