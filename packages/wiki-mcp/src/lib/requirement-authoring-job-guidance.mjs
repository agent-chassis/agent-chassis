

import { isDeepStrictEqual } from "node:util";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

export const AUTHORING_VOCABULARY_TOPIC = "authoring_vocabulary";
export const CASE_FAMILY_TOPIC = "family";

export function caseFamilyGuidanceCall(family) {
  return buildNextCall({ tool: "workspace_read_wiki", recommended: true,
    arguments: { reads: [{ subject: { requirement_guidance: true, topic: ["case_authoring", CASE_FAMILY_TOPIC, family] } }] } });
}

export function deriveAuthoringJobVocabulary(vocabularies) {
  const signatures = new Map();
  const common = new Map();
  const positions = Object.keys(vocabularies);

  const indexes = new Set(["schema_version", "relation_details", "relation_accounting",
    "relations_by_object_kind", "single_object_relations_by_object_kind", "restricted_applicability"]);
  for (const [position, vocabulary] of Object.entries(vocabularies)) {
    for (const [key, value] of Object.entries(vocabulary)) {
      if (indexes.has(key)) continue;
      if (common.has(key) && !isDeepStrictEqual(common.get(key), value)) {
        throw new Error(`authoring_job_vocabulary_definition_disagrees: ${key} at ${position}`);
      }
      common.set(key, value);
    }
    for (const detail of vocabulary.relation_details) {
      const held = signatures.get(detail.term);
      if (held !== undefined && !isDeepStrictEqual(held.signature, detail)) {
        throw new Error(`authoring_job_vocabulary_signature_disagrees: ${detail.term} at ${position}`);
      }
      if (held === undefined) signatures.set(detail.term, { signature: detail, positions: [position] });
      else held.positions.push(position);
    }
  }
  return Object.freeze({ schema_version: "requirement-authoring-job-vocabulary.v1",
    ...Object.fromEntries(common),
    position_rule: "Each row's positions are its exact allowed uses: behavior, fails_when, observes. " +
      "Operand bounds and applicability govern every listed use. Follow relation_definition_read for row.term's " +
      "canonical semantics and pinned CEL links. Derive groups from operand_kind and maximum_operands; " +
      "restricted rows carry their exact applicability_modes.",
    positions,
    relation_accounting: Object.fromEntries(Object.entries(vocabularies).map(([position, vocabulary]) =>
      [position, vocabulary.relation_accounting])),
    relation_details: [...signatures.values()].sort((left, right) => left.signature.term.localeCompare(right.signature.term))
      .map(({ signature, positions: allowed }) =>
      ({ ...signature, positions: allowed })) });
}

export function deriveCaseFamilyGuidance(caseAuthoring, familyId, familyFacts) {
  if (!Object.hasOwn(caseAuthoring.families, familyId) || familyFacts.family_id !== familyId) {
    throw new Error(`case_guidance_family_not_supported: ${familyId}`);
  }
  const { families, target_variants: _targets, falsification: _falsifiers,
    schema_version: _version, ...common } = caseAuthoring;
  return { schema_version: "requirement-case-family-guidance.v1",
    scope: { family: familyId, selection: "explicit caller choice; this answer describes only this family" },
    common, family: families[familyId], target: familyFacts.target,
    falsification: familyFacts.falsification,
    navigation: "Use this answer's reference and an offered case-family selection to read another complete family; " +
      "select ['case_authoring'] for the complete general question. Selecting guidance executes and authorizes nothing." };
}

export const caseFamilySelections = caseAuthoring => Object.keys(caseAuthoring.families)
  .map(family => ({ guidance: ["case_authoring", CASE_FAMILY_TOPIC, family] }));
