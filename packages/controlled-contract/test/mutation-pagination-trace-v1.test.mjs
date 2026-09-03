import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonBytes, sha256 } from "../lib/exact-binding-common.mjs";
import {
  assertCanonicalProjectionResult,
  executeDeterministicProjection,
  projectDeterministicPopulation
} from "../lib/deterministic-projection.mjs";
import {
  COMPLETE_TRAVERSAL_RESOURCE_LIMITS,
  assertCompleteTraversalResourceUsage,
  completeTraversalOccurrenceId
} from "../lib/mutation-pagination-trace-projection.mjs";
import {
  completeTraversalProjection
} from "../lib/mutation-pagination-complete-traversal.mjs";
import {
  snapshotTraceFixture,
  versionedCursorTraceFixture
} from "./proof-packs/mutation-pagination-trace-v1-fixture.mjs";
import {
  completeTraversalTraceFixture,
  rebuildCompleteSources
} from "./proof-packs/complete-pagination-traversal-v1-fixture.mjs";
import {
  rederiveVersioned,
  sources
} from "./proof-packs/mutation-pagination-v1-harness.mjs";

const transformerId = "mutation-pagination-trace.v1";

function execute(fixture) {
  const bytes = executeDeterministicProjection(transformerId, fixture.sources);
  return { bytes, value: assertCanonicalProjectionResult(transformerId, bytes) };
}

test("snapshot trace preserves ordered repeated occurrences while projections remain sets", () => {
  const { bytes, value } = execute(snapshotTraceFixture());
  assert.equal(value.policy, "snapshot");
  assert.equal(value.ordered_occurrences.stable_member_occurrence_ids.length, 3);
  assert.equal(value.ordered_occurrences.interleaved_member_occurrence_ids.length, 3);
  assert.equal(new Set(value.ordered_occurrences.interleaved_member_occurrence_ids).size, 3);
  assert.equal(projectDeterministicPopulation(transformerId, bytes, "snapshot").length, 1);
  assert.equal(projectDeterministicPopulation(transformerId, bytes, "member_occurrences").length, 3);
});
test("versioned cursor trace selects exact stale and non-stale control occurrences", () => {
  const { bytes, value } = execute(versionedCursorTraceFixture());
  assert.equal(value.policy, "versioned_cursor_refusal");
  for (const population of [
    "traversal", "stale_cursor", "stale_attempt", "refusal",
    "relevant_mutation", "unrelated_mutation", "control_attempt",
    "control_return", "control_advancement"
  ]) assert.equal(projectDeterministicPopulation(transformerId, bytes, population).length, 1);
  assert.equal(projectDeterministicPopulation(
    transformerId, bytes, "protected_effects"
  ).length, 4);
  assert.deepEqual(value.projections.effect_occurrences, []);
});

test("mutation pagination transformation is deterministic and pure", () => {
  const fixture = snapshotTraceFixture();
  const before = structuredClone(fixture.trace);
  const first = executeDeterministicProjection(transformerId, fixture.sources);
  const second = executeDeterministicProjection(transformerId, fixture.sources);
  assert.ok(first.equals(second));
  assert.deepEqual(fixture.trace, before);
});

test("rejects final-count, omitted, duplicated, and reordered occurrence reports", () => {
  for (const options of [
    { stable_members: ["member-alpha", "member-beta"] },
    { interleaved_pages: [["member-alpha"], ["member-beta"]] },
    { interleaved_pages: [["member-alpha", "member-alpha"], ["member-alpha"]] },
    { interleaved_pages: [["member-alpha", "member-beta"], ["member-alpha"]] }
  ]) assert.throws(
    () => executeDeterministicProjection(transformerId, snapshotTraceFixture(options).sources),
    /ordered member occurrences must match exactly/
  );
});

test("rejects result-schema substitution and fabricated singleton populations", () => {
  const { bytes, value } = execute(snapshotTraceFixture());
  assert.throws(
    () => assertCanonicalProjectionResult("integration-prefix-census.v1", bytes),
    /registered canonical output/
  );
  const fabricated = structuredClone(value);
  fabricated.projections.snapshot.push("ref-snapshot-substitute");
  fabricated.projections.snapshot.sort();
  assert.throws(
    () => projectDeterministicPopulation(
      transformerId, canonicalJsonBytes(fabricated, { file: true }), "snapshot"
    ),
    /singleton pagination projections/
  );
});

test("rejects incomplete source tuples and capture substitutions", () => {
  const fixture = versionedCursorTraceFixture();
  assert.throws(
    () => executeDeterministicProjection(transformerId, fixture.sources.slice(0, 4)),
    /requires every captured source byte sequence/
  );
  const swapped = [...fixture.sources];
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.throws(
    () => executeDeterministicProjection(transformerId, swapped),
    /capture digests must identify the exact captured sources/
  );
});

test("permits unprotected stale-attempt effects but binds control advancement cursor", () => {
  const allowed = versionedCursorTraceFixture();
  const stale = allowed.trace.page_attempts.find(({ kind }) => kind === "stale");
  allowed.trace.refusals[0].position = 7;
  allowed.trace.effect_occurrences.push({
    occurrence_id: "occ-placeholder", position: 6,
    attempt_occurrence_id: stale.occurrence_id,
    effect_id: "audit-log", operation: "write"
  });
  rederiveVersioned(allowed.trace);
  allowed.sources = sources(allowed);
  assert.doesNotThrow(() => execute(allowed));

  const wrongCursor = versionedCursorTraceFixture();
  wrongCursor.trace.advancements[0].cursor_id = "cursor-stale";
  rederiveVersioned(wrongCursor.trace);
  wrongCursor.sources = sources(wrongCursor);
  assert.throws(() => execute(wrongCursor), /non-stale control attempt must return and advance/);
});

test("does not impose an undeclared aggregate occurrence ceiling", () => {
  const members = Array.from({ length: 50001 }, (_, index) => `member-${index}`);
  const fixture = snapshotTraceFixture({
    stable_members: members,
    interleaved_pages: [members.slice(0, 25000), members.slice(25000)]
  });
  assert.doesNotThrow(() => execute(fixture));
});

function assertCompleteRefusal(mutator, code, options = {}) {
  const fixture = completeTraversalTraceFixture(options);
  mutator(fixture);
  rebuildCompleteSources(fixture, { reauthenticate: options.reauthenticate === true });
  assert.throws(
    () => executeDeterministicProjection(transformerId, fixture.sources),
    (error) => error.code === code,
    code
  );
}

test("complete traversal accepts empty through multi-page populations deterministically", () => {
  for (const options of [
    { member_ids: [], page_sizes: [0] },
    { member_ids: ["member-alpha"], page_sizes: [1] },
    { member_ids: ["member-alpha", "member-beta"], page_sizes: [1, 1] },
    { page_sizes: [1, 1, 1, 1, 1] },
    { page_sizes: [2, 2, 1] },
    { page_sizes: [3, 2] }
  ]) {
    const fixture = completeTraversalTraceFixture(options);
    const first = execute(fixture);
    const second = execute(fixture);
    assert.ok(first.bytes.equals(second.bytes));
    assert.equal(first.value.policy, "complete_traversal");
    assert.deepEqual(
      first.value.ordered_occurrences.authoritative_occurrence_ids,
      first.value.ordered_occurrences.returned_occurrence_ids
    );
  }
});

test("complete traversal result is invariant under page repartitioning and reference renaming", () => {
  const one = execute(completeTraversalTraceFixture({ page_sizes: [2, 2, 1] })).value;
  const two = execute(completeTraversalTraceFixture({
    page_sizes: [1, 3, 1], reference_prefix: "ref-renamed"
  })).value;
  assert.deepEqual(one.ordered_occurrences, two.ordered_occurrences);
  assert.deepEqual(one.projections.authoritative_occurrences,
    two.projections.authoritative_occurrences);
  assert.deepEqual(one.projections.equality_normalized_members,
    two.projections.equality_normalized_members);
});

test("complete traversal performs one authoritative Set lookup per member", () => {
  const memberCount = 512;
  const memberIds = Array.from(
    { length: memberCount }, (_, index) => `wk2087-linear-member-${index}`
  );
  const fixture = completeTraversalTraceFixture({
    member_ids: memberIds,
    page_sizes: [memberCount]
  });
  const expectedOccurrenceIds = fixture.population.occurrences.map(
    ({ source_occurrence_id: sourceOccurrenceId }) => completeTraversalOccurrenceId(
      fixture.population.source_grounded_identity_sha256, sourceOccurrenceId
    )
  );
  const originalHas = Set.prototype.has;
  const authoritativeMembershipLookups = new Map();
  Set.prototype.has = function (value) {
    if (this.size === memberCount && expectedOccurrenceIds.indexOf(value) !== -1) {
      authoritativeMembershipLookups.set(
        this, (authoritativeMembershipLookups.get(this) ?? 0) + 1
      );
    }
    return Reflect.apply(originalHas, this, [value]);
  };

  let value;
  try {
    ({ value } = execute(fixture));
    assert.equal(value.policy, "complete_traversal");
  } finally {
    Set.prototype.has = originalHas;
  }
  assert.equal(authoritativeMembershipLookups.size, 2);
  assert.deepEqual([...authoritativeMembershipLookups.values()], [
    memberCount, memberCount
  ]);
  assert.deepEqual(
    value.ordered_occurrences.authoritative_occurrence_ids,
    expectedOccurrenceIds.map((occurrenceId) => `ref-${occurrenceId}`)
  );
  const expectedWorkUnits = memberCount + memberCount +
    fixture.trace.pages.length + fixture.trace.transitions.length;
  const sourceValues = fixture.sources.map((bytes) => JSON.parse(bytes));
  const sourceDigests = fixture.sources.map((bytes) => sha256(bytes));
  assert.equal(completeTraversalProjection(
    sourceValues[0], sourceValues, sourceDigests
  ).work_units, expectedWorkUnits);
});

test("complete traversal refuses authoritative, membership, equality, and order faults distinctly", () => {
  assertCompleteRefusal((fixture) => {
    fixture.population.occurrences.push(structuredClone(fixture.population.occurrences[0]));
  }, "complete_traversal_authoritative_identity_duplicate", { reauthenticate: true });
  assertCompleteRefusal((fixture) => {
    fixture.population.occurrences[1].equality_key =
      fixture.population.occurrences[0].equality_key;
  }, "complete_traversal_equality_ambiguity", { reauthenticate: true });
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages[0].member_occurrences.push(
      structuredClone(fixture.trace.pages[0].member_occurrences[0])
    );
  }, "complete_traversal_returned_occurrence_duplicate");
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages[0].member_occurrences.splice(1, 1);
  }, "complete_traversal_occurrence_missing");
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages.at(-1).member_occurrences.push({
      occurrence_id: completeTraversalOccurrenceId(
        fixture.population.source_grounded_identity_sha256, "member-extra"
      ),
      source_occurrence_id: "member-extra",
      reference_id: "ref-result-extra",
      equality_key: "equality-member-extra",
      content_sha256: "a".repeat(64)
    });
  }, "complete_traversal_occurrence_extra");
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages[0].member_occurrences[0].occurrence_id = `occ-${"b".repeat(64)}`;
  }, "complete_traversal_occurrence_identity_mismatch");
  for (const mutate of [
    (fixture) => fixture.trace.pages[0].member_occurrences.reverse(),
    (fixture) => {
      const left = fixture.trace.pages[0].member_occurrences.at(-1);
      fixture.trace.pages[0].member_occurrences.splice(-1, 1,
        fixture.trace.pages[1].member_occurrences[0]);
      fixture.trace.pages[1].member_occurrences.splice(0, 1, left);
    }
  ]) assertCompleteRefusal(mutate, "complete_traversal_order_mismatch");
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages.at(-1).member_occurrences = [];
  }, "complete_traversal_early_terminal");
});

test("complete traversal refuses every cursor-chain and state fault distinctly", () => {
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages[1].request_cursor = fixture.trace.pages[1].next_cursor;
    fixture.trace.pages[1].request_cursor_sha256 =
      fixture.trace.pages[1].next_cursor_sha256;
  }, "complete_traversal_cursor_skip");
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages[2].request_cursor = fixture.trace.pages[1].request_cursor;
    fixture.trace.pages[2].request_cursor_sha256 =
      fixture.trace.pages[1].request_cursor_sha256;
  }, "complete_traversal_cursor_replay");
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages[1].next_cursor = fixture.trace.pages[0].next_cursor;
    fixture.trace.pages[1].next_cursor_sha256 = fixture.trace.pages[0].next_cursor_sha256;
  }, "complete_traversal_cursor_fork");
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages[1].request_cursor_sha256 = "c".repeat(64);
  }, "complete_traversal_cursor_substitution");
  assertCompleteRefusal((fixture) => {
    fixture.trace.transitions.pop();
  }, "complete_traversal_cursor_dangling");
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages[1].request_cursor = "opaque-cursor-unknown";
    fixture.trace.pages[1].request_cursor_sha256 = sha256(
      Buffer.from(fixture.trace.pages[1].request_cursor, "utf8")
    );
  }, "complete_traversal_cursor_unknown");
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages[1].terminal = true;
    fixture.trace.pages.at(-1).terminal = false;
    fixture.trace.terminal_page_id = fixture.trace.pages[1].page_id;
    fixture.trace.pages[1].next_cursor = null;
    fixture.trace.pages[1].next_cursor_sha256 = null;
  }, "complete_traversal_post_terminal_request");
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages[1].snapshot_id = "snapshot-drifted";
  }, "complete_traversal_snapshot_drift");
  assertCompleteRefusal((fixture) => {
    fixture.trace.pages[1].version_id = "source-version-drifted";
  }, "complete_traversal_version_drift");
});

test("complete traversal authenticates population bytes and enforces all declared resources", () => {
  assertCompleteRefusal((fixture) => {
    fixture.population.occurrences[0].content_sha256 = "d".repeat(64);
  }, "complete_traversal_source_authentication_mismatch");
  for (const resource of Object.keys(COMPLETE_TRAVERSAL_RESOURCE_LIMITS)) {
    const atLimit = {
      aggregate_input_bytes: 0, canonical_result_bytes: 0, work_units: 0,
      [resource]: COMPLETE_TRAVERSAL_RESOURCE_LIMITS[resource]
    };
    assert.equal(assertCompleteTraversalResourceUsage(atLimit), true);
    assert.throws(() => assertCompleteTraversalResourceUsage({
      ...atLimit, [resource]: COMPLETE_TRAVERSAL_RESOURCE_LIMITS[resource] + 1
    }), (error) => error.code === {
      aggregate_input_bytes: "complete_traversal_aggregate_input_limit_exceeded",
      canonical_result_bytes: "complete_traversal_canonical_result_limit_exceeded",
      work_units: "complete_traversal_work_limit_exceeded"
    }[resource]);
  }
});
