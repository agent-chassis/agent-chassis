import { PROOF_PACK_ADEQUACY_RUN_VERSION } from
  "../support/proof-pack-adequacy-constants.mjs";
import { evaluateStableProofPackFixtureV1 } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import {
  buildVersionedCursorPaginationFixture
} from "./mutation-pagination-profiles-v1-fixture.mjs";
import {
  VERSIONED_MUTANTS,
  executeMutant,
  oracle,
  rederiveVersioned,
  sources
} from "./mutation-pagination-v1-harness.mjs";
import { versionedCursorTraceFixture } from
  "./mutation-pagination-trace-v1-fixture.mjs";

const GUARANTEE_DIGEST =
  "54fb6ac12173078ba025706e0c3a6d2626ee32d98c6e072256fbd0244af52081";

function satisfaction(fixture) {
  return evaluateStableProofPackFixtureV1({
    contract: fixture.contract, profile: fixture.profile,
    evaluation_input: fixture.input
  }).satisfaction;
}

function removePattern(contract, patternId) {
  const claimId = `claim-${patternId}`;
  const claim = contract.claims.find(({ claim_id: id }) => id === claimId);
  const propositions = new Set(
    [claim?.proposition_id, claim?.falsifying_proposition_id].filter(Boolean)
  );
  contract.claims = contract.claims.filter(({ claim_id: id }) => id !== claimId);
  contract.propositions = contract.propositions.filter(
    ({ proposition_id: id }) => !propositions.has(id)
  );
  contract.relations = contract.relations.filter(
    ({ source_claim_id: source, target_claim_id: target }) =>
      source !== claimId && target !== claimId
  );
}

function addObservedClaim(contract, roles, id, {
  subject, operator, operands, modality = "MUST",
  mode = "unconditional", context = []
}) {
  const propositionId = `prop-observed-${id}`;
  contract.propositions.push({
    proposition_id: propositionId,
    subject_reference_id: roles[subject][0], operator,
    applicability_context: {
      mode, operand_reference_ids: context.flatMap((role) => roles[role])
    },
    operands: operands.flatMap((role) => roles[role].map(
      (reference_id) => ({ kind: "reference", reference_id })
    ))
  });
  contract.claims.push({
    claim_id: `claim-observed-${id}`, kind: "evidence", modality,
    proposition_id: propositionId
  });
}

function truthfulMutantFixture(profile, mutantId) {
  const staleReturn = {
    subject: "stale_attempt", operator: "reference:returns",
    operands: ["page_result_artifact"], mode: "when",
    context: ["stale_attempt", "return_failure_condition"]
  };
  const observations = {
    "stale-continuation-succeeds": staleReturn,
    "page-returned-before-error": staleReturn,
    "cursor-advances-before-refusal": {
      subject: "stale_attempt", operator: "reference:emits",
      operands: ["cursor_advance_event"], mode: "when",
      context: ["stale_attempt", "advancement_failure_condition"]
    },
    "wrong-traversal-or-cursor-refused": {
      subject: "refusal", operator: "reference:rejects",
      operands: ["stale_attempt"], modality: "MUST_NOT"
    },
    "wrong-mutation-treated-relevant": {
      subject: "relevant_mutation", operator: "reference:mutates",
      operands: ["live_source"], modality: "MUST_NOT",
      mode: "where", context: ["traversal"]
    },
    "protected-write-before-refusal": {
      subject: "stale_attempt", operator: "reference:writes",
      operands: ["protected_effects"], mode: "when",
      context: ["stale_attempt", "write_failure_condition"]
    },
    "unrelated-mutation-causes-false-refusal": {
      subject: "refusal", operator: "reference:rejects",
      operands: ["control_attempt"], mode: "when",
      context: ["unrelated_mutation", "false_refusal_condition"]
    },
    "caller-selected-refusal-or-attempt": {
      subject: "stale_attempt", operator: "reference:uses",
      operands: ["stale_cursor"], modality: "MUST_NOT",
      mode: "where", context: ["traversal"]
    },
    "identical-content-version-substitution": {
      subject: "live_source", operator: "reference:has_state",
      operands: ["current_source_version"], modality: "MUST_NOT",
      mode: "where", context: ["stale_attempt"]
    },
    "control-advances-wrong-cursor": {
      subject: "control_attempt", operator: "reference:emits",
      operands: ["control_advancement"], modality: "MUST_NOT"
    }
  };
  return buildVersionedCursorPaginationFixture({
    profile,
    mutate_contract(contract, _input, roles) {
      addObservedClaim(contract, roles, mutantId, observations[mutantId]);
    }
  });
}

function unprotectedEffectFixture(profile) {
  const fixture = versionedCursorTraceFixture();
  const stale = fixture.trace.page_attempts.find(({ kind }) => kind === "stale");
  fixture.trace.refusals[0].position = 7;
  fixture.trace.effect_occurrences.push({
    occurrence_id: "occ-placeholder", position: 6,
    attempt_occurrence_id: stale.occurrence_id,
    effect_id: "audit-log", operation: "write"
  });
  rederiveVersioned(fixture.trace);
  fixture.sources = sources(fixture);
  return buildVersionedCursorPaginationFixture({ profile, trace_fixture: fixture });
}

function positiveControls(profile) {
  const cases = {
    "stale-cursor-refusal-with-zero-protected-effects":
      buildVersionedCursorPaginationFixture({ profile }),
    "unrelated-mutation-without-refusal":
      buildVersionedCursorPaginationFixture({ profile }),
    "empty-successful-returned-page":
      buildVersionedCursorPaginationFixture({ profile }),
    "multiple-protected-effects":
      buildVersionedCursorPaginationFixture({ profile }),
    "unprotected-stale-attempt-effect-permitted": unprotectedEffectFixture(profile),
    "alternate-demonstration-verification": buildVersionedCursorPaginationFixture({
      profile, verification_method: "demonstration"
    }),
    "alternate-proof-verification": buildVersionedCursorPaginationFixture({
      profile, verification_method: "proof"
    }),
    "harmless-unrelated-evidence": buildVersionedCursorPaginationFixture({
      profile,
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-unrelated-evidence", type_term: "cc:evidence",
          identity: { kind: "durable_id", domain: "unrelated", value: "evidence" }
        });
      }
    }),
    "unicode-identities-and-declaration-permutations":
      buildVersionedCursorPaginationFixture({
        profile, identity_domain: "游标-Δ-🔒",
        mutate_contract(contract) {
          contract.references.reverse(); contract.propositions.reverse();
          contract.claims.reverse(); contract.relations.reverse();
        },
        mutate_input(input) { input.reference_bindings.reverse(); }
      })
  };
  return Object.entries(cases).map(([control_id, fixture]) => ({
    control_id, category: "positive",
    implementation_outcome: oracle(fixture.trace).passed ? "passed" : "killed",
    profile_satisfaction: satisfaction(fixture)
  }));
}

function mutantControls(profile) {
  return Object.keys(VERSIONED_MUTANTS).map((control_id) => {
    const execution = executeMutant("versioned", control_id);
    return {
      control_id, category: "mutant",
      implementation_outcome: execution.passed ? "survived" : "killed",
      profile_satisfaction: satisfaction(truthfulMutantFixture(profile, control_id))
    };
  });
}

function rejectionControls(profile) {
  const ids = [
    "no-stale-page-return", "no-stale-page-return-event", "no-stale-cursor-advance",
    "no-stale-protected-write", "no-stale-protected-mutation",
    "no-unrelated-mutation-false-refusal"
  ];
  const controls = ids.map((patternId) => ({
    control_id: `missing-${patternId}`, category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: satisfaction(buildVersionedCursorPaginationFixture({
      profile, mutate_contract(contract) { removePattern(contract, patternId); }
    }))
  }));
  controls.push({
    control_id: "refusal-bound-to-wrong-attempt", category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: satisfaction(buildVersionedCursorPaginationFixture({
      profile, mutate_contract(contract) {
        contract.propositions.find(({ proposition_id: id }) =>
          id === "prop-refusal-rejects-stale-attempt").operands = [{
          kind: "reference", reference_id: "ref-occ-placeholder"
        }];
        contract.references.push({
          reference_id: "ref-occ-placeholder", type_term: "cc:event",
          identity: { kind: "durable_id", domain: "wrong", value: "attempt" }
        });
      }
    }))
  });
  return controls;
}

function exclusionControls(profile) {
  const baseline = satisfaction(buildVersionedCursorPaginationFixture({ profile }));
  return [
    "standalone-traversal-completeness", "undeclared-mutation",
    "cursor-retention-or-isolation", "capture-provenance",
    "evidence-authority-or-cce-consequence", "runtime-truth",
    "cross-pack-shared-role-identity"
  ].map((control_id) => ({
    control_id, category: "exclusion", implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: baseline
  }));
}

async function runProofPackAdequacyControls({ profile, profile_digest }) {
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id, profile_version: profile.profile_version,
    profile_digest, guarantee_digest: GUARANTEE_DIGEST,
    controls: [
      ...positiveControls(profile), ...mutantControls(profile),
      ...rejectionControls(profile), ...exclusionControls(profile)
    ]
  };
}

export { runProofPackAdequacyControls };
