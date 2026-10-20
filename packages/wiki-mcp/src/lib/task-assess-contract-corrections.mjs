

import { recordAuthoringAvailability } from "@agent-chassis/wiki-core/src/lib/record-authoring-availability.mjs";
import { FIND_PROOFS_TASK } from "@agent-chassis/controlled-contract/proof-discovery-task";
import { requirementGuidanceRecoveryCall } from "./requirement-authoring-guidance.mjs";
import { AUTHORING_VOCABULARY_TOPIC } from "./requirement-authoring-job-guidance.mjs";
import { isDeepStrictEqual } from "node:util";

const definitionGrammar = registeredTier => [["required_object_shapes"], [AUTHORING_VOCABULARY_TOPIC],
  ["save_record_inputs", "requirement_batch"]].map(ownerPath => requirementGuidanceRecoveryCall(ownerPath, registeredTier));

const schemaRead = (registeredTier, definition) => requirementGuidanceRecoveryCall(
  ["requirement_schema", "existing", ...(definition === undefined ? [] : [definition])], registeredTier);
function definitionCorrection(subject, registeredTier) {
  const identity = subject.authored_identity_correction === true;
  const meanings = subject.required_uses ?? [];
  const population = meanings.some(use => use.required_meaning === "population");
  const rowSchema = identity ? "requirement" : population ? "membership_requirement" : "definition_requirement";

  const multipleRoots = !identity && (meanings.some(use => !['value', 'condition', 'population'].includes(use.required_meaning)) ||
    population && meanings.some(use => use.required_meaning !== 'population'));
  const schema = () => schemaRead(registeredTier, multipleRoots ? undefined : rowSchema);
  const entity = subject.object?.entity;
  if (entity === undefined) return { executable: false, required_uses: meanings,
    limitation: { cause: 'The selected diagnosis establishes no exact entity for this definition correction.',
      stop: 'No replacement identity or authored definition was selected.' } };
  if (identity && (!(subject.requirements?.length > 0) || subject.requirements.some(row => row.target === undefined))) {
    const unresolved = (subject.requirements ?? []).flatMap(row => row.targeting === undefined ? [] : [row.targeting]);
    return { executable: false, limitation: { code: 'definition_target_unresolved',
      cause: 'The diagnosed identity has no unique, available authored correction target.',
      ...(unresolved.length ? { targeting: unresolved } : {}),
      stop: 'No identity replacement is offered. Narrow the target with established authored meaning only; do not select by storage identity or position.' } };
  }
  const name = entity?.identity?.kind === 'profile_term' ? entity.identity.term : 'definition_subject';
  const correction = { executable: false,
    accepted_schema: [schema()],
    schema_definition: rowSchema,
    ...(!identity ? { construction_read: requirementGuidanceRecoveryCall(
      population ? ['requirement_schema', 'existing', 'membership_requirement']
        : ['compact_record_comparison', meanings.every(use => use.required_meaning === 'condition')
          ? 'conditional_boundary' : 'planned_operation'], registeredTier) } : {}),

    ...(!identity ? { shape: { changes: { requirements: { entities: {
      [name]: entity.identity.kind === 'profile_term' ? entity.type_term : entity },
      requirements: [{ subject: name, ...(!population ? { definition: true } : {}) }] } } } } : {}),
    missing_authored_input: identity ? ["caller intent", "new entity id and exact identity", "affected row corrections preserving intended behavior"]
      : [population ? "membership clauses and applicability" : "behavior relation and operands defining the required typed meaning",
        "applicable observation/type or value inputs; condition definitions must yield bool"],
    ...(!identity ? { append_instruction: "Append the missing definition rows in a subsequent save_record using the current_read response.contexts entry for the write unit's revision; do not resend or replace existing operative rows." } : {}),
    constraints: "KEEP operative behavior, applicability, source links and intended verification/case associations at the listed rows and uses. CHANGE identity only for a diagnosed identity mistake; specification-owned entities keep their identity. SUPPLY the typed meaning in required_uses through applicable definitions and required relationships. The author chooses capture boundaries and meaning; types, existence and unrelated symbol equality supply no missing behavior." };
  if (identity) correction.alternatives = [
    { intent: "correct_existing_source_reference",
      candidates: subject.finding.source.candidates ?? [],
      accepted_schema_from: "correction.accepted_schema",
      missing_authored_input: ["the exact intended existing declaration"],
      instruction: "Choose the intended existing-source identity; declaring a different identity under the saved entity id is refused." },
    { intent: "specify_new_functionality", type_term: subject.object.entity.type_term,
      construction_read: requirementGuidanceRecoveryCall(["compact_record_comparison", "planned_operation"], registeredTier),
      accepted_schema: [schemaRead(registeredTier)],
      missing_authored_input: ["new specification-owned entity id", "applicable typed inputs, results and conditions"],
      instruction: "If the intended functionality is new, declare its specification-owned identity by type under a new entity id and author its behavior; no implementation symbol is required." }];
  if (identity) correction.row_correction = {
    targets_from: "affected subject.requirements[].target; restate its declaration and preserve its listed uses",
    guidance: [requirementGuidanceRecoveryCall(["save_record_inputs", "requirement_batch", "row_addressing"], registeredTier),
      requirementGuidanceRecoveryCall(["required_object_shapes", "requirement_rebinding"], registeredTier)],
    instruction: "KEEP behavior, conditions, source links and intended evidence associations. CHANGE only the diagnosed identity at its listed uses. SUPPLY typed definitions for required_uses. When changing a whole declaration's assertions, use its whole target with replacement_key: claims may select $key for the complete submitted population or an explicit claim selector with requirement:$key for each intended subset member. Use the separate verification.key for explicit check links and case.verification. Translate returned claims explicitly; preserve unrelated selections and shared case IDs. Saved selectors still select saved assertions. Do not clear required links, infer cross-unit mappings, mutate immutable identities or replace returned values with existence." };
  return correction;
}

export function assessmentDefinitionIdentityRecovery(carrier, diagnosis, registeredTier) {
  if (!writable(carrier) || !recordAuthoringAvailability(registeredTier).compile_requirements) return null;
  const subject = diagnosis.subjects.find(row => row.authored_identity_correction === true);
  if (subject === undefined) return null;
  const correction = definitionCorrection(subject, registeredTier);
  return correction.alternatives === undefined ? null : { purpose: "definition_identity_intent",
    alternatives: correction.alternatives.map(({ intent, instruction }) => ({ intent, instruction })) };
}

const selects = subject => typeof subject.discovery_input === "string";
const authoredField = subject => selects(subject) ? "obligations[].proof.name" : subject.field;

const proofDiscovery = subjects => [...new Map(subjects.filter(selects)
  .map(subject => subject.discovery_input === "proof_name" && typeof subject.proof_name === "string"
    ? { tool: FIND_PROOFS_TASK, arguments: { proof_name: subject.proof_name } }
    : { tool: FIND_PROOFS_TASK, executable: false, missing_caller_input: [subject.discovery_input] })
  .map(call => [JSON.stringify(call), call])).values()];
const address = carrier => ({ unit: carrier.unit,
  ...(carrier.focus === null ? {} : { focus: carrier.focus }),
  ...(carrier.selection.scope === "selected_obligation" ? { obligation_id: carrier.selection.obligation_id } : {}) });
const writable = carrier => ["orchestrator", "operator"].includes(carrier.source_authority.role);
const saveStatus = carrier => !writable(carrier) ? "authoring_not_authorized"
  : carrier.focus !== null ? "focused_save_unsupported" : "awaiting_authored_values";

const unlinked = subject => subject.association?.condition === "no_eligible_verification"
  ? subject.association.required_choice : null;

const owned = subject => subject.association?.required_choice?.otherwise === undefined
  ? null : subject.association.required_choice;
const ownedClauses = (clause, { when, field, otherwise }) => [{ ...clause, field, when }, { ...clause, ...otherwise }];

const linkClauses = (subjects = [], clauses) => Object.fromEntries(Object.entries(clauses).map(([key, clause]) => {
  const referencing = subjects.filter(subject => subject.corrections?.includes(key));
  const choices = referencing.map(unlinked);
  if (key === "association" && referencing.length > 0 && referencing.every(owned)) {
    const [reuse, { field, when }] = ownedClauses(clause, owned(referencing[0]));
    return [key, { ...reuse, otherwise: { field, when } }];
  }
  return [key, choices.length > 0 && choices.every(choice => choice?.field === clause.field)
    ? { ...clause, field: choices[0].links_field } : clause];
}));

export function assessmentSaveGuidance(carrier, purpose, registeredTier, detailed = false) {
  const status = saveStatus(carrier);
  const meaning = ['definition', 'specification_meaning'].includes(purpose);

  const missingRequirements = !meaning && purpose !== 'applicability' &&
    carrier.assessment?.specification?.status === 'not_assessed' &&
    recordAuthoringAvailability(registeredTier).compile_requirements;
  const missingChain = missingRequirements && carrier.diagnosis_inventory?.diagnoses
    .some(row => row.code === 'obligation_coverage_authored_case_missing');
  const unit = meaning ? carrier.unit.split('#')[0] : carrier.unit;
  const members = meaning ? ['requirements'] : purpose === 'applicability' ? ['controlled_acceptance']
    : missingRequirements ? ['requirements', 'obligations'] : ['obligations'];
  return { required_arguments: ["unit", "revision", "changes"],
    revision_from: `current_read response.contexts[${JSON.stringify(unit)}].revision; never historical assessment evidence`,
    changes_schema_from: status !== 'awaiting_authored_values' ? null : {
      current_read: { tool: 'workspace_read_wiki', arguments: { reads: [{ subject: unit, for_changes: members }] } },
      calls_from: `current_read response.contexts[${JSON.stringify(unit)}].next_calls`,
      select: { input_contract: { tool: 'save_record', members } } },
    ...(missingChain && status === 'awaiting_authored_values' && !detailed ? {
      requirement_chain: "Requirements are absent. Select the missing-case diagnosis for the requirement/verification-to-case recovery sequence."
    } : {}),
    ...(missingChain && status === 'awaiting_authored_values' && detailed ? { recovery_sequence: {
      requirements_unit: carrier.unit.split('#')[0],
      requirements_current_read: { tool: 'workspace_read_wiki', arguments: { reads: [{ subject: carrier.unit.split('#')[0], for_changes: ['requirements'] }] } },
      requirements_select: { input_contract: { tool: 'save_record', members: ['requirements'] } },
      guidance: [['save_record_inputs', 'requirement_batch'], ['case_authoring']]
        .map(topic => requirementGuidanceRecoveryCall(topic, registeredTier)),
      steps: [
        "Author faithful requirements, exact user_requirement passages (and occurrences where repeated), and independently authored verification meaning in the parent. Bare unresolved text creates no source link and leaves the specification incomplete.",
        "Link the affected unit's obligations by id to the requirements and verifications through claims, and supply the selected provider's case fields. Use request-local labels within one save or returned identities across saves; choose an eligible case.verification when needed. Read each write unit's current revision before saving. No native binding or task meaning is supplied here.",
        "Reassess and preview the exact affected unit; a successful draft save alone clears no blocker." ],
      reassess: { tool: 'workspace_assess_contract', arguments: { unit: carrier.unit } },
      preview: { tool: 'start_agent', arguments: { subject: carrier.unit, preview: true } }
    } } : {}),
    instruction: meaning
      ? "Author the diagnosed requirements; assessment supplies no replacement meaning."
      : purpose === 'applicability'
        ? "Author controlled_acceptance.disposition using the selected schema and the current_read response.contexts entry for the write unit's revision. The caller chooses; assessment neither chooses nor saves the declaration."
      : "Author the diagnosed changes. Existing obligations use id; new ones key. case edits the obligation's own case without key/id; case.id selects a different/shared case. case.verification selects an eligible candidate, including an unbound competitor. Use criteria, claims and proof.name/proof.parameters; never edit derived bindings.",
    ...(status === "authoring_not_authorized" ? { limitation: "Frozen assessment authority grants no authoring permission or live write revision." }
      : status === "focused_save_unsupported" ? { limitation: "save_record accepts root and slice units, but has no focus argument and cannot change this named focused contract. workspace_read_wiki unit context does not supply focused-contract write authority. Do not redirect this correction to the root." }
        : {}) };
}

const applicabilityChoices = () => ({ field: "controlled_acceptance.disposition", selected: null,
  caller_decision: "The caller decides. Save the changes with the current_read revision; assessment saves nothing.",
  choices: [
    { intent: "declare_applicable", changes: { controlled_acceptance: { disposition: "required" } } }] });
const withSaveGuidance = (carrier, used, purpose, registeredTier, detailed = false) =>
  used && (!['definition', 'specification_meaning'].includes(purpose) || recordAuthoringAvailability(registeredTier).compile_requirements) ? { save_guidance: assessmentSaveGuidance(carrier, purpose, registeredTier, detailed) } : {};

export function assessmentAuthoringGuidance(carrier, { purpose, subjects = [], codes = [], clauses = {}, associations = [] } = {}, registeredTier) {
  const compilation = recordAuthoringAvailability(registeredTier).compile_requirements;
  const competing = [...associations, ...subjects.map(subject => subject.association)]
    .filter(association => association?.competitions?.length > 0);
  const competition = competing.length > 0;
  const recovery = competing[0]?.competition_recovery;
  if (purpose === 'specification_meaning') {
    const unit = carrier.unit.split('#')[0];
    const status = !compilation ? 'authoring_operation_unavailable' : saveStatus(carrier);
    const supported = status === 'awaiting_authored_values';
    return { status, executable: false, unit, purpose, scope: 'whole_unit',
      required_authored_input: ['requirements: author the intended typed behavior and restate only the meanings that remain unfinished'],
      subjects: subjects.map(subject => ({ subject: subject.subject, text: subject.text,
        ...(subject.reason === undefined ? {} : { reason: subject.reason }),
        ...(subject.grammar_exception === undefined ? {} : { grammar_exception: subject.grammar_exception }) })),
      constraints: ['Resolve the intended meaning before removing its unresolved entry. Preserve source passages, existing definitions, other unfinished meaning, cases and obligation/proof associations. Recording an exception supplies no definition or enforcement.'],
      ...(supported ? { grammar_guidance: definitionGrammar(registeredTier) } : {}),
      current_read: supported ? { tool: 'workspace_read_wiki', arguments: { reads: [{ subject: unit, for_changes: ['requirements'] }] } } : null,
      save: { supported, tool: 'save_record', executable: false, authored_members: compilation ? ['requirements'] : [] } };
  }
  const status = purpose === "definition" && !compilation ? "authoring_operation_unavailable" : saveStatus(carrier);
  const supported = status === "awaiting_authored_values";
  const inputs = subject => (subject.corrections ?? []).filter(key => typeof clauses[key]?.field === "string")
    .flatMap(key => key === "association" && owned(subject) ? ownedClauses(clauses[key], owned(subject)) : [clauses[key]])
    .map(clause => clause.field === unlinked(subject)?.field ? { ...clause, field: unlinked(subject).links_field } : clause);
  const fields = [...new Set(subjects.flatMap(subject => inputs(subject).map(clause =>
    typeof clause.when === "string" ? `${clause.field} when ${clause.when}` : clause.field)))];
  const discovery = proofDiscovery(subjects);
  const constraints = [...new Set(subjects.flatMap(subject => inputs(subject).map(clause => clause.constraint))
    .filter(constraint => typeof constraint === "string"))];
  const required = codes.includes("controlled_acceptance_disposition_missing")
    ? ["controlled_acceptance.disposition"]
    : codes.includes("obligation_coverage_node_unknown") ? ["obligations[].claims"]
    : purpose === "criterion_coverage"
      ? ["obligations[].criteria associations chosen by the author; incomplete obligations must also be repaired"]
      : purpose === "definition"
        ? ["requirements: supply the typed definition for each diagnosed required_uses; the author supplies meaning"]
      : competition ? recovery.choices.flatMap(choice => [
        `${choice.field} when ${choice.when}`, ...(choice.then ? [choice.then] : [])])
      : fields.length > 0 ? fields
      : subjects.some(subject => typeof authoredField(subject) === "string")
        ? [...new Set(subjects.map(authoredField).filter(field => typeof field === "string"))]
        : ["the corrected authored values identified by the diagnosis and its subjects; assessment supplies no replacement meaning"];
  const missingApplicability = codes.includes("controlled_acceptance_disposition_missing");

  const definitionUnit = carrier.unit.split("#")[0];
  const unit = purpose === "definition" ? definitionUnit : carrier.unit;
  return { status, executable: false, ...address(carrier), unit, purpose,
    ...(purpose === "definition" && !compilation ? { limitation: "Requirement compilation is unavailable in this session. Required meaning and applicability remain unchanged; assessment changes nothing and supplies no executable correction." } : {}),
    required_authored_input: required,
    ...(associations.length === 0 || !competition ? {} : { competition: { ...recovery,
      competitions: competing.flatMap(association => association.competitions).filter((facts, index, all) =>
        !all.slice(0, index).some(previous => isDeepStrictEqual(previous, facts))) } }),
    ...(competition ? { requirements_unit: carrier.unit.split('#')[0],
      requirements_current_read: supported && compilation ? { tool: 'workspace_read_wiki',
        arguments: { reads: [{ subject: carrier.unit.split('#')[0], for_changes: ['requirements'] }] } } : null,
      ...(supported && compilation ? { grammar_guidance: [
        requirementGuidanceRecoveryCall(['case_authoring', 'verification_association'], registeredTier),
        schemaRead(registeredTier)] } : {}) } : {}),
    ...(purpose === "definition" && compilation && writable(carrier) ? { grammar_guidance: definitionGrammar(registeredTier) } : {}),
    ...(supported && missingApplicability ? { applicability: applicabilityChoices() } : {}),
    subjects: subjects.map(subject => ({
      ...(typeof subject.obligation_id === "string" ? { obligation_id: subject.obligation_id } : {}),
      ...(typeof subject.case_id === "string" ? { case_id: subject.case_id } : {}),
      ...(purpose !== "definition" ? {} : { finding: subject.finding, object: subject.object,
        requirements: subject.requirements,
        uses: subject.uses, required_uses: subject.required_uses,
        ...(compilation && writable(carrier) ? { correction: definitionCorrection(subject, registeredTier) } : {}) }),
      ...(subject.row_id === undefined ? {} : { row_id: subject.row_id,
        semantic_identity: subject.semantic_identity, evidence: subject.evidence }),
      ...(subject.failed_fields === undefined ? {} : { failed_fields: subject.failed_fields }),
      ...(subject.association === undefined ? {} : { association: subject.association }),
      ...(inputs(subject).length === 0 ? {} : { missing_authored_input: inputs(subject).map(clause => ({
        field: clause.field, ...(typeof clause.operation === "string" ? { operation: clause.operation } : {}),
        ...(typeof clause.when === "string" ? { when: clause.when } : {}) })) }) })),
    ...(constraints.length === 0 ? {} : { constraints }),
    ...(discovery.length === 0 ? {} : { discovery }),
    current_read: supported ? { tool: "workspace_read_wiki", arguments: { reads: [{ subject: unit, for_changes: purpose === "definition" ? ["requirements"] : purpose === "applicability" ? ["controlled_acceptance"] : ["obligations"] }] } } : null,
    save: { supported, tool: "save_record", executable: false,
      authored_members: purpose === "applicability" ? ["controlled_acceptance"]
        : purpose === "definition" ? compilation ? ["requirements"] : []
          : competition && compilation ? ["requirements", "obligations"] : ["obligations"] } };
}

export function projectAssessmentDiagnosis(carrier, diagnosis, clauses = {}, registeredTier) {
  const { correction_call: _call, recovery, requires_authored_values: _values,
    correction_route: _route, ...facts } = diagnosis;
  const applicability = [diagnosis.code, ...(diagnosis.reason_codes ?? [])].includes('controlled_acceptance_disposition_missing');
  const authored = applicability || diagnosis.category === "author_input" || diagnosis.recovery_status === "authored_correction_available"
    || diagnosis.correction_call?.tool === "workspace_controlled_contract_obligation_coverage_upsert"
    || diagnosis.subjects?.some(subject => subject.authored_identity_correction === true)
    || diagnosis.subjects?.some(selects);

  let subjects = diagnosis.subjects;
  const definitions = {};
  if (diagnosis.family === "definition") {
    facts.subjects = subjects.map(({ obligation_id, ...definition }) => {
      let id = Object.keys(definitions).find(key => isDeepStrictEqual(definitions[key], definition));
      if (id === undefined) { id = `definition-${Object.keys(definitions).length + 1}`; definitions[id] = definition; }
      return { ...(obligation_id === undefined ? {} : { obligation_id }), definition_id: id };
    });
    facts.subject_definitions = definitions;
    subjects = Object.values(definitions);
  }
  const authoring = authored ? assessmentAuthoringGuidance(carrier, {
    purpose: applicability ? 'applicability' : diagnosis.family === 'specification_meaning' ? 'specification_meaning'
      : diagnosis.family === "definition" ? "definition" : "diagnosis", subjects,
    codes: [diagnosis.code, ...(diagnosis.reason_codes ?? [])], clauses }, registeredTier) : null;
  if (authoring !== null && diagnosis.family === "definition") {
    const corrections = {}, correctionInputs = {};

    authoring.subjects = authoring.subjects.map((subject, index) => {
      const association = { definition_id: Object.keys(definitions)[index] };
      if (subject.correction === undefined) return association;
      const { entity: _entity, uses: _uses, required_uses: _required, ...correction } = subject.correction;
      let id = Object.keys(correctionInputs).find(key => isDeepStrictEqual(correctionInputs[key], subject.correction));
      if (id === undefined) {
        id = `correction-${Object.keys(corrections).length + 1}`;
        corrections[id] = correction; correctionInputs[id] = subject.correction;
      }
      return { ...association, corrections: [id] };
    });
    authoring.correction_definitions = corrections;
  }
  return { ...facts, recovery: authored
    ? { actor_recovery: recovery?.actor_recovery ?? "agent",
      ...(applicability ? { scope: 'applicability_declaration_only',
        limitation: 'The caller must still author every missing contract decision; declaring applicability establishes no complete contract or readiness.' } : {}),
      authoring }
    : { actor_recovery: recovery?.actor_recovery ?? "none", explanation: recovery?.explanation ?? null,
      instructions: "This diagnosis establishes no supported authored correction. Preserve its owner cause; a current reassessment does not execute proofs or grant credit." }, correction_call: null,
    ...(['definition', 'specification_meaning'].includes(diagnosis.family) ? { inspection: { tool: "workspace_read_wiki",
      arguments: { reads: [{ subject: carrier.unit.split("#")[0] }] } } } : {}),
    ...(authored ? { requires_authored_values: true } : {}) };
}

export function projectAssessmentCorrections(corrections) {
  return Object.fromEntries(Object.entries(corrections).map(([key, clause]) => {
    const { guidance: _oldGuidance, read_tool: _read, write_tool: _write,
      validation_tool: _validate, ...facts } = clause;
    return [key, { ...facts, authored_member: "changes.obligations", executable: false }];
  }));
}

export function projectSelectedDiagnosisGuidance(carrier, diagnosis, corrections, registeredTier) {
  const projected = projectAssessmentDiagnosis(carrier, diagnosis, corrections, registeredTier);
  const guidance = withSaveGuidance(carrier, projected.recovery.authoring !== undefined || Object.keys(corrections).length > 0,
    projected.recovery.authoring?.purpose, registeredTier, true);
  if (projected.recovery.authoring?.current_read != null &&
      isDeepStrictEqual(projected.recovery.authoring.current_read, guidance.save_guidance?.changes_schema_from?.current_read)) {
    delete projected.recovery.authoring.current_read;
  }
  if (guidance.save_guidance?.changes_schema_from?.current_read != null) delete projected.inspection;
  if (guidance.save_guidance && carrier.assessment.acceptance_coverage?.correction != null) {
    const { purpose, required_authored_input, executable } = assessmentAuthoringGuidance(carrier, { purpose: "criterion_coverage" }, registeredTier);
    guidance.save_guidance.criterion_coverage = { purpose, required_authored_input, executable };
  }
  const obligations = [...new Set(diagnosis.subjects.map(subject => subject.obligation_id).filter(id => typeof id === "string"))];
  if (guidance.save_guidance?.changes_schema_from && projected.recovery.authoring?.save.authored_members.includes("obligations") && obligations.length > 0) {
    guidance.save_guidance.readback = {
      current_read_from: "changes_schema_from.current_read",
      when: "Only when saved-content inspection is requested; successful correction may finish after save.",
      call: { tool: "workspace_read_wiki", arguments: { reads: obligations.map(id => ({ subject: carrier.unit, select: { contract: "obligations", where: { kind: "obligation", id } } })) } },
      verifies: "Compare the selected obligation identities and authored meaning with the intended changes. Reading establishes no complete-contract verdict." };
  }
  return { diagnosis: projected, corrections: projectAssessmentCorrections(linkClauses(diagnosis.subjects, corrections)), ...guidance };
}

function exceptionAccountingRecovery(carrier, accounting, registeredTier) {
  const gaps = accounting.recovery?.saved_exception_binding_gaps;
  if (gaps === undefined) return {};
  const kinds = Object.keys(gaps).filter(kind => kind !== 'grammar'
    || recordAuthoringAvailability(registeredTier).grammar_exception);
  const status = saveStatus(carrier) !== 'awaiting_authored_values' ? saveStatus(carrier)
    : kinds.length === 0 ? 'authoring_operation_unavailable' : 'awaiting_authored_values';
  return { exception: {
    cause: 'A saved exception has absent or stale passage bindings; those bindings cover no current text. Remaining prose still needs accounting.',
    parent_unit: accounting.parent_unit, source_field: accounting.source_field, status,
    ...(status !== 'awaiting_authored_values' ? {} : {
      kinds,
      discovery: { current_read: accounting.correction, calls_from: `current_read response.contexts[${JSON.stringify(accounting.parent_unit)}].next_calls`,
        select: { input_contract: { tool: 'save_record', operation: 'exception',
          ...(kinds.length === 1 ? { kind: kinds[0] } : {}) } } },
      instruction: 'Read the parent context and exception operation. Reapply with its current revision and caller-selected exact source_passages, preserving saved rationale, scope and intended bindings. Choose repeated occurrences explicitly. Do not expand to residual text by default; formal authoring remains available.' })
  } };
}

export function projectAssessmentGuidance(carrier, assessment, registeredTier, { compact = false } = {}) {
  if (compact && carrier.diagnosis_inventory.diagnoses.length > 0) {
    const { exceptions, parent_source_accounting: accounting, specification, acceptance_coverage: coverage,
      dispatch, user_requirements_comparison: comparison, diagnoses, corrections, ...facts } = assessment;
    const omit = (value, names) => Object.fromEntries(Object.entries(value).filter(([key]) => !names.includes(key)));
    return { ...facts,
      ...(diagnoses === undefined ? {} : { diagnoses: [], diagnoses_total: assessment.diagnoses_total,
        diagnoses_returned: 0, diagnoses_omitted: assessment.diagnoses_total, complete: false }),
      ...(exceptions === undefined ? {} : { exceptions: { complete: false,
        proof: omit(exceptions.proof, ['declined_obligations', 'undecided_obligation_ids']),
        grammar: omit(exceptions.grammar, ['excepted_meanings']),
        controlled_acceptance: omit(exceptions.controlled_acceptance, ['rationale']) } }),
      ...(accounting === undefined ? {} : { parent_source_accounting: { ...omit(accounting, ['recovery', 'link_meaning']),
        ...(accounting.recovery === undefined ? {} : { recovery: {
          status: !recordAuthoringAvailability(registeredTier).compile_requirements ? 'authoring_operation_unavailable' : saveStatus(carrier) } }) } }),
      ...(specification === undefined ? {} : { specification }),
      ...(coverage === undefined ? {} : { acceptance_coverage: { ...coverage, correction: null } }),
      ...(dispatch === undefined ? {} : { dispatch: { status: dispatch.status } }),
      ...(comparison === undefined ? {} : { user_requirements_comparison: omit(comparison, ['read_call']) }) };
  }
  const { dispatch, acceptance_coverage: coverage, parent_source_accounting: accounting, diagnoses, corrections,
    user_requirements_comparison: comparison, ...facts } = assessment;
  const codes = assessment.diagnostics?.meanings.map(row => row.code) ?? [];
  const applicability = codes.includes("controlled_acceptance_disposition_missing");
  const definition = assessment.diagnostics?.meanings.some(row => row.owner === "contract-requirement-descriptions"
    && row.category === "author_input") || diagnoses?.some(row => row.family === "definition" && row.category === "author_input");
  const unfinished = assessment.specification?.unfinished_meaning?.count > 0;
  const purpose = applicability ? 'applicability' : definition ? 'definition' : unfinished ? 'specification_meaning' : 'diagnosis';
  const authored = assessment.diagnostics?.meanings.some(row => row.category === "author_input")
    || diagnoses?.some(row => row.category === "author_input" || row.recovery_status === "authored_correction_available");
  const projected = diagnoses?.map(row => projectAssessmentDiagnosis(carrier, row, corrections ?? {}, registeredTier));

  const associations = diagnoses === undefined ? carrier.diagnosis_inventory.diagnoses
    .flatMap(row => row.subjects).map(subject => subject.association).filter(Boolean) : [];
  const competition = associations.some(association => association.competitions?.length > 0)
    ? assessmentAuthoringGuidance(carrier, { purpose: 'diagnosis', associations }, registeredTier) : null;
  const guided = applicability || authored || coverage?.correction != null
    || Object.keys(corrections ?? {}).length > 0 || projected?.some(row => row.recovery.authoring !== undefined);
  return { ...facts,
    ...(competition === null ? {} : {
      unbound_case_recovery: { ...competition.competition,
        ...(competition.grammar_guidance === undefined ? {} : { grammar_guidance: competition.grammar_guidance }),
        current_read: competition.current_read, requirements_unit: competition.requirements_unit,
        requirements_current_read: competition.requirements_current_read,
        save: competition.save }
    }),
    ...(accounting === undefined ? {} : { parent_source_accounting: {
      ...accounting, ...(accounting.recovery === undefined ? {} : { recovery: {
        ...accounting.recovery,
        ...exceptionAccountingRecovery(carrier, accounting, registeredTier),
        status: !recordAuthoringAvailability(registeredTier).compile_requirements
          ? 'authoring_operation_unavailable' : saveStatus(carrier),
        guidance: saveStatus(carrier) === 'awaiting_authored_values'
          && recordAuthoringAvailability(registeredTier).compile_requirements ? accounting.recovery.guidance : [],
        ...(!recordAuthoringAvailability(registeredTier).compile_requirements
          ? { limitation: 'Requirement compilation is unavailable; required meaning and incomplete accounting remain unchanged.' }
          : saveStatus(carrier) === 'awaiting_authored_values' ? {}
            : { limitation: assessmentSaveGuidance(carrier).limitation })
      } }) } }),
    ...(assessment.specification?.findings > 0 || unfinished ? { specification: { ...assessment.specification,
      inspection: { tool: "workspace_read_wiki", arguments: { reads: [{ subject: carrier.unit.split("#")[0] }] } } } } : {}),
    ...(comparison === undefined ? {} : { user_requirements_comparison: comparison.read_call === null
      ? comparison : { ...comparison,
        read_call: { tool: "workspace_read_wiki", arguments: { reads: [{ subject: carrier.unit, select: { field: "sections.user_requirements" } }] } },
        read_purpose: "Complete current authored requirements for the selected unit." } }),
    ...(dispatch === undefined ? {} : { dispatch: { status: dispatch.status } }),
    ...(coverage === undefined ? {} : { acceptance_coverage: { ...coverage,
      correction: coverage.correction == null ? null : assessmentAuthoringGuidance(carrier,
        { purpose: "criterion_coverage" }, registeredTier) } }),
    ...(projected === undefined ? {} : { diagnoses: projected }),
    ...(corrections === undefined ? {} : { corrections: projectAssessmentCorrections(corrections) }),
    ...(applicability || authored ? { authoring: assessmentAuthoringGuidance(carrier,
      { purpose, codes }, registeredTier) } : {}),
    ...withSaveGuidance(carrier, guided, purpose, registeredTier) };
}

export function assessmentCurrentRead(body) {
  return body.assessment?.save_guidance?.changes_schema_from?.current_read
    ?? body.selected_diagnosis?.save_guidance?.changes_schema_from?.current_read
    ?? body.assessment?.authoring?.current_read ?? body.assessment?.acceptance_coverage?.correction?.current_read
    ?? body.selected_diagnosis?.diagnosis.recovery?.authoring?.current_read
    ?? body.selected_diagnosis?.diagnosis.inspection ?? body.assessment?.specification?.inspection
    ?? body.assessment?.user_requirements_comparison?.read_call
    ?? (body.assessment?.parent_source_accounting?.recovery === undefined
      ? null : body.assessment.parent_source_accounting.correction);
}
