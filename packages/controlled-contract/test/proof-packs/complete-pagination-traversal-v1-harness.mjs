import { sha256 } from "../../lib/exact-binding-common.mjs";
import { executeDeterministicProjection } from
  "../../lib/deterministic-projection.mjs";
import {
  completeTraversalOccurrenceId
} from "../../lib/mutation-pagination-trace-projection.mjs";
import {
  completeTraversalResourceFixture,
  completeTraversalTraceFixture,
  rebuildCompleteSources
} from "./complete-pagination-traversal-v1-fixture.mjs";

const transformerId = "mutation-pagination-trace.v1";

const functionalMutants = Object.freeze({
  "authenticated-population-omission": {
    reauthenticate: true,
    mutate(fixture) { fixture.population.occurrences.pop(); }
  },
  "authenticated-population-substitution": {
    reauthenticate: true,
    mutate(fixture) { fixture.population.occurrences[0].content_sha256 = "1".repeat(64); }
  },
  "authentication-capture-substitution": {
    mutate(fixture) { fixture.population.occurrences[0].content_sha256 = "2".repeat(64); }
  },
  "traversal-occurrence-omission": {
    mutate(fixture) { fixture.trace.pages[0].member_occurrences.splice(1, 1); }
  },
  "traversal-occurrence-duplication": {
    mutate(fixture) {
      fixture.trace.pages[0].member_occurrences.push(
        structuredClone(fixture.trace.pages[0].member_occurrences[0])
      );
    }
  },
  "traversal-extra-member": {
    mutate(fixture) {
      fixture.trace.pages.at(-1).member_occurrences.push({
        occurrence_id: completeTraversalOccurrenceId(
          fixture.population.source_grounded_identity_sha256, "member-extra"
        ),
        source_occurrence_id: "member-extra",
        reference_id: "ref-result-extra",
        equality_key: "equality-member-extra",
        content_sha256: "3".repeat(64)
      });
    }
  },
  "within-page-reorder": {
    mutate(fixture) { fixture.trace.pages[0].member_occurrences.reverse(); }
  },
  "cross-page-reorder": {
    mutate(fixture) {
      const left = fixture.trace.pages[0].member_occurrences.at(-1);
      fixture.trace.pages[0].member_occurrences.splice(-1, 1,
        fixture.trace.pages[1].member_occurrences[0]);
      fixture.trace.pages[1].member_occurrences.splice(0, 1, left);
    }
  },
  "cursor-skip": {
    mutate(fixture) {
      fixture.trace.pages[1].request_cursor = fixture.trace.pages[1].next_cursor;
      fixture.trace.pages[1].request_cursor_sha256 =
        fixture.trace.pages[1].next_cursor_sha256;
    }
  },
  "cursor-replay": {
    mutate(fixture) {
      fixture.trace.pages[2].request_cursor = fixture.trace.pages[1].request_cursor;
      fixture.trace.pages[2].request_cursor_sha256 =
        fixture.trace.pages[1].request_cursor_sha256;
    }
  },
  "cursor-fork": {
    mutate(fixture) {
      fixture.trace.pages[1].next_cursor = fixture.trace.pages[0].next_cursor;
      fixture.trace.pages[1].next_cursor_sha256 = fixture.trace.pages[0].next_cursor_sha256;
    }
  },
  "cursor-substitution": {
    mutate(fixture) { fixture.trace.pages[1].request_cursor_sha256 = "4".repeat(64); }
  },
  "cursor-dangling": {
    mutate(fixture) { fixture.trace.transitions.pop(); }
  },
  "early-terminal": {
    mutate(fixture) { fixture.trace.pages.at(-1).member_occurrences = []; }
  },
  "post-terminal-request": {
    mutate(fixture) {
      fixture.trace.pages[1].terminal = true;
      fixture.trace.pages.at(-1).terminal = false;
      fixture.trace.terminal_page_id = fixture.trace.pages[1].page_id;
      fixture.trace.pages[1].next_cursor = null;
      fixture.trace.pages[1].next_cursor_sha256 = null;
    }
  },
  "unknown-cursor": {
    mutate(fixture) {
      fixture.trace.pages[1].request_cursor = "opaque-cursor-unknown";
      fixture.trace.pages[1].request_cursor_sha256 = sha256(
        Buffer.from(fixture.trace.pages[1].request_cursor, "utf8")
      );
    }
  },
  "snapshot-drift": {
    mutate(fixture) { fixture.trace.pages[1].snapshot_id = "snapshot-drifted"; }
  },
  "version-drift": {
    mutate(fixture) { fixture.trace.pages[1].version_id = "source-version-drifted"; }
  },
  "identifier-renaming-dependence": {
    mutate(fixture) {
      fixture.trace.pages[0].member_occurrences[0].reference_id = "ref-renamed";
      fixture.trace.pages[0].member_occurrences[0].occurrence_id = `occ-${"5".repeat(64)}`;
    }
  },
  "equality-normalized-duplicate": {
    reauthenticate: true,
    mutate(fixture) {
      fixture.population.occurrences[1].equality_key =
        fixture.population.occurrences[0].equality_key;
    }
  },
  "unknown-occurrence-identity": {
    mutate(fixture) {
      fixture.trace.pages[0].member_occurrences[0].occurrence_id = `occ-${"6".repeat(64)}`;
    }
  }
});

const resourceMutants = Object.freeze({
  "aggregate-input-limit-plus-one": Object.freeze({
    resource: "aggregate_input_bytes",
    code: "complete_traversal_aggregate_input_limit_exceeded"
  }),
  "canonical-result-limit-plus-one": Object.freeze({
    resource: "canonical_result_bytes",
    code: "complete_traversal_canonical_result_limit_exceeded"
  }),
  "work-limit-plus-one": Object.freeze({
    resource: "work_units",
    code: "complete_traversal_work_limit_exceeded"
  })
});

const COMPLETE_TRAVERSAL_MUTANT_IDS = Object.freeze([
  ...Object.keys(functionalMutants), ...Object.keys(resourceMutants)
].sort());

function executeCompleteTraversalMutant(mutantId) {
  const resource = resourceMutants[mutantId];
  if (resource) {
    const { fixture, expected_measure: expectedMeasure } =
      completeTraversalResourceFixture(resource.resource);
    try {
      executeDeterministicProjection(transformerId, fixture.sources);
      return { killed: false, code: null };
    } catch (error) {
      return {
        killed: error?.code === resource.code &&
          error?.details?.resource === resource.resource &&
          error?.details?.observed === expectedMeasure,
        code: error?.code ?? null
      };
    }
  }
  const mutant = functionalMutants[mutantId];
  if (!mutant) throw new TypeError(`unknown complete traversal mutant: ${mutantId}`);
  const fixture = completeTraversalTraceFixture({ page_sizes: [2, 1, 1, 1] });
  mutant.mutate(fixture);
  rebuildCompleteSources(fixture, { reauthenticate: mutant.reauthenticate === true });
  try {
    executeDeterministicProjection(transformerId, fixture.sources);
    return { killed: false, code: null };
  } catch (error) {
    return { killed: true, code: error.code };
  }
}

function executeCompleteTraversalPositive(options) {
  const fixture = completeTraversalTraceFixture(options);
  const bytes = executeDeterministicProjection(transformerId, fixture.sources);
  return { fixture, bytes, result: JSON.parse(bytes) };
}

export {
  COMPLETE_TRAVERSAL_MUTANT_IDS,
  executeCompleteTraversalMutant,
  executeCompleteTraversalPositive
};
