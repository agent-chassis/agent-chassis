

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkspaceAgentDispatchBackend } from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  buildSliceReviewAcceptanceProof,
  computeSliceReviewStructuredResultDigest,
  SLICE_REVIEW_ACCEPTANCE_DECISION_CODES,
  SLICE_REVIEW_ACCEPTANCE_EVIDENCE_KEY,
  SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION,
  validateSliceReviewAcceptanceProof
} from "../packages/wiki-core/src/lib/work-record-slice-review-acceptance.mjs";
import {
  mintAndPersistSliceReviewAcceptanceProof,
  resolveSliceReviewAcceptanceProof
} from "../packages/wiki-core/src/operations/work-record-slice-review-acceptance.mjs";
import {
  AGENT_ROLE_RESULT_REVIEWED_CONTROLS
} from "../packages/agent-launch-core/src/lib/agent-role-result.mjs";

const RECORD_ID = "WK-9955";
const IMPL_SLICE = "SLICE-001";
const INITIATIVE = "IN-0021";
const SUBJECT = `${RECORD_ID}#${IMPL_SLICE}`;
const SLICE_REF = `refs/heads/slice/${INITIATIVE}/${RECORD_ID}/${IMPL_SLICE}`;
const REVIEWED_SHA = "c".repeat(40);
const DIFF_BASE_SHA = "d".repeat(40);
const WORKER_RUN_ID = "slice_worker_run";

const CANONICAL_ROLE_CONFIG =
  '[roles.worker]\nmodel = "gpt-5-codex"\n' +
  '[roles.reviewer]\nmodel = "gpt-5-codex"\n' +
  '[roles.redteam]\nmodel = "gpt-5-codex"\n';

const ZERO_COUNTS = Object.freeze({
  total: 0,
  blocking: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0
});

function sliceReviewRecord() {
  return {
    schema_version: "work-record.v1",
    id: RECORD_ID,
    repo: "agent-chassis/agent-chassis",
    title: "Slice-level review canary",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "active",
    priority: "high",
    owner: "codex",
    created: "2026-07-18",
    updated: "2026-07-18",
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
      summary: "Slice-level review canary parent record.",
      why_it_matters: "Exercises the slice-level pre-integration reviewer.",
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
        title: "Implementation slice under review",
        work_kind: "implementation",
        status: "review",
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
      }
    ],
    escalations: [],
    projections: [],
    migration: null
  };
}

function sliceReviewTarget() {
  return Object.freeze({
    ref: SLICE_REF,
    sha: REVIEWED_SHA,
    diff_base_sha: DIFF_BASE_SHA,
    diff_head_sha: REVIEWED_SHA,
    diff_range: `${DIFF_BASE_SHA}..${REVIEWED_SHA}`,
    slice_level_review: true
  });
}

function cleanReviewerFinalResult({ outcome = "no_findings", findings = [], counts = ZERO_COUNTS } = {}) {
  const payload = {
    schema_version: "agent-role-result.v1",
    reported_role: "reviewer",
    reported_subject: SUBJECT,
    reported_outcome: outcome,
    summary: "Slice review complete.",
    findings,
    finding_counts: counts,
    reviewed_controls: AGENT_ROLE_RESULT_REVIEWED_CONTROLS.map((control_id) => ({
      control_id,
      result: "pass"
    }))
  };
  return {
    schema_version: "workspace-agent-dispatch-final-result.v1",
    kind: outcome === "changes_requested" ? "findings" : "no_findings",
    findings: outcome === "changes_requested" ? { summary: "findings recorded" } : null,
    no_findings: outcome === "changes_requested" ? null : { reason: "clean" },
    missing_result: null,
    full_response: {
      format: "markdown",
      text: `Reviewer notes.\n\n\`\`\`agent-role-result.v1\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
      source: null
    },
    writeback: { kind: "wk_updated", detail: null }
  };
}

function proseOnlyFinalResult() {
  return {
    schema_version: "workspace-agent-dispatch-final-result.v1",
    kind: "no_findings",
    findings: null,
    no_findings: { reason: "Looks good to me. SIGNOFF." },
    missing_result: null,
    full_response: { format: "markdown", text: "Looks good to me. SIGNOFF.", source: null },
    writeback: { kind: "wk_updated", detail: null }
  };
}

async function createSliceReviewFixture(t, { finalResult = cleanReviewerFinalResult() } = {}) {
  const mainRepo = await mkdtemp(path.join(os.tmpdir(), "slice-acceptance-main-"));
  const sliceWorktree = await mkdtemp(path.join(os.tmpdir(), "slice-acceptance-worktree-"));
  t.after(() => rm(mainRepo, { recursive: true, force: true }));
  t.after(() => rm(sliceWorktree, { recursive: true, force: true }));

  await mkdir(path.join(mainRepo, "wiki", "work-records"), { recursive: true });
  await mkdir(path.join(mainRepo, "docs"), { recursive: true });
  await writeFile(path.join(mainRepo, "agent-launch.toml"), CANONICAL_ROLE_CONFIG, "utf8");
  await writeFile(
    path.join(mainRepo, "wiki", "work-records", `${RECORD_ID}.json`),
    JSON.stringify(sliceReviewRecord(), null, 2),
    "utf8"
  );

  const target = sliceReviewTarget();

  const gitState = { sha: REVIEWED_SHA };
  const backend = createWorkspaceAgentDispatchBackend({
    __testHooks: true,
    launchExecutor: async () => ({
      accepted: true,
      status: "running",
      probe: async () => ({ status: "succeeded", final_result: finalResult })
    }),
    worktreeProvisioning: { mainRepo, worktreeRoot: path.join(mainRepo, ".worktrees") },
    reviewContextRunGit: ({ args }) => {
      const rev = String(args[args.length - 1] ?? "");
      if (rev.startsWith(DIFF_BASE_SHA)) return { ok: true, stdout: DIFF_BASE_SHA };
      if (rev.startsWith(REVIEWED_SHA)) return { ok: true, stdout: REVIEWED_SHA };
      return { ok: true, stdout: gitState.sha };
    },
    postWorkerSliceLifecycle: async ({ status, deps }) => deps.bindFrozenSliceReviewContext({
      status,
      provisioning: {
        record_id: RECORD_ID,
        slice_id: IMPL_SLICE,
        slice_worktree_path: sliceWorktree,
        slice_binding: { output_branch: SLICE_REF, worktree_path: sliceWorktree }
      },
      sliceTarget: target,
      reviewUnit: deps.resolveCanonicalSliceReviewUnit({ mainRepo, subject: SUBJECT })
    })
  });

  await backend.runPostWorkerSliceLifecycle({
    workspace: { dir: mainRepo },
    status: { run_id: WORKER_RUN_ID, subject: SUBJECT }
  });

  return { backend, mainRepo, sliceWorktree, target, gitState };
}

async function launchSliceReview(backend, mainRepo) {
  const launch = await backend.startLaunch({
    caller_session_id: "slice_reviewer_session",
    role: "reviewer",
    subject: SUBJECT,
    workspace_alias: "test",
    workspace_dir: mainRepo,
    app: "codex"
  });
  assert.equal(launch.accepted, true,
    `slice reviewer must launch; got ${JSON.stringify(launch.refusal ?? null)}`);
  return launch;
}

function pollStatus(backend, launch) {
  return backend.getRunStatus({
    caller_session_id: "slice_reviewer_session",
    run_id: launch.run_id,
    monitor_handle: launch.monitor_handle,
    subject: SUBJECT
  });
}

async function runSliceReviewToTerminal(backend, mainRepo) {
  const launch = await launchSliceReview(backend, mainRepo);
  const status = await pollStatus(backend, launch);
  assert.equal(status.terminal, true);
  return { launch, status };
}

async function readPersistedProof(mainRepo) {
  const record = JSON.parse(
    await readFile(path.join(mainRepo, "wiki", "work-records", `${RECORD_ID}.json`), "utf8")
  );
  const entry = (record.derived_evidence ?? []).find(
    (candidate) => candidate?.unit?.slice_id === IMPL_SLICE
  );
  if (!entry?.sidecar_path) return { record, entry: entry ?? null, proof: null };
  const sidecar = JSON.parse(await readFile(path.join(mainRepo, entry.sidecar_path), "utf8"));
  return {
    record,
    entry,
    sidecar,
    proof: sidecar?.normalized_request?.evidence?.[SLICE_REVIEW_ACCEPTANCE_EVIDENCE_KEY] ?? null
  };
}

function expectationFor(runIds) {
  return {
    unit_address: SUBJECT,
    initiative: INITIATIVE,
    slice_ref: SLICE_REF,
    reviewed_sha: REVIEWED_SHA,
    diff_base_sha: DIFF_BASE_SHA,
    source_worker_run_id: WORKER_RUN_ID,
    review_run_id: runIds.review_run_id,

    current_slice_sha: runIds.current_slice_sha ?? REVIEWED_SHA
  };
}

function mintOutcomeFor(backend, runId) {
  return backend.__snapshotRuns().find((run) => run.run_id === runId)?.slice_review_acceptance_mint
    ?? null;
}

async function writeRecord(mainRepo, record) {
  await writeFile(
    path.join(mainRepo, "wiki", "work-records", `${RECORD_ID}.json`),
    JSON.stringify(record, null, 2),
    "utf8"
  );
}

async function editPersistedRecord(mainRepo, mutate) {
  const record = JSON.parse(
    await readFile(path.join(mainRepo, "wiki", "work-records", `${RECORD_ID}.json`), "utf8")
  );
  mutate(record);
  await writeRecord(mainRepo, record);
  return record;
}

test("a clean terminal slice reviewer run mints a Proof A bound to the exact slice tuple", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const { launch, status } = await runSliceReviewToTerminal(backend, mainRepo);

  assert.equal(status.review_result?.clean_review, true,
    "the trusted backend review_result must be clean for a proof to exist");

  const { proof } = await readPersistedProof(mainRepo);
  assert.ok(proof, "a Proof A must be persisted for a clean terminal slice review");
  assert.equal(proof.schema_version, SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION);
  assert.equal(proof.unit_address, SUBJECT);
  assert.equal(proof.initiative, INITIATIVE);
  assert.equal(proof.slice_ref, SLICE_REF);
  assert.equal(proof.reviewed_sha, REVIEWED_SHA);
  assert.equal(proof.diff_base_sha, DIFF_BASE_SHA);
  assert.equal(proof.source_worker_run_id, WORKER_RUN_ID);
  assert.equal(proof.review_run_id, launch.run_id);
  assert.equal(proof.review_monitor_handle, launch.monitor_handle);
  assert.equal(proof.reviewer_role, "reviewer");
  assert.equal(proof.review_outcome, "no_findings");
  assert.equal(
    proof.structured_result_digest,
    computeSliceReviewStructuredResultDigest(status.review_result),
    "the proof must bind the exact clean verdict that authorized it"
  );
});

test("the persisted proof survives process restart and resolves SERVER-SIDE from mainRepo alone", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const { launch } = await runSliceReviewToTerminal(backend, mainRepo);

  const restarted = createWorkspaceAgentDispatchBackend({
    __testHooks: true,
    launchExecutor: async () => ({ accepted: true, status: "running", probe: async () => ({ status: "running" }) }),
    worktreeProvisioning: { mainRepo, worktreeRoot: path.join(mainRepo, ".worktrees") }
  });
  assert.equal(restarted.__snapshotFrozenSliceReviewContexts().length, 0);

  const resolved = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    expectation: expectationFor({ review_run_id: launch.run_id })
  });
  assert.equal(resolved.ok, true, `server-side resolution must succeed; got ${JSON.stringify(resolved.reasons ?? null)}`);
  assert.equal(resolved.proof.reviewed_sha, REVIEWED_SHA);
  assert.equal(resolved.proof.review_run_id, launch.run_id);
  assert.equal(resolved.authorizes_slice_integration, true);
});

test("a caller-authored or replayed proof is never trusted", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const { launch } = await runSliceReviewToTerminal(backend, mainRepo);

  const forged = buildSliceReviewAcceptanceProof({
    unit_address: SUBJECT,
    initiative: INITIATIVE,
    slice_ref: SLICE_REF,
    reviewed_sha: "e".repeat(40),
    diff_base_sha: DIFF_BASE_SHA,
    source_worker_run_id: WORKER_RUN_ID,
    review_run_id: "forged_review_run",
    review_monitor_handle: "forged_handle",
    reviewer_role: "reviewer",
    review_outcome: "no_findings",
    reviewed_at: "2026-07-19T00:00:00Z",
    canonical_review_unit_digest: `sha256:${"0".repeat(64)}`,
    structured_result_digest: `sha256:${"1".repeat(64)}`
  });
  assert.equal(forged.ok, true, "the builder is a pure shape helper; provenance is enforced elsewhere");

  const callerCarried = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    expectation: expectationFor({ review_run_id: launch.run_id }),
    proof: forged.proof
  });
  assert.equal(callerCarried.ok, false);
  assert.equal(callerCarried.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.untrustedProvenance);

  const replayedSha = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    expectation: {
      ...expectationFor({ review_run_id: launch.run_id }),
      reviewed_sha: "e".repeat(40)
    }
  });
  assert.equal(replayedSha.ok, false);
  assert.equal(replayedSha.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.bindingMismatch);

  const replayedRun = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    expectation: expectationFor({ review_run_id: "some_other_review_run" })
  });
  assert.equal(replayedRun.ok, false);
  assert.equal(replayedRun.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.bindingMismatch);

  const movedTip = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    expectation: {
      ...expectationFor({ review_run_id: launch.run_id }),
      current_slice_sha: "f".repeat(40)
    }
  });
  assert.equal(movedTip.ok, false);
  assert.equal(movedTip.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.targetStale);
});

test("a findings review mints NOTHING", async (t) => {
  const blocking = {
    id: "F-001",
    title: "slice leaves the contract unimplemented",
    severity: "high",
    blocking: true,
    affected_paths: [{ path: "tests/fixtures/slice-review-canary.txt", line: 1 }]
  };
  const { backend, mainRepo } = await createSliceReviewFixture(t, {
    finalResult: cleanReviewerFinalResult({
      outcome: "changes_requested",
      findings: [blocking],
      counts: { ...ZERO_COUNTS, total: 1, blocking: 1, high: 1 }
    })
  });
  const { status } = await runSliceReviewToTerminal(backend, mainRepo);
  assert.equal(status.review_result, undefined, "a findings review has no clean review_result");

  const { proof } = await readPersistedProof(mainRepo);
  assert.equal(proof, null, "a findings review must never mint an acceptance proof");
});

test("a prose-only 'clean' review mints NOTHING", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t, {
    finalResult: proseOnlyFinalResult()
  });
  const { status } = await runSliceReviewToTerminal(backend, mainRepo);
  assert.equal(status.review_result, undefined,
    "legacy no-findings prose must not derive a clean review_result");

  const { proof } = await readPersistedProof(mainRepo);
  assert.equal(proof, null, "prose and a generic final_result.kind cannot mint a proof");
});

test("resolution of an unreviewed slice refuses as MISSING, never as clean", async (t) => {
  const { mainRepo } = await createSliceReviewFixture(t);

  const resolved = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    expectation: expectationFor({ review_run_id: "never_ran" })
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.missing);
  assert.equal(resolved.authorizes_slice_integration, false);
});

test("a malformed persisted proof refuses as MALFORMED, never as clean", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const { launch } = await runSliceReviewToTerminal(backend, mainRepo);
  const { entry, sidecar } = await readPersistedProof(mainRepo);
  assert.ok(entry?.sidecar_path);

  sidecar.normalized_request.evidence[SLICE_REVIEW_ACCEPTANCE_EVIDENCE_KEY].reviewed_sha =
    "e".repeat(40);
  await writeFile(
    path.join(mainRepo, entry.sidecar_path),
    `${JSON.stringify(sidecar, null, 2)}\n`,
    "utf8"
  );

  const resolved = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    expectation: expectationFor({ review_run_id: launch.run_id })
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.malformed);
});

test("the proof shape is closed: unknown fields and non-clean outcomes never build", () => {
  const valid = {
    unit_address: SUBJECT,
    initiative: INITIATIVE,
    slice_ref: SLICE_REF,
    reviewed_sha: REVIEWED_SHA,
    diff_base_sha: DIFF_BASE_SHA,
    source_worker_run_id: WORKER_RUN_ID,
    review_run_id: "review_run",
    review_monitor_handle: "handle",
    reviewer_role: "reviewer",
    review_outcome: "no_findings",
    reviewed_at: "2026-07-19T00:00:00Z",
    canonical_review_unit_digest: `sha256:${"0".repeat(64)}`,
    structured_result_digest: `sha256:${"1".repeat(64)}`
  };
  assert.equal(buildSliceReviewAcceptanceProof(valid).ok, true);

  const extra = buildSliceReviewAcceptanceProof({ ...valid, accepted_authorities: ["forged"] });
  assert.equal(extra.ok, false);
  assert.equal(extra.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.malformed);

  const notAccepted = buildSliceReviewAcceptanceProof({ ...valid, review_outcome: "changes_requested" });
  assert.equal(notAccepted.ok, false);
  assert.equal(notAccepted.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.reviewNotAccepted);

  const crossUnit = buildSliceReviewAcceptanceProof({
    ...valid,
    slice_ref: `refs/heads/slice/${INITIATIVE}/WK-9999/${IMPL_SLICE}`
  });
  assert.equal(crossUnit.ok, false);
  assert.equal(crossUnit.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.malformed);

  const built = buildSliceReviewAcceptanceProof(valid).proof;
  const tampered = { ...built, reviewed_sha: "e".repeat(40) };
  const verdict = validateSliceReviewAcceptanceProof(tampered, {
    ...valid,
    reviewed_sha: "e".repeat(40)
  });
  assert.equal(verdict.valid, false);
  assert.equal(verdict.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.malformed);
});

test("the mint is exactly-once across repeated polls of the same terminal run", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const launch = await launchSliceReview(backend, mainRepo);

  await pollStatus(backend, launch);
  const first = await readPersistedProof(mainRepo);
  assert.ok(first.proof);

  await pollStatus(backend, launch);
  await pollStatus(backend, launch);
  const third = await readPersistedProof(mainRepo);

  assert.equal(third.proof.reviewed_at, first.proof.reviewed_at);
  assert.equal(third.proof.evidence_digest, first.proof.evidence_digest);
  assert.equal(third.entry.sidecar_digest, first.entry.sidecar_digest);
  assert.equal(mintOutcomeFor(backend, launch.run_id).ok, true);
});

test("concurrent status reads of one terminal run mint exactly one proof", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const launch = await launchSliceReview(backend, mainRepo);

  const [left, right] = await Promise.all([
    pollStatus(backend, launch),
    pollStatus(backend, launch)
  ]);
  assert.equal(left.terminal, true);
  assert.equal(right.terminal, true);

  const { record, proof } = await readPersistedProof(mainRepo);
  assert.ok(proof);
  const entriesForUnit = (record.derived_evidence ?? []).filter(
    (entry) => entry?.unit?.slice_id === IMPL_SLICE
  );
  assert.equal(entriesForUnit.length, 1, "derived evidence is one entry per unit");
  assert.equal(mintOutcomeFor(backend, launch.run_id).ok, true);
});

test("a tampered retained reviewer launch identity mints NOTHING and is named", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const launch = await launchSliceReview(backend, mainRepo);

  const replaced = backend.__replaceReviewerLaunchIdentityForTest(launch.run_id, {
    main_repo: mainRepo,
    review_subject: SUBJECT,
    record_id: RECORD_ID,
    review_slice_id: IMPL_SLICE,
    initiative: INITIATIVE,
    slice_ref: SLICE_REF,
    worktree_path: "/tmp/not-the-slice-worktree",
    reviewed_sha: "e".repeat(40),
    diff_head_sha: "e".repeat(40),
    trusted_frozen_review_contract: { schema_version: "forged", review_subject: SUBJECT }
  });
  assert.equal(replaced, true);

  const status = await pollStatus(backend, launch);
  assert.equal(status.review_result?.clean_review, true, "the review itself is still clean");

  const { proof } = await readPersistedProof(mainRepo);
  assert.equal(proof, null, "a clean review with a mismatched identity mints nothing");
  const outcome = mintOutcomeFor(backend, launch.run_id);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reasons[0], "retained_slice_reviewer_launch_identity_mismatch");
});

test("a canonical contract change between launch and terminal mints NOTHING and is named", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const launch = await launchSliceReview(backend, mainRepo);

  const drifted = sliceReviewRecord();
  drifted.slices[0].status = "done";
  await writeRecord(mainRepo, drifted);

  await pollStatus(backend, launch);
  const { proof } = await readPersistedProof(mainRepo);
  assert.equal(proof, null);
  const outcome = mintOutcomeFor(backend, launch.run_id);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reasons[0], "canonical_slice_review_unit_unresolvable");
});

test("a slice ref that moved off the reviewed SHA mints NOTHING and is named", async (t) => {
  const { backend, mainRepo, gitState } = await createSliceReviewFixture(t);
  const launch = await launchSliceReview(backend, mainRepo);

  gitState.sha = "e".repeat(40);

  await pollStatus(backend, launch);
  const { proof } = await readPersistedProof(mainRepo);
  assert.equal(proof, null, "the mint re-verifies the object store; it does not trust the frozen target");
  const outcome = mintOutcomeFor(backend, launch.run_id);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reasons[0], "frozen_slice_review_target_object_store_verification_failed");
});

test("a re-review overwrites the proof in place rather than accumulating entries", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const { launch, status } = await runSliceReviewToTerminal(backend, mainRepo);
  const first = await readPersistedProof(mainRepo);
  assert.ok(first.proof);

  const second = await mintAndPersistSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    review_result: status.review_result,
    reviewed_at: "2026-07-19T12:00:00Z",
    binding: {
      initiative: INITIATIVE,
      slice_ref: SLICE_REF,
      reviewed_sha: REVIEWED_SHA,
      diff_base_sha: DIFF_BASE_SHA,
      source_worker_run_id: WORKER_RUN_ID,
      review_run_id: "second_review_run",
      review_monitor_handle: "second_handle",
      reviewer_role: "reviewer"
    }
  });
  assert.equal(second.ok, true, JSON.stringify(second.reasons ?? null));

  const after = await readPersistedProof(mainRepo);
  const entriesForUnit = (after.record.derived_evidence ?? []).filter(
    (entry) => entry?.unit?.slice_id === IMPL_SLICE
  );
  assert.equal(entriesForUnit.length, 1, "one entry per unit; a re-review replaces in place");
  assert.equal(after.proof.review_run_id, "second_review_run");
  assert.notEqual(after.proof.evidence_digest, first.proof.evidence_digest);

  const stale = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    expectation: expectationFor({ review_run_id: launch.run_id })
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.bindingMismatch);
});

test("the mint path refuses caller-carried proof material", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const { status } = await runSliceReviewToTerminal(backend, mainRepo);

  const forged = await mintAndPersistSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    review_result: status.review_result,
    review_outcome: "no_findings",
    binding: {}
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.untrustedProvenance);
});

test("a lost sidecar requires a repeated review; it never resolves as clean", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const { launch } = await runSliceReviewToTerminal(backend, mainRepo);
  const { entry } = await readPersistedProof(mainRepo);
  assert.ok(entry?.sidecar_path);

  await rm(path.join(mainRepo, entry.sidecar_path), { force: true });

  const resolved = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    expectation: expectationFor({ review_run_id: launch.run_id })
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.malformed);
  assert.equal(resolved.authorizes_slice_integration, false);
});

test("a canonical contract edit after minting resolves as STALE, not as never-reviewed", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const { launch } = await runSliceReviewToTerminal(backend, mainRepo);
  assert.ok((await readPersistedProof(mainRepo)).proof);

  await editPersistedRecord(mainRepo, (record) => {
    record.slices[0].acceptance.criteria = ["Slice: create the canary fixture, revised."];
  });

  const resolved = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    expectation: expectationFor({ review_run_id: launch.run_id })
  });
  assert.equal(resolved.ok, false);

  assert.equal(resolved.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.targetStale);
});

test("minting refuses rather than overwriting admission evidence recorded at another digest", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const { status } = await runSliceReviewToTerminal(backend, mainRepo);
  assert.ok((await readPersistedProof(mainRepo)).proof);

  await editPersistedRecord(mainRepo, (record) => {
    record.slices[0].acceptance.criteria = ["Slice: create the canary fixture, revised."];
  });
  const before = await readPersistedProof(mainRepo);

  const second = await mintAndPersistSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    review_result: status.review_result,
    binding: {
      initiative: INITIATIVE,
      slice_ref: SLICE_REF,
      reviewed_sha: REVIEWED_SHA,
      diff_base_sha: DIFF_BASE_SHA,
      source_worker_run_id: WORKER_RUN_ID,
      review_run_id: "second_review_run",
      review_monitor_handle: "second_handle",
      reviewer_role: "reviewer"
    }
  });
  assert.equal(second.ok, false);
  assert.equal(second.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.targetStale);

  const after = await readPersistedProof(mainRepo);
  assert.equal(after.entry.sidecar_digest, before.entry.sidecar_digest);
  assert.equal(after.entry.source_record_digest, before.entry.source_record_digest);
});

test("resolution requires the live slice tip; an under-bound expectation is refused", async (t) => {
  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const { launch } = await runSliceReviewToTerminal(backend, mainRepo);

  const { current_slice_sha: _omitted, ...underBound } = expectationFor({
    review_run_id: launch.run_id
  });
  const resolved = await resolveSliceReviewAcceptanceProof({
    dir: mainRepo,
    unit_address: SUBJECT,
    expectation: underBound
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.decision_code, SLICE_REVIEW_ACCEPTANCE_DECISION_CODES.bindingMismatch);
});

test("Proof A never enters the public run-status envelope", async (t) => {

  const { backend, mainRepo } = await createSliceReviewFixture(t);
  const { status } = await runSliceReviewToTerminal(backend, mainRepo);

  assert.deepEqual(Object.keys(status).sort(), [
    "accepted",
    "app",
    "caller_session_id",
    "exit",
    "final_result",
    "monitor_handle",
    "review_result",
    "role",
    "run_id",
    "schema_version",
    "started_at",
    "status",
    "subject",
    "terminal",
    "updated_at",
    "workspace_alias"
  ]);
  assert.equal(JSON.stringify(status).includes(SLICE_REVIEW_ACCEPTANCE_SCHEMA_VERSION), false);
  assert.equal(JSON.stringify(status).includes(SLICE_REVIEW_ACCEPTANCE_EVIDENCE_KEY), false);

  const { proof } = await readPersistedProof(mainRepo);
  assert.ok(proof);
});
