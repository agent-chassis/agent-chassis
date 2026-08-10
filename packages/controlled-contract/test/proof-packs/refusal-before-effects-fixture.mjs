import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034
} from "../../lib/native-contract-carrier-v034.mjs";
import { EVALUATION_INPUT_VERSION_V034 } from "../../lib/verification-profile-v034.mjs";

const REFUSAL_BEFORE_EFFECTS_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.authorization.refusal-before-effects/1.0.0/profile.json",
  import.meta.url
), "utf8"));

const PROOF_PATTERN_IDS = [
  "attempt-performs-operation",
  "attempt-uses-subject",
  "subject-unauthorized-for-operation",
  "refusal-rejects-attempt",
  "attempt-precedes-protected-interval",
  "protected-interval-precedes-refusal",
  "verification-observes-exact-proof-subjects"
];

const roleReferenceIds = Object.freeze({
  operation: "ref-operation",
  attempt: "ref-attempt",
  subject: "ref-subject",
  authority: "ref-authority",
  refusal: "ref-refusal",
  protected_interval: "ref-protected-interval",
  protected_effect_population: "ref-protected-effect-population",
  verification: "ref-verification"
});

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });
const unconditional = () => ({ mode: "unconditional", operand_reference_ids: [] });
const scoped = (mode, ...referenceIds) => ({
  mode,
  operand_reference_ids: referenceIds
});

function roleReferenceId(role) {
  return roleReferenceIds[role];
}

function proposition(propositionId, subjectReferenceId, operator, context, operands) {
  return {
    proposition_id: propositionId,
    subject_reference_id: subjectReferenceId,
    operator,
    applicability_context: context,
    operands
  };
}

function claim(patternId, kind, modality, extras = {}) {
  return {
    claim_id: `claim-${patternId}`,
    kind,
    modality,
    proposition_id: `prop-${patternId}`,
    ...extras
  };
}

function buildRefusalBeforeEffectsFixture({
  domain = "capability",
  profile: suppliedProfile = REFUSAL_BEFORE_EFFECTS_PROFILE,
  protected_effects: protectedEffects = [
    { reference_id: "ref-protected-channel", type_term: "cc:resource" },
    { reference_id: "ref-protected-configuration", type_term: "cc:configuration" }
  ],
  role_type_overrides: roleTypeOverrides = {},
  verification_method: verificationMethod = "test_execution",
  identity_prefix: identityPrefix = domain,
  mutate_contract: mutateContract,
  mutate_input: mutateInput
} = {}) {
  const profile = structuredClone(suppliedProfile);
  const protectedEffectIds = protectedEffects.map(
    ({ reference_id: referenceId }) => referenceId
  );
  const references = [
    ["operation", "cc:capability"],
    ["attempt", "cc:event"],
    ["subject", "cc:actor"],
    ["authority", "cc:authority"],
    ["refusal", "cc:event"],
    ["protected_interval", "cc:event"],
    ["protected_effect_population", "cc:scope"],
    ["verification", "cc:test"]
  ].map(([role, defaultType]) => ({
    reference_id: roleReferenceId(role),
    type_term: roleTypeOverrides[role] ?? defaultType,
    identity: { kind: "profile_term", term: `${identityPrefix}:${role}` }
  }));
  for (const [index, effect] of protectedEffects.entries()) references.push({
    reference_id: effect.reference_id,
    type_term: effect.type_term,
    identity: {
      kind: "profile_term",
      term: effect.identity_term ?? `${identityPrefix}:protected-effect-${index + 1}`
    }
  });

  const attemptId = roleReferenceId("attempt");
  const operationId = roleReferenceId("operation");
  const subjectId = roleReferenceId("subject");
  const authorityId = roleReferenceId("authority");
  const refusalId = roleReferenceId("refusal");
  const intervalId = roleReferenceId("protected_interval");
  const populationId = roleReferenceId("protected_effect_population");
  const verificationId = roleReferenceId("verification");
  const effectOperands = protectedEffectIds.map(ref);

  const propositions = [
    proposition("prop-attempt-performs-operation", attemptId, "reference:performs",
      unconditional(), [ref(operationId)]),
    proposition("prop-attempt-uses-subject", attemptId, "reference:uses",
      unconditional(), [ref(subjectId)]),
    proposition("prop-subject-unauthorized-for-operation", authorityId,
      "reference:authorizes", scoped("where", operationId), [ref(subjectId)]),
    proposition("prop-refusal-rejects-attempt", refusalId, "reference:rejects",
      unconditional(), [ref(attemptId)]),
    proposition("prop-attempt-precedes-protected-interval", attemptId,
      "reference:precedes", unconditional(), [ref(intervalId)]),
    proposition("prop-protected-interval-precedes-refusal", intervalId,
      "reference:precedes", unconditional(), [ref(refusalId)]),
    proposition("prop-protected-effect-population-membership", populationId,
      "reference:contains", unconditional(), effectOperands),
    proposition("prop-protected-effect-population-cardinality", populationId,
      "number:has_cardinality", unconditional(), [
        { kind: "number", value: protectedEffectIds.length }
      ]),
    proposition("prop-verification-observes-exact-proof-subjects", verificationId,
      "reference:reads", unconditional(), [
        ref(attemptId), ref(refusalId), ref(operationId), ...effectOperands
      ]),
    proposition("prop-no-protected-write-before-refusal", attemptId,
      "reference:writes", scoped("before", refusalId), effectOperands),
    proposition("prop-no-protected-mutation-before-refusal", attemptId,
      "reference:mutates", scoped("before", refusalId), effectOperands),
    proposition("prop-write-prohibition-verification", verificationId,
      "reference:covers", unconditional(), [ref(attemptId)]),
    proposition("prop-falsifier-write-prohibition-verification", attemptId,
      "reference:writes", scoped("before", refusalId), effectOperands),
    proposition("prop-mutation-prohibition-verification", verificationId,
      "reference:covers", unconditional(), [ref(populationId)]),
    proposition("prop-falsifier-mutation-prohibition-verification", attemptId,
      "reference:mutates", scoped("before", refusalId), effectOperands)
  ];

  const claims = [
    claim("attempt-performs-operation", "evidence", "MUST"),
    claim("attempt-uses-subject", "evidence", "MUST"),
    claim("subject-unauthorized-for-operation", "evidence", "MUST_NOT"),
    claim("refusal-rejects-attempt", "evidence", "MUST"),
    claim("attempt-precedes-protected-interval", "evidence", "MUST"),
    claim("protected-interval-precedes-refusal", "evidence", "MUST"),
    claim("protected-effect-population-membership", "evidence", "MUST"),
    claim("protected-effect-population-cardinality", "evidence", "MUST"),
    claim("verification-observes-exact-proof-subjects", "evidence", "MUST"),
    claim("no-protected-write-before-refusal", "behavior", "MUST_NOT"),
    claim("no-protected-mutation-before-refusal", "behavior", "MUST_NOT"),
    claim("write-prohibition-verification", "verification", "MUST", {
      verification_method: verificationMethod,
      falsifying_proposition_id: "prop-falsifier-write-prohibition-verification"
    }),
    claim("mutation-prohibition-verification", "verification", "MUST", {
      verification_method: verificationMethod,
      falsifying_proposition_id: "prop-falsifier-mutation-prohibition-verification"
    })
  ];

  const contract = {
    schema_version: SCHEMA_VERSION_V034,
    vocabulary_version: VOCABULARY_VERSION_V034,
    profile_id: PROFILE_ID_V034,
    references,
    propositions,
    claims,
    relations: [
      {
        relation_id: "rel-write-verification-target",
        role: "verifies",
        source_claim_id: "claim-write-prohibition-verification",
        target_claim_id: "claim-no-protected-write-before-refusal"
      },
      {
        relation_id: "rel-mutation-verification-target",
        role: "verifies",
        source_claim_id: "claim-mutation-prohibition-verification",
        target_claim_id: "claim-no-protected-mutation-before-refusal"
      }
    ],
    collections: [
      {
        collection_id: "set-proof-population",
        collection_kind: "closed_set",
        purpose: "profile_proof_population",
        member_claim_ids: PROOF_PATTERN_IDS.map((id) => `claim-${id}`)
      }
    ],
    residue: [],
    annotations: []
  };

  const input = {
    input_version: EVALUATION_INPUT_VERSION_V034,
    evaluation_stage: "pre_dispatch",
    reference_bindings: [
      ...Object.keys(roleReferenceIds).map((role) => ({
        role,
        reference_ids: [roleReferenceId(role)]
      })),
      { role: "protected_effects", reference_ids: protectedEffectIds }
    ],
    number_bindings: [
      { role: "protected_effect_count", value: protectedEffectIds.length }
    ],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: []
  };

  if (mutateContract) mutateContract(contract);
  if (mutateInput) mutateInput(input);
  return { contract, input, profile };
}

function findClaim(contract, patternId) {
  return contract.claims.find(({ claim_id: claimId }) => claimId === `claim-${patternId}`);
}

function findProposition(contract, patternId, { falsifier = false } = {}) {
  const prefix = falsifier ? "prop-falsifier-" : "prop-";
  return contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === `${prefix}${patternId}`
  );
}

export {
  PROOF_PATTERN_IDS,
  REFUSAL_BEFORE_EFFECTS_PROFILE,
  buildRefusalBeforeEffectsFixture,
  findClaim,
  findProposition,
  ref,
  roleReferenceId
};
