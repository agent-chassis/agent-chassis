import assert from "node:assert/strict";
import test from "node:test";

import {
  isTerminalReviewLifecycleRefusal,
  normalizeAuthenticatedTerminalReviewLifecycleDelta
} from "../packages/agent-launch-cli/src/lib/backend-terminal-review-lifecycle-authority.mjs";

const CLOSURE = Object.freeze({
  summary: "Implemented and verified.",
  validation: ["node --test"],
  follow_ups: []
});

function contract({ parentStatus = "review", reviewStatus = "review", dependencyStatus = "review", closure, secondDependencyStatus, secondClosure, mutate } = {}) {
  const record = {
    id: "WK-1788",
    status: parentStatus,
    slices: [
      {
        id: "SLICE-010",
        work_kind: "review",
        review_purpose: "terminal_whole_wk",
        status: reviewStatus,
        depends_on: ["WK-1788#SLICE-011"],
        sections: {}
      },
      {
        id: "SLICE-011",
        work_kind: "implementation",
        status: dependencyStatus,
        sections: {}
      },
      ...(secondDependencyStatus === undefined ? [] : [{
        id: "SLICE-012",
        work_kind: "implementation",
        status: secondDependencyStatus,
        sections: {}
      }])
    ]
  };
  if (closure !== undefined) record.slices[1].sections.closure = closure;
  if (secondClosure !== undefined) record.slices[2].sections.closure = secondClosure;
  mutate?.(record);
  return JSON.stringify(record);
}

function normalize(historicalParentContract, liveParentContract) {
  return normalizeAuthenticatedTerminalReviewLifecycleDelta({
    historicalParentContract,
    liveParentContract,
    recordId: "WK-1788",
    reviewSliceId: "SLICE-010"
  });
}

function refuses(historical, live) {
  assert.throws(
    () => normalize(historical, live),
    (error) => isTerminalReviewLifecycleRefusal(error) &&
      error.terminal_review_lifecycle.reason === "authored_contract_changed_beyond_authenticated_transition"
  );
}

test("WK-1788#SLICE-011 admits declared final implementation review-to-done with absent-to-canonical closure", () => {
  const historical = contract({ dependencyStatus: "review" });
  const live = contract({ dependencyStatus: "done", closure: CLOSURE });
  const result = normalize(historical, live);
  assert.deepEqual(result.dependencies, [{ slice_id: "SLICE-011", from: "review", to: "done" }]);
});

test("WK-1788#SLICE-011 refuses undeclared, cross-WK, non-implementation, and changed dependencies", () => {
  for (const mutate of [
    (record) => { record.slices[0].depends_on = []; },
    (record) => { record.slices[0].depends_on = ["WK-9999#SLICE-011"]; },
    (record) => { record.slices[1].work_kind = "review"; },
    (record) => { record.slices[0].depends_on = ["WK-1788#SLICE-010"]; }
  ]) {
    refuses(contract({ dependencyStatus: "review" }), contract({ dependencyStatus: "done", closure: CLOSURE, mutate }));
  }
});

test("WK-1788#SLICE-011 refuses invalid, extra, existing, and closure-only changes", () => {
  const invalidClosures = [
    { summary: "missing fields" },
    { summary: "ok", validation: [], follow_ups: [], extra: true },
    { summary: "ok", validation: [3], follow_ups: [] }
  ];
  for (const closure of invalidClosures) {
    refuses(contract({ dependencyStatus: "review" }), contract({ dependencyStatus: "done", closure }));
  }
  refuses(contract({ dependencyStatus: "review", closure: CLOSURE }), contract({ dependencyStatus: "done", closure: { ...CLOSURE, summary: "changed" } }));
  refuses(contract({ dependencyStatus: "review" }), contract({ dependencyStatus: "review", closure: CLOSURE }));
  refuses(contract({ dependencyStatus: "todo" }), contract({ dependencyStatus: "done", closure: CLOSURE }));
});

test("WK-1788#SLICE-011 refuses two newly-added closures across declared dependencies", () => {
  const historical = contract({
    dependencyStatus: "review",
    secondDependencyStatus: "review",
    mutate: (record) => { record.slices[0].depends_on.push("WK-1788#SLICE-012"); }
  });
  const live = contract({
    dependencyStatus: "done",
    closure: CLOSURE,
    secondDependencyStatus: "done",
    secondClosure: CLOSURE,
    mutate: (record) => { record.slices[0].depends_on.push("WK-1788#SLICE-012"); }
  });
  refuses(historical, live);
});

test("WK-1788#SLICE-011 refuses unrelated slice-field drift", () => {
  refuses(
    contract({ dependencyStatus: "review" }),
    contract({ dependencyStatus: "done", closure: CLOSURE, mutate: (record) => {
      record.slices[1].title = "unauthorized";
    } })
  );
});
