import {
  canonicalJsonBytes,
  sha256
} from "../../lib/deterministic-projection-primitives.mjs";
import {
  MUTATION_PAGINATION_TRACE_VERSION,
  mutationPaginationOccurrenceId
} from "../../lib/mutation-pagination-trace-projection.mjs";

function occurrence(kind, value) {
  const result = { ...value };
  result.occurrence_id = mutationPaginationOccurrenceId(kind, result);
  return result;
}

function member(owner, ordinal, memberId) {
  return occurrence("member", {
    member_id: memberId,
    owner_occurrence_id: owner,
    ordinal
  });
}

function canonicalSources(trace, captures) {
  const values = [trace, ...captures];
  return values.map((value) => canonicalJsonBytes(value, { file: true }));
}

function snapshotTraceFixture({
  stable_members: stableMembers = ["member-alpha", "member-alpha", "member-beta"],
  interleaved_pages: interleavedPages = [
    ["member-alpha", "member-alpha"], ["member-beta"]
  ],
  snapshot_id: snapshotId = "snapshot-frozen",
  snapshot_state_id: snapshotStateId = "snapshot-state-frozen"
} = {}) {
  const captures = [
    { schema_version: "pagination-captured-state.v1", members: ["alpha", "beta"] },
    { schema_version: "pagination-captured-state.v1", members: ["alpha", "beta"] },
    { schema_version: "pagination-source-version.v1", version: "version-initial" },
    { schema_version: "pagination-source-version.v1", version: "version-later" }
  ];
  const captureDigests = captures.map((value) => sha256(canonicalJsonBytes(value, { file: true })));
  const firstAttempt = occurrence("page-attempt", {
    position: 1,
    source_version_id: "source-version-initial",
    snapshot_id: snapshotId,
    snapshot_state_id: snapshotStateId
  });
  const laterAttempt = occurrence("page-attempt", {
    position: 5,
    source_version_id: "source-version-later",
    snapshot_id: snapshotId,
    snapshot_state_id: snapshotStateId
  });
  const firstPage = occurrence("returned-page", {
    position: 2,
    attempt_occurrence_id: firstAttempt.occurrence_id,
    source_version_id: "source-version-initial",
    snapshot_id: snapshotId,
    snapshot_state_id: snapshotStateId,
    member_occurrences: []
  });
  firstPage.member_occurrences = interleavedPages[0].map((value, index) =>
    member(firstPage.occurrence_id, index, value));
  const laterPage = occurrence("returned-page", {
    position: 6,
    attempt_occurrence_id: laterAttempt.occurrence_id,
    source_version_id: "source-version-later",
    snapshot_id: snapshotId,
    snapshot_state_id: snapshotStateId,
    member_occurrences: []
  });
  laterPage.member_occurrences = interleavedPages[1].map((value, index) =>
    member(laterPage.occurrence_id, index, value));
  const relevantMutation = occurrence("mutation", {
    position: 4,
    target_source_id: "live-source",
    before_version_id: "source-version-initial",
    after_version_id: "source-version-later"
  });
  const stableOwner = "stable-traversal-snapshot";
  const trace = {
    schema_version: MUTATION_PAGINATION_TRACE_VERSION,
    policy: "snapshot",
    traversal_id: "traversal-snapshot",
    live_source_id: "live-source",
    snapshot_id: snapshotId,
    snapshot_state_id: snapshotStateId,
    initial_source_version_id: "source-version-initial",
    later_source_version_id: "source-version-later",
    page_attempts: [firstAttempt, laterAttempt],
    returned_pages: [firstPage, laterPage],
    stable_member_occurrences: stableMembers.map((value, index) =>
      member(stableOwner, index, value)),
    mutations: [relevantMutation],
    selected: {
      first_page_attempt_id: firstAttempt.occurrence_id,
      later_page_attempt_id: laterAttempt.occurrence_id,
      relevant_mutation_id: relevantMutation.occurrence_id
    },
    captures: {
      primary_before_sha256: captureDigests[0],
      primary_after_sha256: captureDigests[1],
      control_before_sha256: captureDigests[2],
      control_after_sha256: captureDigests[3]
    }
  };
  return { trace, captures, sources: canonicalSources(trace, captures) };
}

function returnedPage(position, attempt, versionId, memberIds) {
  const page = occurrence("returned-page", {
    position,
    attempt_occurrence_id: attempt.occurrence_id,
    source_version_id: versionId,
    member_occurrences: []
  });
  page.member_occurrences = memberIds.map((value, index) =>
    member(page.occurrence_id, index, value));
  return page;
}

function versionedCursorTraceFixture() {
  const captures = [
    { schema_version: "pagination-source-version.v1", version: "version-stale" },
    { schema_version: "pagination-source-version.v1", version: "version-current" },
    { schema_version: "pagination-source-version.v1", version: "version-control" },
    { schema_version: "pagination-source-version.v1", version: "version-control" }
  ];
  const captureDigests = captures.map((value) => sha256(canonicalJsonBytes(value, { file: true })));
  const prior = occurrence("page-attempt", {
    position: 1, traversal_id: "traversal-stale", cursor_id: "cursor-stale", kind: "prior"
  });
  const stale = occurrence("page-attempt", {
    position: 5, traversal_id: "traversal-stale", cursor_id: "cursor-stale", kind: "stale"
  });
  const control = occurrence("page-attempt", {
    position: 11, traversal_id: "traversal-control", cursor_id: "cursor-control",
    kind: "control"
  });
  const priorPage = returnedPage(2, prior, "source-version-stale", ["member-alpha"]);
  const controlPage = returnedPage(12, control, "source-version-control", []);
  const relevantMutation = occurrence("mutation", {
    position: 4, target_source_id: "live-source-primary",
    before_version_id: "source-version-stale", after_version_id: "source-version-current"
  });
  const unrelatedMutation = occurrence("mutation", {
    position: 10, target_source_id: "live-source-unrelated",
    before_version_id: "unrelated-version-before",
    after_version_id: "unrelated-version-after"
  });
  const refusal = occurrence("refusal", {
    position: 6, attempt_occurrence_id: stale.occurrence_id, cursor_id: "cursor-stale"
  });
  const priorReturn = occurrence("return", {
    position: 3, attempt_occurrence_id: prior.occurrence_id,
    returned_page_occurrence_id: priorPage.occurrence_id
  });
  const controlReturn = occurrence("return", {
    position: 13, attempt_occurrence_id: control.occurrence_id,
    returned_page_occurrence_id: controlPage.occurrence_id
  });
  const controlAdvance = occurrence("advancement", {
    position: 14, attempt_occurrence_id: control.occurrence_id, cursor_id: "cursor-control"
  });
  const trace = {
    schema_version: MUTATION_PAGINATION_TRACE_VERSION,
    policy: "versioned_cursor_refusal",
    traversal_id: "traversal-stale",
    control_traversal_id: "traversal-control",
    live_source_id: "live-source-primary",
    control_source_id: "live-source-control",
    unrelated_source_id: "live-source-unrelated",
    traversal_source_version_id: "source-version-stale",
    current_source_version_id: "source-version-current",
    control_source_version_id: "source-version-control",
    cursors: [
      { cursor_id: "cursor-control", traversal_id: "traversal-control",
        source_version_id: "source-version-control" },
      { cursor_id: "cursor-stale", traversal_id: "traversal-stale",
        source_version_id: "source-version-stale" }
    ],
    page_attempts: [prior, stale, control],
    returned_pages: [priorPage, controlPage],
    mutations: [relevantMutation, unrelatedMutation],
    refusals: [refusal],
    returns: [priorReturn, controlReturn],
    advancements: [controlAdvance],
    protected_effects: [
      "cursor-state", "extra-protected-effect", "page-result-artifact", "traversal-state"
    ],
    effect_occurrences: [],
    selected: {
      prior_page_attempt_id: prior.occurrence_id,
      relevant_mutation_id: relevantMutation.occurrence_id,
      stale_attempt_id: stale.occurrence_id,
      stale_cursor_id: "cursor-stale",
      refusal_id: refusal.occurrence_id,
      page_result_artifact_id: "page-result-artifact",
      page_return_event_id: "page-return-event",
      cursor_advance_event_id: "cursor-advance-event",
      cursor_state_id: "cursor-state",
      traversal_state_id: "traversal-state",
      unrelated_mutation_id: unrelatedMutation.occurrence_id,
      control_attempt_id: control.occurrence_id,
      control_return_id: controlReturn.occurrence_id,
      control_advancement_id: controlAdvance.occurrence_id
    },
    captures: {
      primary_before_sha256: captureDigests[0],
      primary_after_sha256: captureDigests[1],
      control_before_sha256: captureDigests[2],
      control_after_sha256: captureDigests[3]
    }
  };
  return { trace, captures, sources: canonicalSources(trace, captures) };
}

export {
  canonicalSources,
  member,
  occurrence,
  snapshotTraceFixture,
  versionedCursorTraceFixture
};
