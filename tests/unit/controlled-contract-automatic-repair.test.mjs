import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  attemptControlledContractAutomaticRepair,
  deriveControlledContractRepairCandidate,
  projectControlledContractRepairOutcome
} from
  "../../packages/wiki-core/src/operations/controlled-contract/design-workbench-repair.mjs";
import {
  clearControlledContractRefactorStagingForTest,
  retainControlledContractRefactorResource
} from "../../packages/wiki-core/src/lib/controlled-contract-refactor-staging.mjs";

const SHA = (character) => `sha256:${character.repeat(64)}`;

async function fixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "automatic-repair-"));
  await mkdir(path.join(repoRoot, "wiki", "contracts"), { recursive: true });
  t.after(async () => {
    await clearControlledContractRefactorStagingForTest({ repoRoot });
    await rm(repoRoot, { recursive: true, force: true });
  });
  return repoRoot;
}

function row(rowId, forms, { continuation = SHA("a") } = {}) {
  return { row_id: rowId, state: "missing", reason_codes: ["incomplete"],
    eligible_response_forms: forms,
    ...(continuation === null ? {} : {
      continuation: { identity: continuation, response_kinds: forms } }) };
}

function workbench(actionableRows, { sourceDigest = SHA("5"), complete = false } = {}) {
  return {
    subject: { wk_id: "WK-9999", focus: null, generation_id: "generation-one",
      record_source_digest: sourceDigest },
    mechanically_complete: complete,
    actionable_row_count: actionableRows.length,
    actionable_rows: actionableRows,
    non_actionable_row_count: 0,
    non_actionable_rows: []
  };
}

function descriptorsFor(entries) {
  return new Map(entries.map(([rowId, owner]) => [rowId, { semantic_owner: owner }]));
}

const input = (repoRoot) => ({ repoRoot, wkId: "WK-9999", focus: null });

test("exactly one mechanically determined row is the unique repair candidate", () => {
  const candidate = deriveControlledContractRepairCandidate(
    workbench([row("authoring_stage:one", ["advance_authoring"])]),
    { descriptors: descriptorsFor([["authoring_stage:one", "proof_plan"]]) });
  assert.equal(candidate.unique, true);
  assert.equal(candidate.responsible_owner, "proof_plan");
  assert.equal(candidate.candidate_row_id, "authoring_stage:one");
});

test("two rows contending for one role are not a candidate and mutate nothing",
  async (t) => {
    const repoRoot = await fixture(t);
    let calls = 0;
    const result = await attemptControlledContractAutomaticRepair({
      input: input(repoRoot),
      workbench: workbench([row("authoring_stage:one", ["advance_authoring"]),
        row("authoring_stage:two", ["advance_authoring"], { continuation: SHA("b") })]),

      descriptors: descriptorsFor([["authoring_stage:one", "proof_plan"],
        ["authoring_stage:two", "buildProspectiveProofPlan"]]),
      runTransaction: async () => { calls += 1; }
    });
    assert.equal(calls, 0);
    assert.equal(result.attempted, false);
    assert.equal(result.settled, false);
    assert.equal(result.reason_code, "controlled_contract_repair_role_contended");
    assert.equal(result.gap_class, "unresolved_semantic_choice");
  });

test("several rows on disjoint roles form one candidate", async (t) => {
  const repoRoot = await fixture(t);
  const seen = [];
  const result = await attemptControlledContractAutomaticRepair({
    input: input(repoRoot),
    workbench: workbench([row("authoring_stage:one", ["advance_authoring"]),
      row("authoring_stage:two", ["advance_authoring"], { continuation: SHA("b") })]),
    descriptors: descriptorsFor([["authoring_stage:one", "authoring_continuation"],
      ["authoring_stage:two", "proof_plan"]]),
    runTransaction: async ({ candidate }) => {
      seen.push(candidate);
      return { receipt: { transaction_identity: SHA("c"), receipt_identity: SHA("d"),
        target: { generation: "generation-two" }, committed_participants: ["canonical_generation"] },
      source_identity: { starting_generation: "generation-one" },
      participant_count: 2, prepared_role_count: 3, contribution_count: 2,
      settlement_participants: ["canonical_generation"] };
    }
  });
  assert.equal(result.settled, true);
  assert.equal(seen.length, 1, "one transaction for the whole candidate");
  assert.equal(seen[0].rows.length, 2);
  assert.deepEqual(seen[0].rows.map(({ semantic_owner: owner }) => owner).sort(),
    ["authoring_continuation", "proof_plan"]);
  assert.equal(seen[0].affected_roles.length >= 3, true);
});

test("a substantive semantic response is never an automatic repair", async (t) => {
  const repoRoot = await fixture(t);
  let calls = 0;
  const result = await attemptControlledContractAutomaticRepair({
    input: input(repoRoot),
    workbench: workbench([row("obligation_coverage:one",
      ["obligation_wording", "mapping_selection"])]),
    descriptors: descriptorsFor([["obligation_coverage:one", "obligation_coverage"]]),
    applyMechanicalTransition: async () => { calls += 1; }
  });
  assert.equal(calls, 0);
  assert.equal(result.attempted, false);
  assert.equal(result.reason_code,
    "controlled_contract_repair_no_mechanical_candidate");
  assert.equal(result.gap_class, "unresolved_semantic_choice");
});

test("an unregistered semantic owner cannot repair anything", async (t) => {
  const repoRoot = await fixture(t);
  let calls = 0;
  const result = await attemptControlledContractAutomaticRepair({
    input: input(repoRoot),
    workbench: workbench([row("authoring_stage:one", ["advance_authoring"])]),
    descriptors: descriptorsFor([["authoring_stage:one", "an_owner_nobody_registered"]]),
    applyMechanicalTransition: async () => { calls += 1; }
  });
  assert.equal(calls, 0);
  assert.equal(result.reason_code, "controlled_contract_repair_owner_unregistered");
  assert.equal(result.gap_class, "tooling_or_internal_invariant");
});

test("an unauthenticated work-record source never begins a repair", async (t) => {
  const repoRoot = await fixture(t);
  let calls = 0;
  const result = await attemptControlledContractAutomaticRepair({
    input: input(repoRoot),
    workbench: workbench([row("authoring_stage:one", ["advance_authoring"])],
      { sourceDigest: null }),
    descriptors: descriptorsFor([["authoring_stage:one", "proof_plan"]]),
    applyMechanicalTransition: async () => { calls += 1; }
  });
  assert.equal(calls, 0);
  assert.equal(result.reason_code, "controlled_contract_repair_source_unauthenticated");
  assert.equal(result.gap_class, "stale_source");
});

test("a mechanically complete workbench needs no repair", async (t) => {
  const repoRoot = await fixture(t);
  let calls = 0;
  const result = await attemptControlledContractAutomaticRepair({
    input: input(repoRoot),
    workbench: workbench([], { complete: true }),
    descriptors: new Map(),
    applyMechanicalTransition: async () => { calls += 1; }
  });
  assert.equal(calls, 0);
  assert.equal(result.reason_code, "controlled_contract_repair_not_required");
  assert.equal(result.gap_class, null);
});

function settledTransaction() {
  return { receipt: { transaction_identity: SHA("c"), receipt_identity: SHA("d"),
    target: { generation: "generation-two" },
    committed_participants: ["coverage", "canonical_generation"] },
  source_identity: { starting_generation: "generation-one" },
  participant_count: 1, prepared_role_count: 1, contribution_count: 1,
  settlement_participants: ["canonical_generation", "coverage"] };
}

test("the coordinator delegates once and projects the settled identities",
  async (t) => {
    const repoRoot = await fixture(t);
    const calls = [];
    const result = await attemptControlledContractAutomaticRepair({
      input: input(repoRoot),
      workbench: workbench([row("authoring_stage:one", ["advance_authoring"])]),
      descriptors: descriptorsFor([["authoring_stage:one", "proof_plan"]]),
      runTransaction: async ({ candidate }) => {
        calls.push(candidate); return settledTransaction();
      }
    });
    assert.equal(calls.length, 1, "exactly one transaction per evaluation");
    assert.equal(result.attempted, true);
    assert.equal(result.settled, true);
    assert.equal(result.replayed, false);
    assert.equal(result.transaction_identity, SHA("c"));
    assert.equal(result.receipt_identity, SHA("d"));

    assert.equal(calls[0].starting_generation, "generation-one");
    assert.equal(calls[0].record_source_digest, SHA("5"));
    assert.equal(typeof calls[0].candidate_digest, "string");
  });

test("the coordinator projects a transaction replay without re-attempting",
  async (t) => {
    const repoRoot = await fixture(t);
    let calls = 0;
    const result = await attemptControlledContractAutomaticRepair({
      input: input(repoRoot),
      workbench: workbench([row("authoring_stage:one", ["advance_authoring"])]),
      descriptors: descriptorsFor([["authoring_stage:one", "proof_plan"]]),
      runTransaction: async () => {
        calls += 1;
        return { replay: { replayed: true, transaction_identity: SHA("c"),
          receipt_identity: SHA("d"), source_current: true,
          grants_dispatch_authority: false } };
      }
    });
    assert.equal(calls, 1);
    assert.equal(result.replayed, true);
    assert.equal(result.settled, true);
    assert.equal(result.transaction_identity, SHA("c"));
    assert.equal(result.receipt_identity, SHA("d"));
    assert.equal(result.source_current, true);
    assert.equal(projectControlledContractRepairOutcome(result).recomputation_count,
      0, "a replay recomputes nothing");
  });

test("a recovered historical replay is projected as non-current", async (t) => {
  const repoRoot = await fixture(t);
  const result = await attemptControlledContractAutomaticRepair({
    input: input(repoRoot),
    workbench: workbench([row("authoring_stage:one", ["advance_authoring"])]),
    descriptors: descriptorsFor([["authoring_stage:one", "proof_plan"]]),
    runTransaction: async () => ({ replay: { replayed: true,
      transaction_identity: SHA("c"), receipt_identity: SHA("d"),
      source_current: false, grants_dispatch_authority: false } })
  });
  assert.equal(result.replayed, true);
  assert.equal(result.source_current, false,
    "a moved source makes the recovered result non-current");
});

test("a transaction failure is projected without claiming a settlement",
  async (t) => {
    const repoRoot = await fixture(t);
    const result = await attemptControlledContractAutomaticRepair({
      input: input(repoRoot),
      workbench: workbench([row("authoring_stage:one", ["advance_authoring"])]),
      descriptors: descriptorsFor([["authoring_stage:one", "proof_plan"]]),
      runTransaction: async () => {
        const error = new Error("owner refused");
        error.code = "controlled_contract_owner_refused_example";
        error.details = { changed: false };
        throw error;
      }
    });
    assert.equal(result.attempted, true);
    assert.equal(result.settled, false);
    assert.equal(result.gap_class, "owner_refusal");
    assert.equal(result.transaction_identity, null);
  });

test("the public repair projection is compact and states its own limits", () => {
  const projected = projectControlledContractRepairOutcome(
    Object.freeze({ schema_version: "controlled-contract-automatic-repair.v1",
      attempted: true, settled: true, replayed: false, reason_code: null,
      responsible_owner: "proof_plan", candidate_row_id: "authoring_stage:one" }));
  assert.equal(projected.repair_attempt_limit, 1);
  assert.equal(projected.recomputation_count, 1);
  assert.equal(Object.hasOwn(projected, "continuation"), false,
    "public results never carry the internal continuation identity");
});
