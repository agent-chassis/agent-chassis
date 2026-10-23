
import { CANONICAL_VERSION } from "@agent-chassis/controlled-contract/canonical-specification";
import { LOWERING_VERSION } from "@agent-chassis/controlled-contract/cel-lowering";
import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";
import { NATIVE_AUTHORING, canonicalJson } from "../../lib/controlled-requirement-authoring-schema.mjs";
import { GRAMMAR_EXCEPTION_ENFORCEMENT, RECORD_AUTHORING_EXCEPTION_CONSEQUENCES, RECORD_AUTHORING_EXCEPTION_RATIONALE_PROVENANCE } from "../../lib/record-authoring-exception.mjs";
import { controlledContractIdentityScope } from "./contract-requirement-identity.mjs";
import { deriveAuthored, assertRowConstraintIdentities, emptyAuthoredRequirements as emptyAuthored } from "./contract-requirement-derivation.mjs";
import { describeRequirementSourceLink, projectRequirementSourceLink } from "./contract-requirement-source-links.mjs";
export const REQUIREMENT_BATCH_VERSION = "controlled-requirement-batch.v1";
export const REQUIREMENT_BATCH_CODES = Object.freeze({
  REFUSED: "controlled_contract_requirement_batch_refused",
  ROW_SELECTOR_CONFLICT: "controlled_contract_requirement_row_selector_conflict",
  ROW_UNKNOWN: "controlled_contract_requirement_row_unknown",
  ROW_SELECTED_TWICE: "controlled_contract_requirement_row_selected_twice",
  GROUP_CORRECTION_REQUIRED: "controlled_contract_requirement_row_group_correction_required",
  ASSOCIATION_POPULATION_EMPTY: "controlled_contract_requirement_association_population_empty",
  VERIFICATION_INCOMPLETE: "controlled_contract_requirement_verification_incomplete",
  ROW_REMOVAL_DEPENDENCY: "controlled_contract_requirement_row_removal_dependency_conflict",
  UNRESOLVED_LIMIT: "controlled_contract_requirement_unresolved_limit",
  ROW_DISAGREES: "controlled_contract_requirement_row_disagrees"
});
const CODES = REQUIREMENT_BATCH_CODES;

export const REQUIREMENT_BATCH_STATUS = Object.freeze({ compiled: "compiled", compiled_with_omissions: "compiled_with_omissions",
  lowering_unsupported: "lowering_unsupported", incomplete: "incomplete", none: "none" });

export const REQUIREMENT_BATCH_GUIDANCE_PATH = Object.freeze(["save_record_inputs", "requirement_batch"]);
const fail = (code, message, details = {}) => { throw new ControlledContractToolError(code, message, { changed: false,
  ...(typeof details.field === "string" && details.field.startsWith("changes") ? { path: details.field } : {}),
  ...(details.phase === "projection" ? {} : { guidance_path: [...REQUIREMENT_BATCH_GUIDANCE_PATH] }), ...details }); };
const clone = value => structuredClone(value);

function projectUnresolvedMeaning(entry, sourceText) {
  const { grammar_exception: exception, ...meaning } = typeof entry === "string" ? { text: entry } : clone(entry);
  return { ...meaning, ...(meaning.source_passages === undefined ? {} : {
    source_passages: meaning.source_passages.map(stored => {
      const link = describeRequirementSourceLink(stored, sourceText);
      return projectRequirementSourceLink({ ...link, ...(link.state !== 'stale' ? {} : {
        correction: 'Restate changes.requirements.unresolved, preserving every intended fragment, with source_passages selected against the current user requirements.' }) });
    }) }),
    ...(exception === undefined ? {} : { grammar_exception: {
    enforcement: GRAMMAR_EXCEPTION_ENFORCEMENT, rationale: exception.rationale, ...(exception.source_passages === undefined ? {} : { source_passages: clone(exception.source_passages) }), ...RECORD_AUTHORING_EXCEPTION_RATIONALE_PROVENANCE,
    consequence: RECORD_AUTHORING_EXCEPTION_CONSEQUENCES.grammar } }) };
}

export const requirementCompilerIdentity = () => Object.freeze({ batch_version: REQUIREMENT_BATCH_VERSION,
  canonical_version: CANONICAL_VERSION, lowering_version: LOWERING_VERSION, vocabulary_version: NATIVE_AUTHORING.vocabulary_version });

const statusOf = (derivation, authored) => {
  if (derivation.compiled.state === 'none' && authored.rows.length === 0 && authored.unresolved.length === 0 && authored.collections.length === 0) return REQUIREMENT_BATCH_STATUS.none;
  const unfinished = derivation.descriptions.missing.some(row => row.code !== 'description_lowering_unsupported') ||
    derivation.compiled.not_included.incomplete_statements > 0 || derivation.compiled.not_included.incomplete_collections > 0 || authored.unresolved.length > 0;
  return unfinished || derivation.compiled.state === "none" ? REQUIREMENT_BATCH_STATUS.incomplete
    : derivation.compiled.state !== "complete" ? REQUIREMENT_BATCH_STATUS.lowering_unsupported
      : derivation.compiled.coverage.omitted.length ? REQUIREMENT_BATCH_STATUS.compiled_with_omissions : REQUIREMENT_BATCH_STATUS.compiled;
};

export function projectAuthoredRequirements(contract, { wkId, focus = null, sourceText = null, claimIds = null,
  sourceDescriptions = new Map(), sourceGeneration = null, visibleNodeIds = null } = {}) {
  const stored = contract?.authored_requirements ?? (contract?.claims?.some(row => row.kind === 'behavior') ? emptyAuthored() : null);
  const unitScope = { wk_id: wkId, focus: focus ?? null };

  const kept = stored === undefined || stored === null || claimIds === null ? null
    : new Set(stored.rows.filter(row => row.claim_ids.length > 0 && row.claim_ids.every(id => claimIds.has(id))).map(row => row.row_id));
  const authored = stored;
  if (authored === undefined || authored === null) return Object.freeze({ status: "absent", unit: unitScope, compiler: requirementCompilerIdentity(),
    state: REQUIREMENT_BATCH_STATUS.none, rows: [], collections: [], unresolved: [], compiled: null });
  for (const collection of authored.collections) {
    const members = collection.member_row_ids;
    const malformed = !Array.isArray(members) || members.some(member => typeof member !== 'string' || member.length === 0);
    if (malformed || members.some(member => !authored.rows.some(row => row.row_id === member))) fail(
      'controlled_contract_requirement_collection_invalid', malformed
        ? 'The saved collection member association is malformed; members must be nonempty authored declaration bindings.'
        : 'A saved collection member has no authored declaration in the captured contract.',
      { phase: 'projection', field: 'members', collection: {
        ...(collection.kind === undefined ? {} : { kind: collection.kind }),
        ...(collection.purpose === undefined ? {} : { purpose: collection.purpose }) },
      uncertainty: 'The complete collection membership cannot be established from this saved source.',
      correction: 'Stop: the stored collection relationship is inconsistent. No supported save can safely infer the missing authored membership.' });
  }
  const derivation = deriveAuthored({ unit: controlledContractIdentityScope(wkId, focus), authored, contract, sourceDescriptions, claimIds, visibleNodeIds });
  const rows = authored.rows.map((row, index) => {
    const statement = derivation.statements[index];
    const constraintIds = (derivation.constraintsOf[index] ?? []).map(entry => entry.identity);
    assertRowConstraintIdentities(row, constraintIds, fail);
    const described = describeRequirementSourceLink(row.source, sourceText);
    const source = row.source_role === 'context' && described.state === 'stale' ? { ...described,
      correction: 'Target and restate this complete definition with an exact current user_requirement and its occurrence where repeated; explicitly choose source_role:"context" to classify the new binding or source_role:null to clear the classification.' } : described;
    return { row_id: row.row_id, state: statement.state, meaning: statement.meaning,

      constraint_ids: constraintIds, claim_ids: [...row.claim_ids],
      ...(statement.state === "complete" ? { constraints: statement.constraints ?? [statement.constraint] } : { pending: clone(derivation.derived[index].pending) }),
      ...(statement.declaration === undefined ? {} : { declaration: statement.declaration }),
      input: clone(row.input), ...(row.source_role === undefined ? {} : { source_role: row.source_role }),

      source: source.state === "absent" ? source : { ...source, constraint_ids: constraintIds, claim_ids: [...row.claim_ids] } };
  });
  const collections = derivation.collections.map((row, index) => ({ collection_row_id: authored.collections[index].collection_row_id, kind: row.kind,
    ...(row.purpose === undefined ? {} : { purpose: row.purpose }), state: row.state,
    members: row.members.map(member => member.state === undefined ? { row_id: member.requirement, constraint_ids: member.identities } : { row_id: member.requirement, state: member.state }),
    ...(row.identity === undefined ? {} : { identity: row.identity, meaning: row.meaning }) }));
  const contextIds = new Set(derivation.descriptions.roots.flatMap(row => row.defining_constraint_ids));
  const selectedRows = kept === null ? rows : rows.filter(row => kept.has(row.row_id));
  return Object.freeze({ status: "present", unit: unitScope, compiler: requirementCompilerIdentity(), state: statusOf(derivation, authored),
    rows: selectedRows, collections: kept === null ? collections : collections.filter(row => row.members.every(member => kept.has(member.row_id))),
    definition_dependencies: kept === null ? [] : rows.filter(row => !kept.has(row.row_id) && row.constraint_ids.some(id => contextIds.has(id)))
      .map(({ source: _source, ...row }) => ({ ...row, role: 'definition_context' })),
    unresolved: claimIds === null ? authored.unresolved.map(entry => projectUnresolvedMeaning(entry, sourceText))
      : authored.unresolved.length ? [{ code: 'description_unresolved_scope', unresolved_meanings: authored.unresolved.length }] : [],
    descriptions: derivation.descriptions, source_generation: sourceGeneration,
    compiled: derivation.compiled });
}

export function requirementDescriptionEntities(contract, { unit, claimIds = null,
  additionalRoots = [], visibleNodeIds = null, previousContract = undefined } = {}) {
  const descriptions = projectRequirementDescriptions(contract, { unit, claimIds, additionalRoots, visibleNodeIds });
  let roots = descriptions.roots;
  if (previousContract !== undefined) {
    const before = projectRequirementDescriptions(previousContract, { unit });
    const previous = new Map(before.nodes.map(row => [row.key, canonicalJson(row)]));
    const current = new Map(descriptions.nodes.map(row => [row.key, canonicalJson(row)]));
    const changed = new Set([...new Set([...previous.keys(), ...current.keys()])]
      .filter(key => previous.get(key) !== current.get(key)));
    roots = roots.filter(row => [row.key, ...row.dependency_keys].some(key => changed.has(key)));
  }
  const needed = new Set(roots.flatMap(row => [row.key, ...row.dependency_keys]));
  return descriptions.nodes.filter(row => needed.has(row.key)).map(row => row.entity);
}

export function projectRequirementDescriptions(contract, { unit, claimIds = null,
  sourceDescriptions = new Map(), visibleNodeIds = null, additionalRoots = [] } = {}) {
  return deriveAuthored({ unit, contract, authored: contract?.authored_requirements ?? emptyAuthored(),
    claimIds, sourceDescriptions, visibleNodeIds, additionalRoots }).descriptions;
}
