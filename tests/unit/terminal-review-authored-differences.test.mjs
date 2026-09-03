import assert from "node:assert/strict";
import test from "node:test";

import {
  isTerminalReviewLifecycleRefusal,
  normalizeAuthenticatedTerminalReviewLifecycleDelta,
  projectAuthenticatedTerminalReviewAuthoredDifferences
} from "../../packages/agent-launch-cli/src/lib/backend-terminal-review-lifecycle-authority.mjs";

const ADDRESS = Object.freeze({ recordId: "WK-1864", reviewSliceId: "SLICE-044" });

function contract({ parentStatus = "review", reviewStatus = "review", dependencyStatus,
  dependencyAddress = "WK-1864#SLICE-003", closure, mutate } = {}) {
  const review = {
    id: "SLICE-044",
    work_kind: "review",
    review_purpose: "terminal_whole_wk",
    status: reviewStatus,
    write_scope: [],
    acceptance: { criteria: ["findings-only"] }
  };
  const slices = [review];
  if (dependencyStatus !== undefined) {
    review.depends_on = [dependencyAddress];
    const dependency = { id: "SLICE-003", work_kind: "implementation", status: dependencyStatus, sections: {} };
    if (closure !== undefined) dependency.sections.closure = closure;
    slices.push(dependency);
  }
  const record = {
    id: "WK-1864",
    initiative: "IN-0016",
    title: "terminal review",
    status: parentStatus,
    acceptance: { criteria: ["review the candidate"], validation: ["node --test"] },
    slices
  };
  mutate?.(record);
  return JSON.stringify(record);
}

function project(historicalParentContract, liveParentContract, extra = {}) {
  return projectAuthenticatedTerminalReviewAuthoredDifferences({
    historicalParentContract,
    liveParentContract,
    ...ADDRESS,
    ...extra
  });
}

function assertRefusal(historicalParentContract, liveParentContract, reason) {
  assert.throws(
    () => project(historicalParentContract, liveParentContract),
    (error) => isTerminalReviewLifecycleRefusal(error) &&
      error.terminal_review_lifecycle.reason === reason
  );
}

function assertNormalizationRefusal(historicalParentContract, liveParentContract, reason) {
  assert.throws(
    () => normalizeAuthenticatedTerminalReviewLifecycleDelta({
      historicalParentContract,
      liveParentContract,
      ...ADDRESS
    }),
    (error) => isTerminalReviewLifecycleRefusal(error) &&
      error.terminal_review_lifecycle.reason === reason
  );
}

test("returns a frozen empty population for identical and formatting-only contracts", () => {
  const historical = contract();
  const live = JSON.stringify(JSON.parse(historical), null, 2);
  const result = project(historical, live);
  assert.deepEqual(result, []);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(project(historical, historical)), true);
});

test("authenticated parent, review-unit, dependency, and one completion closure are neutralized", () => {
  for (const [historical, live] of [
    [contract({ parentStatus: "todo", reviewStatus: "todo" }), contract()],
    [contract({ parentStatus: "active", reviewStatus: "todo" }), contract()],
    [contract({ parentStatus: "review", reviewStatus: "todo" }), contract({ reviewStatus: "review" })],
    [contract({ dependencyStatus: "todo" }), contract({ dependencyStatus: "done" })],
    [contract({ dependencyStatus: "review" }), contract({ dependencyStatus: "done", closure: {
      summary: "complete", validation: ["node --test"], follow_ups: []
    } })]
  ]) assert.deepEqual(project(historical, live), []);
});

test("reports every non-neutralized authored field and preserves decision order", () => {
  for (const [mutate, expected] of [
    [(record) => { record.title = "changed"; },
      [{ path: "/title", change_kind: "replace" }]],
    [(record) => { record.acceptance.criteria.push("extra"); },
      [{ path: "/acceptance/criteria/1", change_kind: "add" }]],
    [(record) => { record.slices[0].write_scope = ["unexpected"]; },
      [{ path: "/slices/0/write_scope/0", change_kind: "add" }]],
    [(record) => { record.slices.push({ id: "SLICE-045", work_kind: "implementation", status: "todo" }); },
      [{ path: "/slices/1", change_kind: "add" }]]
  ]) {
    const historical = contract({ parentStatus: "todo", reviewStatus: "todo" });
    const live = contract({ parentStatus: "review", reviewStatus: "review", mutate });
    assertNormalizationRefusal(historical, live, "authored_contract_changed_beyond_authenticated_transition");
    assert.deepEqual(project(historical, live), expected);
  }
  assertRefusal(contract({ parentStatus: "done", reviewStatus: "todo" }), contract(),
    "parent_status_transition_unauthenticated");
  assert.deepEqual(project(contract({ parentStatus: "done", reviewStatus: "todo" }),
    contract({ parentStatus: "review", reviewStatus: "todo", mutate: (record) => { record.title = "changed"; } })), [
    { path: "/title", change_kind: "replace" }
  ]);
});

test("walks objects and arrays with RFC 6901 pointers and exact change kinds", () => {
  const historical = contract({ mutate: (record) => {
    record.extra = { "a~b/c": { kept: 1 }, removed: { nested: true }, scalar: 1, array: ["a", { x: 1 }, 3] };
  } });
  const live = contract({ mutate: (record) => {
    record.extra = { "a~b/c": { kept: 2, added: true }, scalar: "1", array: ["b", { x: 2 }, 3, 4] };
  } });
  assert.deepEqual(project(historical, live), [
    { path: "/extra/array/0", change_kind: "replace" },
    { path: "/extra/array/1/x", change_kind: "replace" },
    { path: "/extra/array/3", change_kind: "add" },
    { path: "/extra/a~0b~1c/added", change_kind: "add" },
    { path: "/extra/a~0b~1c/kept", change_kind: "replace" },
    { path: "/extra/removed", change_kind: "remove" },
    { path: "/extra/scalar", change_kind: "replace" }
  ]);
  assert.equal(Object.isFrozen(project(historical, live)[0]), true);
  const oneSided = project(contract({ mutate: (record) => { record.left = { nested: { value: 1 } }; } }),
    contract());
  assert.deepEqual(oneSided, [{ path: "/left", change_kind: "remove" }]);
  assert.deepEqual(project(contract(), contract({ mutate: (record) => {
    record.right = { nested: { value: 1 } };
  } })), [{ path: "/right", change_kind: "add" }]);
  assert.deepEqual(project(contract({ mutate: (record) => {
    record.extra = { history: ["a", "b", "c"] };
  } }), contract({ mutate: (record) => {
    record.extra = { history: ["a"] };
  } })), [
    { path: "/extra/history/1", change_kind: "remove" },
    { path: "/extra/history/2", change_kind: "remove" }
  ]);
});

test("sorts Unicode code points then add/remove/replace, without duplicate pairs", () => {
  const result = project(contract({ mutate: (record) => {
    record["😀"] = 1;
    record["\uE000"] = 1;
    record.a = 1;
  } }), contract({ mutate: (record) => {
    record["😀"] = 2;
    record["\uE000"] = 2;
    record.a = null;
    record.b = 3;
  } }));
  assert.deepEqual(result, [
    { path: "/a", change_kind: "replace" },
    { path: "/b", change_kind: "add" },
    { path: "/", change_kind: "replace" },
    { path: "/😀", change_kind: "replace" }
  ]);
  assert.equal(new Set(result.map(({ path, change_kind }) => `${path}\0${change_kind}`)).size, result.length);
  assert.deepEqual(project(contract({ mutate: (record) => { record.value = -0; } }),
    contract({ mutate: (record) => { record.value = 0; } })), []);
  assert.deepEqual(project(contract({ mutate: (record) => { record.value = 1; } }),
    contract({ mutate: (record) => { record.value = 1.5; } })), [{ path: "/value", change_kind: "replace" }]);
});

test("is uncapped at 10,001 authored differences", () => {
  const historical = contract({ mutate: (record) => { record.values = []; } });
  const live = contract({ mutate: (record) => { record.values = Array.from({ length: 10001 }, (_, index) => index); } });
  const result = project(historical, live);
  assert.equal(result.length, 10001);
  assert.equal(new Set(result.map(({ path, change_kind }) => `${path}\0${change_kind}`)).size, 10001);
  assert.equal(result.at(-1).path, "/values/9999");
});

test("empty projection is equivalent to canonical prepared-byte equality and normalization flag", () => {
  const historical = contract({ parentStatus: "todo", reviewStatus: "todo", dependencyStatus: "review" });
  const live = contract({ parentStatus: "review", reviewStatus: "review", dependencyStatus: "done", closure: {
    summary: "complete", validation: ["node --test"], follow_ups: []
  } });
  assert.deepEqual(project(historical, live), []);
  assert.equal(normalizeAuthenticatedTerminalReviewLifecycleDelta({
    historicalParentContract: historical, liveParentContract: live, ...ADDRESS
  }).parent.from, "todo");
  const changed = contract({ parentStatus: "review", reviewStatus: "review", mutate: (record) => { record.title = "changed"; } });
  assert.equal(project(live, changed).length > 0, true);
  assertNormalizationRefusal(
    live,
    changed,
    "authored_contract_changed_beyond_authenticated_transition"
  );
});

test("retains malformed, identity, slice, dependency, sibling, and closure refusals", () => {
  for (const [historical, live, reason] of [
    ["not json", contract(), "historical_contract_unreadable"],
    ["[]", contract(), "historical_contract_unreadable"],
    [contract(), contract(), "addressed_unit_identity_is_not_canonical"]
  ]) {
    if (reason === "addressed_unit_identity_is_not_canonical") {
      assert.throws(() => project(historical, live, { recordId: "bad", reviewSliceId: "SLICE-044" }),
        (error) => isTerminalReviewLifecycleRefusal(error) && error.terminal_review_lifecycle.reason === reason);
    } else assertRefusal(historical, live, reason);
  }
  const wrongIdentity = contract({ mutate: (record) => { record.id = "WK-9999"; } });
  assertRefusal(wrongIdentity, contract(), "historical_contract_identity_mismatch");
  const absentSlice = contract({ mutate: (record) => { record.slices = []; } });
  assertRefusal(absentSlice, contract(), "historical_designated_review_unit_absent");
  assertNormalizationRefusal(contract({ dependencyStatus: "active" }), contract({ dependencyStatus: "done" }),
    "authored_contract_changed_beyond_authenticated_transition");
  assertNormalizationRefusal(contract({ dependencyStatus: "review" }), contract({ dependencyStatus: "done", mutate: (record) => {
    record.slices[0].depends_on = ["SLICE-003"];
  } }), "authored_contract_changed_beyond_authenticated_transition");
  assertNormalizationRefusal(contract({ dependencyStatus: "review" }), contract({ dependencyStatus: "done", closure: {
    summary: "x", validation: [], follow_ups: []
  }, mutate: (record) => {
    record.slices.push({ id: "SLICE-005", work_kind: "implementation", status: "done", sections: {
      closure: { summary: "x", validation: [], follow_ups: [] }
    } });
  } }), "authored_contract_changed_beyond_authenticated_transition");
  assertNormalizationRefusal(contract({ dependencyStatus: "review" }), contract({ dependencyStatus: "done", dependencyAddress: "WK-9999#SLICE-003" }),
    "authored_contract_changed_beyond_authenticated_transition");
  assertNormalizationRefusal(contract({ dependencyStatus: "review" }), contract({ dependencyStatus: "done", closure: { invalid: true } }),
    "authored_contract_changed_beyond_authenticated_transition");
  assertNormalizationRefusal(contract({ dependencyStatus: "review" }), contract({ dependencyStatus: "done", closure: { summary: "x", validation: [], follow_ups: [] }, mutate: (record) => {
    record.slices.push({ id: "SLICE-003", work_kind: "implementation", status: "done", sections: { closure: { summary: "x", validation: [], follow_ups: [] } } });
  } }), "authored_contract_changed_beyond_authenticated_transition");
});
