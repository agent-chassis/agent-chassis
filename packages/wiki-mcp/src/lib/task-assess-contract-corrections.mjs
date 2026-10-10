

import { FIND_PROOFS_TASK } from "@agent-chassis/controlled-contract/proof-discovery-task";

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

export function assessmentSaveGuidance(carrier) {
  const status = saveStatus(carrier);
  return { required_arguments: ["unit", "revision", "changes"],
    revision_from: "workspace_read_wiki current context response.revision",
    changes_schema_from: "save_record tools/list inputSchema changes for work_item",
    instruction: "Supply explicitly authored changes using the current schema. An existing obligation uses id and a new one key. A case member addresses the obligation's own case without key or id; case.id is supplied only to choose a different or shared saved case. Omit case.verification unless a subject's association lists several candidates. Criteria use criteria, claim links use claims, proof selections use proof.name and proof.parameters. Do not copy the assessment digest into revision or edit derived bindings.",
    ...(status === "authoring_not_authorized" ? { limitation: "Frozen assessment authority grants no authoring permission or live write revision." }
      : status === "focused_save_unsupported" ? { limitation: "save_record accepts root and slice units, but has no focus argument and cannot change this named focused contract. workspace_read_wiki unit context does not supply focused-contract write authority. Do not redirect this correction to the root." }
        : {}) };
}

const applicabilityChoices = () => ({ field: "controlled_acceptance.disposition", selected: null,
  caller_decision: "The caller decides. Save the chosen changes with the current_read revision; assessment selects neither.",
  choices: [
    { intent: "declare_applicable", changes: { controlled_acceptance: { disposition: "required" } } },
    { intent: "opt_out", changes: { controlled_acceptance: { disposition: "opted_out" } },
      missing_caller_input: ["controlled_acceptance.rationale"] }] });
const withSaveGuidance = (carrier, used) => used ? { save_guidance: assessmentSaveGuidance(carrier) } : {};

export function assessmentAuthoringGuidance(carrier, { purpose, subjects = [], codes = [], clauses = {} } = {}) {
  const supported = saveStatus(carrier) === "awaiting_authored_values";
  const inputs = subject => (subject.corrections ?? []).filter(key => typeof clauses[key]?.field === "string")
    .flatMap(key => key === "association" && owned(subject) ? ownedClauses(clauses[key], owned(subject)) : [clauses[key]])
    .map(clause => clause.field === unlinked(subject)?.field ? { ...clause, field: unlinked(subject).links_field } : clause);
  const fields = [...new Set(subjects.flatMap(subject => inputs(subject).map(clause =>
    typeof clause.when === "string" ? `${clause.field} when ${clause.when}` : clause.field)))];
  const discovery = proofDiscovery(subjects);
  const constraints = [...new Set(subjects.flatMap(subject => inputs(subject).map(clause => clause.constraint))
    .filter(constraint => typeof constraint === "string"))];
  const required = codes.includes("controlled_acceptance_disposition_missing")
    ? ["controlled_acceptance.disposition; opted_out also requires an authored rationale"]
    : purpose === "criterion_coverage"
      ? ["obligations[].criteria associations chosen by the author; incomplete obligations must also be repaired"]
      : fields.length > 0 ? fields
      : subjects.some(subject => typeof authoredField(subject) === "string")
        ? [...new Set(subjects.map(authoredField).filter(field => typeof field === "string"))]
        : ["the corrected authored values identified by the diagnosis and its subjects; assessment supplies no replacement meaning"];
  const missingApplicability = codes.includes("controlled_acceptance_disposition_missing");
  return { status: saveStatus(carrier), executable: false, ...address(carrier), purpose,
    required_authored_input: required,
    ...(supported && missingApplicability ? { applicability: applicabilityChoices() } : {}),
    subjects: subjects.map(subject => ({
      ...(typeof subject.obligation_id === "string" ? { obligation_id: subject.obligation_id } : {}),
      ...(typeof subject.case_id === "string" ? { case_id: subject.case_id } : {}),
      ...(subject.failed_fields === undefined ? {} : { failed_fields: subject.failed_fields }),
      ...(subject.association === undefined ? {} : { association: subject.association }),
      ...(inputs(subject).length === 0 ? {} : { missing_authored_input: inputs(subject).map(clause => ({
        field: clause.field, ...(typeof clause.operation === "string" ? { operation: clause.operation } : {}),
        ...(typeof clause.when === "string" ? { when: clause.when } : {}) })) }) })),
    ...(constraints.length === 0 ? {} : { constraints }),
    ...(discovery.length === 0 ? {} : { discovery }),
    current_read: supported ? { tool: "workspace_read_wiki", arguments: { subject: carrier.unit } } : null,
    save: { supported, tool: "save_record", executable: false,
      authored_members: purpose === "applicability" ? ["controlled_acceptance"] : ["obligations"] } };
}

export function projectAssessmentDiagnosis(carrier, diagnosis, clauses = {}) {
  const { correction_call: _call, recovery, requires_authored_values: _values,
    correction_route: _route, ...facts } = diagnosis;
  const authored = diagnosis.category === "author_input" || diagnosis.recovery_status === "authored_correction_available"
    || diagnosis.correction_call?.tool === "workspace_controlled_contract_obligation_coverage_upsert"
    || diagnosis.subjects?.some(selects);
  return { ...facts, recovery: authored
    ? { actor_recovery: recovery?.actor_recovery ?? "agent",
      authoring: assessmentAuthoringGuidance(carrier, { purpose: "diagnosis", subjects: diagnosis.subjects,
        codes: [diagnosis.code, ...(diagnosis.reason_codes ?? [])], clauses }) }
    : { actor_recovery: recovery?.actor_recovery ?? "none", explanation: recovery?.explanation ?? null,
      instructions: "This diagnosis establishes no supported authored correction. Preserve its owner cause; a current reassessment does not execute proofs or grant credit." }, correction_call: null,
    ...(authored ? { requires_authored_values: true } : {}) };
}

export function projectAssessmentCorrections(corrections) {
  return Object.fromEntries(Object.entries(corrections).map(([key, clause]) => {
    const { guidance: _oldGuidance, read_tool: _read, write_tool: _write,
      validation_tool: _validate, ...facts } = clause;
    return [key, { ...facts, authored_member: "changes.obligations", executable: false }];
  }));
}

export function projectSelectedDiagnosisGuidance(carrier, diagnosis, corrections) {
  const projected = projectAssessmentDiagnosis(carrier, diagnosis, corrections);
  return { diagnosis: projected, corrections: projectAssessmentCorrections(linkClauses(diagnosis.subjects, corrections)),
    ...withSaveGuidance(carrier, projected.recovery.authoring !== undefined || Object.keys(corrections).length > 0) };
}

export function projectAssessmentGuidance(carrier, assessment) {
  const { dispatch, acceptance_coverage: coverage, diagnoses, corrections,
    user_requirements_comparison: comparison, ...facts } = assessment;
  const codes = assessment.diagnostics?.meanings.map(row => row.code) ?? [];
  const applicability = codes.includes("controlled_acceptance_disposition_missing");
  const authored = assessment.diagnostics?.meanings.some(row => row.category === "author_input")
    || diagnoses?.some(row => row.category === "author_input" || row.recovery_status === "authored_correction_available");
  const projected = diagnoses?.map(row => projectAssessmentDiagnosis(carrier, row, corrections ?? {}));
  const guided = applicability || authored || coverage?.correction != null
    || Object.keys(corrections ?? {}).length > 0 || projected?.some(row => row.recovery.authoring !== undefined);
  return { ...facts,
    ...(comparison === undefined ? {} : { user_requirements_comparison: comparison.read_call === null
      ? comparison : { ...comparison,
        read_call: { tool: "workspace_read_wiki", arguments: { subject: carrier.unit } },
        read_selection: { field: "sections.user_requirements" },
        read_reference_from: "read_call response.reference",
        read_purpose: "current authored requirements; follow the context's emitted field selection for the complete value" } }),
    ...(dispatch === undefined ? {} : { dispatch: { status: dispatch.status } }),
    ...(coverage === undefined ? {} : { acceptance_coverage: { ...coverage,
      correction: coverage.correction == null ? null : assessmentAuthoringGuidance(carrier,
        { purpose: "criterion_coverage" }) } }),
    ...(projected === undefined ? {} : { diagnoses: projected }),
    ...(corrections === undefined ? {} : { corrections: projectAssessmentCorrections(corrections) }),
    ...(applicability || authored ? { authoring: assessmentAuthoringGuidance(carrier,
      { purpose: applicability ? "applicability" : "diagnosis", codes }) } : {}),
    ...withSaveGuidance(carrier, guided) };
}

export function assessmentCurrentRead(body) {
  return body.assessment?.authoring?.current_read ?? body.assessment?.acceptance_coverage?.correction?.current_read
    ?? body.selected_diagnosis?.diagnosis.recovery?.authoring?.current_read
    ?? body.assessment?.user_requirements_comparison?.read_call ?? null;
}
