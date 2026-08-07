

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS,
  classifyCanonicalIntegratedSliceContract,
  resolveCanonicalIntegratedSliceState
} from "../packages/agent-launch-cli/src/lib/backend-scope-authority.mjs";
import { projectSliceReviewReceiptContracts } from "../packages/wiki-core/src/index.mjs";
import {
  SUBJECT as RESTART_SUBJECT,
  SLICE_REF,
  WK as RESTART_WK,
  committedFixture,
  dispatchWorker,
  git,
  idMint,
  inMemoryReceiptStore,
  assertConvergentLoser,
  reconstructBackend
} from "./managed-dispatch-orchestrator-restart-fixture.mjs";
import { INITIATIVE } from "./managed-dispatch-orchestrator-restart-fixture.mjs";

const INT_WK = "WK-9098";
const INT_SUBJECT = `${INT_WK}#SLICE-001`;

function integratedSlice(id, workKind, status, extra = {}) {
  return {
    id,
    title: `${id} unit`,
    work_kind: workKind,
    status,
    priority: "critical",
    owner: "codex",
    depends_on: [],
    read_scope: ["src/canary.txt"],
    repo_paths: ["src/canary.txt"],
    write_scope: workKind === "implementation" ? ["src/canary.txt"] : [],
    dispatch_intent: {
      intended_agent_role: workKind === "review" ? "reviewer" : workKind === "redteam" ? "redteam" : "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: { criteria: [`Deliver ${id}.`], validation: [`Inspect ${id}.`] },
    sections: { agent_notes: "" },
    ...extra
  };
}

function integratedRecord() {
  return {
    schema_version: "work-record.v1",
    id: INT_WK,
    repo: "fixture/repo",
    title: "Integrated corrective lifecycle",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "active",
    priority: "critical",
    owner: "codex",
    created: "2026-07-24",
    updated: "2026-07-24",
    initiative: INITIATIVE,
    read_scope: ["src/canary.txt"],
    repo_paths: ["src/canary.txt"],
    write_scope: [],
    depends_on: [], blocks: [], related: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: { criteria: ["Converge after review."], validation: ["node --test"] },
    sections: {
      summary: "Integrated corrective lifecycle.",
      why_it_matters: "Pins the closed corrective normalization.",
      scope: { items: ["corrective continuation"], out_of_scope: [] },
      tasks: [], references: [], agent_notes: "", closure: null
    },
    children: [],
    slices: [
      integratedSlice("SLICE-001", "implementation", "review"),
      integratedSlice("SLICE-002", "implementation", "todo"),
      integratedSlice("SLICE-003", "review", "todo"),
      integratedSlice("SLICE-004", "redteam", "todo")
    ],
    escalations: [], projections: [], migration: null
  };
}

function integratedFixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "integrated-corrective-")));
  const repo = path.join(root, "repo");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  return repo;
}

function writeIntegratedRecord(repo, record) {
  writeFileSync(
    path.join(repo, "wiki", "work-records", `${INT_WK}.json`),
    `${JSON.stringify(record, null, 2)}\n`
  );
  return record;
}

function frozenContractFor(record, sliceId = "SLICE-001") {
  const contracts = projectSliceReviewReceiptContracts(record, sliceId);
  assert.notEqual(contracts.slice_review_contract, null);
  return {
    record_id: INT_WK,
    slice_id: sliceId,
    initiative: record.initiative,
    unit_address: `${record.id}#${sliceId}`,
    canonical_parent_wk_contract: contracts.canonical_parent_wk_contract,
    slice_review_contract: contracts.slice_review_contract
  };
}

function slicesOf(record, id) {
  return record.slices.find((entry) => entry.id === id);
}

function resolveCurrent(repo, frozen, mutate) {
  const current = structuredClone(JSON.parse(frozen.canonical_parent_wk_contract));

  current.updated = "2026-07-25";
  mutate(current);
  writeIntegratedRecord(repo, current);
  return resolveCanonicalIntegratedSliceState(repo, INT_SUBJECT, frozen);
}

function expectIntegratedRefusal(repo, frozen, mutate, expected, label = "") {
  assert.throws(
    () => resolveCurrent(repo, frozen, mutate),
    (error) => {
      assert.match(error.message, expected, label);
      return true;
    },
    label
  );
}

test("WK-1723#SLICE-009 a reviewed delivery reopened to todo is a canonical corrective state", (t) => {
  const repo = integratedFixture(t);
  const frozen = frozenContractFor(integratedRecord());

  const corrective = resolveCurrent(repo, frozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
  });
  assert.equal(corrective.lifecycle_state, "corrective");
  assert.equal(corrective.corrective, true);
  assert.equal(corrective.final, false);
  assert.equal(corrective.parent_status, "active");
  assert.equal(corrective.slice_status, "todo");
  assert.equal(corrective.record_id, INT_WK);
  assert.equal(corrective.slice_id, "SLICE-001");

  const soleOutstanding = resolveCurrent(repo, frozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
    slicesOf(record, "SLICE-002").status = "done";
  });
  assert.equal(soleOutstanding.lifecycle_state, "corrective");

  expectIntegratedRefusal(repo, frozen, (record) => {
    record.status = "review";
    slicesOf(record, "SLICE-001").status = "todo";
  }, /canonical corrective integrated slice state is inconsistent/u);
});

test("WK-1723#SLICE-009 sibling lifecycle and coordination movement never invalidates the target", (t) => {
  const repo = integratedFixture(t);
  const frozen = frozenContractFor(integratedRecord());

  const allMoved = resolveCurrent(repo, frozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
    slicesOf(record, "SLICE-002").status = "done";
    slicesOf(record, "SLICE-003").status = "review";
    slicesOf(record, "SLICE-004").status = "done";
  });
  assert.equal(allMoved.lifecycle_state, "corrective");

  const noteless = integratedRecord();
  delete slicesOf(noteless, "SLICE-002").sections;
  const notelessFrozen = frozenContractFor(noteless);
  const noteAppeared = resolveCurrent(repo, notelessFrozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
    slicesOf(record, "SLICE-002").sections = { agent_notes: "Coordinator recorded the review disposition." };
  });
  assert.equal(noteAppeared.lifecycle_state, "corrective");

  const noteMoved = resolveCurrent(repo, frozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
    slicesOf(record, "SLICE-002").sections.agent_notes = "Rewritten coordination note.";
    slicesOf(record, "SLICE-003").sections.agent_notes = "Review sibling coordination note.";
  });
  assert.equal(noteMoved.lifecycle_state, "corrective");

  const generated = resolveCurrent(repo, frozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
    slicesOf(record, "SLICE-002").derived_evidence = { admission_metrics: { refreshed: true } };
    slicesOf(record, "SLICE-003").projections = [{ kind: "graph_impact" }];
    record.derived_evidence = { target_resolution: { refreshed: true } };
    record.projections = [{ kind: "catalog" }];
  });
  assert.equal(generated.lifecycle_state, "corrective");
});

test("WK-1723#SLICE-009 coordination-only notes on the reopened target authenticate", (t) => {
  const repo = integratedFixture(t);

  const FINDINGS = "Findings-only review returned changes_requested: Blocking orphaned reservation.";

  const noteless = integratedRecord();
  delete slicesOf(noteless, "SLICE-001").sections;
  const notelessFrozen = frozenContractFor(noteless);
  const appeared = resolveCurrent(repo, notelessFrozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
    slicesOf(record, "SLICE-001").sections = { agent_notes: FINDINGS };
  });
  assert.equal(appeared.lifecycle_state, "corrective");

  const frozen = frozenContractFor(integratedRecord());

  const written = resolveCurrent(repo, frozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
    slicesOf(record, "SLICE-001").sections.agent_notes = FINDINGS;
  });
  assert.equal(written.lifecycle_state, "corrective");

  const noted = integratedRecord();
  slicesOf(noted, "SLICE-001").sections.agent_notes = FINDINGS;
  const notedFrozen = frozenContractFor(noted);
  const changed = resolveCurrent(repo, notedFrozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
    slicesOf(record, "SLICE-001").sections.agent_notes = "Second remediation round: previous findings superseded.";
  });
  assert.equal(changed.lifecycle_state, "corrective");

  const appended = resolveCurrent(repo, notedFrozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
    slicesOf(record, "SLICE-001").sections.agent_notes =
      `${FINDINGS}\nHigh: whole-parent frozen-byte comparison rejects ordinary lifecycle movement.`;
  });
  assert.equal(appended.lifecycle_state, "corrective");

  const cleared = resolveCurrent(repo, notedFrozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
    delete slicesOf(record, "SLICE-001").sections.agent_notes;
    slicesOf(record, "SLICE-003").status = "done";
    slicesOf(record, "SLICE-004").sections.agent_notes = "Redteam sibling disposition.";
  });
  assert.equal(cleared.lifecycle_state, "corrective");

  assert.equal(
    resolveCurrent(repo, frozen, (record) => {
      slicesOf(record, "SLICE-001").status = "done";
      slicesOf(record, "SLICE-001").sections.agent_notes = FINDINGS;
    }).lifecycle_state,
    "non_final"
  );
});

test("WK-1723#SLICE-009 authored drift outside the closed lifecycle set still refuses", (t) => {
  const repo = integratedFixture(t);
  const frozen = frozenContractFor(integratedRecord());
  const DRIFT = /canonical integrated state changed beyond the permitted lifecycle transition/u;

  for (const [name, mutate] of [
    ["acceptance", (record) => { slicesOf(record, "SLICE-001").acceptance.criteria = ["Deliver something else."]; }],
    ["write_scope", (record) => { slicesOf(record, "SLICE-001").write_scope = ["src/other.txt"]; }],
    ["read_scope", (record) => { slicesOf(record, "SLICE-001").read_scope = ["src/other.txt"]; }],
    ["dispatch_intent", (record) => { slicesOf(record, "SLICE-001").dispatch_intent.requires_escalation = true; }],
    ["expected_edit_targets", (record) => {
      slicesOf(record, "SLICE-001").expected_edit_targets = [{ path: "src/canary.txt", kind: "file", operation: "modify" }];
    }],
    ["title", (record) => { slicesOf(record, "SLICE-001").title = "Retitled target"; }],
    ["owner", (record) => { slicesOf(record, "SLICE-001").owner = "someone-else"; }],
    ["depends_on", (record) => { slicesOf(record, "SLICE-001").depends_on = ["WK-9098#SLICE-002"]; }],
    ["other sections key", (record) => { slicesOf(record, "SLICE-001").sections.closure = { landed: true }; }]
  ]) {
    expectIntegratedRefusal(repo, frozen, (record) => {
      slicesOf(record, "SLICE-001").status = "todo";
      mutate(record);
    }, DRIFT, name);
  }

  expectIntegratedRefusal(repo, frozen, (record) => {
    slicesOf(record, "SLICE-001").status = "todo";
    slicesOf(record, "SLICE-001").work_kind = "review";
  }, /canonical integrated slice identity is unavailable/u, "target work_kind");

  for (const [name, mutate] of [
    ["acceptance", (record) => { record.acceptance.criteria = ["A different parent contract."]; }],
    ["write_scope", (record) => { record.write_scope = ["src/canary.txt"]; }],
    ["title", (record) => { record.title = "Retitled parent"; }],
    ["sections.agent_notes", (record) => { record.sections.agent_notes = "Parent note drift."; }],
    ["slice removed", (record) => { record.slices = record.slices.filter((entry) => entry.id !== "SLICE-002"); }],
    ["slice added", (record) => { record.slices.push(integratedSlice("SLICE-005", "implementation", "todo")); }]
  ]) {
    expectIntegratedRefusal(repo, frozen, (record) => {
      slicesOf(record, "SLICE-001").status = "todo";
      mutate(record);
    }, DRIFT, name);
  }

  for (const [name, mutate] of [
    ["sibling write_scope", (record) => { slicesOf(record, "SLICE-002").write_scope = ["src/other.txt"]; }],
    ["sibling read_scope", (record) => { slicesOf(record, "SLICE-003").read_scope = ["src/other.txt"]; }],
    ["sibling acceptance", (record) => { slicesOf(record, "SLICE-002").acceptance.validation = ["Different validation."]; }],
    ["sibling dispatch_intent", (record) => { slicesOf(record, "SLICE-002").dispatch_intent.target_unit = "record"; }],
    ["sibling expected_edit_targets", (record) => {
      slicesOf(record, "SLICE-002").expected_edit_targets = [{ path: "src/canary.txt", kind: "file", operation: "modify" }];
    }],
    ["sibling work_kind", (record) => { slicesOf(record, "SLICE-002").work_kind = "review"; }],
    ["redteam sibling work_kind", (record) => { slicesOf(record, "SLICE-004").work_kind = "implementation"; }],
    ["sibling title", (record) => { slicesOf(record, "SLICE-003").title = "Retitled review sibling"; }],
    ["sibling owner", (record) => { slicesOf(record, "SLICE-004").owner = "someone-else"; }],
    ["sibling other sections key", (record) => { slicesOf(record, "SLICE-002").sections.closure = { landed: true }; }]
  ]) {
    expectIntegratedRefusal(repo, frozen, (record) => {
      slicesOf(record, "SLICE-001").status = "todo";
      mutate(record);
    }, DRIFT, name);
  }

  assert.equal(
    resolveCurrent(repo, frozen, (record) => { slicesOf(record, "SLICE-001").status = "todo"; }).lifecycle_state,
    "corrective"
  );
});

test("WK-1723#SLICE-009 existing final and non-final integrated states remain supported", (t) => {
  const repo = integratedFixture(t);
  const frozen = frozenContractFor(integratedRecord());

  const nonFinal = resolveCurrent(repo, frozen, (record) => {
    slicesOf(record, "SLICE-001").status = "done";
  });
  assert.equal(nonFinal.lifecycle_state, "non_final");
  assert.equal(nonFinal.final, false);
  assert.equal(nonFinal.corrective, false);
  assert.equal(nonFinal.slice_status, "done");

  for (const targetStatus of ["review", "done"]) {
    const final = resolveCurrent(repo, frozen, (record) => {
      record.status = "review";
      slicesOf(record, "SLICE-001").status = targetStatus;
      slicesOf(record, "SLICE-002").status = "done";
    });
    assert.equal(final.lifecycle_state, "final", targetStatus);
    assert.equal(final.final, true);
    assert.equal(final.corrective, false);
    assert.equal(final.parent_status, "review");
  }

  expectIntegratedRefusal(repo, frozen, (record) => {
    record.status = "review";
  }, /canonical final integrated slice state is inconsistent/u);
  expectIntegratedRefusal(repo, frozen, (record) => {
    slicesOf(record, "SLICE-001").status = "blocked";
  }, /canonical non-final integrated slice state is inconsistent/u);
  expectIntegratedRefusal(repo, frozen, (record) => {
    slicesOf(record, "SLICE-001").status = "done";
    slicesOf(record, "SLICE-002").status = "done";
  }, /canonical non-final integrated slice state is inconsistent/u);

  assert.throws(
    () => resolveCanonicalIntegratedSliceState(repo, INT_WK, frozen),
    /integrated slice subject is not canonical/u
  );
  assert.throws(
    () => resolveCanonicalIntegratedSliceState(repo, "WK-9097#SLICE-001", frozen),
    /canonical integrated slice identity is unavailable/u
  );
  writeIntegratedRecord(repo, (() => {
    const record = integratedRecord();
    slicesOf(record, "SLICE-001").work_kind = "review";
    return record;
  })());
  assert.throws(
    () => resolveCanonicalIntegratedSliceState(repo, INT_SUBJECT, frozen),
    /canonical integrated slice identity is unavailable/u
  );

  writeIntegratedRecord(repo, (() => {
    const record = integratedRecord();
    slicesOf(record, "SLICE-001").status = "todo";
    return record;
  })());
  assert.equal(
    resolveCanonicalIntegratedSliceState(repo, INT_SUBJECT).lifecycle_state,
    "corrective"
  );
});

test("WK-1723#SLICE-018 a changed corrective contract converges through fresh cold-restart dispatch", async (t) => {
  const fx = await committedFixture(t);
  const ids = idMint();
  const { store } = inMemoryReceiptStore();
  const recordPath = path.join(fx.repo, "wiki", "work-records", `${RESTART_WK}.json`);
  const preIntegration = JSON.parse(readFileSync(recordPath, "utf8"));
  const contracts = projectSliceReviewReceiptContracts(preIntegration, "SLICE-001");
  const reviewedSha = git(fx.repo, "rev-parse", SLICE_REF);
  const diffBaseSha = git(fx.repo, "rev-parse", `wk/${INITIATIVE}/${RESTART_WK}`);
  const frozen = {
    record_id: RESTART_WK,
    slice_id: "SLICE-001",
    initiative: INITIATIVE,
    unit_address: RESTART_SUBJECT,
    slice_ref: SLICE_REF,
    reviewed_sha: reviewedSha,
    diff_base_sha: diffBaseSha,
    committed_target_digest: "trusted-committed-target",
    canonical_parent_contract_digest: "trusted-parent-contract",
    slice_review_contract_digest: "trusted-slice-contract",
    canonical_parent_wk_contract: contracts.canonical_parent_wk_contract,
    slice_review_contract: contracts.slice_review_contract,
    review_admission_kind: "canonical_committed_slice",
    structured_outcome: { outcome: "changes_requested", findings: [] }
  };
  await store.persist(frozen);

  const current = structuredClone(preIntegration);
  current.updated = "2026-07-25";
  current.slices.find((slice) => slice.id === "SLICE-001").status = "todo";
  current.slices.find((slice) => slice.id === "SLICE-001").acceptance.criteria =
    ["Deliver the corrected target contract."];
  writeFileSync(recordPath, `${JSON.stringify(current, null, 2)}\n`);

  const classified = classifyCanonicalIntegratedSliceContract(
    fx.repo,
    RESTART_SUBJECT,
    frozen
  );
  assert.equal(
    classified.classification,
    CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS.CORRECTIVE_CURRENT_CONTRACT_REQUIRES_FRESH_IDENTITY
  );
  assert.equal(classified.lifecycle_state, "corrective");
  assert.match(classified.current_contract, /corrected target contract/u);

  const launches = [];
  const successorProcessStarttime = "888";
  const firstBackend = reconstructBackend(fx, {

    procs: { [process.pid]: "999", 5252: successorProcessStarttime },
    ids, launches, receiptStore: store
  });
  const fresh = await dispatchWorker(firstBackend, "cold-restart-1");
  assert.equal(fresh.accepted, true, JSON.stringify(fresh));
  assert.equal(launches.length, 1);
  assert.notEqual(fresh.run_id, fx.tuple.run_id);

  const secondBackend = reconstructBackend(fx, {

    procs: { [process.pid]: "555", 5252: successorProcessStarttime },
    ids, launches, receiptStore: store
  });
  const continuation = await dispatchWorker(secondBackend, "cold-restart-2");
  assert.equal(continuation.accepted, false, JSON.stringify(continuation));
  assert.equal(continuation.detail?.continuation?.run_id, fresh.run_id);
  assertConvergentLoser(continuation, { winnerRunId: fresh.run_id });
  assert.equal(launches.length, 1);

});
