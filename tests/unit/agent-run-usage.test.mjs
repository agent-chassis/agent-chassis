import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_RUN_USAGE_COST_KIND,
  combinePopulationUsage,
  normalizeTokenUsage,
  reconcileInvocationUsage
} from "../../packages/agent-launch-core/src/lib/agent-run-usage.mjs";

const IDENTITY = {
  invocation_id: "invocation-1",
  session_id: "session-1",
  source_id: "source-a",
  population_id: "population-root",
  interval_id: "interval-1"
};
const complete = (value) => ({ value, observed: value, status: "complete" });
const partial = (observed) => ({ value: null, observed, status: "partial" });
const UNAVAILABLE = { value: null, observed: null, status: "unavailable" };
const FRESH = { kind: "fresh_session", session_created: true, session_id: IDENTITY.session_id };
const counters = (input, output, rest = {}) => ({ input, output, ...rest });
const estimate = (amount, rest = {}) => ({ amount, currency: "USD", source: "native-client", ...rest });
const codes = (result) => result.causes.map((cause) => cause.code);

function bound(identity, fact) {
  const { session_id, source_id, population_id } = identity;
  return { session_id, source_id, population_id, ...fact };
}
const snapshot = (sequence, value, cost) => bound(IDENTITY, { sequence, counters: value, cost });
const event = (event_id, value, cost) => bound(IDENTITY, { event_id, counters: value, cost });
const startSnapshot = (value, cost, rest = {}) =>
  bound(IDENTITY, { kind: "snapshot", interval_id: IDENTITY.interval_id, counters: value, cost, ...rest });

function cumulative(stream, source = {}) {
  return reconcileInvocationUsage({
    identity: IDENTITY,
    source: { input_semantics: "inclusive", counter_kind: "cumulative", descendant_coverage: "root_only", ...source },
    ...stream
  });
}

function incremental(stream) {
  return reconcileInvocationUsage({
    identity: IDENTITY,
    source: { input_semantics: "inclusive", counter_kind: "incremental", descendant_coverage: "root_only" },
    ...stream
  });
}

function populationUsage(identity, descendant_coverage, input, { cost, requests } = {}) {
  const merged = { ...IDENTITY, ...identity };
  return reconcileInvocationUsage({
    identity: merged,
    source: { input_semantics: "inclusive", counter_kind: "cumulative", descendant_coverage },
    baseline: { ...FRESH, session_id: merged.session_id },
    snapshots: [bound(merged, { sequence: 1, counters: counters(input, 10), cost })],
    requests
  });
}

test("token normalization preserves categories and missingness", () => {
  const reported = counters(100, 30, { cache_read: 40, cache_creation: 10, reasoning_output: 12 });
  const exclusive = normalizeTokenUsage({ input_semantics: "exclusive", counters: reported });
  assert.deepEqual(exclusive.causes, []);
  assert.deepEqual(exclusive.tokens, {
    input: complete(150),
    cache_read: complete(40),
    cache_creation: complete(10),
    output: complete(30),
    reasoning_output: complete(12),
    total: complete(180)
  });

  const inclusive = normalizeTokenUsage({ input_semantics: "inclusive", counters: { ...reported, input: 150 } });
  assert.deepEqual(inclusive.causes, []);
  assert.deepEqual(inclusive.tokens, exclusive.tokens);

  const zero = normalizeTokenUsage({
    input_semantics: "exclusive",
    counters: counters(0, 0, { cache_read: 0, cache_creation: 0, reasoning_output: 0 })
  });
  assert.deepEqual(zero.tokens.total, complete(0));
  assert.deepEqual(zero.tokens.cache_read, complete(0));

  const missingCache = normalizeTokenUsage({
    input_semantics: "exclusive",
    counters: counters(100, 30, { cache_creation: 10 }),
    identity: IDENTITY
  });
  assert.deepEqual(missingCache.tokens.input, partial(110));
  assert.deepEqual(missingCache.tokens.cache_read, UNAVAILABLE);
  assert.deepEqual(missingCache.tokens.output, complete(30));
  assert.deepEqual(missingCache.tokens.total, partial(140));
  assert.deepEqual(missingCache.causes, [
    { code: "missing_category", quantity: "cache_read", identity: IDENTITY, detail: null }
  ]);

  const inclusiveWithoutCache = normalizeTokenUsage({ input_semantics: "inclusive", counters: counters(150, 30) });
  assert.deepEqual(inclusiveWithoutCache.causes, []);
  assert.deepEqual(inclusiveWithoutCache.tokens.total, complete(180));
  assert.deepEqual(inclusiveWithoutCache.tokens.cache_read, UNAVAILABLE);
  assert.deepEqual(inclusiveWithoutCache.tokens.reasoning_output, UNAVAILABLE);

  const missingOutput = normalizeTokenUsage({ input_semantics: "inclusive", counters: { input: 150 } });
  assert.deepEqual(missingOutput.tokens.total, partial(150));
  assert.deepEqual(codes(missingOutput), ["missing_category"]);

  for (const invalid of ["100", -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity, true]) {
    const result = normalizeTokenUsage({ input_semantics: "inclusive", counters: counters(invalid, 30) });
    assert.deepEqual(result.tokens.input, UNAVAILABLE, `input ${String(invalid)}`);
    assert.deepEqual(result.tokens.total, partial(30));
    assert.deepEqual(result.causes.map(({ code, quantity }) => [code, quantity]), [["invalid_token_value", "input"]]);
  }

  const cacheExceedsInput = normalizeTokenUsage({
    input_semantics: "inclusive",
    counters: counters(150, 30, { cache_read: 90, cache_creation: 70 })
  });
  assert.deepEqual(cacheExceedsInput.tokens.input, UNAVAILABLE);
  assert.deepEqual(cacheExceedsInput.tokens.total, partial(30));
  assert.deepEqual(codes(cacheExceedsInput), ["subset_exceeds_parent"]);

  const reasoningExceedsOutput = normalizeTokenUsage({
    input_semantics: "inclusive",
    counters: counters(150, 30, { reasoning_output: 31 })
  });
  assert.deepEqual(reasoningExceedsOutput.tokens.output, UNAVAILABLE);
  assert.deepEqual(reasoningExceedsOutput.tokens.reasoning_output, UNAVAILABLE);
  assert.deepEqual(reasoningExceedsOutput.tokens.total, partial(150));

  const overflow = normalizeTokenUsage({
    input_semantics: "exclusive",
    counters: counters(Number.MAX_SAFE_INTEGER, 1, { cache_read: 1, cache_creation: 0 })
  });
  assert.deepEqual(overflow.tokens.input, UNAVAILABLE);
  assert.equal(overflow.tokens.total.value, null);
  assert.deepEqual(codes(overflow), ["unsafe_sum"]);

  const undeclared = normalizeTokenUsage({ input_semantics: "bytes", counters: reported });
  assert.deepEqual(undeclared.tokens.total, UNAVAILABLE);
  assert.deepEqual(codes(undeclared), ["invalid_source_declaration"]);
});

test("resume snapshots reconcile without duplicate charges", () => {
  const fresh = cumulative({
    baseline: FRESH,
    snapshots: [snapshot(2, counters(300, 40)), snapshot(1, counters(100, 10)), snapshot(2, counters(300, 40))]
  });
  assert.deepEqual(fresh.causes.filter((cause) => cause.quantity !== "peak_context"), []);
  assert.deepEqual(fresh.tokens.input, complete(300));
  assert.deepEqual(fresh.tokens.total, complete(340));

  const resumedStream = {
    baseline: startSnapshot(counters(300, 40)),
    snapshots: [snapshot(3, counters(500, 70))]
  };
  const resumed = cumulative(resumedStream);
  assert.deepEqual(resumed.tokens.input, complete(200));
  assert.deepEqual(resumed.tokens.output, complete(30));
  assert.deepEqual(resumed.session_cumulative.tokens.input, complete(500));
  assert.deepEqual(cumulative(resumedStream), resumed);

  const unbound = cumulative({ baseline: null, snapshots: resumedStream.snapshots });
  assert.deepEqual(unbound.tokens.input, UNAVAILABLE);
  assert.deepEqual(unbound.tokens.total, UNAVAILABLE);
  assert.deepEqual(unbound.session_cumulative.tokens.input, complete(500));
  assert.ok(codes(unbound).includes("missing_baseline"));

  const refusals = [
    [{ ...FRESH, session_created: false }, "unproven_fresh_session"],
    [{ ...FRESH, session_id: "session-2" }, "unproven_fresh_session"],
    [startSnapshot(counters(300, 40), undefined, { interval_id: "interval-0" }), "baseline_identity_mismatch"],
    [startSnapshot(counters(300, 40), undefined, { population_id: "population-other" }), "baseline_identity_mismatch"]
  ];
  for (const [baseline, code] of refusals) {
    const result = cumulative({ baseline, snapshots: resumedStream.snapshots });
    assert.deepEqual(result.tokens.total, UNAVAILABLE, code);
    assert.ok(codes(result).includes(code), code);
  }

  const disputed = [snapshot(1, counters(300, 40)), snapshot(1, counters(310, 40))];
  for (const order of [disputed, [...disputed].reverse()]) {
    const conflicting = cumulative({ baseline: FRESH, snapshots: order });
    assert.deepEqual(conflicting.tokens.input, UNAVAILABLE);
    assert.deepEqual(conflicting.tokens.total, UNAVAILABLE);
    assert.equal(conflicting.session_cumulative, null);
    assert.ok(codes(conflicting).includes("conflicting_snapshot"));
  }

  const topLevelReset = cumulative({ baseline: { kind: "reset", boundary_observed: true }, snapshots: disputed.slice(0, 1) });
  assert.deepEqual(topLevelReset.tokens.total, UNAVAILABLE);
  assert.deepEqual(topLevelReset.session_cumulative.tokens.total, complete(340));
  assert.ok(codes(topLevelReset).includes("missing_baseline"));

  const cached = (input, cache_read) => counters(input, 1, { cache_read, cache_creation: 0 });
  for (const [source, values, operand, kept] of [
    [{}, [counters(500, 40), counters(450, 200)], "input", { output: complete(200) }],
    [{ input_semantics: "exclusive" }, [cached(100, 100), cached(200, 50)], "cache_read", { cache_creation: complete(0), output: complete(1) }],
    [{ input_semantics: "exclusive" }, [cached(100, 0), cached(50, 100)], "input", { cache_read: complete(100), output: complete(1) }]
  ]) {
    const rollback = cumulative({ baseline: FRESH, snapshots: values.map((value, index) => snapshot(index + 1, value)) }, source);
    assert.deepEqual(rollback.tokens.input, UNAVAILABLE, operand);
    assert.deepEqual(rollback.tokens.total, UNAVAILABLE, operand);
    for (const [quantity, expected] of Object.entries(kept)) assert.deepEqual(rollback.tokens[quantity], expected, operand);
    assert.deepEqual(rollback.causes.filter((cause) => cause.code === "rollback").map((cause) => cause.quantity), [operand]);
  }

  const populationChanged = cumulative({
    baseline: FRESH,
    snapshots: [snapshot(1, counters(100, 10)), { ...snapshot(2, counters(300, 40)), population_id: "population-other" }]
  });
  assert.deepEqual(populationChanged.tokens.total, UNAVAILABLE);
  assert.ok(codes(populationChanged).includes("population_changed"));

  const reset = { kind: "reset", boundary_observed: true };
  const snapshots = [
    snapshot(1, counters(400, 50)), snapshot(2, counters(450, 60)),
    snapshot(3, counters(20, 5)), snapshot(4, counters(80, 9))
  ];
  const segments = (second) => [
    { segment_id: "segment-1", first_sequence: 1, last_sequence: 2, baseline: startSnapshot(counters(300, 40)) },
    { segment_id: "segment-2", first_sequence: 3, last_sequence: 4, baseline: reset, ...second }
  ];
  const segmented = cumulative({ segments: segments(), snapshots });
  assert.deepEqual(segmented.tokens.input, complete(230));
  assert.deepEqual(segmented.tokens.output, complete(29));

  const unsegmented = cumulative({ baseline: startSnapshot(counters(300, 40)), snapshots });
  assert.deepEqual(unsegmented.tokens.input, UNAVAILABLE);
  assert.ok(codes(unsegmented).includes("rollback"));
  for (const [second, code, expected] of [
    [{ first_sequence: 2 }, "overlapping_interval", UNAVAILABLE],
    [{ baseline: { kind: "reset", boundary_observed: false } }, "reset_boundary_ambiguous", partial(150)],
    [{ last_sequence: 3 }, "reset_boundary_ambiguous", UNAVAILABLE]
  ]) {
    const result = cumulative({ segments: segments(second), snapshots });
    assert.deepEqual(result.tokens.input, expected, code);
    assert.ok(codes(result).includes(code), code);
  }

  const first = populationUsage({}, "root_only", 200);
  const second = populationUsage({ invocation_id: "invocation-2", session_id: "session-2" }, "root_only", 200);
  const sessions = combinePopulationUsage({
    root: first,
    members: [{ relation: "managed_invocation", usage: second }, { relation: "managed_invocation", usage: second }]
  });
  assert.deepEqual(sessions.tokens.input, complete(400));
  assert.deepEqual(sessions.contributors.map((entry) => entry.disposition), ["counted", "counted", "duplicate"]);

  const events = [event("event-1", counters(10, 2)), event("event-2", counters(20, 3)), event("event-1", counters(10, 2))];
  const summed = incremental({ events, interval_complete: true });
  assert.deepEqual(summed.tokens.input, complete(30));
  assert.deepEqual(summed.tokens.total, complete(35));
  assert.equal(summed.session_cumulative, null);

  const emptyInterval = incremental({ events: [], interval_complete: true });
  assert.deepEqual(emptyInterval.tokens.total, complete(0));
  for (const stream of [{ events: [] }, { events: [event(undefined, counters(5, 1))], interval_complete: true }]) {
    const unattributable = incremental(stream);
    assert.deepEqual(unattributable.tokens.input, UNAVAILABLE);
    assert.deepEqual(unattributable.tokens.total, UNAVAILABLE);
    assert.deepEqual(unattributable.cost.amount, UNAVAILABLE);
  }

  for (const [stream, code, observed] of [
    [{ events: [...events, event(undefined, counters(5, 1))], interval_complete: true }, "missing_event_identity", 30],
    [{ events: [...events, event("event-2", counters(21, 3))], interval_complete: true }, "conflicting_event", 10],
    [{ events, interval_complete: true, gaps: [{ after: "event-1" }] }, "observed_gap", 30],
    [{ events }, "interval_completion_unobserved", 30]
  ]) {
    const result = incremental(stream);
    assert.deepEqual(result.tokens.input, partial(observed), code);
    assert.ok(codes(result).includes(code), code);
  }
});

test("descendant accounting preserves disjoint populations", () => {
  const child = populationUsage({ population_id: "population-child", source_id: "source-child" }, "root_only", 300);
  const nativeChild = { relation: "native_descendant", usage: child };
  const provenChild = { ...nativeChild, disjoint_proven: true, root_population_id: IDENTITY.population_id };
  const managed = {
    relation: "managed_invocation",
    usage: populationUsage({ invocation_id: "invocation-2", session_id: "session-2" }, "inclusive", 250)
  };
  const dispositions = (result) => result.contributors.map((entry) => entry.disposition);

  const inclusive = combinePopulationUsage({
    root: populationUsage({}, "inclusive", 1000),
    members: [nativeChild],
    expected_native_children: ["population-child"]
  });
  assert.deepEqual(inclusive.causes, []);
  assert.deepEqual(inclusive.tokens.input, complete(1000));
  assert.deepEqual(dispositions(inclusive), ["counted", "included_in_root"]);

  const rootOnly = populationUsage({}, "root_only", 700);
  const disjoint = combinePopulationUsage({
    root: rootOnly,
    members: [provenChild, provenChild],
    expected_native_children: ["population-child"]
  });
  assert.deepEqual(disjoint.causes, []);
  assert.deepEqual(disjoint.tokens.input, complete(1000));
  assert.deepEqual(disjoint.tokens.output, complete(20));
  assert.deepEqual(dispositions(disjoint), ["counted", "counted", "duplicate"]);

  for (const [tree, code] of [
    [{ members: [nativeChild] }, "unproven_disjoint_child"],
    [{ members: [{ ...provenChild, root_population_id: "population-other" }] }, "unproven_disjoint_child"],
    [{ members: [], expected_native_children: ["population-child"] }, "unresolved_expected_child"],
    [{ members: [{ ...managed, usage: child }] }, "unbound_contributor"]
  ]) {
    const result = combinePopulationUsage({ root: rootOnly, ...tree });
    assert.deepEqual(result.tokens.input, partial(700), code);
    assert.deepEqual(codes(result), [code]);
  }

  const conflictingChild = { ...provenChild, usage: { ...child, tokens: { ...child.tokens, input: complete(301) } } };
  const conflicted = combinePopulationUsage({ root: rootOnly, members: [provenChild, conflictingChild] });
  assert.equal(conflicted.tokens.input.value, null);
  assert.deepEqual(codes(conflicted), ["conflicting_contributor"]);

  const unknownRoot = populationUsage({}, "unknown", 700);
  for (const members of [[], [provenChild]]) {
    const unknown = combinePopulationUsage({ root: unknownRoot, members });
    assert.deepEqual(unknown.tokens.input, partial(700));
    assert.deepEqual(unknown.tokens.total, partial(710));
    assert.deepEqual(codes(unknown), ["unknown_descendant_coverage"]);
  }

  const withManaged = combinePopulationUsage({
    root: populationUsage({}, "inclusive", 1000),
    members: [nativeChild, managed]
  });
  assert.deepEqual(withManaged.causes, []);
  assert.deepEqual(withManaged.tokens.input, complete(1250));
  assert.deepEqual(dispositions(withManaged), ["counted", "included_in_root", "counted"]);

  const unknownManaged = populationUsage({ invocation_id: "invocation-2", session_id: "session-2" }, "unknown", 250);
  const unknownChild = populationUsage({ population_id: "population-child", source_id: "source-child" }, "unknown", 300);
  for (const [root, member, observed] of [
    [populationUsage({}, "inclusive", 1000), { ...managed, usage: unknownManaged }, 1250],
    [rootOnly, { ...provenChild, usage: unknownChild }, 1000]
  ]) {
    const result = combinePopulationUsage({ root, members: [member] });
    assert.deepEqual(result.tokens.input, partial(observed));
    assert.equal(result.tokens.total.value, null);
    assert.deepEqual(dispositions(result), ["counted", "counted"]);
    assert.deepEqual(
      result.causes.map((cause) => [cause.code, cause.identity]),
      [["unknown_descendant_coverage", member.usage.identity]]
    );
  }
});

test("cost coverage and peak context stay evidence bound", () => {
  const exclusive = { input_semantics: "exclusive" };
  const resumed = cumulative({
    baseline: startSnapshot(counters(300, 40), estimate(0.5)),
    snapshots: [snapshot(3, counters(500, 70), estimate(1.25))]
  });
  assert.deepEqual(resumed.cost, {
    amount: complete(0.75),
    currency: "USD",
    source: "native-client",
    kind: AGENT_RUN_USAGE_COST_KIND
  });
  assert.equal(AGENT_RUN_USAGE_COST_KIND, "native_estimate");

  const withoutCost = cumulative({ baseline: FRESH, snapshots: [snapshot(1, counters(500, 70))] });
  assert.deepEqual(withoutCost.cost, { amount: UNAVAILABLE, currency: null, source: null, kind: "native_estimate" });
  assert.deepEqual(withoutCost.tokens.total, complete(570));

  const costOnly = cumulative({ baseline: FRESH, snapshots: [snapshot(1, { input: 500 }, estimate(1.25))] });
  assert.deepEqual(costOnly.cost.amount, complete(1.25));
  assert.equal(costOnly.tokens.total.value, null);

  const unboundCost = cumulative({
    baseline: startSnapshot(counters(300, 40)),
    snapshots: [snapshot(3, counters(500, 70), estimate(1.25))]
  });
  assert.deepEqual(unboundCost.cost.amount, UNAVAILABLE);
  assert.deepEqual(unboundCost.tokens.total, complete(230));
  assert.deepEqual(unboundCost.session_cumulative.cost, complete(1.25));
  assert.ok(unboundCost.causes.some((cause) => cause.code === "missing_baseline" && cause.quantity === "cost"));

  for (const [start, end, code] of [
    [estimate(0.5), estimate(-1), "invalid_cost"],
    [estimate(0.5), estimate(Number.NaN), "invalid_cost"],
    [estimate(0.5), estimate("1.25"), "invalid_cost"],
    [estimate(0.5), estimate(1.25, { currency: "" }), "invalid_cost"],
    [estimate(0.5), estimate(1.25, { currency: "EUR" }), "inconsistent_cost_label"],
    [estimate(0.5), estimate(1.25, { source: "other-client" }), "inconsistent_cost_label"],
    [estimate(1.5), estimate(1.25), "rollback"]
  ]) {
    const result = cumulative({
      baseline: startSnapshot(counters(300, 40), start),
      snapshots: [snapshot(3, counters(500, 70), end)]
    });
    assert.deepEqual(result.cost.amount, UNAVAILABLE, code);
    assert.deepEqual(result.tokens.total, complete(230), code);
    assert.ok(codes(result).includes(code), code);
  }

  const tokenDispute = (first, second, baseline = startSnapshot(counters(300, 40), estimate(0.5))) => cumulative({
    baseline,
    snapshots: [snapshot(3, counters(500, 70), first), snapshot(3, counters(510, 70), second)]
  });
  const tokenOnly = tokenDispute(estimate(1.25), estimate(1.25));
  assert.deepEqual(tokenOnly.cost.amount, complete(0.75));
  assert.deepEqual(tokenOnly.tokens.total, UNAVAILABLE);
  assert.deepEqual(tokenOnly.tokens.output, UNAVAILABLE);
  assert.equal(tokenOnly.session_cumulative, null);
  assert.ok(codes(tokenOnly).includes("conflicting_snapshot"));
  for (const disputed of [
    tokenDispute(estimate(1.25), estimate(1.5)),
    tokenDispute(estimate(1.25), estimate(1.25, { source: "other-client" })),
    tokenDispute(estimate(1.25), estimate(1.25), null),
    tokenDispute(estimate(1.25), estimate(1.25), startSnapshot(counters(300, 40)))
  ]) {
    assert.deepEqual(disputed.cost.amount, UNAVAILABLE);
    assert.deepEqual(disputed.tokens.total, UNAVAILABLE);
  }

  const emptyInterval = incremental({ events: [], interval_complete: true });
  assert.deepEqual(emptyInterval.cost, { amount: UNAVAILABLE, currency: null, source: null, kind: "native_estimate" });

  const eventCost = incremental({
    events: [event("event-1", counters(10, 2), estimate(0.25)), event("event-2", counters(20, 3))],
    interval_complete: true
  });
  assert.deepEqual(eventCost.cost.amount, partial(0.25));
  assert.deepEqual(eventCost.tokens.total, complete(35));

  const requests = {
    coverage_complete: true,
    observations: [
      { request_id: "request-1", counters: counters(100, 5, { cache_read: 20, cache_creation: 0 }) },
      { request_id: "request-2", counters: counters(300, 9, { cache_read: 90, cache_creation: 10 }) },
      { request_id: "request-3", counters: counters(250, 7, { cache_read: 0, cache_creation: 0 }) },
      { request_id: "request-2", counters: counters(300, 9, { cache_read: 90, cache_creation: 10 }) }
    ]
  };
  const stream = {
    baseline: FRESH,
    snapshots: [snapshot(1, counters(650, 21, { cache_read: 110, cache_creation: 10 }))]
  };
  const peaked = cumulative({ ...stream, requests }, exclusive);
  assert.deepEqual(peaked.tokens.input, complete(770));
  assert.deepEqual(peaked.peak_context, complete(400));

  const withoutRequests = cumulative(stream, exclusive);
  assert.deepEqual(withoutRequests.peak_context, UNAVAILABLE);
  assert.deepEqual(withoutRequests.tokens.input, complete(770));
  assert.deepEqual(cumulative({ ...stream, requests: { coverage_complete: true, observations: [] } }, exclusive).peak_context, UNAVAILABLE);

  const unidentified = { counters: counters(900, 1, { cache_read: 0, cache_creation: 0 }) };
  const uncached = { request_id: "request-4", counters: counters(900, 1) };
  for (const [evidence, code] of [
    [{ ...requests, coverage_complete: false }, "request_coverage_incomplete"],
    [{ ...requests, observations: [...requests.observations, unidentified] }, "missing_request_identity"],
    [{ ...requests, observations: [...requests.observations, uncached] }, "missing_category"]
  ]) {
    const result = cumulative({ ...stream, requests: evidence }, exclusive);
    assert.deepEqual(result.peak_context, partial(400), code);
    assert.ok(codes(result).includes(code), code);
  }

  const single = (request_id, input) => ({
    coverage_complete: true,
    observations: [{ request_id, counters: counters(input, 1) }]
  });
  const inputOnly = { coverage_complete: true, observations: [{ request_id: "request-1", counters: { input: 400 } }] };
  const inputOnlyPeak = cumulative({ baseline: FRESH, snapshots: [snapshot(1, counters(650, 21))], requests: inputOnly });
  assert.deepEqual(inputOnlyPeak.peak_context, complete(400));
  assert.deepEqual(inputOnlyPeak.causes, []);
  const invalidInput = cumulative({ baseline: FRESH, snapshots: [snapshot(1, counters(650, 21))], requests: single("request-1", -1) });
  assert.deepEqual(invalidInput.peak_context, UNAVAILABLE);
  assert.deepEqual(invalidInput.causes.map(({ code, quantity }) => [code, quantity]), [["invalid_token_value", "input"]]);
  const priced = populationUsage({}, "root_only", 700, { cost: estimate(1.25), requests: single("request-1", 400) });
  const unpriced = populationUsage(
    { invocation_id: "invocation-2", session_id: "session-2" }, "root_only", 250,
    { requests: single("request-9", 250) }
  );
  const tree = combinePopulationUsage({ root: priced, members: [{ relation: "managed_invocation", usage: unpriced }] });
  assert.deepEqual(tree.tokens.input, complete(950));
  assert.deepEqual(tree.cost, { amount: partial(1.25), currency: "USD", source: "native-client", kind: "native_estimate" });
  assert.deepEqual(tree.peak_context, complete(400));
});
