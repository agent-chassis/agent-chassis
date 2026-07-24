

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createWorkspaceAgentDispatchBackend } from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import { runPostWorkerSliceLifecycle } from "../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle.mjs";
import {
  createLifecycleCheckpoint,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES
} from "../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-bindings.mjs";

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

const CANONICAL_ROLE_CONFIG =
  '[roles.worker]\nmodel = "gpt-5-codex"\n' +
  '[roles.reviewer]\nmodel = "gpt-5-codex"\n' +
  '[roles.redteam]\nmodel = "gpt-5-codex"\n';

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
      why_it_matters: "Exercises the A2a inversion through the registered public routes.",
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

async function createPublicSeamFixture(t, { overrideProvisioning = null } = {}) {
  const mainRepo = await mkdtemp(path.join(os.tmpdir(), "slice-seam-main-"));
  const sliceWorktree = await mkdtemp(path.join(os.tmpdir(), "slice-seam-worktree-"));
  const wkWorktree = await mkdtemp(path.join(os.tmpdir(), "slice-seam-wk-"));
  t.after(() => rm(mainRepo, { recursive: true, force: true }));
  t.after(() => rm(sliceWorktree, { recursive: true, force: true }));
  t.after(() => rm(wkWorktree, { recursive: true, force: true }));

  await mkdir(path.join(mainRepo, "wiki", "work-records"), { recursive: true });
  await mkdir(path.join(mainRepo, "docs"), { recursive: true });
  await writeFile(path.join(mainRepo, "agent-launch.toml"), CANONICAL_ROLE_CONFIG, "utf8");
  await writeFile(
    path.join(mainRepo, "wiki", "work-records", `${RECORD_ID}.json`),
    JSON.stringify(sliceReviewRecord(), null, 2),
    "utf8"
  );

  const provisioning = overrideProvisioning ?? Object.freeze({
    record_id: RECORD_ID,
    slice_id: IMPL_SLICE,
    slice_binding: Object.freeze({
      unit_address: `${INITIATIVE}/${RECORD_ID}/${IMPL_SLICE}`,
      output_branch: SLICE_REF,
      worktree_path: sliceWorktree,
      base_sha: DIFF_BASE_SHA,
      retry_id: 0
    }),
    wk_binding: Object.freeze({
      unit_address: `${INITIATIVE}/${RECORD_ID}`,
      output_branch: WK_REF,
      worktree_path: wkWorktree,
      base_sha: DIFF_BASE_SHA
    }),
    validation_worktree_path: wkWorktree
  });

  const integrationCalls = [];
  const statusWrites = [];
  const executorInputs = [];

  const checkpointByRun = new Map();

  const integrationResult = Object.freeze({
    schema_version: "slice-integration.v1",
    integrated: true,
    rebased: false,
    previous_wk_sha: DIFF_BASE_SHA,
    slice_ref: SLICE_REF,
    slice_sha: REVIEWED_SHA,
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
    hostSliceReviewPreparationAdapter: async (input) => ({
      accepted: true,
      preparation: {
        ...input,
        worktree_path: provisioning.slice_binding.worktree_path,
        slice_ref: SLICE_REF,
        base_sha: DIFF_BASE_SHA,
        reviewed_sha: REVIEWED_SHA,
        reviewed_tree: REVIEWED_SHA
      }
    }),
    hostSliceIntegrationAdapter: async (input) => {
      integrationCalls.push(input);
      return { accepted: true, integration: { ...integrationResult, tuple: input } };
    },
    setWorkRecordStatusByUnit: ({ unitAddress, status }) => {
      statusWrites.push({ unitAddress, status });
      return applyStatusToRecord(mainRepo, unitAddress, status);
    }
  };

  const backend = createWorkspaceAgentDispatchBackend({
    __testHooks: true,
    launchExecutor: async (input) => {
      executorInputs.push(input);
      return { accepted: true, status: "running", probe: async () => ({ status: "running" }) };
    },
    worktreeProvisioning: { mainRepo, worktreeRoot: path.join(mainRepo, ".worktrees") },
    reviewContextRunGit: ({ args }) => {
      const rev = String(args[args.length - 1] ?? "");
      if (rev.startsWith(DIFF_BASE_SHA)) return { ok: true, stdout: DIFF_BASE_SHA };
      return { ok: true, stdout: REVIEWED_SHA };
    },

    postWorkerSliceLifecycle: ({ workspace, status, deps }) => runPostWorkerSliceLifecycle({
      workspace,
      status,
      deps: { ...environmentDeps, ...deps, resolveManagedRunBinding: () => provisioning }
    })
  });

  return {
    backend,
    mainRepo,
    sliceWorktree,
    integrationCalls,
    statusWrites,
    executorInputs,
    integrationResult,
    readRecord: async () => JSON.parse(
      await readFile(path.join(mainRepo, "wiki", "work-records", `${RECORD_ID}.json`), "utf8")
    ),
    runLifecycle: () => pollLifecycle(backend, mainRepo, checkpointByRun),
    launchSliceReviewer: () => backend.startLaunch({
      caller_session_id: "slice_reviewer_session",
      role: "reviewer",
      subject: SUBJECT,
      workspace_alias: "test",
      workspace_dir: mainRepo,
      app: "codex"
    })
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
  const result = await backend.runPostWorkerSliceLifecycle({
    workspace: { repo: "agent-chassis", dir: mainRepo },
    status: statusWithCheckpoint
  });
  if (checkpoint.phase === POST_WORKER_LIFECYCLE_PHASES.PRE_INTEGRATION) {
    checkpoint.integration = result?.integration ?? null;
    checkpoint.finalized = result;
    checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.FINALIZED;
  }
  return result;
}

function applyStatusToRecord(mainRepo, unitAddress, status) {
  const file = path.join(mainRepo, "wiki", "work-records", `${RECORD_ID}.json`);
  const record = JSON.parse(readFileSync(file, "utf8"));
  const [wkId, sliceId] = String(unitAddress).split("#");
  if (wkId !== RECORD_ID) throw new Error(`unexpected status write target ${unitAddress}`);
  if (sliceId === undefined) {
    record.status = status;
  } else {
    const slice = record.slices.find((entry) => entry?.id === sliceId);
    if (!slice) throw new Error(`unknown slice ${unitAddress}`);
    slice.status = status;
  }
  writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
  return { valid: true, written: true };
}

test("A2a public seam: the PRODUCTION binder derives the slice worktree from slice_binding.worktree_path and parks with ZERO integration", async (t) => {
  const fixture = await createPublicSeamFixture(t);

  const parked = await fixture.runLifecycle();

  assert.equal(parked.phase, "awaiting-slice-review");
  assert.equal(parked.integrated, false);
  assert.equal(parked.integration, null);
  assert.equal(fixture.integrationCalls.length, 0, "ZERO integration through the public route");

  assert.equal(parked.slice_review.slice_worktree_path, fixture.sliceWorktree);
  assert.equal(parked.reviewer_dispatch.context.workspace_dir, fixture.sliceWorktree);
  assert.equal(parked.reviewer_dispatch.context.slice_level_review, true);
  assert.equal(
    parked.reviewer_dispatch.context.review_context_schema_version,
    "workspace-agent-frozen-slice-review-context.v1",
    "the context came from the production binder, not a stub"
  );
  assert.equal(parked.reviewer_dispatch.args.subject, SUBJECT);

  assert.deepEqual(fixture.statusWrites, [{ unitAddress: SUBJECT, status: "review" }]);
  const record = await fixture.readRecord();
  assert.equal(record.slices.find((slice) => slice.id === IMPL_SLICE).status, "review");
  assert.equal(record.status, "active", "the parent WK is never transitioned by a slice-level review");
  assert.equal(parked.wk_transitioned_to_review, false);
});

test("A2a public seam: accepted review unlocks only the closed trusted integration tuple", async (t) => {
  const fixture = await createPublicSeamFixture(t);

  const parked = await fixture.runLifecycle();
  assert.equal(parked.phase, "awaiting-slice-review");
  assert.equal(fixture.integrationCalls.length, 0);

  const launch = await fixture.launchSliceReviewer();
  assert.equal(launch.accepted, true,
    `slice reviewer must launch; got ${JSON.stringify(launch.refusal ?? null)}`);

  assert.equal(fixture.executorInputs.length, 1);
  assert.equal(fixture.executorInputs[0].workspace_dir, fixture.sliceWorktree);
  assert.equal(fixture.executorInputs[0].config_root_dir, fixture.mainRepo);

  const finalized = await fixture.runLifecycle();
  assert.equal(finalized.integrated, true);
  assert.equal(fixture.integrationCalls.length, 1, "exactly one integration");

  assert.deepEqual(fixture.integrationCalls[0], {
    assigned_unit: SUBJECT,
    launch_ref: WORKER_MONITOR_HANDLE,
    run_id: WORKER_RUN_ID,
    retry_id: 0
  });
  assert.equal(Object.hasOwn(fixture.integrationCalls[0], "sliceReviewAcceptance"), false);
  assert.equal(Object.hasOwn(fixture.integrationCalls[0], "review_run_id"), false);
});

test("A2a public seam: an explicit slice_worktree_path that disagrees with slice_binding.worktree_path fails the unchanged equality check", async (t) => {
  const sliceWorktree = await mkdtemp(path.join(os.tmpdir(), "slice-seam-real-"));
  const wkWorktree = await mkdtemp(path.join(os.tmpdir(), "slice-seam-wk-mismatch-"));
  t.after(() => rm(sliceWorktree, { recursive: true, force: true }));
  t.after(() => rm(wkWorktree, { recursive: true, force: true }));

  const fixture = await createPublicSeamFixture(t, {
    overrideProvisioning: Object.freeze({
      record_id: RECORD_ID,
      slice_id: IMPL_SLICE,
      slice_worktree_path: "/tmp/some-other-slice-worktree",
      slice_binding: Object.freeze({
        unit_address: `${INITIATIVE}/${RECORD_ID}/${IMPL_SLICE}`,
        output_branch: SLICE_REF,
        worktree_path: sliceWorktree,
        base_sha: DIFF_BASE_SHA,
        retry_id: 0
      }),
      wk_binding: Object.freeze({
        unit_address: `${INITIATIVE}/${RECORD_ID}`,
        output_branch: WK_REF,
        worktree_path: wkWorktree,
        base_sha: DIFF_BASE_SHA
      }),
      validation_worktree_path: wkWorktree
    })
  });

  await assert.rejects(
    fixture.runLifecycle(),
    /backend-owned frozen slice review context does not match managed provisioning and canonical slice-review identity/
  );
  assert.equal(fixture.integrationCalls.length, 0, "a mismatched worktree integrates ZERO times");

  await fixture.launchSliceReviewer();
  for (const input of fixture.executorInputs) {
    assert.notEqual(input.workspace_dir, "/tmp/some-other-slice-worktree");
    assert.notEqual(input.workspace_dir, fixture.sliceWorktree);
  }
});
