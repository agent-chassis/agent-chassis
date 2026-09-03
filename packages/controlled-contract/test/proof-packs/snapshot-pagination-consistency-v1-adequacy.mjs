import { PROOF_PACK_ADEQUACY_RUN_VERSION } from
  "../support/proof-pack-adequacy-constants.mjs";
import { evaluateStableProofPackFixtureV1 } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import {
  buildSnapshotPaginationFixture
} from "./mutation-pagination-profiles-v1-fixture.mjs";
import {
  SNAPSHOT_MUTANTS,
  executeMutant,
  oracle
} from "./mutation-pagination-v1-harness.mjs";

const GUARANTEE_DIGEST =
  "9a3ea58d8d91e072e4b4cdf456cadb4a4c55ee54631cc22727a94b4c767e4514";

function satisfaction(fixture) {
  return evaluateStableProofPackFixtureV1({
    contract: fixture.contract, profile: fixture.profile,
    evaluation_input: fixture.input
  }).satisfaction;
}

function removePattern(contract, patternId) {
  const prefix = `claim-${patternId}`;
  const removed = new Set(contract.claims.filter(
    ({ claim_id: id }) => id === prefix || id.startsWith(`${prefix}-`)
  ).flatMap((claim) => [claim.proposition_id, claim.falsifying_proposition_id].filter(Boolean)));
  contract.claims = contract.claims.filter(
    ({ claim_id: id }) => id !== prefix && !id.startsWith(`${prefix}-`)
  );
  contract.propositions = contract.propositions.filter(
    ({ proposition_id: id }) => !removed.has(id)
  );
  contract.relations = contract.relations.filter(
    ({ source_claim_id: source, target_claim_id: target }) =>
      !source.startsWith(prefix) && !target.startsWith(prefix)
  );
}

function addObservedContradiction(contract, roles, id, {
  subject, operator, operands, mode = "unconditional", context = []
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
    claim_id: `claim-observed-${id}`, kind: "evidence", modality: "MUST_NOT",
    proposition_id: propositionId
  });
}

function truthfulMutantFixture(profile, mutantId) {
  const sequence = {
    subject: "sequence_comparison_result", operator: "reference:equals",
    operands: ["identical_sequence_state"]
  };
  const observations = {
    "duplicate-hidden-by-final-count": sequence,
    "omission-hidden-by-final-count": sequence,
    "reordered-occurrences": sequence,
    "prefix-only-comparison": sequence,
    "mixed-source-versions": {
      subject: "later_returned_page", operator: "reference:resolves_to",
      operands: ["snapshot"], mode: "where", context: ["traversal"]
    },
    "changed-snapshot-identity": {
      subject: "later_page_attempt", operator: "reference:resolves_to",
      operands: ["snapshot"], mode: "where", context: ["traversal"]
    },
    "constant-label-changed-captured-population": {
      subject: "snapshot", operator: "reference:has_state",
      operands: ["snapshot_state"], mode: "where", context: ["later_page_attempt"]
    },
    "wrong-traversal-mutation": {
      subject: "relevant_mutation", operator: "reference:mutates",
      operands: ["live_source"], mode: "where", context: ["traversal"]
    }
  };
  return buildSnapshotPaginationFixture({
    profile,
    mutate_contract(contract, _input, roles) {
      addObservedContradiction(contract, roles, mutantId, observations[mutantId]);
    }
  });
}

function positiveControls(profile) {
  const cases = {
    "frozen-snapshot-across-live-mutation": buildSnapshotPaginationFixture({ profile }),
    "duplicate-semantic-members-remain-distinct": buildSnapshotPaginationFixture({ profile }),
    "empty-returned-page-permitted": buildSnapshotPaginationFixture({
      profile, trace_options: {
        stable_members: ["member-alpha"], interleaved_pages: [[], ["member-alpha"]]
      }
    }),
    "all-pages-empty-permitted": buildSnapshotPaginationFixture({
      profile, trace_options: { stable_members: [], interleaved_pages: [[], []] }
    }),
    "alternate-analysis-verification": buildSnapshotPaginationFixture({
      profile, verification_method: "analysis"
    }),
    "alternate-proof-verification": buildSnapshotPaginationFixture({
      profile, verification_method: "proof"
    }),
    "harmless-unrelated-evidence": buildSnapshotPaginationFixture({
      profile,
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-unrelated-evidence", type_term: "cc:evidence",
          identity: { kind: "durable_id", domain: "unrelated", value: "evidence" }
        });
      }
    }),
    "unicode-identities-and-declaration-permutations": buildSnapshotPaginationFixture({
      profile, identity_domain: "分页-Δ-🔒",
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
  return Object.keys(SNAPSHOT_MUTANTS).map((control_id) => {
    const execution = executeMutant("snapshot", control_id);
    return {
      control_id, category: "mutant",
      implementation_outcome: execution.passed ? "survived" : "killed",
      profile_satisfaction: satisfaction(truthfulMutantFixture(profile, control_id))
    };
  });
}

function rejectionControls(profile) {
  const mutations = {
    "missing-attempt-snapshot-binding": (contract) =>
      removePattern(contract, "each-attempt-resolves-selected-snapshot"),
    "uses-does-not-prove-snapshot-resolution": (contract) => {
      contract.propositions.find(({ proposition_id: id }) =>
        id.startsWith("prop-each-attempt-resolves-selected-snapshot-")).operator =
        "reference:uses";
    },
    "missing-relevant-mutation-binding": (contract) =>
      removePattern(contract, "relevant-mutation-mutates-live-source"),
    "missing-ordered-sequence-comparison": (contract) =>
      removePattern(contract, "ordered-sequences-identical")
  };
  return Object.entries(mutations).map(([control_id, mutate]) => ({
    control_id, category: "profile_rejection", implementation_outcome: "not_applicable",
    profile_satisfaction: satisfaction(buildSnapshotPaginationFixture({
      profile, mutate_contract: mutate
    }))
  }));
}

function exclusionControls(profile) {
  const baseline = satisfaction(buildSnapshotPaginationFixture({ profile }));
  return [
    "standalone-traversal-completeness", "undeclared-mutation",
    "snapshot-retention-or-isolation", "capture-provenance",
    "evidence-authority-or-cce-consequence", "runtime-truth"
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
