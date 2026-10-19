

import { createHash } from "node:crypto";

import { CANONICAL_VERSION, compileSpecification } from "@agent-chassis/controlled-contract/canonical-specification";
import { LOWERING_VERSION } from "@agent-chassis/controlled-contract/cel-lowering";
import { relationAvailableForAuthoring } from "@agent-chassis/controlled-contract/vocabulary";

import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";
import { NATIVE_AUTHORING, canonicalJson } from "../../lib/controlled-requirement-authoring-schema.mjs";
import { workItemRequirementBatchSchema } from "../../lib/record-authoring-schema.mjs";
import { GRAMMAR_EXCEPTION_ENFORCEMENT, RECORD_AUTHORING_EXCEPTION_CODES, RECORD_AUTHORING_EXCEPTION_CONSEQUENCES,
  RECORD_AUTHORING_EXCEPTION_RATIONALE_PROVENANCE } from "../../lib/record-authoring-exception.mjs";

import { controlledContractIdentityScope } from "./contract-requirement-authoring.mjs";
import { CONTROLLED_CONTRACT_REQUIREMENT_LIMITS } from "./contract-requirement-vocabulary.mjs";
import { ORDERED_SEQUENCE, behaviorUses, bindEntities, createRequirementNormalizer, finding, isMembership, requirementUses } from
  "./contract-requirement-normalization.mjs";
import { describeRequirementSourceLink, resolveRequirementSourceLink } from "./contract-requirement-source-links.mjs";
import { describeRequirementObjects, nativeSpecificationConstraints } from './contract-requirement-descriptions.mjs';
import { projectRowValueReferences } from './contract-requirement-value-projection.mjs';
import { valueRowMetadata } from './contract-requirement-native-values.mjs';

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
const UNRESOLVED_LIMIT = 64;

export const REQUIREMENT_BATCH_GUIDANCE_PATH = Object.freeze(["save_record_inputs", "requirement_batch"]);
const fail = (code, message, details = {}) => { throw new ControlledContractToolError(code, message, { changed: false,
  ...(typeof details.field === "string" && details.field.startsWith("changes") ? { path: details.field } : {}),
  ...(details.phase === "projection" ? {} : { guidance_path: [...REQUIREMENT_BATCH_GUIDANCE_PATH] }), ...details }); };
const clone = value => structuredClone(value);
const digest40 = value => createHash("sha256").update(value).digest("hex").slice(0, 40);
const pathText = (path, root) => `${root}${path.map(part => typeof part === "number" ? `[${part}]` : `.${part}`).join("")}`;
const BATCH_ROOT = "changes.requirements";
const emptyAuthored = () => ({ rows: [], collections: [], unresolved: [] });

function refuseRequirementBatch(refusals) {
  const corrections = {};
  const findings = refusals.map(row => {
    if (row.recovery?.correction === undefined) return { ...row, path: pathText(row.path, BATCH_ROOT) };
    const { correction, ...recovery } = row.recovery;
    corrections[recovery.correct] = correction;
    return { ...row, path: pathText(row.path, BATCH_ROOT), recovery };
  });
  fail(CODES.REFUSED, `${pathText(refusals[0].path, BATCH_ROOT)}: ${refusals[0].message}`, {
    ...(Object.keys(corrections).length === 0 ? {} : { recovery: { kind: 'resubmit_corrected_batch',
      executable: false, caller_decision_required: true, corrections } }),
    field: pathText(refusals[0].path, BATCH_ROOT), finding_count: findings.length, findings });
}

function projectUnresolvedMeaning(entry, index) {
  const { grammar_exception: exception, ...meaning } = typeof entry === "string" ? { text: entry } : clone(entry);
  return { id: `u${index + 1}`, ...meaning, ...(exception === undefined ? {} : { grammar_exception: {
    enforcement: GRAMMAR_EXCEPTION_ENFORCEMENT, rationale: exception.rationale, ...(exception.source_passages === undefined ? {} : { source_passages: clone(exception.source_passages) }), ...RECORD_AUTHORING_EXCEPTION_RATIONALE_PROVENANCE,
    consequence: RECORD_AUTHORING_EXCEPTION_CONSEQUENCES.grammar } }) };
}

function carryGrammarExceptions(stored, restated) {
  const held = new Map();
  for (const entry of stored) {
    if (typeof entry === "string" || entry.grammar_exception === undefined) continue;
    held.set(entry.text, [...(held.get(entry.text) ?? []), entry.grammar_exception]);
  }
  return restated.map(entry => {
    const text = typeof entry === "string" ? entry : entry.text;
    const exception = held.get(text)?.shift();
    return exception === undefined ? entry : { ...(typeof entry === "string" ? { text } : entry), grammar_exception: clone(exception) };
  });
}

export function prepareGrammarException({ contract = null, subject, action, rationale, sourcePassages }) {
  const stored = contract?.authored_requirements ?? emptyAuthored();
  const position = /^u([1-9][0-9]*)$/u.exec(subject ?? "");
  const index = position === null ? -1 : Number(position[1]) - 1;
  if (index < 0 || index >= stored.unresolved.length) throw new ControlledContractToolError(
    RECORD_AUTHORING_EXCEPTION_CODES.SUBJECT_UNKNOWN,
    `exception.subject names ${JSON.stringify(subject)}, which is no unresolved meaning saved at this revision`,
    { changed: false, phase: "request", path: "exception.subject", kind: "grammar", subject,
      saved_unresolved_meanings: stored.unresolved.length,
      correction: "Read the unit's requirements for the unresolved meanings saved at the current revision. Meaning not yet " +
        "saved is first saved as unresolved draft meaning through changes.requirements.unresolved." });
  const saved = stored.unresolved[index];
  const { grammar_exception: prior, ...meaning } = typeof saved === "string" ? { text: saved } : clone(saved);
  const applied = { rationale, ...(sourcePassages === undefined ? {} : { source_passages: clone(sourcePassages) }) };
  const next = action === "apply" ? { ...meaning, grammar_exception: applied }
    : meaning.reason === undefined ? meaning.text : meaning;
  const unresolved = stored.unresolved.map((entry, at) => at === index ? next : clone(entry));
  return Object.freeze({
    answer: { authored_requirements: { rows: clone(stored.rows), collections: clone(stored.collections), unresolved } },
    subject: `u${index + 1}`, text: meaning.text, ...(meaning.reason === undefined ? {} : { reason: meaning.reason }),
    changed: canonicalJson(prior ?? null) !== canonicalJson(action === "apply" ? applied : null) });
}

export const requirementCompilerIdentity = () => Object.freeze({ batch_version: REQUIREMENT_BATCH_VERSION,
  canonical_version: CANONICAL_VERSION, lowering_version: LOWERING_VERSION, vocabulary_version: NATIVE_AUTHORING.vocabulary_version });

function writtenRow(row) {
  if (isMembership(row)) return { ...valueRowMetadata(row), subject: row.subject, membership: row.membership.map(clause => ({ ...clause })), ...(row.applies === undefined ? {} : { applies: clone(row.applies) }) };
  return { ...valueRowMetadata(row), subject: row.subject, ...(row.modality === undefined ? {} : { modality: row.modality }), ...(row.nature === undefined ? {} : { nature: row.nature }),
    behavior: clone(row.behavior) };
}

function boundInput(written, bindings) {
  const bound = id => bindings.has(id) ? { id, ...clone(bindings.get(id)) } : { id };
  written = projectRowValueReferences(written, bound);
  const applies = value => value === undefined ? {} : { applies: { ...clone(value), mode: value.mode, ...(value.context === undefined ? {} : { context: value.context.map(bound) }) } };
  if (isMembership(written)) return { ...valueRowMetadata(written), subject: bound(written.subject),
    membership: written.membership.map(clause => ({ ...clone(clause), ...(clause.member === undefined ? {} : { member: bound(clause.member) }), ...(clause.modality === undefined ? {} : { modality: clause.modality }) })),
    ...applies(written.applies) };
  return { ...valueRowMetadata(written), subject: bound(written.subject), ...(written.modality === undefined ? {} : { modality: written.modality }),
    ...(written.nature === undefined ? {} : { nature: written.nature }),
    behavior: { ...clone(written.behavior), relation: written.behavior.relation,
      ...(written.behavior.objects === undefined ? {} : { objects: written.behavior.objects.map(object => Object.hasOwn(object, "referent") ? { ...clone(object), referent: bound(object.referent) } : clone(object)) }),
      ...applies(written.behavior.applies) } };
}

function unboundInput(input) {
  const bindings = new Map();
  const unbound = [];
  const named = entity => { if (entity.type_term === undefined) { if (!unbound.includes(entity.id)) unbound.push(entity.id); }
    else bindings.set(entity.id, { type_term: entity.type_term, identity: clone(entity.identity) }); return entity.id; };
  input = projectRowValueReferences(input, named);
  const applies = value => value === undefined ? {} : { applies: { ...clone(value), mode: value.mode, ...(value.context === undefined ? {} : { context: value.context.map(named) }) } };
  const written = Object.hasOwn(input, "membership")
    ? { ...valueRowMetadata(input), subject: named(input.subject), membership: input.membership.map(clause => ({ ...clone(clause), ...(clause.member === undefined ? {} : { member: named(clause.member) }), ...(clause.modality === undefined ? {} : { modality: clause.modality }) })),
      ...applies(input.applies) }
    : { ...valueRowMetadata(input), subject: named(input.subject), ...(input.modality === undefined ? {} : { modality: input.modality }), ...(input.nature === undefined ? {} : { nature: input.nature }),
      behavior: { ...clone(input.behavior), relation: input.behavior.relation,
        ...(input.behavior.objects === undefined ? {} : { objects: input.behavior.objects.map(object => Object.hasOwn(object, "referent") ? { ...clone(object), referent: named(object.referent) } : clone(object)) }),
        ...applies(input.behavior.applies) } };
  return { written, bindings, unbound };
}

function boundEntities(input, into, conflicting) {
  const { bindings } = unboundInput(input);
  for (const [id, binding] of bindings) {
    if (conflicting.has(id)) continue;
    if (into.has(id) && canonicalJson(into.get(id)) !== canonicalJson(binding)) { into.delete(id); conflicting.add(id); } else into.set(id, binding);
  }
}

function deriveRow(normalizer, input, index) {
  const { written, bindings, unbound } = unboundInput(input);
  const prepared = isMembership(written)
    ? normalizer.prepareMembership({ subject: written.subject, clauses: written.membership, applies: written.applies, for_each: written.for_each, within: written.within }, ["requirements", index, "membership"], bindings)
    : normalizer.prepareRequirement(written, ["requirements", index], bindings);
  const pending = [...unbound.map(id => ["entities", id]), ...prepared.holes.map(hole => hole.path.slice(2))];
  return { written, prepared, pending };
}

function deriveAuthored({ unit, authored, contract = null, sourceDescriptions = new Map(), claimIds = null, visibleNodeIds = null, additionalRoots = [] }) {
  const normalizer = createRequirementNormalizer({ schema: workItemRequirementBatchSchema(), unit });
  const inputs = authored.rows.map(row => unboundInput(row.input));
  normalizer.configureScopes(inputs.map(row => row.written), new Map(inputs.flatMap(row => [...row.bindings])));
  const derived = authored.rows.map((row, index) => deriveRow(normalizer, row.input, index));
  const prepared = derived.map(row => row.prepared);
  const ids = authored.rows.map(row => row.row_id);
  const requirements = derived.map(row => row.written);
  const constraintsOf = normalizer.constraintsOfRows(prepared);
  const statements = normalizer.statementsOfRows({ ids, requirements, prepared, constraintsOf, memberships: prepared.map(row => row.membership ?? null) });
  const refusals = [];
  const holes = [];
  const collections = normalizer.resolveCollections({ rows: authored.collections.map(row => ({ ...(row.kind === undefined ? {} : { kind: row.kind }),
    ...(row.purpose === undefined ? {} : { purpose: row.purpose }), members: row.member_row_ids })),
  collectionIds: authored.collections.map(row => row.collection_row_id), ids, requirements, statements, refusals, holes, scope: "contract" });
  refusals.push(...normalizer.restatedCollections(collections));
  const native = nativeSpecificationConstraints(contract, unit);
  const constraints = [...native.constraints, ...constraintsOf.flatMap(rows => rows ?? [])];
  const selected = claimIds === null ? null : new Set([...native.constraints.filter(row => claimIds.has(row.claim_id)).map(row => row.identity),
    ...authored.rows.filter(row => row.claim_ids.length && row.claim_ids.every(id => claimIds.has(id))).flatMap(row => row.constraint_ids)]);
  const roots = selected === null ? null : constraints.filter(row => selected.has(row.identity)).map(row => ({ owner: unit,
    entity: row.constraint.subject, meaning: 'subject', applies: row.constraint.applies }));
  const descriptions = describeRequirementObjects({ specifications: [{ owner: unit, contract, constraints, visibleNodeIds,
    incompleteSubjects: derived.flatMap((row, index) => row.pending.length && authored.rows[index].input.subject.identity
      ? [authored.rows[index].input.subject] : []) }], roots, additionalRoots, sourceDescriptions });
  const context = new Set(descriptions.roots.flatMap(row => row.defining_constraint_ids));
  const describedKeys = new Set(descriptions.nodes.map(row => canonicalJson(row.entity.identity)));
  const compiled = compileSpecification({ unit, constraints,
    collections: collections.filter(row => row?.canonical).map(row => row.canonical), orderedSequence: ORDERED_SEQUENCE,
    selectedConstraintIds: selected, contextConstraintIds: context,
    open: { statements: statements.filter((row, index) => row.state !== "complete" &&
      (selected === null || describedKeys.has(canonicalJson(authored.rows[index].input.subject.identity)))).length,
      collections: selected === null ? collections.filter(row => row?.state !== "complete").length : 0,
      unresolved: authored.unresolved.length + descriptions.missing.length + native.missing.length } });
  return { derived, statements, constraintsOf, collections, compiled, descriptions, refusals };
}

const statusOf = (derivation, authored) => {
  if (derivation.compiled.state === 'none' && authored.rows.length === 0 && authored.unresolved.length === 0 && authored.collections.length === 0) return REQUIREMENT_BATCH_STATUS.none;
  const unfinished = derivation.descriptions.missing.some(row => row.code !== 'description_lowering_unsupported') ||
    derivation.compiled.not_included.incomplete_statements > 0 || derivation.compiled.not_included.incomplete_collections > 0 || authored.unresolved.length > 0;
  return unfinished || derivation.compiled.state === "none" ? REQUIREMENT_BATCH_STATUS.incomplete
    : derivation.compiled.state !== "complete" ? REQUIREMENT_BATCH_STATUS.lowering_unsupported
      : derivation.compiled.coverage.omitted.length ? REQUIREMENT_BATCH_STATUS.compiled_with_omissions : REQUIREMENT_BATCH_STATUS.compiled;
};

function assertRowConstraintIdentities(row, constraintIds) {
  if (canonicalJson(constraintIds) !== canonicalJson(row.constraint_ids)) fail(CODES.ROW_DISAGREES,
    `Stored requirement row ${row.row_id} records constraint identities its own input does not compile to`,
    { phase: "projection", row_id: row.row_id, recorded_constraint_ids: [...row.constraint_ids], derived_constraint_ids: constraintIds });
}

export function projectAuthoredRequirements(contract, { wkId, focus = null, sourceText = null, claimIds = null,
  sourceDescriptions = new Map(), sourceGeneration = null, visibleNodeIds = null } = {}) {
  const stored = contract?.authored_requirements ?? (contract?.claims?.some(row => row.kind === 'behavior') ? emptyAuthored() : null);
  const unitScope = { wk_id: wkId, focus: focus ?? null };

  const kept = stored === undefined || stored === null || claimIds === null ? null
    : new Set(stored.rows.filter(row => row.claim_ids.length > 0 && row.claim_ids.every(id => claimIds.has(id))).map(row => row.row_id));
  const authored = stored;
  if (authored === undefined || authored === null) return Object.freeze({ status: "absent", unit: unitScope, compiler: requirementCompilerIdentity(),
    state: REQUIREMENT_BATCH_STATUS.none, rows: [], collections: [], unresolved: [], compiled: null });
  const derivation = deriveAuthored({ unit: controlledContractIdentityScope(wkId, focus), authored, contract, sourceDescriptions, claimIds, visibleNodeIds });
  const rows = authored.rows.map((row, index) => {
    const statement = derivation.statements[index];
    const constraintIds = (derivation.constraintsOf[index] ?? []).map(entry => entry.identity);
    assertRowConstraintIdentities(row, constraintIds);
    const source = describeRequirementSourceLink(row.source, sourceText);
    return { row_id: row.row_id, state: statement.state, meaning: statement.meaning,

      constraint_ids: constraintIds, claim_ids: [...row.claim_ids],
      ...(statement.state === "complete" ? { constraints: statement.constraints ?? [statement.constraint] } : { pending: clone(derivation.derived[index].pending) }),
      ...(statement.declaration === undefined ? {} : { declaration: statement.declaration }),
      input: clone(row.input),

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
    unresolved: claimIds === null ? authored.unresolved.map(projectUnresolvedMeaning)
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

const labelOf = (row, index) => row.key !== undefined ? `$${row.key}` : row.row_id ?? row.id ?? `requirements[${index}]`;
const rowField = index => `${BATCH_ROOT}.requirements[${index}]`;

function assertRowSelectors(rows, collections) {
  rows.forEach((row, index) => {
    const selectors = ["key", "row_id", "id"].filter(member => row[member] !== undefined);
    if (selectors.length > 1) fail(CODES.ROW_SELECTOR_CONFLICT, `${rowField(index)} carries ${selectors.join(" and ")}; a row is addressed one way`,
      { field: rowField(index), selectors, correction: "keep key for a new row, row_id to restate a saved row as a whole, or id to correct one saved requirement claim" });
  });
  collections.forEach((row, index) => { if (row.key !== undefined && row.row_id !== undefined) fail(CODES.ROW_SELECTOR_CONFLICT,
    `${BATCH_ROOT}.collections[${index}] carries key and row_id; a collection is addressed one way`,
    { field: `${BATCH_ROOT}.collections[${index}]`, selectors: ["key", "row_id"], correction: "keep key for a new collection or row_id to restate a saved one" }); });
}

function nativeVerification({ normalizer, row, index, prepared, bindings, uses, entityHoles }) {
  const field = `${rowField(index)}.verification`;
  const { key: _key, ...verification } = row.verification;
  void _key;
  if (!prepared.inputs) fail(CODES.ASSOCIATION_POPULATION_EMPTY,
    `${field} verifies a row that emits no requirement claim: ${isMembership(row) ? "a closed membership has no native claim to verify" : "the row is incomplete"}`,
    { field, row: labelOf(row, index), reason: isMembership(row) ? "closed_membership_emits_no_claim" : "row_incomplete",
      correction: isMembership(row) ? `omit ${field}; the closed membership itself is saved without it`
        : `omit ${field} until the row is complete, or complete the row in this request` });
  const out = { holes: [], refusals: [] };
  const observes = normalizer.prepareVerificationBehavior(row, verification.verifier, verification.observes, ["requirements", index, "verification", "observes"], bindings, out);
  const failsWhen = normalizer.prepareVerificationBehavior(row, row.subject, verification.fails_when, ["requirements", index, "verification", "fails_when"], bindings, out);
  const subjects = verification.runtime_test?.boundary?.subjects ?? [];
  if (out.refusals.length > 0) fail(CODES.REFUSED, out.refusals[0].message, { field: pathText(out.refusals[0].path, BATCH_ROOT), findings: out.refusals });

  const missing = new Map(entityHoles.map(hole => [hole.path[1], hole]));
  const findings = uses.filter(use => use.path[0] === "requirements" && use.path[1] === index &&
    use.path[2] === "verification" && missing.has(use.id)).map(use => {
    const hole = missing.get(use.id);
    const declarationPath = pathText(hole.path, BATCH_ROOT);
    return finding(pathText(use.path, BATCH_ROOT), "entity_type_missing", hole.question, clone(hole.accepts),
      { id: use.id, declaration_path: declarationPath,
        correction: `declare ${use.id} at ${declarationPath} with its intended type or typed identity, using the accepted entity declaration` });
  });
  if (!observes || !failsWhen || !bindings.has(verification.verifier) || subjects.some(id => !bindings.has(id))) fail(CODES.VERIFICATION_INCOMPLETE,
    `${field} is incomplete: a verification states its verifier, what it observes and what would falsify the requirement in full`,
    { field, unfinished: [...out.holes.map(hole => pathText(hole.path, BATCH_ROOT)), ...findings.map(row => row.path)],
      ...(findings.length === 0 ? {} : { findings }),
      correction: "state every entity type, object, applicability and value of the verification; a verification has no pending member" });
  const declare = id => ({ declare: clone(bindings.get(id)) });
  return { method: verification.method, verifier: declare(verification.verifier), observes, fails_when: failsWhen, subject: prepared.written.subject,
    ...(verification.runtime_test === undefined ? {} : { runtime_test: { ...clone(verification.runtime_test),
      boundary: { ...clone(verification.runtime_test.boundary), subjects: subjects.map(declare) } } }) };
}

export function prepareRequirementBatch({ wkId, focus = null, contract = null, batch = {}, removeRowIds = [], retireClaimIds = [], sourceText = null, compile }) {
  const unit = controlledContractIdentityScope(wkId, focus);
  const schema = workItemRequirementBatchSchema();
  const normalizer = createRequirementNormalizer({ schema, unit });
  const stored = contract?.authored_requirements ?? emptyAuthored();

  if (stored.rows.length) {
    const incumbent = deriveAuthored({ unit, authored: stored });
    stored.rows.forEach((row, index) => assertRowConstraintIdentities(row,
      (incumbent.constraintsOf[index] ?? []).map(entry => entry.identity)));
  }
  const rows = batch.requirements ?? [];
  const batchCollections = batch.collections ?? [];

  rows.forEach((row, index) => {
    for (const [position, statement, member] of [
      ["requirement_behavior", row.behavior, "behavior"],
      ["verification_fails_when", row.verification?.fails_when, "verification.fails_when"]
    ]) {
      if (statement && !relationAvailableForAuthoring(statement.relation, position)) {
        const field = `${rowField(index)}.${member}.relation`;
        fail("controlled_contract_requirement_relation_unavailable", `${field} cannot author ${statement.relation} at ${position}`,
          { field, relation: statement.relation, position, guidance_path: ["vocabulary"],
            correction: "select a behavioral relation from the published vocabulary, or record the unrepresentable meaning explicitly" });
      }
    }
  });
  assertRowSelectors(rows, batchCollections);

  const answerBound = CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.requirements_per_answer;
  if (rows.length + retireClaimIds.length > answerBound) fail("controlled_contract_requirement_invalid",
    `one save carries at most ${answerBound} requirement rows and retired requirement claims together; this one carries ${rows.length} and ${retireClaimIds.length}`,
    { field: rows.length > 0 ? `${BATCH_ROOT}.requirements` : "changes.remove.requirements", maximum: answerBound,
      requirement_count: rows.length, retirement_count: retireClaimIds.length,
      correction: `send at most ${answerBound} rows and retirements in one save, and the rest in a following save` });
  rows.forEach((row, index) => { if (row.user_requirement === undefined && row.user_requirement_occurrence !== undefined) {
    resolveRequirementSourceLink({ wkId, text: sourceText, passage: undefined, occurrence: row.user_requirement_occurrence, field: rowField(index) }); } });

  const known = new Map();
  const conflicting = new Set();
  for (const row of stored.rows) boundEntities(row.input, known, conflicting);
  const declared = Object.fromEntries(Object.entries(batch.entities ?? {}).filter(([id, value]) => !known.has(id) || canonicalJson(typeof value === "string"
    ? { type_term: value, identity: { kind: "profile_term", term: id } } : value) !== canonicalJson(known.get(id))));
  const written = rows.map(writtenRow);
  const ids = rows.map(labelOf);
  const uses = [];
  requirementUses(written, uses);
  rows.forEach((row, index) => {
    if (row.verification === undefined) return;
    const at = ["requirements", index, "verification"];
    behaviorUses(row.verification.verifier, [...at, "verifier"], row.verification.observes, [...at, "observes"], uses);
    if (!isMembership(row)) behaviorUses(row.subject, [...at, "fails_when", "relation"], row.verification.fails_when, [...at, "fails_when"], uses);
    (row.verification.runtime_test?.boundary?.subjects ?? []).forEach((id, position) => uses.push({ id, path: [...at, "runtime_test", "boundary", "subjects", position],
      types: null, role: "a subject of the runtime test boundary" }));
  });
  const refusals = [];
  const { bindings, refusals: entityRefusals, holes: entityHoles } = bindEntities({ uses, declared, known });
  refusals.push(...entityRefusals);

  const matched = new Set();
  const scopedRows = stored.rows.map(saved => {
    const prior = unboundInput(saved.input).written;
    const index = rows.findIndex((incoming, index) => incoming.row_id === saved.row_id || saved.claim_ids.includes(incoming.id)
      || canonicalJson(prior) === canonicalJson(written[index]));
    if (index < 0) return prior;
    matched.add(index);
    return written[index];
  });

  normalizer.configureScopes([...scopedRows, ...written.filter((_row, index) => !matched.has(index))], new Map([...known, ...bindings]));
  const prepared = normalizer.prepareRows(written, bindings);
  for (const row of prepared) refusals.push(...row.refusals);
  refusals.push(...normalizer.membershipsStatedTwice(written, ids));
  const constraintsOf = refusals.length ? [] : normalizer.constraintsOfRows(prepared);
  if (!refusals.length) refusals.push(...normalizer.restatedRequirements(constraintsOf, ids));
  if (refusals.length) refuseRequirementBatch(refusals);

  const storedById = new Map(stored.rows.map(row => [row.row_id, row]));
  const rowsOfClaim = claimId => stored.rows.filter(row => row.claim_ids.includes(claimId));
  const groupRefusal = (field, claimId, row, action) => fail(CODES.GROUP_CORRECTION_REQUIRED,
    `${field} ${action} ${claimId}, one of ${row.claim_ids.length} claims saved row ${row.row_id} emits together; changing one would leave the row's own declaration untrue`,
    { field, claim_id: claimId, row_id: row.row_id, row_claim_ids: [...row.claim_ids],
      correction: `restate the whole row with ${BATCH_ROOT}.requirements[] row_id ${row.row_id}, or remove it with changes.remove.requirement_rows` });
  const selected = new Map();
  const select = (rowId, field) => { if (selected.has(rowId)) fail(CODES.ROW_SELECTED_TWICE, `${field} and ${selected.get(rowId)} both address saved row ${rowId}`,
    { field, row_id: rowId, fields: [selected.get(rowId), field], correction: "address a saved row once in one request" }); selected.set(rowId, field); };
  const taken = new Set(stored.rows.map(row => row.row_id));
  const inputs = written.map((row, index) => boundInput(row, bindings));
  const targets = rows.map((row, index) => {
    const field = rowField(index);
    if (row.row_id !== undefined) {
      if (!storedById.has(row.row_id)) fail(CODES.ROW_UNKNOWN, `${field}.row_id names ${row.row_id}, which this contract does not store`,
        { field: `${field}.row_id`, row_id: row.row_id, stored_row_ids: stored.rows.map(entry => entry.row_id).slice(0, 32),
          correction: "read the unit's requirements for its saved row ids, or send the row with key as a new row" });
      select(row.row_id, field);
      return { row_id: row.row_id, existing: storedById.get(row.row_id), restated: true };
    }
    if (row.id !== undefined) {
      if ((prepared[index].inputs ?? []).length > 1) fail(CODES.GROUP_CORRECTION_REQUIRED,
        `${field}.id corrects one saved claim, and the row states ${prepared[index].inputs.length} statements, one per object`,
        { field: `${field}.id`, claim_id: row.id, statement_count: prepared[index].inputs.length,
          correction: "state one object to correct one claim, or send the grouped statement as a row with key or row_id" });
      const containing = rowsOfClaim(row.id);
      const group = containing.find(entry => entry.claim_ids.length > 1);
      if (group) groupRefusal(`${field}.id`, row.id, group, "corrects");
      if (containing.length === 1) { select(containing[0].row_id, field); return { row_id: containing[0].row_id, existing: containing[0], restated: false }; }
    }

    let salt = 0;
    for (;;) {
      const rowId = `row-${digest40(canonicalJson([unit, inputs[index], salt]))}`;
      const existing = storedById.get(rowId);
      if (existing !== undefined && canonicalJson(existing.input) === canonicalJson(inputs[index])) { select(rowId, field); return { row_id: rowId, existing, restated: false }; }
      if (!taken.has(rowId)) { taken.add(rowId); return { row_id: rowId, existing: null, restated: false }; }
      salt += 1;
    }
  });

  const removedRows = new Set();
  const removedCollections = new Set();
  const storedCollections = new Map(stored.collections.map(row => [row.collection_row_id, row]));
  removeRowIds.forEach((rowId, index) => {
    const field = `changes.remove.requirement_rows[${index}]`;
    if (storedCollections.has(rowId)) { removedCollections.add(rowId); return; }
    if (!storedById.has(rowId)) fail(CODES.ROW_UNKNOWN, `${field} names ${rowId}, which this contract does not store`,
      { field, row_id: rowId, correction: "read the unit's requirements for its saved row ids" });
    if (selected.has(rowId)) fail(CODES.ROW_SELECTED_TWICE, `${field} removes saved row ${rowId}, which ${selected.get(rowId)} also addresses`,
      { field, row_id: rowId, fields: [selected.get(rowId), field], correction: "restate the row or remove it, not both" });
    removedRows.add(rowId);
  });
  retireClaimIds.forEach((claimId, index) => {
    for (const row of rowsOfClaim(claimId)) {
      if (row.claim_ids.length > 1 && !removedRows.has(row.row_id) && !selected.has(row.row_id)) groupRefusal(`changes.remove.requirements[${index}]`, claimId, row, "retires");

      if (row.claim_ids.length === 1 && !selected.has(row.row_id)) removedRows.add(row.row_id);
    }
  });

  const flat = [];
  const flatOf = rows.map((row, index) => {
    const verification = row.verification === undefined ? null : nativeVerification({ normalizer, row, index, prepared: prepared[index], bindings, uses, entityHoles });
    return (prepared[index].inputs ?? []).map(input => { flat.push({ ...input, ...(verification === null ? {} : { verification }),
      ...(row.id === undefined ? {} : { replace_claim_id: row.id }), ...(row.rebind_case_ids === undefined ? {} : { rebind_case_ids: [...row.rebind_case_ids] }) });
    return flat.length - 1; });
  });

  const stated = flat.length === 0 ? [] : compile({ requirements: flat }, { statementsOfRows: true }).compiled;
  const claimIdsOf = flatOf.map(positions => [...new Set(positions.map(position => stated[position].claim_id).filter(id => id !== null))]);

  const sourceOf = rows.map((row, index) => row.user_requirement === undefined ? null
    : resolveRequirementSourceLink({ wkId, text: sourceText, passage: row.user_requirement, occurrence: row.user_requirement_occurrence, field: rowField(index) }));
  const authoredRow = index => {
    const mine = constraintsOf[index];
    const { pending } = deriveRow(normalizer, inputs[index], index);

    const source = sourceOf[index] ?? targets[index].existing?.source ?? null;
    return { row_id: targets[index].row_id, input: inputs[index], pending, constraint_ids: (mine ?? []).map(entry => entry.identity),
      claim_ids: claimIdsOf[index], ...(source === null ? {} : { source: clone(source) }) };
  };
  const byRowId = new Map(targets.map((target, index) => [target.row_id, index]));
  const prospective = [...stored.rows.filter(row => !removedRows.has(row.row_id)).map(row => byRowId.has(row.row_id) ? authoredRow(byRowId.get(row.row_id)) : clone(row)),
    ...targets.flatMap((target, index) => target.existing === null ? [authoredRow(index)] : [])];
  const prospectiveIds = new Set(prospective.map(row => row.row_id));

  const stillEmitted = new Set(prospective.flatMap(row => row.claim_ids));
  const corrected = new Set(rows.flatMap(row => row.id === undefined ? [] : [row.id]));
  const leaving = [...stored.rows.filter(row => removedRows.has(row.row_id)), ...targets.filter(target => target.existing !== null).map(target => target.existing)]
    .flatMap(row => row.claim_ids).filter(claimId => !stillEmitted.has(claimId) && !corrected.has(claimId));
  const retire = [...new Set([...retireClaimIds, ...leaving])];

  const keyed = new Map(rows.flatMap((row, index) => row.key === undefined ? [] : [[`$${row.key}`, targets[index].row_id]]));
  const collectionTargets = batchCollections.map((row, index) => {
    const field = `${BATCH_ROOT}.collections[${index}]`;
    const members = row.members.map((member, position) => {
      const rowId = member.startsWith("$") ? keyed.get(member) : member;
      if (rowId === undefined || !prospectiveIds.has(rowId)) fail(CODES.ROW_UNKNOWN,
        `${field}.members[${position}] names ${member}, which is ${member.startsWith("$") ? "no requirement label of this request" : "no saved requirement row of this unit after this save"}`,
        { field: `${field}.members[${position}]`, member, accepted_labels: [...keyed.keys()], correction: "name a requirement of this request by \"$key\" or a saved row by its row_id" });
      return rowId;
    });
    const repeated = members.findIndex((member, position) => members.indexOf(member) !== position);
    if (repeated !== -1) fail(CODES.REFUSED, `${field}.members[${repeated}] names a requirement the collection already lists; a collection lists each requirement once`,
      { field: `${field}.members[${repeated}]`, findings: [{ path: `${field}.members[${repeated}]`, cause: "collection_member_stated_twice",
        message: "a collection lists each requirement once", recovery: { kind: "remove_member", path: `${field}.members[${repeated}]` } }] });
    const body = { ...(row.kind === undefined ? {} : { kind: row.kind }), ...(row.purpose === undefined ? {} : { purpose: row.purpose }), member_row_ids: members };
    if (row.row_id !== undefined) {
      if (!storedCollections.has(row.row_id) || removedCollections.has(row.row_id)) fail(CODES.ROW_UNKNOWN, `${field}.row_id names ${row.row_id}, which this contract does not store`,
        { field: `${field}.row_id`, row_id: row.row_id, correction: "read the unit's requirements for its saved collection ids, or send the collection without row_id" });
      return { collection_row_id: row.row_id, ...body };
    }
    return { collection_row_id: `collection-row-${digest40(canonicalJson([unit, body]))}`, ...body };
  });
  const replaced = new Map(collectionTargets.map(row => [row.collection_row_id, row]));
  const collections = [...stored.collections.filter(row => !removedCollections.has(row.collection_row_id)).map(row => replaced.get(row.collection_row_id) ?? clone(row)),
    ...collectionTargets.filter(row => !storedCollections.has(row.collection_row_id))]
    .filter((row, position, all) => all.findIndex(other => other.collection_row_id === row.collection_row_id) === position);
  const dangling = collections.filter(row => row.member_row_ids.some(rowId => !prospectiveIds.has(rowId)));
  if (dangling.length > 0) fail(CODES.ROW_REMOVAL_DEPENDENCY, "a saved collection still lists a requirement row this save removes",
    { field: "changes.remove.requirement_rows", dependencies: dangling.map(row => ({ collection_row_id: row.collection_row_id,
      removed_row_ids: row.member_row_ids.filter(rowId => !prospectiveIds.has(rowId)) })),
    correction: "remove the collection in the same request by its collection row id, or restate it without the removed rows" });

  const unresolved = batch.unresolved === undefined ? clone(stored.unresolved)
    : carryGrammarExceptions(stored.unresolved, clone(batch.unresolved));
  const tooLong = unresolved.findIndex(entry => Buffer.byteLength(typeof entry === "string" ? entry : entry.text, "utf8") > NATIVE_AUTHORING.limits.text_bytes);
  if (unresolved.length > UNRESOLVED_LIMIT || tooLong !== -1) fail(CODES.UNRESOLVED_LIMIT,
    `${BATCH_ROOT}.unresolved holds at most ${UNRESOLVED_LIMIT} meanings of at most ${NATIVE_AUTHORING.limits.text_bytes} bytes each`,
    { field: tooLong === -1 ? `${BATCH_ROOT}.unresolved` : `${BATCH_ROOT}.unresolved[${tooLong}]`, maximum_items: UNRESOLVED_LIMIT, maximum_bytes: NATIVE_AUTHORING.limits.text_bytes });

  const authored = { rows: prospective, collections, unresolved };
  const derivation = deriveAuthored({ unit, authored });
  if (derivation.refusals.length > 0) refuseRequirementBatch(derivation.refusals);

  prospective.forEach((row, index) => {
    const constraintIds = (derivation.constraintsOf[index] ?? []).map(entry => entry.identity);
    if (!byRowId.has(row.row_id) && row.input.definition === true && row.claim_ids.length === 0) row.constraint_ids = constraintIds;
    assertRowConstraintIdentities(row, constraintIds);
  });

  return Object.freeze({
    answer: { ...(flat.length === 0 ? {} : { requirements: flat }), ...(retire.length === 0 ? {} : { retire_claim_ids: retire }), authored_requirements: authored },

    rows: rows.map((row, index) => ({ index, ...(row.key === undefined ? {} : { key: row.key }), row_id: targets[index].row_id,
      state: constraintsOf[index] ? "complete" : "incomplete", constraint_ids: (constraintsOf[index] ?? []).map(entry => entry.identity), claim_ids: claimIdsOf[index],
      requirement_indexes: flatOf[index].filter(position => stated[position].claim_id !== null),
      ...(row.verification === undefined ? {} : { ...(row.verification.key === undefined ? {} : { verification_key: row.verification.key }),
        verification_claim_id: stated[flatOf[index][0]].verification_claim_id }) })),
    collections: collectionTargets.map((row, index) => ({ index, ...(batchCollections[index].key === undefined ? {} : { key: batchCollections[index].key }),
      collection_row_id: row.collection_row_id })),
    removed_row_ids: [...removedRows], removed_collection_row_ids: [...removedCollections], retire_claim_ids: retire });
}
