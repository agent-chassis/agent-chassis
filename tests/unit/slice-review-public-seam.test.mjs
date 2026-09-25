

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createWorkspaceAgentDispatchBackend } from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import { runPostWorkerSliceLifecycle } from "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle.mjs";
import { sliceLifecycleProvisioning } from "../helpers/slice-lifecycle-projection-fixture.mjs";
import {
  createLifecycleCheckpoint,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES
} from "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-bindings.mjs";
import {
  RETIRED_POST_WORKER_REVIEW_SEAMS
} from "../../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";

const RECORD_ID = "WK-9955";
const IMPL_SLICE = "SLICE-001";
const REVIEW_SLICE = "SLICE-099";
const INITIATIVE = "IN-0021";
const SUBJECT = `${RECORD_ID}#${IMPL_SLICE}`;
const SLICE_REF = `refs/heads/slice/${INITIATIVE}/${RECORD_ID}/${IMPL_SLICE}`;
const WK_REF = `refs/heads/wk/${INITIATIVE}/${RECORD_ID}`;
const REVIEWED_SHA = "c".repeat(40);
const DIFF_BASE_SHA = "d".repeat(40);
const WORKER_RUN_ID = "slice_worker_run";
const WORKER_MONITOR_HANDLE = "wkmh_slice_worker";

function sliceReviewRecord() {
  return {
    schema_version: "work-record.v1",
    id: RECORD_ID,
    repo: "agent-chassis/agent-chassis",
    title: "Slice-level review public-seam canary",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "active",
    priority: "high",
    owner: "codex",
    created: "2026-07-19",
    updated: "2026-07-19",
    initiative: INITIATIVE,
    docs: ["docs/work-record-schema.md"],
    repo_paths: ["tests/fixtures/slice-review-canary.txt"],
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
      criteria: ["Parent WK: the slice-level review canary is delivered end to end."],
      validation: ["Parent WK: workspace_work_record_validate returns valid=true."]
    },
    sections: {
      summary: "Slice-level review public-seam canary parent record.",
      why_it_matters: "Exercises the post-worker lifecycle through the registered public routes.",
      scope: { items: ["slice review canary"], out_of_scope: ["product promotion"] },
      tasks: [],
      references: ["docs/work-record-schema.md"],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [
      {
        id: IMPL_SLICE,
        title: "Implementation slice",
        work_kind: "implementation",
        status: "in_progress",
        write_scope: ["tests/fixtures/slice-review-canary.txt"],
        repo_paths: ["tests/fixtures/slice-review-canary.txt"],
        docs: ["docs/work-record-schema.md"],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        },
        depends_on: [],
        acceptance: {
          criteria: ["Slice: create the canary fixture."],
          validation: ["Slice: node --test"]
        }
      },
      {
        id: REVIEW_SLICE,
        title: "Findings-only whole-WK review",
        work_kind: "review",
        review_purpose: "terminal_whole_wk",
        status: "todo",
        write_scope: [],
        repo_paths: ["tests/fixtures/slice-review-canary.txt"],
        docs: ["docs/work-record-schema.md"],
        dispatch_intent: {
          intended_agent_role: "reviewer",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        },
        depends_on: [],
        acceptance: {
          criteria: ["Perform findings-only review of the frozen whole-WK context."],
          validation: ["Reviewer records findings-only result evidence."]
        }
      }
    ],
    escalations: [],
    projections: [],
    migration: null
  };
}

const WORKER_STATUS = Object.freeze({
  accepted: true,
  run_id: WORKER_RUN_ID,
  monitor_handle: WORKER_MONITOR_HANDLE,
  role: "worker",
  subject: SUBJECT,
  status: "succeeded",
  terminal: true
});

const BACKEND_LIFECYCLE_DEPS = Object.freeze([
  "resolveCommittedSliceIntegrationContinuation",
  "resolveManagedRunBinding",
  "resolveManagedWorkerProvenDeath",
  "retireManagedWorkerIdentity"
]);

const RETIRED_BACKEND_REVIEW_DEPS = Object.freeze([
  ...RETIRED_POST_WORKER_REVIEW_SEAMS,
  "resolveSliceReviewAcceptanceBinding",

  "resolveDeclaredTerminalReviewUnit",
  "authenticateTerminalCandidatePreparation",
  "terminalReviewEvidenceMode",
  "reviewEnforcementMode"
]);

async function createPublicSeamFixture(t) {
  const mainRepo = await mkdtemp(path.join(os.tmpdir(), "slice-seam-main-"));
  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "slice-seam-worktrees-"));
  const sliceWorktree = path.join(worktreeRoot, `slice-${INITIATIVE}-${RECORD_ID}-${IMPL_SLICE}`);
  await mkdir(sliceWorktree);
  const wkWorktree = await mkdtemp(path.join(os.tmpdir(), "slice-seam-wk-"));
  t.after(() => rm(mainRepo, { recursive: true, force: true }));
  t.after(() => rm(worktreeRoot, { recursive: true, force: true }));
  t.after(() => rm(wkWorktree, { recursive: true, force: true }));

  const record = sliceReviewRecord();
  const recordFile = path.join(mainRepo, "wiki", "work-records", `${RECORD_ID}.json`);
  await mkdir(path.dirname(recordFile), { recursive: true });
  await mkdir(path.join(mainRepo, "docs"), { recursive: true });
  const recordBytes = JSON.stringify(record, null, 2);
  await writeFile(recordFile, recordBytes, "utf8");

  const provisioning = sliceLifecycleProvisioning({
    initiative: INITIATIVE,
    recordId: RECORD_ID,
    sliceId: IMPL_SLICE,
    sliceRef: SLICE_REF,
    baseSha: DIFF_BASE_SHA,
    sliceWorktree,
    wkWorktree,
    dispatchTuple: Object.freeze({
      assigned_unit: SUBJECT,
      launch_ref: WORKER_MONITOR_HANDLE,
      run_id: WORKER_RUN_ID,
      retry_id: 0
    })
  });

  const integrationCalls = [];
  const retiredSeamCalls = [];
  const composedDeps = [];
  const checkpointByRun = new Map();

  const integrationResult = Object.freeze({
    schema_version: "slice-integration.v1",
    integrated: true,
    rebased: false,
    previous_wk_sha: DIFF_BASE_SHA,
    slice_ref: SLICE_REF,
    slice_sha: REVIEWED_SHA,
    delivery_sha: REVIEWED_SHA,
    wk_ref: WK_REF,
    wk_sha: REVIEWED_SHA,
    review_target: null,
    transition: Object.freeze({ valid: true, written: true })
  });

  const environmentDeps = {
    runGit: ({ args }) => {
      if (args[0] === "rev-parse") return { ok: true, stdout: `${REVIEWED_SHA}\n` };
      return { ok: false, status: 128, stderr: `unexpected git call: ${args.join(" ")}` };
    },

    reconcileIntegratedSliceRecord: () => null,
    hostSliceIntegrationAdapter: async (input) => {
      integrationCalls.push(input);
      return { accepted: true, integration: { ...integrationResult, tuple: input } };
    },
    ...Object.fromEntries(RETIRED_BACKEND_REVIEW_DEPS.map((name) => [name, (...args) => {
      retiredSeamCalls.push({ name, args });
      throw new Error(`retired review seam ${name} was called`);
    }]))
  };

  const backend = createWorkspaceAgentDispatchBackend({
    __testHooks: true,
    launchExecutor: async () => ({
      accepted: true, status: "running", probe: async () => ({ status: "running" })
    }),
    worktreeProvisioning: { mainRepo, worktreeRoot },

    postWorkerSliceLifecycle: ({ workspace, status, deps }) => {
      composedDeps.push(deps);
      return runPostWorkerSliceLifecycle({
        workspace,
        status,
        deps: { ...environmentDeps, ...deps, resolveManagedRunBinding: () => provisioning }
      });
    }
  });

  return {
    backend,
    mainRepo,
    recordBytes,
    integrationCalls,
    retiredSeamCalls,
    composedDeps,
    readRecordBytes: () => readFile(recordFile, "utf8"),
    runLifecycle: () => pollLifecycle(backend, mainRepo, checkpointByRun)
  };
}

async function pollLifecycle(backend, mainRepo, checkpointByRun) {
  if (!checkpointByRun.has(WORKER_RUN_ID)) {
    checkpointByRun.set(WORKER_RUN_ID, createLifecycleCheckpoint());
  }
  const checkpoint = checkpointByRun.get(WORKER_RUN_ID);
  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.FINALIZED) {
    return checkpoint.finalized;
  }
  const statusWithCheckpoint = { ...WORKER_STATUS };
  Object.defineProperty(statusWithCheckpoint, POST_WORKER_LIFECYCLE_CHECKPOINT, {
    value: checkpoint,
    enumerable: false
  });
  return backend.runPostWorkerSliceLifecycle({
    workspace: { repo: "agent-chassis", dir: mainRepo },
    status: statusWithCheckpoint
  });
}

test("public seam: the backend composes no review capability for the post-worker lifecycle", async (t) => {
  const fixture = await createPublicSeamFixture(t);
  assert.equal(typeof fixture.backend.runPostWorkerSliceLifecycle, "function");
  for (const retired of ["bindFrozenSliceReviewContext", "bindFrozenReviewContext",
    "resolveCanonicalSliceReviewUnit"]) {
    assert.equal(fixture.backend[retired], undefined, retired);
  }

  await fixture.runLifecycle();
  assert.equal(fixture.composedDeps.length, 1);
  assert.deepEqual(Object.keys(fixture.composedDeps[0]).sort(), BACKEND_LIFECYCLE_DEPS);
  for (const retired of RETIRED_BACKEND_REVIEW_DEPS) {
    assert.equal(Object.hasOwn(fixture.composedDeps[0], retired), false, retired);
  }
});

test("public seam: a committed delivery integrates directly with no review surface or status write", async (t) => {
  const fixture = await createPublicSeamFixture(t);

  const finalized = await fixture.runLifecycle();

  assert.equal(finalized.phase, POST_WORKER_LIFECYCLE_PHASES.FINALIZED);
  assert.equal(finalized.integrated, true);
  assert.equal(finalized.wk_transitioned_to_review, false);
  assert.equal(finalized.integration.slice_sha, REVIEWED_SHA);
  assert.equal(finalized.delivery_state, "delivery_finalized");
  for (const key of ["slice_review", "reviewer_dispatch", "terminal_review_materialization",
    "empty_delivery", "terminal_candidate"]) {
    assert.equal(Object.hasOwn(finalized, key), false, key);
  }

  assert.deepEqual(fixture.integrationCalls, [{
    assigned_unit: SUBJECT,
    launch_ref: WORKER_MONITOR_HANDLE,
    run_id: WORKER_RUN_ID,
    retry_id: 0
  }]);

  assert.deepEqual(fixture.retiredSeamCalls, []);
  assert.equal(await fixture.readRecordBytes(), fixture.recordBytes);

  assert.equal(await fixture.runLifecycle(), finalized);
  assert.equal(fixture.integrationCalls.length, 1);
});

test("public slice-review seam does not become a readiness authority", () => {
  const acceptance = readFileSync(
    new URL(
      "../../packages/wiki-core/src/operations/work-record-slice-review-acceptance.mjs",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(acceptance, /from "\.\.\/lib\/work-record-dispatch-readiness-shape\.mjs"/u);
  assert.doesNotMatch(acceptance, /dispatch-readiness\.v1/u);
  assert.doesNotMatch(acceptance, /DEFAULT_(GRAPH_STATE|RECOVERY)/u);
});
