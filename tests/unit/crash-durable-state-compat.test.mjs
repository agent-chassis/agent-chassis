

import { test } from "node:test";
import assert from "node:assert/strict";
import { attemptJournalFilePath } from "../../packages/agent-launch-core/src/index.mjs";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureLauncherOwnedWorkspaceDurableStateRoot
} from "../../packages/agent-launch-core/src/lib/durable-runtime-state.mjs";
import {
  EVENT_FILE_RE,
  LAYOUT_MARKER_FILE,
  PARTITION_DIRECTORY,
  RECEIPT_DIRECTORY,
  SELECTOR_INDEX_FILE
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-schema.mjs";
import {
  acquireStoreLock,
  parseSelectorIndex,
  unitPartitionDigest
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-store-io.mjs";
import {
  ATTEMPT_RETIREMENT_DIRECTORY
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-selector-journal.mjs";
import {
  createExactSliceReviewReceipt,
  createExactSliceReviewReceiptStore,
  digestTrustedExactReviewEvidence,
  reviseExactSliceReviewReceipt
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import {
  identityDigest
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-transitions.mjs";
import {
  bindManagedRunSandboxProcessIdentity,
  managedRunProcessIdentityFilePath,
  publishPendingManagedRunProcessIdentity,
  readManagedRunProcessIdentity,
  serializeRecord
} from "../../packages/agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import {
  acquireManagedRunSubjectReservation,
  managedRunSubjectReservationFilePath,
  managedRunSubjectSuccessorGuardFilePath
} from "../../packages/agent-launch-cli/src/lib/managed-run-subject-reservation.mjs";
import {
  bindingFilePath,
  defaultWriteBindingFile,
  resolveWorktreeBinding
} from "../../packages/agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import {
  correctionPopulationFromTargets,
  createIntegratedCorrectiveRemainingScopeTransition,
  validateCorrectiveRemainingScopeTransition
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-scope.mjs";
import {
  defaultAcquireWkProvisioningLock
} from "../../packages/agent-launch-cli/src/lib/worktree-provisioning-dispatch-managed.mjs";
import {
  defaultWriteAudit,
  worktreeReaperAuditDir
} from "../../packages/agent-launch-cli/src/lib/worktree-reaper.mjs";
import {
  appendCorrectiveIntegrationHop,
  readTrustedCorrectiveIntegrationState,
  validateCorrectiveIntegrationChain
} from "../../packages/agent-launch-cli/src/lib/trusted-slice-integration.mjs";
import {
  WK_TERMINAL_DISPOSITION_PROOF_SCHEMA_VERSION,
  defaultResolveWkTerminalDispositionProof,
  wkTerminalDispositionProofPath
} from "../../packages/agent-launch-cli/src/lib/worktree-reaper-wk-terminal-proof.mjs";
import {
  readWorkRecordById,
  writeValidatedWorkRecord
} from "../../packages/wiki-core/src/operations/work-records-store-io.mjs";
import {
  CRASH_DURABLE_FAULTS,
  CRASH_DURABLE_LOCK_STATES,
  CRASH_DURABLE_RESULTS,
  classifyLockState,
  createAsyncEffects,
  inspectLockPathSync,
  planReplacement,
  runCrashDurablePlanAsync
} from "../../packages/wiki-core/src/lib/crash-durable-state.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DURABLE_STORE_WRITER_CENSUS_ARTIFACT_REL =
  "tests/fixtures/crash-durable-state-writer-census.json";

export const DURABLE_STORE_BASELINE_SCHEMA_VERSION = "crash-durable-state-baseline.v1";

export const DURABLE_STORE_ARTIFACT_CLASSES = Object.freeze({
  DURABLE_ROOT: "durable_root",
  AUTHORITATIVE_PAYLOAD: "authoritative_payload",
  LOCK_ARTIFACT: "lock_artifact"
});

export const DURABLE_STORE_COMPATIBILITY = Object.freeze({
  PAYLOAD_PRESERVED: "authoritative_payload_path_and_bytes_preserved",
  LOCK_MIGRATION_AUTHORIZED: "token_owned_directory_lock_migration_authorized"
});

export const DURABLE_STORE_BASELINE_REQUIRED_FIELDS = Object.freeze([
  "store_id",
  "owner_module",
  "artifact_class",
  "compatibility",
  "relative_path",
  "filename_derivation",
  "mode",
  "serialized_bytes",
  "authority",
  "append_ordering",
  "read_result",
  "legacy_lock_shape",
  "production_writer",
  "artifacts"
]);

export const DURABLE_STORE_ARTIFACT_REQUIRED_FIELDS = Object.freeze([
  "artifact_id",
  "relative_path",
  "mode",
  "serialized_bytes",
  "authority",
  "append_ordering",
  "read_result"
]);

function sha256(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function serializedBytes(text) {
  return Object.freeze({
    encoding: "utf8",
    byte_length: Buffer.byteLength(text, "utf8"),
    sha256: sha256(text)
  });
}

function modeOf(absPath) {
  return statSync(absPath).mode & 0o7777;
}

function umaskMode(base) {
  const umask = process.umask();
  return base & ~umask;
}

function relative(workspaceDir, absPath) {
  return path.relative(workspaceDir, absPath).split(path.sep).join("/");
}

function createWorkspace(cleanups) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wk2357-baseline-")));
  mkdirSync(path.join(dir, ".git"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const BASELINE_TUPLE = Object.freeze({
  assigned_unit: "WK-2357#SLICE-004",
  launch_ref: "launch-ref-crash-durable-baseline",
  run_id: "run-crash-durable-baseline",
  retry_id: 0
});
const BASELINE_SUBJECT = "WK-2357#SLICE-004";

const BASELINE_RESERVATION_SUBJECT = "WK-2357#SLICE-002";
const BASELINE_INITIATIVE = "IN-0042";
const BASELINE_RECORD_ID = "WK-2357";

export const BASELINE_WORK_RECORD_FIXTURE = Object.freeze({
  schema_version: "work-record.v1",
  id: "WK-0001",
  repo: "agent-chassis/agent-chassis",
  title: "Crash-durable store baseline fixture record",
  record_kind: "work_item",
  work_kind: "implementation",
  status: "todo",
  priority: "medium",
  owner: "unassigned",
  created: "2026-01-01",
  updated: "2026-01-01",
  resolution: "unresolved",
  read_scope: ["AGENTS.md"],
  repo_paths: ["AGENTS.md"],
  write_scope: [],
  depends_on: [],
  blocks: [],
  related: [],
  dispatch_intent: {
    intended_agent_role: "worker",
    target_unit: "record",
    requires_graph_impact: false,
    requires_escalation: false
  },
  acceptance: {
    criteria: ["The fixture record round-trips through the canonical work-record store."],
    validation: []
  },
  children: [],
  slices: [],
  escalations: [],
  projections: [],
  sections: {
    summary: "Self-contained input fixture for the WK-2357 durable-store baseline.",
    why_it_matters: "The baseline must not depend on a mutable repository record.",
    scope: { items: ["Round-trip exactly one canonical work record."], out_of_scope: [] },
    tasks: [],
    references: [],
    agent_notes: "Fixture only; never dispatched.",
    closure: null
  }
});

const BASELINE_CORRECTIVE_RECORD_ID = "WK-0002";
const BASELINE_CORRECTIVE_SLICE_ID = "SLICE-001";

const BASELINE_CORRECTIVE_TARGETS = Object.freeze([
  Object.freeze({
    path: "packages/agent-launch-cli/src/lib/baseline-corrective-alpha.mjs",
    name: "baselineCorrectiveAlpha",
    kind: "function",
    operation: "modify"
  }),
  Object.freeze({
    path: "packages/agent-launch-cli/src/lib/baseline-corrective-beta.mjs",
    name: "baselineCorrectiveBeta",
    kind: "function",
    operation: "modify"
  })
]);
const BASELINE_DELIVERED_CORRECTION_ID = "CORR-001";
const BASELINE_REMAINING_CORRECTION_ID = "CORR-002";

const BASELINE_CORRECTIVE_POPULATION = correctionPopulationFromTargets(
  BASELINE_CORRECTIVE_TARGETS,
  [BASELINE_DELIVERED_CORRECTION_ID, BASELINE_REMAINING_CORRECTION_ID],
  BASELINE_CORRECTIVE_TARGETS.map((target) => target.path)
);

export const BASELINE_CORRECTIVE_WORK_RECORD_FIXTURE = Object.freeze({
  schema_version: "work-record.v1",
  id: BASELINE_CORRECTIVE_RECORD_ID,
  repo: "agent-chassis/agent-chassis",
  title: "Crash-durable corrective-integration baseline fixture record",
  record_kind: "work_item",
  work_kind: "implementation",
  status: "todo",
  priority: "medium",
  owner: "unassigned",
  created: "2026-01-01",
  updated: "2026-01-01",
  resolution: "unresolved",
  read_scope: ["AGENTS.md"],
  repo_paths: ["AGENTS.md"],
  write_scope: [],
  depends_on: [],
  blocks: [],
  related: [],
  dispatch_intent: {
    intended_agent_role: "worker",
    target_unit: "slice",
    requires_graph_impact: false,
    requires_escalation: false
  },
  acceptance: {
    criteria: ["The fixture record carries one authored corrective population."],
    validation: []
  },
  children: [],
  slices: [
    {
      id: BASELINE_CORRECTIVE_SLICE_ID,
      title: "Corrective slice carrying one authored population",
      work_kind: "implementation",
      status: "todo",
      priority: "medium",
      owner: "unassigned",
      depends_on: [],
      read_scope: ["AGENTS.md"],

      repo_paths: [BASELINE_CORRECTIVE_TARGETS[0].path],
      write_scope: [BASELINE_CORRECTIVE_TARGETS[0].path],
      dispatch_intent: {
        intended_agent_role: "worker",
        target_unit: "slice",
        requires_graph_impact: false,
        requires_escalation: false
      },
      acceptance: {
        criteria: ["The authored corrective population drives one remaining-scope subtraction."],
        validation: []
      },
      expected_edit_targets: [BASELINE_CORRECTIVE_TARGETS[0]],
      expected_changed_line_budget: 10,
      correction_population: BASELINE_CORRECTIVE_POPULATION,
      current_correction_ids: [BASELINE_DELIVERED_CORRECTION_ID],
      sections: {
        agent_notes: "Fixture only; never dispatched."
      }
    }
  ],
  escalations: [],
  projections: [],
  sections: {
    summary: "Self-contained corrective input fixture for the WK-2357 durable-store baseline.",
    why_it_matters: "The corrective chain's record dependency must be falsifiable.",
    scope: { items: ["Author exactly one corrective population."], out_of_scope: [] },
    tasks: [],
    references: [],
    agent_notes: "Fixture only; never dispatched.",
    closure: null
  }
});

const BASELINE_RESULT_MODE = Object.freeze({
  schema_version: "workspace-agent-result-mode.v1",
  mode: "structured_result",
  selected_contract: "schema_constrained",
  authority: "launcher_observation_only",
  prose_authority: "none"
});

const BASELINE_STRUCTURED_OUTCOME = Object.freeze({
  outcome: "clean",
  clean_review: true,
  review_result: Object.freeze({
    review_outcome: "no_findings",
    clean_review: true,
    no_findings: true,
    blocking_finding_count: 0,
    medium_finding_count: 0,
    reviewed_controls: Object.freeze(["acceptance", "scope"])
  })
});

function baselineReviewReceipt({ label, generationHex = "1", contractVersion = "1" }) {
  const reviewedSha = "a".repeat(40);
  const identityBody = {
    schema_version: "canonical-standalone-findings-review-binding.v1",
    unit_address: BASELINE_SUBJECT,
    initiative: BASELINE_INITIATIVE,
    record_id: BASELINE_RECORD_ID,
    slice_id: "SLICE-004",
    repository_path: "/workspace",
    target_ref: "refs/heads/main",
    target_sha: reviewedSha,
    worktree_path: "/workspace",
    canonical_source_digest: `sha256:${contractVersion.repeat(64)}`
  };
  const committedTargetDigest = digestTrustedExactReviewEvidence(identityBody);
  const worktreeIdentity = { ...identityBody, committed_target_digest: committedTargetDigest };
  const target = {
    unit_address: BASELINE_SUBJECT,
    record_id: BASELINE_RECORD_ID,
    slice_id: "SLICE-004",
    initiative: BASELINE_INITIATIVE,
    review_admission_kind: "standalone_findings",
    target_ref: "refs/heads/main",
    committed_target_digest: committedTargetDigest,
    reviewed_sha: reviewedSha,
    diff_base_sha: reviewedSha
  };
  const currentGeneration = {
    generation_digest: `sha256:${generationHex.repeat(64)}`,
    manifest_digest: `sha256:${generationHex.repeat(64)}`
  };
  const dispatchId = `review-dispatch-${label}`;
  const canonicalContract = JSON.stringify({ id: BASELINE_RECORD_ID, version: contractVersion });
  const sliceContract = JSON.stringify({ id: "SLICE-004", version: contractVersion });
  return createExactSliceReviewReceipt({
    unit_address: BASELINE_SUBJECT,
    record_id: BASELINE_RECORD_ID,
    slice_id: "SLICE-004",
    initiative: BASELINE_INITIATIVE,
    canonical_parent_wk_contract: canonicalContract,
    canonical_parent_contract_digest: digestTrustedExactReviewEvidence(canonicalContract),
    slice_review_contract: sliceContract,
    slice_review_contract_digest: digestTrustedExactReviewEvidence(sliceContract),
    review_admission_kind: "standalone_findings",
    committed_target_digest: committedTargetDigest,
    review_run_id: `review-run-${label}`,
    review_monitor_handle: `review-monitor-${label}`,
    reviewer_role: "reviewer",
    slice_ref: "refs/heads/main",
    worktree_path: "/workspace",
    worktree_identity: worktreeIdentity,
    worktree_identity_digest: digestTrustedExactReviewEvidence(worktreeIdentity),
    reviewed_sha: reviewedSha,
    diff_base_sha: reviewedSha,
    terminal_run_status: "launching",
    structured_outcome: null,
    verdict_evidence: "pending",
    review_dispatch_identity: {
      schema_version: "workspace-agent-review-dispatch-identity.v1",
      kind: "review_dispatch",
      review_dispatch_id: dispatchId,
      target,
      current_generation: currentGeneration
    },
    attempt_lineage_identity: {
      schema_version: "workspace-agent-attempt-lineage-identity.v1",
      kind: "attempt_lineage",
      review_dispatch_id: dispatchId,
      attempt_id: `attempt-lineage-${label}`,
      attempt_number: 1,
      target,
      current_generation: currentGeneration,
      run_id: `review-run-${label}`,
      monitor_handle: `review-monitor-${label}`
    },
    recovery_transition_identity: null
  });
}

function baselineLineageDecision(prior, replacement) {
  return Object.freeze({
    schema_version: "workspace-agent-reviewer-generation-correction-decision.v1",
    decision: "eligible",
    owner: "reviewerLineageBinder",
    authority: "launcher_authenticated_lifecycle_facts",
    prior_identity_digest: identityDigest(prior),
    replacement_identity_digest: identityDigest(replacement),
    lifecycle_facts: Object.freeze({
      launch_state: "not_started",
      reviewer_child_created: false,
      terminal_child_fact: false,
      settled_result: false,
      downstream_authority_granted: false
    })
  });
}

export function buildDurableStoreBaselineCorpus() {
  return Object.freeze([
    Object.freeze({
      store_id: "launcher-durable-state-root",
      owner_module: "packages/agent-launch-core/src/lib/durable-runtime-state.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.DURABLE_ROOT,
      compatibility: DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,
      authority: "stable_workspace_anchored_root",
      legacy_lock_shape: null,
      production_writer: "ensureLauncherOwnedWorkspaceDurableStateRoot",
      async produce({ workspaceDir }) {
        const ensured = await ensureLauncherOwnedWorkspaceDurableStateRoot({ workspaceDir });
        assert.equal(ensured.ok, true, "the durable root must resolve for an authenticated primary checkout");
        assert.equal(ensured.dir, ensured.root, "the ensure seam and the resolved root are one path");
        assert.equal(relative(workspaceDir, ensured.root), ".agent-launch/durable-state/v1");
        assert.equal(modeOf(ensured.root), 0o700, "the durable root is launcher-private");
        return {
          relative_path: relative(workspaceDir, ensured.root),
          filename_derivation:
            "path.join(workspace, LAUNCHER_CONFIG_DIRNAME, LAUNCHER_DURABLE_STATE_DIRNAME, LAUNCHER_DURABLE_STATE_LAYOUT_VERSION)",
          mode: 0o700,
          serialized_bytes: null,
          append_ordering: null,
          read_result: Object.freeze({ ok: true, source: ensured.source }),
          durable_root: ensured.root
        };
      }
    }),

    Object.freeze({

      store_id: "exact-slice-review-receipt-journal",
      owner_module: "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-store.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.AUTHORITATIVE_PAYLOAD,
      compatibility: DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,
      authority: "immutable_partition_events_with_derived_replaceable_index",
      legacy_lock_shape: null,
      production_writer:
        "createExactSliceReviewReceiptStore: persist, retireAndElectReplacement, persistTerminalRunResult, persistTerminalSettlementConflict",
      async produce({ workspaceDir, durableRoot }) {
        const store = createExactSliceReviewReceiptStore({ workspaceDir });
        const prior = baselineReviewReceipt({ label: "prior" });
        const successor = baselineReviewReceipt({
          label: "successor",
          generationHex: "2",
          contractVersion: "2"
        });

        await store.persist(prior);

        const elected = (await store.retireAndElectReplacement({
          prior_receipt: prior,
          replacement_receipt: successor,
          lineage_decision: baselineLineageDecision(prior, successor)
        })).receipt;

        const terminal = reviseExactSliceReviewReceipt(elected, {
          terminal_run_status: "succeeded",
          structured_outcome: BASELINE_STRUCTURED_OUTCOME,
          verdict_evidence: "verdict_recorded",
          result_mode: BASELINE_RESULT_MODE
        });
        await store.persistTerminalRunResult({
          receipt: terminal,
          repository_path: "/workspace",
          final_result: {
            kind: "no_findings",
            result_mode: BASELINE_RESULT_MODE,
            structured_role_result: { findings: [] }
          }
        });
        await store.persistTerminalSettlementConflict({
          receipt: terminal,
          conflict: { conflict_class: "applicability_moved", conflict_detail: null }
        });

        const dir = path.join(durableRoot, RECEIPT_DIRECTORY);
        const priorIdentity = identityDigest(prior);
        const electedIdentity = identityDigest(elected);
        const partitionDir = path.join(dir, PARTITION_DIRECTORY, unitPartitionDigest(BASELINE_SUBJECT));
        const eventNames = readdirSync(partitionDir).sort();
        assert.equal(eventNames.length, 2, "election and retirement each publish one immutable event");
        assert.deepEqual(
          eventNames.map((name) => name.slice(0, 22)),
          ["event-0000000000000001", "event-0000000000000002"],
          "partition events carry a zero-padded monotonic generation and publish in order"
        );
        for (const name of eventNames) {
          assert.match(name, EVENT_FILE_RE, "every event filename matches the production event grammar");
        }

        const artifacts = [];
        const record = (artifactId, absPath, authority, readResult, appendOrdering = null) => {
          const raw = readFileSync(absPath, "utf8");
          assert.equal(modeOf(absPath), 0o600, `${artifactId} is launcher-private`);
          artifacts.push(Object.freeze({
            artifact_id: artifactId,
            relative_path: relative(workspaceDir, absPath),
            mode: 0o600,
            serialized_bytes: serializedBytes(raw),
            authority,
            append_ordering: appendOrdering,
            read_result: readResult
          }));
          return raw;
        };

        const layoutPath = path.join(dir, LAYOUT_MARKER_FILE);
        record(
          "layout-marker",
          layoutPath,
          "immutable_layout_declaration",
          Object.freeze({ schema_version: JSON.parse(readFileSync(layoutPath, "utf8")).schema_version })
        );
        const loadedAll = await store.loadAll({ unit_address: BASELINE_SUBJECT });
        assert.equal(loadedAll.length, 2, "the stale and corrected lineages are both durable");
        for (const name of eventNames) {
          record(
            `partition-event:${name.slice(6, 22)}`,
            path.join(partitionDir, name),
            "immutable_append_once_event",
            Object.freeze({ reader: "loadAll", lineages: loadedAll.length }),
            Number.parseInt(name.slice(6, 22), 10)
          );
        }

        const indexPath = path.join(dir, SELECTOR_INDEX_FILE);
        const parsedIndex = parseSelectorIndex(readFileSync(indexPath));
        const indexRaw = record(
          "selector-index",
          indexPath,
          "physically_appended_fixed_width_entries_rebuilt_as_a_sorted_whole_image",
          Object.freeze({ parser: "parseSelectorIndex", entries: parsedIndex.size }),
          Object.freeze([...parsedIndex.keys()])
        );
        assert.ok(parsedIndex.size > 0, "the selector index resolves published entries");
        assert.equal(
          Buffer.byteLength(indexRaw, "utf8") % 130,
          0,
          "the index is a whole number of fixed-width entries; a torn tail is unreadable by construction"
        );
        const publishedIdentities = new Set([priorIdentity, electedIdentity]);
        for (const [selector, identity] of parsedIndex) {
          assert.match(selector, /^[0-9a-f]{64}$/u);
          assert.ok(
            publishedIdentities.has(identity),
            "every selector resolves to an identity that the partitions actually published"
          );
        }

        const retirement = await store.loadAttemptRetirement({ receipt: prior });
        assert.notEqual(retirement, null, "the retired attempt's evidence is durable");
        record(
          "reviewer-attempt-retirement",
          path.join(dir, ATTEMPT_RETIREMENT_DIRECTORY, `${priorIdentity}.json`),
          "immutable_terminal_evidence",
          Object.freeze({ reader: "loadAttemptRetirement", prior_identity_digest: priorIdentity })
        );

        const terminalResult = await store.loadTerminalRunResult({
          receipt: terminal,
          repository_path: "/workspace"
        });
        assert.equal(terminalResult.terminal_run_status, "succeeded");
        record(
          "terminal-run-result",
          path.join(dir, "terminal-run-results", `${electedIdentity}.json`),
          "immutable_terminal_evidence",
          Object.freeze({
            reader: "loadTerminalRunResult",
            terminal_run_status: terminalResult.terminal_run_status
          })
        );

        const conflict = await store.loadTerminalSettlementConflict({ receipt: terminal });
        assert.equal(conflict.observation_generation, 1);
        record(
          "terminal-settlement-conflict",
          path.join(
            dir,
            "terminal-settlement-conflicts",
            `${electedIdentity}-event-${String(conflict.observation_generation).padStart(16, "0")}.json`
          ),
          "append_once_immutable_observation",
          Object.freeze({
            reader: "loadTerminalSettlementConflict",
            conflict_class: conflict.conflict_class
          }),
          conflict.observation_generation
        );

        const covered = new Set(artifacts.map((entry) => entry.relative_path));
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === PARTITION_DIRECTORY) continue;
          const abs = path.join(dir, entry.name);
          const paths = entry.isDirectory()
            ? readdirSync(abs).map((child) => path.join(abs, child))
            : [abs];
          for (const candidate of paths) {
            assert.ok(
              covered.has(relative(workspaceDir, candidate)),
              `uncharacterized receipt-journal artifact: ${relative(workspaceDir, candidate)}`
            );
          }
        }

        const primary = artifacts.find((entry) => entry.artifact_id === "selector-index");
        return {
          relative_path: relative(workspaceDir, dir),
          filename_derivation:
            "RECEIPT_DIRECTORY under the durable root; events at PARTITION_DIRECTORY/unitPartitionDigest(unit_address)/event-<gen16>-<identity>-<receipt>.json; terminal and retirement evidence keyed by identity digest",
          mode: primary.mode,
          serialized_bytes: primary.serialized_bytes,
          append_ordering: "monotonic partition-event generation; index derived from the partitions",
          read_result: Object.freeze({ artifacts: artifacts.length, lineages: loadedAll.length }),
          artifacts: Object.freeze(artifacts)
        };
      }
    }),

    Object.freeze({
      store_id: "exact-slice-review-receipt-store-lock",
      owner_module: "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-store-io.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.LOCK_ARTIFACT,
      compatibility: DURABLE_STORE_COMPATIBILITY.LOCK_MIGRATION_AUTHORIZED,
      authority: "single_winner_directory_rename",

      legacy_lock_shape: "directory_with_owner_record_file",
      production_writer: "acquireStoreLock",
      async produce({ workspaceDir, durableRoot }) {
        const dir = path.join(durableRoot, RECEIPT_DIRECTORY);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const release = await acquireStoreLock(dir, null);
        const lockDir = path.join(dir, ".receipt-store.lock");
        const ownerPath = path.join(lockDir, "owner.json");
        assert.equal(statSync(lockDir).isDirectory(), true, "the held lock is a directory");
        assert.deepEqual(readdirSync(lockDir), ["owner.json"], "the held lock carries exactly its owner record");
        assert.equal(modeOf(lockDir), 0o700);
        assert.equal(modeOf(ownerPath), 0o600);
        const ownerRaw = readFileSync(ownerPath, "utf8");
        const owner = JSON.parse(ownerRaw);

        assert.deepEqual(
          Object.keys(owner).sort(),
          ["identity", "pid", "token"],
          "the migrated owner record is {pid, token, identity}"
        );
        assert.ok(
          owner.identity === null ||
            ["boot_id", "pid", "starttime"].every((field) => Object.hasOwn(owner.identity, field)),
          "the claimant identity is the non-reusable triple, or null where /proc is unavailable"
        );
        assert.equal(owner.pid, process.pid);
        assert.match(owner.token, /^[0-9a-f]{32}$/u);
        assert.equal(ownerRaw, `${JSON.stringify(owner)}\n`, "the owner record is compact JSON plus one newline");

        writeFileSync(
          ownerPath,
          `${JSON.stringify({ pid: owner.pid, token: "f".repeat(32), identity: owner.identity })}\n`,
          "utf8"
        );
        await assert.rejects(
          release,
          /lock ownership changed/u,
          "release refuses once the persisted owner token no longer matches"
        );

        writeFileSync(ownerPath, "not json\n", "utf8");
        await assert.rejects(
          acquireStoreLock(dir, null),
          /lock is malformed/u,
          "a malformed legacy lock is never retired"
        );
        rmSync(lockDir, { recursive: true, force: true });

        return {
          relative_path: relative(workspaceDir, lockDir),
          filename_derivation: "path.join(receiptDir, '.receipt-store.lock')/owner.json",
          mode: Object.freeze({ directory: 0o700, owner_record: 0o600 }),
          serialized_bytes: serializedBytes(ownerRaw),
          append_ordering: null,
          read_result: Object.freeze({ owner_fields: ["pid", "token"] })
        };
      }
    }),

    Object.freeze({
      store_id: "managed-run-process-identity",
      owner_module: "packages/agent-launch-cli/src/lib/managed-run-process-identity-store.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.AUTHORITATIVE_PAYLOAD,
      compatibility: DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,

      authority: "exclusive_create_then_atomic_replace",
      legacy_lock_shape: null,
      production_writer: "publishPendingManagedRunProcessIdentity + bindManagedRunSandboxProcessIdentity",
      async produce({ workspaceDir }) {
        const filePath = managedRunProcessIdentityFilePath(workspaceDir, BASELINE_TUPLE);
        assert.match(
          relative(workspaceDir, filePath),
          /^\.agent-launch\/managed-run-identity\/identity-[0-9a-f]{64}\.json$/u
        );
        const pending = publishPendingManagedRunProcessIdentity({
          mainRepo: workspaceDir,
          tuple: BASELINE_TUPLE,
          role: "worker"
        });
        const pendingRaw = readFileSync(filePath, "utf8");
        assert.equal(pendingRaw, serializeRecord(pending.record), "the pending image is the store's own serialization");
        assert.equal(JSON.parse(pendingRaw).state, "pending");
        assert.equal(modeOf(filePath), 0o600);

        bindManagedRunSandboxProcessIdentity(pending, {
          pid: process.pid,
          killShape: { kind: "bwrap-pid", pid: process.pid }
        });
        const boundRaw = readFileSync(filePath, "utf8");
        assert.equal(modeOf(filePath), 0o600, "the atomic replacement preserves the private mode");
        assert.deepEqual(
          readdirSync(path.dirname(filePath)),
          [path.basename(filePath)],
          "the two-phase publication leaves no temporary residue"
        );
        const read = readManagedRunProcessIdentity({ mainRepo: workspaceDir, tuple: BASELINE_TUPLE });
        const { file_path: readPath, ...body } = read;
        assert.equal(readPath, filePath, "the read reports the exact derived path");
        assert.equal(body.state, "bound");
        assert.deepEqual(JSON.parse(boundRaw), body, "the successful read result is the published image");
        assert.equal(boundRaw, serializeRecord(body), "the bound image is JSON.stringify(record, null, 2) plus one newline");

        return {
          relative_path: relative(workspaceDir, filePath),
          filename_derivation:
            "identity-<sha256([schema_version, assigned_unit, launch_ref, run_id, retry_id])>.json under .agent-launch/managed-run-identity",
          mode: 0o600,
          serialized_bytes: serializedBytes(boundRaw),
          append_ordering: "state transition: pending -> bound, same path",
          read_result: Object.freeze({ state: body.state, reader: "readManagedRunProcessIdentity" })
        };
      }
    }),

    Object.freeze({
      store_id: "managed-run-subject-reservation",
      owner_module: "packages/agent-launch-cli/src/lib/managed-run-subject-reservation.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.AUTHORITATIVE_PAYLOAD,
      compatibility: DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,

      authority: "exclusive_create_held_until_released_or_proven_abandoned",
      legacy_lock_shape: null,
      production_writer: "acquireManagedRunSubjectReservation",
      async produce({ workspaceDir }) {

        const legacyPath = managedRunSubjectReservationFilePath(workspaceDir, BASELINE_RESERVATION_SUBJECT);
        assert.match(
          relative(workspaceDir, legacyPath),
          /^\.agent-launch\/managed-run-identity\/subject-[0-9a-f]{64}\.json$/u
        );
        const filePath = attemptJournalFilePath(
          workspaceDir, workspaceDir, BASELINE_RESERVATION_SUBJECT
        );
        assert.match(
          relative(workspaceDir, filePath),
          /^\.agent-launch\/managed-worker-attempts\/v1-[0-9a-f]{64}\/journal\.jsonl$/u
        );
        const acquired = acquireManagedRunSubjectReservation({
          mainRepo: workspaceDir,
          subject: BASELINE_RESERVATION_SUBJECT,
          role: "worker"
        });
        assert.equal(acquired.may_launch, true);
        assert.equal(existsSync(legacyPath), false,
          "the retired legacy reservation artifact must never be written again");
        const raw = readFileSync(filePath, "utf8");
        assert.equal(modeOf(filePath), 0o600);

        const lines = raw.split("\n").filter((line) => line.length > 0);
        assert.equal(lines.length, 1, "one reservation claim is one event");
        const event = JSON.parse(lines[0]);
        assert.deepEqual(
          Object.keys(event),
          ["schema_version", "repository", "subject", "attempt", "sequence", "prior_digest",
           "generation_digest", "wk_tip", "kind", "payload", "digest"],
          "the attempt event's exact key order is part of its serialized bytes"
        );
        assert.equal(event.schema_version, "managed-worker-attempt-journal.v1");
        assert.equal(event.kind, "reservation_claimed");
        assert.equal(event.sequence, 0);
        assert.equal(event.prior_digest, null);
        assert.deepEqual(Object.keys(event.payload.owner_launcher), ["pid", "starttime", "boot_id"]);

        const contended = acquireManagedRunSubjectReservation({
          mainRepo: workspaceDir,
          subject: BASELINE_RESERVATION_SUBJECT,
          role: "worker"
        });
        assert.equal(contended.may_launch, false, "a live holder is never displaced");
        assert.equal(readFileSync(filePath, "utf8"), raw, "the contended attempt leaves the held bytes untouched");

        return {
          relative_path: relative(workspaceDir, filePath),
          filename_derivation:
            "managed-worker-attempts/v1-<sha256([schema_version, partition_version, repository, subject])>/journal.jsonl",
          mode: 0o600,
          serialized_bytes: serializedBytes(raw),
          append_ordering: "newline_delimited_digest_chain",
          read_result: Object.freeze({ verdict: contended.verdict, may_launch: contended.may_launch })
        };
      }
    }),

    Object.freeze({
      store_id: "worktree-identity-binding",
      owner_module: "packages/agent-launch-cli/src/lib/worktree-substrate-identity.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.AUTHORITATIVE_PAYLOAD,
      compatibility: DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,
      authority: "immutable_exclusive_create",
      legacy_lock_shape: null,
      production_writer: "defaultWriteBindingFile",
      async produce({ workspaceDir }) {
        const filePath = bindingFilePath(
          workspaceDir,
          BASELINE_TUPLE.launch_ref,
          BASELINE_TUPLE.run_id,
          BASELINE_TUPLE.retry_id
        );
        assert.match(
          relative(workspaceDir, filePath),
          /^\.agent-launch\/worktree-identity\/binding-[0-9a-f]{64}\.json$/u
        );

        const binding = {
          schema_version: "worktree-identity-binding.v1",
          launch_ref: BASELINE_TUPLE.launch_ref,
          run_id: BASELINE_TUPLE.run_id,
          retry_id: BASELINE_TUPLE.retry_id,
          unit_address: BASELINE_SUBJECT,
          initiative: BASELINE_INITIATIVE,
          record_id: BASELINE_RECORD_ID,
          slice_id: "SLICE-004",
          base_ref: "refs/heads/main",
          base_sha: "a".repeat(40),
          output_branch: `wk/${BASELINE_INITIATIVE}/${BASELINE_RECORD_ID}`,
          worktree_path: path.join(path.dirname(workspaceDir), "wk2357-baseline-worktree"),
          write_scope: ["tests/unit/crash-durable-state-compat.test.mjs"],
          write_scope_source: "canonical_slice",
          wk_tip_sha: "b".repeat(40)
        };
        const contents = `${JSON.stringify(binding, null, 2)}\n`;
        defaultWriteBindingFile({ filePath, contents });
        const raw = readFileSync(filePath, "utf8");
        assert.equal(raw, contents, "the binding writer stores caller-owned bytes verbatim");
        assert.equal(modeOf(filePath), 0o600);

        const resolved = resolveWorktreeBinding({
          mainRepo: workspaceDir,
          launchRef: BASELINE_TUPLE.launch_ref,
          runId: BASELINE_TUPLE.run_id,
          retryId: BASELINE_TUPLE.retry_id
        });
        assert.deepEqual(resolved, binding, "resolveWorktreeBinding returns the published binding");
        assert.throws(
          () => resolveWorktreeBinding({
            mainRepo: workspaceDir,
            launchRef: "launch-ref-never-allocated",
            runId: BASELINE_TUPLE.run_id,
            retryId: BASELINE_TUPLE.retry_id
          }),
          (error) => error?.code === "agent_launch.worktree_substrate.binding_not_found.v1",
          "an unbound tuple resolves to a typed BINDING_NOT_FOUND refusal, never a default"
        );

        assert.throws(
          () => defaultWriteBindingFile({ filePath, contents }),
          /identity binding already exists/u,
          "a published binding is immutable: a duplicate allocation is a loud collision, never a clobber"
        );
        assert.equal(readFileSync(filePath, "utf8"), raw, "the refused duplicate left the published bytes intact");

        return {
          relative_path: relative(workspaceDir, filePath),
          filename_derivation:
            "binding-<sha256(['worktree-identity-binding.v1', launch_ref, run_id, retry_id])>.json under .agent-launch/worktree-identity",
          mode: 0o600,
          serialized_bytes: serializedBytes(raw),
          append_ordering: null,
          read_result: Object.freeze({
            reader: "resolveWorktreeBinding",
            unit_address: resolved.unit_address,
            immutable: true
          })
        };
      }
    }),

    Object.freeze({
      store_id: "worktree-provision-lock",
      owner_module: "packages/agent-launch-cli/src/lib/worktree-provisioning-dispatch-managed.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.LOCK_ARTIFACT,
      compatibility: DURABLE_STORE_COMPATIBILITY.LOCK_MIGRATION_AUTHORIZED,
      authority: "single_winner_mkdir",

      legacy_lock_shape: "ownerless_directory",
      production_writer: "defaultAcquireWkProvisioningLock",
      async produce({ workspaceDir }) {
        const held = defaultAcquireWkProvisioningLock({ repo: workspaceDir, key: BASELINE_RECORD_ID });
        const lockDir = path.join(
          workspaceDir,
          ".agent-launch",
          "worktree-provision-locks",
          `${BASELINE_RECORD_ID}.lock`
        );
        assert.equal(statSync(lockDir).isDirectory(), true);

        assert.deepEqual(
          readdirSync(lockDir),
          ["owner.json"],
          "the migrated provisioning lock carries exactly its owner record"
        );
        assert.equal(
          modeOf(lockDir),
          0o700,
          "the migrated lock directory is explicitly launcher-private, matching the token-owned layout"
        );
        assert.throws(
          () => defaultAcquireWkProvisioningLock({ repo: workspaceDir, key: BASELINE_RECORD_ID, attempts: 2, backoffMs: 1 }),
          (error) => error?.code === "agent_launch.worktree_provisioning_dispatch.base_sha_raced.v1",
          "a contended provisioning lock fails closed and retryable within its bounded window"
        );
        held.release();
        assert.equal(existsSync(lockDir), false, "release removes the empty lock directory");

        return {
          relative_path: relative(workspaceDir, lockDir),
          filename_derivation:
            "<sanitized key>.lock directory under .agent-launch/worktree-provision-locks (key sanitized to [A-Za-z0-9._-])",
          mode: umaskMode(0o777),
          serialized_bytes: null,
          append_ordering: null,
          read_result: Object.freeze({ owner_record: null, ownerless: true })
        };
      }
    }),

    Object.freeze({
      store_id: "worktree-reaper-audit",
      owner_module: "packages/agent-launch-cli/src/lib/worktree-reaper.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.AUTHORITATIVE_PAYLOAD,
      compatibility: DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,

      authority: "append_ordered_jsonl",
      legacy_lock_shape: null,
      production_writer: "defaultWriteAudit",
      async produce({ workspaceDir }) {
        const auditDir = worktreeReaperAuditDir(workspaceDir);
        const lines = [
          `${JSON.stringify({ schema_version: "worktree-reaper-audit.v1", seq: 1 })}\n`,
          `${JSON.stringify({ schema_version: "worktree-reaper-audit.v1", seq: 2 })}\n`
        ];
        defaultWriteAudit({ auditDir, line: lines[0] });
        const filePath = defaultWriteAudit({ auditDir, line: lines[1] });
        assert.equal(relative(workspaceDir, filePath), ".agent-launch/worktree-reaper-audit/reaper-audit.jsonl");
        const raw = readFileSync(filePath, "utf8");
        assert.equal(raw, lines.join(""), "appends land in call order with no separator rewriting");
        assert.equal(modeOf(filePath), 0o600);
        assert.deepEqual(
          raw.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line).seq),
          [1, 2],
          "the successful read result preserves append ordering"
        );

        return {
          relative_path: relative(workspaceDir, filePath),
          filename_derivation: "reaper-audit.jsonl under .agent-launch/worktree-reaper-audit",
          mode: 0o600,
          serialized_bytes: serializedBytes(raw),
          append_ordering: Object.freeze([1, 2]),
          read_result: Object.freeze({ lines: 2, format: "jsonl" })
        };
      }
    }),

    Object.freeze({
      store_id: "wk-terminal-disposition-proof",
      owner_module: "packages/agent-launch-cli/src/lib/worktree-reaper-wk-terminal-proof.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.AUTHORITATIVE_PAYLOAD,
      compatibility: DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,
      authority: "read_only_in_tree",
      legacy_lock_shape: null,

      production_writer: null,
      async produce({ workspaceDir }) {
        const filePath = wkTerminalDispositionProofPath(workspaceDir, BASELINE_INITIATIVE, BASELINE_RECORD_ID);
        assert.equal(
          relative(workspaceDir, filePath),
          `.agent-launch/wk-terminal-disposition/${BASELINE_INITIATIVE}.${BASELINE_RECORD_ID}.json`
        );
        assert.equal(
          defaultResolveWkTerminalDispositionProof({
            mainRepo: workspaceDir,
            initiative: BASELINE_INITIATIVE,
            recordId: BASELINE_RECORD_ID
          }),
          null,
          "an absent proof reads as MISSING, never as a pass"
        );
        const proof = { schema_version: WK_TERMINAL_DISPOSITION_PROOF_SCHEMA_VERSION };
        const contents = `${JSON.stringify(proof)}\n`;
        mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
        writeFileSync(filePath, contents, { mode: 0o600 });
        assert.deepEqual(
          defaultResolveWkTerminalDispositionProof({
            mainRepo: workspaceDir,
            initiative: BASELINE_INITIATIVE,
            recordId: BASELINE_RECORD_ID
          }),
          proof,
          "the production reader resolves the proof at exactly this derived path"
        );
        writeFileSync(filePath, "not json\n", "utf8");
        assert.throws(
          () => defaultResolveWkTerminalDispositionProof({
            mainRepo: workspaceDir,
            initiative: BASELINE_INITIATIVE,
            recordId: BASELINE_RECORD_ID
          }),
          /not valid JSON/u,
          "a malformed proof fails closed"
        );

        return {
          relative_path: relative(workspaceDir, filePath),
          filename_derivation: "<IN-nnnn>.<WK-nnnn>.json under .agent-launch/wk-terminal-disposition",
          mode: 0o600,
          serialized_bytes: serializedBytes(contents),
          append_ordering: null,
          read_result: Object.freeze({
            reader: "defaultResolveWkTerminalDispositionProof",
            in_tree_writer: false
          })
        };
      }
    }),

    Object.freeze({
      store_id: "canonical-work-record",
      owner_module: "packages/wiki-core/src/operations/work-records-store-io.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.AUTHORITATIVE_PAYLOAD,
      compatibility: DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,
      authority: "replaceable_by_atomic_rename_under_source_digest_guard",
      legacy_lock_shape: null,
      production_writer: "writeValidatedWorkRecord",
      async produce({ workspaceDir }) {

        const dir = workspaceDir;
        mkdirSync(path.join(dir, "wiki", "work-records"), { recursive: true });
        const record = structuredClone(BASELINE_WORK_RECORD_FIXTURE);

        const written = await writeValidatedWorkRecord({ dir, record });
        assert.equal(written.valid, true, "the fixture record validates through the production validator");
        assert.equal(written.written, true);
        const filePath = written.canonical_record_path;
        assert.equal(relative(dir, filePath), `wiki/work-records/${BASELINE_WORK_RECORD_FIXTURE.id}.json`);
        const raw = readFileSync(filePath, "utf8");
        assert.equal(
          raw,
          `${JSON.stringify(record, null, 2)}\n`,
          "the canonical serialization is 2-space JSON plus exactly one trailing newline"
        );
        assert.equal(
          modeOf(filePath),
          umaskMode(0o666),
          "the canonical record takes the process umask; the writer sets no explicit mode"
        );
        const read = await readWorkRecordById({ dir, id: BASELINE_WORK_RECORD_FIXTURE.id });
        assert.equal(read.valid, true);
        assert.deepEqual(read.record, record, "the successful read result is the published record");
        assert.equal(read.source_digest, written.source_digest);

        const stale = await writeValidatedWorkRecord({
          dir,
          record,
          expectedSourceDigest: `sha256:${"0".repeat(64)}`
        });
        assert.equal(stale.written, false);
        assert.equal(stale.diagnostics[0].code, "stale_source_digest", "replacement is guarded by the source digest");
        assert.equal(readFileSync(filePath, "utf8"), raw, "the refused replacement left the published bytes intact");

        return {
          relative_path: `wiki/work-records/${BASELINE_WORK_RECORD_FIXTURE.id}.json`,
          filename_derivation: "<record id>.json under <store dir>/wiki/work-records",
          mode: umaskMode(0o666),
          serialized_bytes: serializedBytes(raw),
          append_ordering: null,
          read_result: Object.freeze({ reader: "readWorkRecordById", source_digest: read.source_digest }),
          work_record_store_dir: dir
        };
      }
    }),

    Object.freeze({
      store_id: "canonical-work-record-write-lock",
      owner_module: "packages/wiki-core/src/operations/work-records-store-io.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.LOCK_ARTIFACT,
      compatibility: DURABLE_STORE_COMPATIBILITY.LOCK_MIGRATION_AUTHORIZED,
      authority: "exclusive_create_regular_file",

      legacy_lock_shape: "regular_file_with_pid_and_wall_clock_metadata",
      production_writer: "withWorkRecordWriteLock (module-private; exercised through writeValidatedWorkRecord)",
      async produce({ workspaceDir, priorObservations }) {
        const dir = priorObservations.get("canonical-work-record").work_record_store_dir;
        const lockPath = path.join(dir, "wiki", ".work-record-write.lock");

        const record = JSON.parse(
          readFileSync(
            path.join(dir, "wiki", "work-records", `${BASELINE_WORK_RECORD_FIXTURE.id}.json`),
            "utf8"
          )
        );

        const staleBody = `${JSON.stringify(
          { acquired_at: new Date(Date.now() - 600_000).toISOString(), pid: null },
          null,
          2
        )}\n`;
        writeFileSync(lockPath, staleBody, "utf8");
        assert.equal(statSync(lockPath).isFile(), true, "the legacy write lock is a regular file, not a directory");
        assert.equal(
          classifyLockState(inspectLockPathSync(lockPath)),
          CRASH_DURABLE_LOCK_STATES.LEGACY_REGULAR_FILE,
          "the legacy regular-file shape is recognized deterministically"
        );
        const refused = await writeValidatedWorkRecord({ dir, record });
        assert.equal(refused.written, false, "a legacy lock is never reclaimed on age or bare PID");
        assert.equal(refused.diagnostics[0].code, "work_record_write_failed");
        assert.equal(
          readFileSync(lockPath, "utf8"),
          staleBody,
          "the legacy artifact is left byte-intact for operator recovery, never unlinked by path"
        );
        rmSync(lockPath, { force: true });

        mkdirSync(lockPath);
        assert.equal(
          classifyLockState(inspectLockPathSync(lockPath)),
          CRASH_DURABLE_LOCK_STATES.LEGACY_OWNERLESS_DIRECTORY,
          "an ownerless lock directory is recognized and fails closed rather than being claimed"
        );
        rmSync(lockPath, { recursive: true, force: true });

        const published = await writeValidatedWorkRecord({ dir, record });
        assert.equal(published.written, true, "an uncontended write acquires and releases the token-owned lock");
        assert.equal(existsSync(lockPath), false, "the canonical lock name is freed by the holder's own release");

        return {
          relative_path: "wiki/.work-record-write.lock",
          filename_derivation: "'.work-record-write.lock' under <store dir>/wiki",
          mode: 0o700,
          serialized_bytes: serializedBytes(staleBody),
          append_ordering: null,
          read_result: Object.freeze({
            legacy_owner_fields: ["acquired_at", "pid"],
            retained_abandonment_inputs: [],
            removed_abandonment_inputs: ["bare_pid_liveness", "elapsed_wall_clock_age", "unlink_by_path"],
            contended_verdict: "indeterminate_never_reclaimed"
          })
        };
      }
    }),

    Object.freeze({
      store_id: "corrective-integration-chain",
      owner_module: "packages/agent-launch-cli/src/lib/trusted-slice-integration.mjs",
      artifact_class: DURABLE_STORE_ARTIFACT_CLASSES.AUTHORITATIVE_PAYLOAD,
      compatibility: DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,
      authority: "replaceable_by_atomic_rename",
      legacy_lock_shape: null,

      production_writer:
        "persistCorrectiveIntegrationState (module-private); state built by appendCorrectiveIntegrationHop + createIntegratedCorrectiveRemainingScopeTransition and closed by readTrustedCorrectiveIntegrationState",
      async produce({ workspaceDir }) {
        const subject = `${BASELINE_CORRECTIVE_RECORD_ID}#${BASELINE_CORRECTIVE_SLICE_ID}`;
        const generation = `sha256:${"1".repeat(64)}`;
        const oid = (character) => character.repeat(40);
        const firstIntegration = {
          previous_wk_sha: oid("1"),
          slice_ref:
            `refs/heads/slice/${BASELINE_INITIATIVE}/${BASELINE_CORRECTIVE_RECORD_ID}/` +
            `${BASELINE_CORRECTIVE_SLICE_ID}`,
          delivery_sha: oid("2"),
          slice_sha: oid("3"),
          wk_sha: oid("3")
        };
        const first = appendCorrectiveIntegrationHop({
          priorState: null,
          subject,
          generation,
          integration: firstIntegration
        });
        assert.equal(first.hop.index, 0);
        assert.equal(first.chain.hops.length, 1);

        const correctiveRecordPath = path.join(
          workspaceDir,
          "wiki",
          "work-records",
          `${BASELINE_CORRECTIVE_RECORD_ID}.json`
        );
        const buildTransition = (transitionSubject) =>
          createIntegratedCorrectiveRemainingScopeTransition({
            mainRepo: workspaceDir,
            subject: transitionSubject,
            controlledContractGeneration: generation,
            integrationChain: first.chain,
            integrationHop: first.hop,
            priorTransition: null
          });

        assert.equal(
          existsSync(correctiveRecordPath),
          false,
          "the corrective record is genuinely absent before this leg runs"
        );
        assert.equal(
          buildTransition(subject),
          null,
          "with no canonical record on disk there is nothing to subtract and the prior transition stands"
        );

        const publishedCorrective = await writeValidatedWorkRecord({
          dir: workspaceDir,
          record: structuredClone(BASELINE_CORRECTIVE_WORK_RECORD_FIXTURE)
        });
        assert.equal(
          publishedCorrective.valid,
          true,
          "the corrective fixture record validates through the production validator"
        );
        assert.equal(publishedCorrective.written, true);
        assert.equal(existsSync(correctiveRecordPath), true);

        const transition = buildTransition(subject);
        assert.notEqual(
          transition,
          null,
          "publishing the canonical record is the only change between legs one and two, so a builder that ignored the record could not produce a transition here"
        );
        assert.equal(transition.subject, subject);
        assert.equal(transition.controlled_contract_generation, generation);
        assert.deepEqual(
          transition.before.map((entry) => entry.correction_id),
          [BASELINE_DELIVERED_CORRECTION_ID, BASELINE_REMAINING_CORRECTION_ID],
          "the before population is the published record's own authored population, in its authored order"
        );
        assert.deepEqual(
          transition.delivered_ids,
          [BASELINE_DELIVERED_CORRECTION_ID],
          "the delivered IDs are the published slice's own current_correction_ids"
        );
        assert.deepEqual(
          transition.after.map((entry) => entry.correction_id),
          [BASELINE_REMAINING_CORRECTION_ID],
          "the remainder is exactly the authored correction this slice did not deliver"
        );

        assert.equal(transition.predecessor_wk_tip, first.hop.pre_wk_tip);
        assert.equal(transition.integration_hop_digest, first.hop.hop_digest);
        validateCorrectiveRemainingScopeTransition(transition, {
          subject,
          controlledContractGeneration: generation,
          integrationChain: first.chain
        });

        const unauthoredSubject = `${BASELINE_WORK_RECORD_FIXTURE.id}#SLICE-001`;
        assert.equal(
          existsSync(
            path.join(workspaceDir, "wiki", "work-records", `${BASELINE_WORK_RECORD_FIXTURE.id}.json`)
          ),
          true,
          "the store above already published this record, so leg three is a present-record case"
        );
        assert.equal(
          buildTransition(unauthoredSubject),
          null,
          "a published record that authors no corrective population still carries no transition"
        );

        const state = {
          schema_version: "corrective-integration-state.v1",
          chain: first.chain,
          remaining_scope_transition: transition
        };
        const contents = `${JSON.stringify(state)}\n`;
        const filePath = path.join(
          workspaceDir,
          ".agent-launch",
          "durable-state",
          "v1",
          "corrective-integration-chains",
          `${createHash("sha256").update(subject).digest("hex")}.json`
        );
        mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
        const temporary = `${filePath}.${process.pid}.tmp`;
        writeFileSync(temporary, contents, { mode: 0o600 });
        renameSync(temporary, filePath);
        assert.equal(modeOf(filePath), 0o600);

        const read = readTrustedCorrectiveIntegrationState({ mainRepo: workspaceDir, subject });
        assert.deepEqual(read, state, "the production reader resolves the chain at exactly this derived path");
        assert.equal(
          readTrustedCorrectiveIntegrationState({
            mainRepo: workspaceDir,
            subject: `${BASELINE_CORRECTIVE_RECORD_ID}#SLICE-002`
          }),
          null,
          "the subject digest, not a shared blob, keys the chain state"
        );

        validateCorrectiveIntegrationChain(read.chain, {
          subject,
          controlledContractGeneration: generation,
          currentWkTip: firstIntegration.wk_sha
        });

        const second = appendCorrectiveIntegrationHop({
          priorState: read,
          subject,
          generation,
          integration: {
            previous_wk_sha: firstIntegration.wk_sha,
            slice_ref: firstIntegration.slice_ref,
            delivery_sha: oid("4"),
            slice_sha: oid("5"),
            wk_sha: oid("5")
          }
        });
        assert.deepEqual(second.chain.hops.map((hop) => hop.index), [0, 1]);
        assert.equal(
          second.chain.original_reviewed_delivery,
          firstIntegration.delivery_sha,
          "later hops stay rooted in the original reviewed delivery"
        );

        return {
          relative_path: relative(workspaceDir, filePath),
          filename_derivation:
            "<sha256(subject)>.json under .agent-launch/durable-state/v1/corrective-integration-chains",
          mode: 0o600,
          serialized_bytes: serializedBytes(contents),
          append_ordering: Object.freeze([0, 1]),
          read_result: Object.freeze({
            reader: "readTrustedCorrectiveIntegrationState",
            hops: read.chain.hops.length,
            validator: "validateCorrectiveIntegrationChain",

            remaining_scope_transition: Object.freeze({
              delivered_ids: Object.freeze([...transition.delivered_ids]),
              remaining_ids: Object.freeze(transition.after.map((entry) => entry.correction_id)),
              validator: "validateCorrectiveRemainingScopeTransition",
              canonical_record_dependency: "absent_record_yields_no_transition"
            })
          })
        };
      }
    })
  ]);
}

export const IN_SCOPE_DURABLE_STORE_IDS = Object.freeze([
  "launcher-durable-state-root",
  "exact-slice-review-receipt-journal",
  "exact-slice-review-receipt-store-lock",
  "managed-run-process-identity",
  "managed-run-subject-reservation",
  "worktree-identity-binding",
  "worktree-provision-lock",
  "worktree-reaper-audit",
  "wk-terminal-disposition-proof",
  "canonical-work-record",
  "canonical-work-record-write-lock",
  "corrective-integration-chain"
]);

export const WK_2358_DURABLE_STORE_IDS = Object.freeze([
  "managed-worker-attempt-journal",
  "managed-worker-attempt-partition-lock",
  "launcher-supervisor-termination"
]);

export const CENSUS_DURABLE_STORE_IDS = Object.freeze([
  ...IN_SCOPE_DURABLE_STORE_IDS,
  ...WK_2358_DURABLE_STORE_IDS
]);

export async function captureDurableStoreBaseline({ workspaceDir }) {
  const observations = [];
  const byId = new Map();
  let durableRoot = null;
  for (const descriptor of buildDurableStoreBaselineCorpus()) {
    const produced = await descriptor.produce({ workspaceDir, durableRoot, priorObservations: byId });
    if (produced.durable_root) durableRoot = produced.durable_root;
    const observation = Object.freeze({
      store_id: descriptor.store_id,
      owner_module: descriptor.owner_module,
      artifact_class: descriptor.artifact_class,
      compatibility: descriptor.compatibility,
      authority: descriptor.authority,
      legacy_lock_shape: descriptor.legacy_lock_shape,
      production_writer: descriptor.production_writer,
      relative_path: produced.relative_path,
      filename_derivation: produced.filename_derivation,
      mode: produced.mode,
      serialized_bytes: produced.serialized_bytes,
      append_ordering: produced.append_ordering,
      read_result: produced.read_result,

      artifacts: produced.artifacts ?? Object.freeze([Object.freeze({
        artifact_id: descriptor.store_id,
        relative_path: produced.relative_path,
        mode: produced.mode,
        serialized_bytes: produced.serialized_bytes,
        authority: descriptor.authority,
        append_ordering: produced.append_ordering,
        read_result: produced.read_result
      })]),
      work_record_store_dir: produced.work_record_store_dir
    });
    byId.set(descriptor.store_id, observation);
    observations.push(observation);
  }
  return Object.freeze({
    schema_version: DURABLE_STORE_BASELINE_SCHEMA_VERSION,
    captured_against: "pre_migration",
    observations: Object.freeze(observations)
  });
}

const cleanups = [];

test("the pre-migration durable-store differential baseline is executable end to end", async (t) => {
  t.after(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });
  const workspaceDir = createWorkspace(cleanups);
  const baseline = await captureDurableStoreBaseline({ workspaceDir });

  assert.equal(baseline.schema_version, DURABLE_STORE_BASELINE_SCHEMA_VERSION);
  assert.equal(baseline.captured_against, "pre_migration");
  assert.deepEqual(
    baseline.observations.map((entry) => entry.store_id),
    IN_SCOPE_DURABLE_STORE_IDS,
    "the corpus covers exactly the in-scope durable-store census, in a stable order"
  );

  for (const entry of baseline.observations) {
    if (entry.store_id === "canonical-work-record" || entry.store_id === "canonical-work-record-write-lock") {
      assert.ok(entry.relative_path.startsWith("wiki/"), `${entry.store_id} lives under wiki/`);
      continue;
    }
    assert.ok(
      entry.relative_path.startsWith(".agent-launch/"),
      `${entry.store_id} lives beneath the launcher-owned .agent-launch root`
    );
  }

  await t.test("every observation records every field the parent acceptance contract requires", () => {
    for (const entry of baseline.observations) {
      for (const field of DURABLE_STORE_BASELINE_REQUIRED_FIELDS) {
        assert.ok(
          Object.hasOwn(entry, field),
          `${entry.store_id} must record ${field}; a missing field is a gap, not a default`
        );
      }
      assert.ok(entry.relative_path.length > 0, `${entry.store_id} must record its exact relative path`);
      assert.ok(
        entry.filename_derivation.length > 0,
        `${entry.store_id} must record how its filename is derived`
      );
      assert.ok(entry.authority.length > 0, `${entry.store_id} must record its authority`);
      if (entry.serialized_bytes !== null) {
        assert.equal(entry.serialized_bytes.encoding, "utf8");
        assert.ok(entry.serialized_bytes.byte_length > 0);
        assert.match(entry.serialized_bytes.sha256, /^sha256:[0-9a-f]{64}$/u);
      }
      assert.ok(entry.artifacts.length > 0, `${entry.store_id} must record at least one artifact`);
      for (const artifact of entry.artifacts) {
        for (const field of DURABLE_STORE_ARTIFACT_REQUIRED_FIELDS) {
          assert.ok(
            Object.hasOwn(artifact, field),
            `${entry.store_id}/${artifact.artifact_id} must record ${field}`
          );
        }
        assert.ok(artifact.relative_path.length > 0);
        if (artifact.serialized_bytes !== null) {
          assert.match(artifact.serialized_bytes.sha256, /^sha256:[0-9a-f]{64}$/u);
        }
      }
    }

    const journal = baseline.observations.find(
      (entry) => entry.store_id === "exact-slice-review-receipt-journal"
    );
    assert.deepEqual(
      journal.artifacts.map((artifact) => artifact.artifact_id).sort(),
      [
        "layout-marker",
        "partition-event:0000000000000001",
        "partition-event:0000000000000002",
        "reviewer-attempt-retirement",
        "selector-index",
        "terminal-run-result",
        "terminal-settlement-conflict"
      ],
      "every authoritative receipt-journal artifact is frozen, not just the selector index"
    );
  });
});

test("the baseline distinguishes authoritative payload compatibility from authorized lock migration", () => {
  const corpus = buildDurableStoreBaselineCorpus();
  const classes = new Set(Object.values(DURABLE_STORE_ARTIFACT_CLASSES));
  const lockShapes = new Set();

  for (const entry of corpus) {
    assert.ok(
      classes.has(entry.artifact_class),
      `${entry.store_id} must carry one of the closed artifact classes`
    );

    if (entry.artifact_class === DURABLE_STORE_ARTIFACT_CLASSES.LOCK_ARTIFACT) {

      assert.equal(
        entry.compatibility,
        DURABLE_STORE_COMPATIBILITY.LOCK_MIGRATION_AUTHORIZED,
        `${entry.store_id} is a lock artifact and takes the migration limb`
      );
      assert.equal(
        typeof entry.legacy_lock_shape,
        "string",
        `${entry.store_id} must name its exact legacy lock shape so the migration can recognize it`
      );
      lockShapes.add(entry.legacy_lock_shape);
      continue;
    }

    assert.equal(
      entry.compatibility,
      DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,
      `${entry.store_id} is not a lock artifact and must be preserved, not migrated`
    );
    assert.equal(
      entry.legacy_lock_shape,
      null,
      `${entry.store_id} must not claim a lock-artifact migration allowance`
    );
  }

  assert.deepEqual(
    [...lockShapes].sort(),
    [
      "directory_with_owner_record_file",
      "ownerless_directory",
      "regular_file_with_pid_and_wall_clock_metadata"
    ],
    "every distinct legacy lock shape in scope is characterized exactly once"
  );

  for (const entry of corpus) {
    assert.ok(
      typeof entry.production_writer === "string" || entry.production_writer === null,
      `${entry.store_id} must record its production writer or state that it has none`
    );
  }
  assert.deepEqual(
    corpus.filter((entry) => entry.production_writer === null).map((entry) => entry.store_id),
    ["wk-terminal-disposition-proof"],
    "exactly one in-scope store has no in-tree production writer, and it is named"
  );
});

const CENSUS_CLASSIFICATIONS = Object.freeze({
  DURABLE: "durable_authoritative",
  NON_AUTHORITATIVE: "non_authoritative_runtime_or_config",
  UNRESOLVED: "unresolved_authoritative_writer"
});

const A = "packages/agent-launch-cli/src/lib";
const B = "packages/agent-launch-core/src/lib";
const C = "packages/wiki-core/src/operations/work-records-store-io.mjs";
export const EXPECTED_CENSUS_WRITER_IDENTITIES = Object.freeze([
  `${A}/managed-run-process-identity-store.mjs#discardManagedRunProcessIdentity`,
  `${A}/managed-run-process-identity-store.mjs#replaceAtomically`,
  `${A}/managed-run-process-identity-store.mjs#writeExclusive`,
  `${A}/managed-run-subject-reservation.mjs#acquireManagedRunSubjectReservation`,
  `${A}/managed-run-subject-reservation.mjs#releaseManagedRunSubjectReservation`,
  `${A}/managed-run-subject-reservation.mjs#releaseSuccessorGuard`,
  `${A}/managed-run-subject-reservation.mjs#reserveSuccessorForProvenDeadNoDeliverySet`,
  `${A}/trusted-slice-integration.mjs#persistCorrectiveIntegrationState`,
  `${A}/workspace-agent-dispatch-run-receipt-selector-journal.mjs#appendSelectorIndexEntries`,
  `${A}/workspace-agent-dispatch-run-receipt-selector-journal.mjs#ensurePartitionDirectory`,
  `${A}/workspace-agent-dispatch-run-receipt-store-io.mjs#acquireStoreLock`,
  `${A}/workspace-agent-dispatch-run-receipt-store-io.mjs#syncDirectory`,
  `${A}/workspace-agent-dispatch-run-receipt-store-io.mjs#writeAtomicPublished`,
  `${A}/workspace-agent-dispatch-run-receipt-store.mjs#ensureEvidenceDirectory`,
  `${A}/workspace-agent-dispatch-run-receipt-store.mjs#receiptDirectory`,
  `${A}/workspace-agent-dispatch-run-receipt-store.mjs#withAttemptLaunchExclusion`,
  `${A}/worktree-provisioning-dispatch-managed.mjs#defaultAcquireWkProvisioningLock`,
  `${A}/worktree-provisioning-dispatch-managed.mjs#rebindWkTip`,
  `${A}/worktree-provisioning-dispatch-managed.mjs#removeBindingFile`,
  `${A}/worktree-reaper-wk-terminal-proof.mjs#wkTerminalDispositionProofPath`,
  `${A}/worktree-reaper.mjs#defaultWriteAudit`,
  `${A}/worktree-substrate-identity.mjs#defaultWriteBindingFile`,
  `${B}/config.mjs#ensureLauncherConfigDir`,
  `${B}/config.mjs#ensureTokenKey`,
  `${B}/durable-runtime-state.mjs#ensureLauncherOwnedWorkspaceDurableStateRoot`,
  `${B}/filesystem.mjs#writeAtomic`,
  `${B}/launcher-context-mint.mjs#ensureLauncherRoleGuardSecret`,
  `${B}/launcher-context-mint.mjs#ensureWorkerFamilyTrustedLauncherRoleGuardSecret`,
  `${B}/registry.mjs#initializeDefaultRegistry`,
  `${C}#breakStaleWorkRecordWriteLock`,
  `${C}#cleanupRecordOwnedAdmissionArtifacts`,
  `${C}#withWorkRecordWriteLock`,
  `${C}#writeJsonFileToTemp`,
  `${C}#writeValidatedWorkRecord`,
  `${C}#writeValidatedWorkRecordWithAdmissionSidecars`,

  `${A}/managed-run-attempt-supervisor.mjs#publishSupervisorTermination`,
  `${A}/managed-run-process-identity-store.mjs#publishAttemptJournalEvents`,
  `${A}/managed-run-process-identity-store.mjs#withAttemptPartitionLock`
]);

export function censusWriterIdentityViolations(census) {
  const actual = census.writers.map((writer) => writer.source_identity);
  const known = new Set(EXPECTED_CENSUS_WRITER_IDENTITIES);
  const present = new Set(actual);
  const violations = [];
  for (const identity of EXPECTED_CENSUS_WRITER_IDENTITIES) {
    if (!present.has(identity)) violations.push(`missing writer identity: ${identity}`);
  }
  for (const identity of actual) {
    if (!known.has(identity)) violations.push(`unknown writer identity: ${identity}`);
  }
  for (const identity of new Set(actual.filter((id, i) => actual.indexOf(id) !== i))) {
    violations.push(`duplicate writer identity: ${identity}`);
  }
  return violations.sort();
}

function readCanonicalWriterCensus() {
  return JSON.parse(
    readFileSync(path.join(REPO_ROOT, DURABLE_STORE_WRITER_CENSUS_ARTIFACT_REL), "utf8")
  );
}

const CENSUS_WRITER_REQUIRED_FIELDS = Object.freeze([
  "source_identity",
  "classification",
  "store_id",
  "artifact_class",
  "compatibility",
  "target",
  "operations",
  "unresolved_blocker"
]);

test("the deny-by-default durable writer census is present, closed, and complete", () => {
  const censusPath = path.join(REPO_ROOT, DURABLE_STORE_WRITER_CENSUS_ARTIFACT_REL);
  assert.equal(existsSync(censusPath), true, "the canonical writer census fixture must exist");

  let census;
  try {
    census = JSON.parse(readFileSync(censusPath, "utf8"));
  } catch (error) {
    assert.fail(`the writer census must be parseable JSON: ${error.message}`);
  }
  assert.equal(census.schema_version, "crash-durable-state-writer-census.v1");
  assert.equal(census.captured_against, "pre_migration");
  assert.ok(Array.isArray(census.writers) && census.writers.length > 0);

  const closedClassifications = new Set(Object.values(CENSUS_CLASSIFICATIONS));
  assert.deepEqual(
    [...census.classifications].sort(),
    [...closedClassifications].sort(),
    "the census declares exactly the closed classification vocabulary"
  );
  for (const writer of census.writers) {
    assert.deepEqual(
      Object.keys(writer).sort(),
      [...CENSUS_WRITER_REQUIRED_FIELDS].sort(),
      `${writer.source_identity} must carry exactly the required census fields`
    );
    assert.ok(
      closedClassifications.has(writer.classification),
      `${writer.source_identity} carries an unknown classification: ${writer.classification}`
    );
    assert.match(
      writer.source_identity,
      /^packages\/[\w.-]+\/src\/[\w./-]+\.mjs#[A-Za-z_$][\w$]*$/u,
      "a census entry is keyed by an exact <module>#<symbol> source identity"
    );
    assert.ok(Array.isArray(writer.operations) && writer.operations.length > 0);

    if (writer.classification === CENSUS_CLASSIFICATIONS.NON_AUTHORITATIVE) {

      assert.equal(writer.store_id, null, `${writer.source_identity} must not claim a durable store`);
      assert.equal(writer.artifact_class, null);
      continue;
    }

    assert.ok(
      CENSUS_DURABLE_STORE_IDS.includes(writer.store_id),
      `${writer.source_identity} names a store outside the census: ${writer.store_id}`
    );
    assert.equal(
      writer.compatibility,
      writer.artifact_class === DURABLE_STORE_ARTIFACT_CLASSES.LOCK_ARTIFACT
        ? DURABLE_STORE_COMPATIBILITY.LOCK_MIGRATION_AUTHORIZED
        : DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,
      `${writer.source_identity} must take the compatibility limb its artifact class fixes`
    );
  }

  const identities = census.writers.map((writer) => writer.source_identity);
  assert.equal(
    new Set(identities).size,
    identities.length,
    "every census source identity appears exactly once"
  );

  const covered = new Set(
    census.writers
      .filter((writer) => writer.classification !== CENSUS_CLASSIFICATIONS.NON_AUTHORITATIVE)
      .map((writer) => writer.store_id)
  );
  assert.deepEqual(
    [...covered].sort(),
    [...CENSUS_DURABLE_STORE_IDS].sort(),
    "the census covers exactly the in-scope durable stores, baseline plus replacements"
  );

  assert.deepEqual(
    censusWriterIdentityViolations(census),
    [],
    "the census carries exactly the closed set of in-scope writer identities"
  );

  const unresolved = census.writers.filter(
    (writer) => writer.classification === CENSUS_CLASSIFICATIONS.UNRESOLVED
  );
  for (const writer of unresolved) {
    assert.ok(
      typeof writer.unresolved_blocker === "string" && writer.unresolved_blocker.includes("SLICE-005"),
      `${writer.source_identity} must record its unresolved authority as a SLICE-005 blocker`
    );
  }
  assert.deepEqual(
    unresolved.map((writer) => writer.store_id),
    ["wk-terminal-disposition-proof"],
    "exactly the store with no in-tree production writer is carried as unresolved"
  );
});

test("census completeness is identity-exact, so a sibling writer cannot be dropped silently", () => {
  const census = readCanonicalWriterCensus();
  const sibling =
    "packages/agent-launch-cli/src/lib/managed-run-process-identity-store.mjs#discardManagedRunProcessIdentity";
  const store = "managed-run-process-identity";

  assert.equal(
    censusWriterIdentityViolations(census).length,
    0,
    "the unmutated census is complete before the sibling is removed"
  );

  const mutated = {
    ...census,
    writers: census.writers.filter((writer) => writer.source_identity !== sibling)
  };
  assert.equal(
    mutated.writers.length,
    census.writers.length - 1,
    "exactly one writer identity was removed"
  );

  const survivors = mutated.writers.filter((writer) => writer.store_id === store);
  assert.ok(survivors.length >= 2, "the store still has sibling writers after the removal");
  const coveredStores = new Set(
    mutated.writers
      .filter((writer) => writer.classification !== CENSUS_CLASSIFICATIONS.NON_AUTHORITATIVE)
      .map((writer) => writer.store_id)
  );
  assert.deepEqual(
    [...coveredStores].sort(),
    [...CENSUS_DURABLE_STORE_IDS].sort(),
    "a store-ID completeness check is blind to the removal, which is exactly why it is insufficient"
  );

  assert.deepEqual(
    censusWriterIdentityViolations(mutated),
    [`missing writer identity: ${sibling}`],
    "identity-exact completeness fails on the dropped sibling"
  );
});

test("the crash-durable helper reproduces authoritative payload compatibility", async (t) => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wk2357-posthelper-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const targetPath = path.join(dir, "authoritative.json");
  const priorBytes = `${JSON.stringify({ schema_version: "x.v1", generation: 1 })}\n`;
  writeFileSync(targetPath, priorBytes, { mode: 0o600 });
  const priorDigest = sha256(priorBytes);

  const nextBytes = `${JSON.stringify({ schema_version: "x.v1", generation: 2 })}\n`;
  const privatePath = path.join(dir, "authoritative.json.private");

  const failed = await runCrashDurablePlanAsync(
    planReplacement({ targetPath, privatePath, bytes: nextBytes }),
    createAsyncEffects({
      faultInjector: (fault) => {
        if (fault === CRASH_DURABLE_FAULTS.TARGET_PUBLISHED) throw new Error("injected");
      }
    })
  );
  assert.equal(failed.classification, CRASH_DURABLE_RESULTS.PRIOR_PRESERVED);
  assert.equal(sha256(readFileSync(targetPath, "utf8")), priorDigest, "prior authoritative bytes are preserved");
  assert.equal(existsSync(privatePath), false, "no private residue is left at the store's path");

  const published = await runCrashDurablePlanAsync(
    planReplacement({ targetPath, privatePath, bytes: nextBytes }),
    createAsyncEffects({})
  );
  assert.equal(published.classification, CRASH_DURABLE_RESULTS.PUBLISHED);
  assert.equal(readFileSync(targetPath, "utf8"), nextBytes, "the published bytes are exactly the caller's bytes");
  assert.equal(relative(dir, targetPath), "authoritative.json", "the authoritative path is unchanged");
  assert.equal(modeOf(targetPath), 0o600, "the caller-owned mode is preserved");
  assert.deepEqual(readdirSync(dir), ["authoritative.json"], "publication leaves no extra artifact in the store directory");

  assert.notEqual(
    DURABLE_STORE_COMPATIBILITY.PAYLOAD_PRESERVED,
    DURABLE_STORE_COMPATIBILITY.LOCK_MIGRATION_AUTHORIZED
  );
});
