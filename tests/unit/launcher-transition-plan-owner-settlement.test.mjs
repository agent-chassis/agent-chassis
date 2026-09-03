import assert from "node:assert/strict";
import test from "node:test";

import {
  LAUNCHER_TRANSITION_FAILURES,
  allocateLauncherTransitionPlan,
  createProspectiveLauncherTransitionPlan,
  isLauncherTransitionPlan,
  projectLauncherTransitionOwnerSettlement,
  revalidateLauncherTransitionPlan
} from "../../packages/agent-launch-cli/src/lib/launcher-transition-plan.mjs";
import { freezeManagedResult } from
  "../../packages/agent-launch-cli/src/lib/worktree-provisioning-dispatch-binding.mjs";
import { deriveExactUnitName } from
  "../../packages/agent-launch-cli/src/lib/worktree-substrate-exact-unit.mjs";

const SUBJECT = "WK-2347#SLICE-004";
const INITIATIVE = "IN-0059";
const WK_ID = "WK-2347";
const SLICE_ID = "SLICE-004";
const REF = `wk/${INITIATIVE}/${WK_ID}`;
const MAIN_REPO = "/launcher/main";
const WORKTREE_ROOT = "/launcher/worktrees";
const LAUNCH_REF = "wkmh_wk2347";
const RUN_ID = "wkdb_wk2347";
const OID_A = "a".repeat(40);
const OID_B = "b".repeat(40);
const OID_C = "c".repeat(40);

function selection(role = "worker") {
  return Object.freeze({
    ok: true,
    target: SUBJECT,
    target_role: role,
    routeKind: "slice",
    app: "codex",
    model: "gpt-5.6-terra",
    backend: "codex",
    backend_profile: "gpt-5.6-terra"
  });
}

function wkOwnerCarrier(baseSha) {
  return Object.freeze({
    schema_version: "managed-wk-lifecycle-allocation.v1",
    complete: true,
    main_repo: MAIN_REPO,
    initiative: INITIATIVE,
    record_id: WK_ID,
    subject: SUBJECT,
    launch_ref: LAUNCH_REF,
    run_id: RUN_ID,
    retry_id: 0,
    worktree_root: WORKTREE_ROOT,
    wk_binding: Object.freeze({
      record_id: WK_ID,
      slice_id: null,
      launch_ref: LAUNCH_REF,
      run_id: `${RUN_ID}.wk`,
      retry_id: 0,
      output_branch: REF,
      wk_tip_sha: baseSha
    }),
    controlled_contract_generation: Object.freeze({
      schema_version: "controlled-contract-resolved-generation.v1",
      record_id: WK_ID,
      count: 1,
      generation_digest: `sha256:${"d".repeat(64)}`
    }),
    wk_snapshot: Object.freeze({
      ref: `refs/heads/${REF}`,
      tip: baseSha,
      tree: baseSha
    })
  });
}

function readiness() {
  return Object.freeze({
    record_id: WK_ID,
    unit: SUBJECT,
    decision_code: "dispatchable_ready",
    admissibility: Object.freeze({ status: "admit", authority: "node_engine" }),
    recovery: Object.freeze({ admission_metrics: "fresh" })
  });
}

function tip(baseSha) {
  return Object.freeze({ base_ref: REF, base_sha: baseSha });
}

function bindingFields(name, baseSha, { wk = false } = {}) {
  const writeScope = Object.freeze([
    "packages/agent-launch-cli/src/lib/launcher-transition-plan.mjs"
  ]);
  return {
    schema_version: wk ? "worktree-identity-binding.v1" : "worktree-identity-binding.v2",
    launch_ref: LAUNCH_REF,
    run_id: `${RUN_ID}.${wk ? "wk" : "slice"}`,
    retry_id: 0,
    unit_address: name.unit_address,
    initiative: INITIATIVE,
    record_id: WK_ID,
    slice_id: wk ? null : SLICE_ID,
    base_ref: wk ? "main" : REF,
    base_sha: wk ? OID_A : baseSha,
    output_branch: name.output_branch,
    worktree_path: name.worktree_path,
    write_scope: writeScope,
    write_scope_source: `wiki/work-records/${WK_ID}.json${wk ? "" : `#${SLICE_ID}`}`
  };
}

function ownerCarrier(baseSha) {
  const wkName = deriveExactUnitName({
    unitAddress: `${INITIATIVE}/${WK_ID}`,
    worktreeRoot: WORKTREE_ROOT
  });
  const sliceName = deriveExactUnitName({
    unitAddress: `${INITIATIVE}/${WK_ID}/${SLICE_ID}`,
    worktreeRoot: WORKTREE_ROOT
  });
  const wkBinding = Object.freeze({
    ...bindingFields(wkName, baseSha, { wk: true }),
    wk_tip_sha: baseSha
  });
  const sliceBinding = Object.freeze({
    ...bindingFields(sliceName, baseSha),
    read_scope: Object.freeze(["AGENTS.md"]),
    repo_paths: Object.freeze(["packages/agent-launch-cli/src/lib/launcher-transition-plan.mjs"]),
    selected_unit: Object.freeze({ record_id: WK_ID, slice_id: SLICE_ID }),
    source_digest: `sha256:${OID_A}${"a".repeat(24)}`,
    source_version: 1,
    checkout_mode: "full"
  });
  return freezeManagedResult({
    mainRepo: MAIN_REPO,
    initiative: INITIATIVE,
    wkId: WK_ID,
    sliceId: SLICE_ID,
    wkBinding,
    sliceBinding,
    retryId: 0
  });
}

function fourFieldLookalike(baseSha) {
  return Object.freeze({
    complete: true,
    wk_binding: Object.freeze({ output_branch: REF, wk_tip_sha: baseSha }),
    slice_binding: Object.freeze({ base_ref: REF, base_sha: baseSha })
  });
}

function publicationIdentity() {
  return Object.freeze({
    schema_version: "forge-confirmed-landed-publication-identity.v1",
    wk: "WK-2313",
    base_branch: "main",
    merge_commit_sha: OID_C,
    pull_request: Object.freeze({ head_sha: OID_A }),
    exact_head_landing: Object.freeze({
      relation: "exact-head-ancestor",
      head_sha: OID_A,
      merge_commit_sha: OID_C
    })
  });
}

function allocatedPlan() {
  const selected = selection();
  const admitted = readiness();
  const prospective = createProspectiveLauncherTransitionPlan({
    subject: SUBJECT,
    selection: selected,
    readiness: admitted
  });
  return {
    selected,
    admitted,
    plan: allocateLauncherTransitionPlan(prospective, {
      subject: SUBJECT,
      selection: selected,
      readiness: admitted,
      plannedBase: tip(OID_A),
      settlement: ownerCarrier(OID_A),
      dependencyEvidence: Object.freeze([{ owner: "dependency resolver", tip: OID_A }]),
      publicationIdentities: [publicationIdentity()],
      reservationState: "held"
    })
  };
}

function invalidate(plan, selected) {
  return projectLauncherTransitionOwnerSettlement(plan, {
    subject: SUBJECT,
    selection: selected,
    authenticated_wk_tip: tip(OID_B)
  });
}

test("authenticated WK-tip movement clears every tip-bound projection", () => {
  const { plan, selected } = allocatedPlan();
  const before = JSON.stringify(plan);

  assert.equal(revalidateLauncherTransitionPlan(plan, {
    subject: SUBJECT,
    selection: selected,
    authenticated_wk_tip: tip(OID_A)
  }), true);
  assert.equal(revalidateLauncherTransitionPlan(plan, {
    subject: SUBJECT,
    selection: selected,
    authenticated_wk_tip: tip(OID_B)
  }), false);

  const invalidated = invalidate(plan, selected);
  assert.equal(isLauncherTransitionPlan(invalidated), true);
  assert.equal(invalidated.phase, "prospective");
  assert.equal(invalidated.lifecycle.state, "fresh_settlement_required");
  assert.equal(invalidated.lifecycle.planned_base, null);
  assert.equal(invalidated.lifecycle.settlement, null);
  assert.deepEqual(invalidated.dependency, {
    owner: plan.dependency.owner,
    state: "prospective",
    evidence: null
  });
  assert.equal(invalidated.publication.owner, plan.publication.owner);
  assert.equal(invalidated.publication.state, "prospective");
  assert.deepEqual(invalidated.publication.identities, []);
  assert.equal(invalidated.spawn.state, "blocked");
  assert.equal(invalidated.identity, plan.identity);
  assert.equal(invalidated.role_runtime, plan.role_runtime);
  assert.equal(invalidated.cce, plan.cce);
  assert.equal(invalidated.reservation, plan.reservation);
  assert.equal(JSON.stringify(plan), before);
});

test("the invalid projection requests one bounded settlement from WK-2261", () => {
  const { plan, selected } = allocatedPlan();
  const invalidated = invalidate(plan, selected);
  const request = invalidated.lifecycle.settlement_request;

  assert.deepEqual(request, {
    owner: "WK-2261",
    operation: "allocate_or_adopt_authenticated_wk_tip",
    attempt_limit: 1,
    plan_identity: plan.identity,
    subject: SUBJECT,
    authenticated_wk_tip: tip(OID_B)
  });
  assert.equal(Object.isFrozen(request), true);
  assert.equal(projectLauncherTransitionOwnerSettlement(invalidated, {
    subject: SUBJECT,
    selection: selected,
    authenticated_wk_tip: tip(OID_B)
  }), invalidated);
});

test("the exact canonically admitted WK-2261 carrier is observed with spawn blocked", () => {
  const { plan, selected, admitted } = allocatedPlan();
  const invalidated = invalidate(plan, selected);
  const winner = ownerCarrier(OID_B);
  assert.throws(() => allocateLauncherTransitionPlan(invalidated, {
    subject: SUBJECT,
    selection: selected,
    readiness: admitted,
    plannedBase: tip(OID_B),
    settlement: winner,
    dependencyEvidence: Object.freeze([]),
    publicationIdentities: [],
    reservationState: "held"
  }), /must be observed before transition allocation/u);
  const observed = projectLauncherTransitionOwnerSettlement(invalidated, {
    subject: SUBJECT,
    selection: selected,
    authenticated_wk_tip: tip(OID_B),
    owner_settlement: winner
  });

  assert.equal(observed.lifecycle.state, "fresh_settlement_observed");
  assert.deepEqual(observed.lifecycle.planned_base, tip(OID_B));
  assert.equal(observed.lifecycle.settlement, winner);
  assert.equal(observed.lifecycle.settlement_request, null);
  assert.equal(observed.dependency.evidence, null);
  assert.deepEqual(observed.publication.identities, []);
  assert.equal(observed.spawn.state, "blocked");
  assert.equal(observed.role_runtime, plan.role_runtime);
  assert.equal(observed.cce, plan.cce);
  assert.equal(observed.reservation, plan.reservation);

  assert.throws(() => allocateLauncherTransitionPlan(observed, {
    subject: SUBJECT,
    selection: selected,
    readiness: admitted,
    plannedBase: tip(OID_B),
    settlement: winner,
    dependencyEvidence: Object.freeze([]),
    reservationState: "held"
  }), /recomputed dependency and publication projections/u);
  assert.throws(() => allocateLauncherTransitionPlan(observed, {
    subject: SUBJECT,
    selection: selected,
    readiness: admitted,
    plannedBase: tip(OID_B),
    settlement: winner,
    publicationIdentities: [],
    reservationState: "held"
  }), /recomputed dependency and publication projections/u);
  const allocated = allocateLauncherTransitionPlan(observed, {
    subject: SUBJECT,
    selection: selected,
    readiness: admitted,
    plannedBase: tip(OID_B),
    settlement: winner,
    dependencyEvidence: Object.freeze([]),
    publicationIdentities: [],
    reservationState: "held"
  });
  assert.equal(allocated.phase, "allocated");
  assert.equal(allocated.spawn.state, "authorized");
});

test("a frozen four-field lookalike is refused as non-authoritative", () => {
  const { plan, selected } = allocatedPlan();
  const invalidated = invalidate(plan, selected);
  const lookalike = fourFieldLookalike(OID_B);
  const refused = projectLauncherTransitionOwnerSettlement(invalidated, {
    subject: SUBJECT,
    selection: selected,
    authenticated_wk_tip: tip(OID_B),
    owner_settlement: lookalike
  });

  assert.equal(refused.lifecycle.state, "fresh_settlement_refused");
  assert.equal(refused.lifecycle.settlement, null);
  assert.equal(refused.spawn.state, "refused");
  assert.equal(refused.failure, LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED);
});

test("a divergent canonical winner refuses without mutating the input projection", () => {
  const { plan, selected } = allocatedPlan();
  const invalidated = invalidate(plan, selected);
  const before = JSON.stringify(invalidated);
  const divergent = ownerCarrier(OID_C);
  const refused = projectLauncherTransitionOwnerSettlement(invalidated, {
    subject: SUBJECT,
    selection: selected,
    authenticated_wk_tip: tip(OID_B),
    owner_settlement: divergent
  });

  assert.equal(refused.lifecycle.state, "fresh_settlement_refused");
  assert.equal(refused.lifecycle.settlement, null);
  assert.equal(refused.lifecycle.settlement_request, null);
  assert.equal(refused.spawn.state, "refused");
  assert.equal(refused.failure, LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED);
  assert.equal(refused.reservation, plan.reservation);
  assert.equal(JSON.stringify(invalidated), before);
  assert.equal(Object.isFrozen(divergent), true);
});

test("settlement preserves the reservation projection and never projects a spawn", () => {
  const { plan, selected } = allocatedPlan();
  const invalidated = invalidate(plan, selected);
  const observed = projectLauncherTransitionOwnerSettlement(invalidated, {
    subject: SUBJECT,
    selection: selected,
    authenticated_wk_tip: tip(OID_B),
    owner_settlement: ownerCarrier(OID_B)
  });

  assert.equal(invalidated.role_runtime.subject, SUBJECT);
  assert.equal(invalidated.reservation, plan.reservation);
  assert.equal(observed.reservation, plan.reservation);
  assert.equal(observed.reservation.state, "held");
  assert.equal(invalidated.spawn.state, "blocked");
  assert.equal(observed.spawn.state, "blocked");
});

test("findings-role stale-tip resettlement consumes the exact WK-level owner carrier", () => {
  const selected = selection("reviewer");
  const admitted = readiness();
  const prospective = createProspectiveLauncherTransitionPlan({
    subject: SUBJECT,
    selection: selected,
    readiness: admitted
  });
  const initial = allocateLauncherTransitionPlan(prospective, {
    subject: SUBJECT,
    selection: selected,
    readiness: admitted,
    plannedBase: tip(OID_A),
    settlement: wkOwnerCarrier(OID_A),
    dependencyEvidence: Object.freeze([]),
    publicationIdentities: Object.freeze([])
  });
  const invalidated = projectLauncherTransitionOwnerSettlement(initial, {
    subject: SUBJECT,
    selection: selected,
    authenticated_wk_tip: tip(OID_B)
  });
  const winner = wkOwnerCarrier(OID_B);
  const observed = projectLauncherTransitionOwnerSettlement(invalidated, {
    subject: SUBJECT,
    selection: selected,
    authenticated_wk_tip: tip(OID_B),
    owner_settlement: winner
  });
  assert.equal(observed.lifecycle.state, "fresh_settlement_observed");
  assert.equal(observed.lifecycle.settlement, winner);
  assert.equal(observed.spawn.state, "blocked");
  const allocated = allocateLauncherTransitionPlan(observed, {
    subject: SUBJECT,
    selection: selected,
    readiness: admitted,
    plannedBase: tip(OID_B),
    settlement: winner,
    dependencyEvidence: Object.freeze([]),
    publicationIdentities: Object.freeze([])
  });
  assert.equal(allocated.phase, "allocated");
});
