import { canonicalJsonBytes, sha256 } from
  "../../lib/deterministic-projection-primitives.mjs";
import {
  mutationPaginationOccurrenceId
} from "../../lib/mutation-pagination-trace-projection.mjs";
import {
  snapshotTraceFixture,
  versionedCursorTraceFixture
} from "./mutation-pagination-trace-v1-fixture.mjs";
import {
  executeMutationPaginationProjection
} from "./mutation-pagination-trace-v1-test-runner.mjs";

function rederiveOccurrence(kind, value) {
  value.occurrence_id = mutationPaginationOccurrenceId(kind, value);
}

function rederiveSnapshot(trace) {
  const oldAttempts = new Map(trace.page_attempts.map((value) => [value.occurrence_id, value]));
  const oldMutations = new Map(trace.mutations.map((value) => [value.occurrence_id, value]));
  const attemptIds = new Map();
  for (const attempt of trace.page_attempts) {
    const old = attempt.occurrence_id;
    rederiveOccurrence("page-attempt", attempt);
    attemptIds.set(old, attempt.occurrence_id);
  }
  for (const page of trace.returned_pages) {
    page.attempt_occurrence_id = attemptIds.get(page.attempt_occurrence_id) ??
      page.attempt_occurrence_id;
    rederiveOccurrence("returned-page", page);
    for (const member of page.member_occurrences) {
      member.owner_occurrence_id = page.occurrence_id;
      rederiveOccurrence("member", member);
    }
  }
  const mutationIds = new Map();
  for (const mutation of trace.mutations) {
    const old = mutation.occurrence_id;
    rederiveOccurrence("mutation", mutation);
    mutationIds.set(old, mutation.occurrence_id);
  }
  for (const member of trace.stable_member_occurrences) rederiveOccurrence("member", member);
  trace.selected.first_page_attempt_id = attemptIds.get(
    trace.selected.first_page_attempt_id
  ) ?? trace.selected.first_page_attempt_id;
  trace.selected.later_page_attempt_id = attemptIds.get(
    trace.selected.later_page_attempt_id
  ) ?? trace.selected.later_page_attempt_id;
  trace.selected.relevant_mutation_id = mutationIds.get(
    trace.selected.relevant_mutation_id
  ) ?? trace.selected.relevant_mutation_id;
  void oldAttempts;
  void oldMutations;
}

function rederiveVersioned(trace) {
  const attemptIds = new Map();
  for (const attempt of trace.page_attempts) {
    const old = attempt.occurrence_id;
    rederiveOccurrence("page-attempt", attempt);
    attemptIds.set(old, attempt.occurrence_id);
  }
  const pageIds = new Map();
  for (const page of trace.returned_pages) {
    const old = page.occurrence_id;
    page.attempt_occurrence_id = attemptIds.get(page.attempt_occurrence_id) ??
      page.attempt_occurrence_id;
    rederiveOccurrence("returned-page", page);
    pageIds.set(old, page.occurrence_id);
    for (const member of page.member_occurrences) {
      member.owner_occurrence_id = page.occurrence_id;
      rederiveOccurrence("member", member);
    }
  }
  const maps = {
    mutation: new Map(), refusal: new Map(), return: new Map(), advancement: new Map()
  };
  for (const [kind, collection] of [
    ["mutation", trace.mutations], ["refusal", trace.refusals],
    ["return", trace.returns], ["advancement", trace.advancements]
  ]) for (const value of collection) {
    const old = value.occurrence_id;
    if (Object.hasOwn(value, "attempt_occurrence_id")) {
      value.attempt_occurrence_id = attemptIds.get(value.attempt_occurrence_id) ??
        value.attempt_occurrence_id;
    }
    if (Object.hasOwn(value, "returned_page_occurrence_id")) {
      value.returned_page_occurrence_id = pageIds.get(value.returned_page_occurrence_id) ??
        value.returned_page_occurrence_id;
    }
    rederiveOccurrence(kind, value);
    maps[kind].set(old, value.occurrence_id);
  }
  for (const effect of trace.effect_occurrences) {
    effect.attempt_occurrence_id = attemptIds.get(effect.attempt_occurrence_id) ??
      effect.attempt_occurrence_id;
    rederiveOccurrence("effect", effect);
  }
  for (const key of ["prior_page_attempt_id", "stale_attempt_id", "control_attempt_id"]) {
    trace.selected[key] = attemptIds.get(trace.selected[key]) ?? trace.selected[key];
  }
  for (const [key, kind] of [
    ["relevant_mutation_id", "mutation"], ["unrelated_mutation_id", "mutation"],
    ["refusal_id", "refusal"], ["control_return_id", "return"],
    ["control_advancement_id", "advancement"]
  ]) trace.selected[key] = maps[kind].get(trace.selected[key]) ?? trace.selected[key];
}

function recapture(fixture, index, value) {
  fixture.captures[index] = value;
  const digest = sha256(canonicalJsonBytes(value, { file: true }));
  const keys = [
    "primary_before_sha256", "primary_after_sha256",
    "control_before_sha256", "control_after_sha256"
  ];
  fixture.trace.captures[keys[index]] = digest;
}

function sources(fixture) {
  return [fixture.trace, ...fixture.captures].map(
    (value) => canonicalJsonBytes(value, { file: true })
  );
}

function oracle(fixture) {
  try {
    executeMutationPaginationProjection(sources(fixture));
    return { passed: true, code: null };
  } catch (error) {
    return { passed: false, code: error.code ?? "untyped" };
  }
}

const SNAPSHOT_MUTANTS = Object.freeze({
  "duplicate-hidden-by-final-count"(fixture) {
    fixture.trace.returned_pages[1].member_occurrences[0].member_id = "member-alpha";
    rederiveSnapshot(fixture.trace);
  },
  "omission-hidden-by-final-count"(fixture) {
    fixture.trace.returned_pages[0].member_occurrences.pop();
    rederiveSnapshot(fixture.trace);
  },
  "mixed-source-versions"(fixture) {
    fixture.trace.returned_pages[1].source_version_id = fixture.trace.initial_source_version_id;
    rederiveSnapshot(fixture.trace);
  },
  "changed-snapshot-identity"(fixture) {
    fixture.trace.page_attempts[1].snapshot_id = "snapshot-changed";
    rederiveSnapshot(fixture.trace);
  },
  "constant-label-changed-captured-population"(fixture) {
    recapture(fixture, 1, {
      schema_version: "pagination-captured-state.v1", members: ["alpha", "gamma"]
    });
  },
  "wrong-traversal-mutation"(fixture) {
    fixture.trace.mutations[0].target_source_id = "unrelated-source";
    rederiveSnapshot(fixture.trace);
  },
  "reordered-occurrences"(fixture) {
    fixture.trace.returned_pages[0].member_occurrences[1].member_id = "member-beta";
    fixture.trace.returned_pages[1].member_occurrences[0].member_id = "member-alpha";
    rederiveSnapshot(fixture.trace);
  },
  "prefix-only-comparison"(fixture) {
    fixture.trace.returned_pages[1].member_occurrences = [];
    rederiveSnapshot(fixture.trace);
  }
});

const VERSIONED_MUTANTS = Object.freeze({
  "stale-continuation-succeeds"(fixture) {
    const stale = fixture.trace.page_attempts.find(({ kind }) => kind === "stale");
    const page = {
      occurrence_id: "occ-placeholder", position: 7,
      attempt_occurrence_id: stale.occurrence_id,
      source_version_id: fixture.trace.current_source_version_id,
      member_occurrences: []
    };
    rederiveOccurrence("returned-page", page);
    fixture.trace.returned_pages.splice(1, 0, page);
    fixture.trace.returns.splice(1, 0, {
      occurrence_id: "occ-placeholder", position: 8,
      attempt_occurrence_id: stale.occurrence_id,
      returned_page_occurrence_id: page.occurrence_id
    });
    rederiveVersioned(fixture.trace);
  },
  "page-returned-before-error"(fixture) {
    fixture.trace.refusals[0].position = 9;
    VERSIONED_MUTANTS["stale-continuation-succeeds"](fixture);
  },
  "cursor-advances-before-refusal"(fixture) {
    const stale = fixture.trace.page_attempts.find(({ kind }) => kind === "stale");
    fixture.trace.refusals[0].position = 8;
    fixture.trace.advancements.unshift({
      occurrence_id: "occ-placeholder", position: 6,
      attempt_occurrence_id: stale.occurrence_id, cursor_id: stale.cursor_id
    });
    rederiveVersioned(fixture.trace);
  },
  "wrong-traversal-or-cursor-refused"(fixture) {
    fixture.trace.refusals[0].cursor_id = "cursor-control";
    rederiveVersioned(fixture.trace);
  },
  "wrong-mutation-treated-relevant"(fixture) {
    fixture.trace.mutations[0].target_source_id = fixture.trace.unrelated_source_id;
    rederiveVersioned(fixture.trace);
  },
  "protected-write-before-refusal"(fixture) {
    const stale = fixture.trace.page_attempts.find(({ kind }) => kind === "stale");
    fixture.trace.refusals[0].position = 8;
    fixture.trace.effect_occurrences.push({
      occurrence_id: "occ-placeholder", position: 6,
      attempt_occurrence_id: stale.occurrence_id,
      effect_id: fixture.trace.protected_effects[0], operation: "write"
    });
    rederiveVersioned(fixture.trace);
  },
  "unrelated-mutation-causes-false-refusal"(fixture) {
    const control = fixture.trace.page_attempts.find(({ kind }) => kind === "control");
    fixture.trace.refusals.push({
      occurrence_id: "occ-placeholder", position: 15,
      attempt_occurrence_id: control.occurrence_id, cursor_id: control.cursor_id
    });
    rederiveVersioned(fixture.trace);
  },
  "caller-selected-refusal-or-attempt"(fixture) {
    fixture.trace.selected.stale_attempt_id = fixture.trace.selected.control_attempt_id;
  },
  "identical-content-version-substitution"(fixture) {
    recapture(fixture, 1, structuredClone(fixture.captures[0]));
  },
  "control-advances-wrong-cursor"(fixture) {
    const advancement = fixture.trace.advancements.find(
      ({ occurrence_id: id }) => id === fixture.trace.selected.control_advancement_id
    );
    advancement.cursor_id = fixture.trace.selected.stale_cursor_id;
    rederiveVersioned(fixture.trace);
  }
});

function executeMutant(policy, mutantId) {
  const fixture = policy === "snapshot" ? snapshotTraceFixture() : versionedCursorTraceFixture();
  const mutant = policy === "snapshot" ? SNAPSHOT_MUTANTS[mutantId] :
    VERSIONED_MUTANTS[mutantId];
  mutant(fixture);
  return oracle(fixture);
}

export {
  SNAPSHOT_MUTANTS,
  VERSIONED_MUTANTS,
  executeMutant,
  oracle,
  recapture,
  rederiveSnapshot,
  rederiveVersioned,
  sources
};
