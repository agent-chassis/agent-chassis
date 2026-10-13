import { resolveStartedAgentDispatchSelection } from "./dispatch-tools/agent-dispatch-route.mjs";
import { admitAgentDispatchRequest } from "./dispatch-tools/agent-dispatch-request-admission.mjs";
import { projectManagedLifecycleCapabilities } from "./dispatch-diagnostic-routes.mjs";
import { boundedRecoveryDetail, exactSliceTargetAuthoring, missingInitiativeAuthoring, missingInitiativeRead } from
  "./dispatch-tools/agent-dispatch-refusal-projection.mjs";
import { MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE } from
  "@agent-chassis/wiki-core/src/lib/work-record-dispatch.mjs";
import { readRecordAuthoringRevision } from "@agent-chassis/wiki-core/src/operations/save-record.mjs";
import { graphDerivationRequiredForDispatch } from "./dispatch-tools/dispatch-admission-policy.mjs";
import { preflightWorkerScope } from "@agent-chassis/agent-launch-cli/src/lib/worker-scope-preflight.mjs";
import { WORKER_SCOPE_BASE_SELECTION_MISSING_DECISION_CODE } from
  "@agent-chassis/wiki-core/src/lib/work-record-dispatch-readiness-shape.mjs";
import { servedGuidanceRead, startAgentBaseCorrection, startAgentBaseSelection } from "./task-start-agent-response.mjs";
import { WK_BASE_SELECTION } from
  "@agent-chassis/agent-launch-cli/src/lib/worktree-substrate-exact-unit-identity.mjs";
import { contractAssessmentCall } from "./task-assess-contract-surface.mjs";
import { obligationCoverageQueryOperation, queryControlledContractObligationCoverageOperation } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/obligation-coverage-query.mjs";
import { assessRequirementSourceResidualOperation } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/proof-validation-operations.mjs";
import { REQUIREMENT_SOURCE_FIELD, REQUIREMENT_SOURCE_STATES } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/contract-requirement-source-links.mjs";
import { REQUIREMENT_BATCH_STATUS } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/contract-requirement-projection.mjs";
import { assertObligationCoverageQueryScope, resolveObligationCoverageQueryContext } from
  "./controlled-contract-query-context.mjs";

const CONTROLLED_ACCEPTANCE_INCOMPLETE = "controlled_acceptance_incomplete";

export async function servedUnitAssessment(unit, requestContracts) {
  const call = { kind: "guidance", recommended: true, ...contractAssessmentCall({ unit }),
    information: "Assess this exact unit to read where its saved specification or acceptance coverage is incomplete, " +
      "with the affected identities and the supported corrections; assessing executes no proof, grants no credit and " +
      "changes no readiness, and it supplies no replacement definition and no executable save." };
  const limit = (code, cause) => ({ limitation: { code, tool: call.tool, ...(cause === undefined ? {} : { cause }) } });
  try {
    const contract = requestContracts?.contractFor?.(call.tool);
    if (!contract) return limit("contract_assessment_consumer_unavailable");
    return await contract.acceptsArguments(call.arguments) === true ? { call }
      : limit("contract_assessment_full_contract_rejected");
  } catch (error) {
    return limit("contract_assessment_validation_failed", { code: error.code ?? null, message: error.message });
  }
}

export const REQUIREMENTS_COMPARISON_INSTRUCTION = "Check that the linked requirements preserve the user’s meaning " +
  "and that nothing is missing. Correct the mappings or record unresolved meaning as residue.";
const READ_TOOL = "workspace_read_wiki";
const REQUIREMENTS_SELECTION = Object.freeze({ contract: "requirements" });

const COMPARISON_MEMBERS = 8, COMPARISON_SCALARS = 1024;
const cause = error => ({ code: error?.code ?? null, message: String(error?.message ?? error) });
function compactText(member, text) {
  if (typeof text !== "string") return { [member]: text };
  const scalars = Array.from(text);
  return scalars.length <= COMPARISON_SCALARS ? { [member]: text }
    : { [member]: scalars.slice(0, COMPARISON_SCALARS).join(""),
      [`${member}_extent`]: { unit: "unicode_scalars", length: COMPARISON_SCALARS, total: scalars.length } };
}
const compactMembers = (members, project) => ({ total_count: members.length,
  returned_count: Math.min(members.length, COMPARISON_MEMBERS),
  omitted_count: Math.max(members.length - COMPARISON_MEMBERS, 0),
  members: members.slice(0, COMPARISON_MEMBERS).map(project) });

function comparisonRow(row) {
  const { user_requirement: passage, constraint_ids: _constraints, claim_ids: _claims, ...link } = row.source;
  return { row_id: row.row_id, state: row.state, constraint_ids: row.constraint_ids, claim_ids: row.claim_ids,
    ...compactText("meaning", row.meaning),
    source: { ...link, ...(passage === undefined ? {} : compactText("user_requirement", passage)) } };
}

const UNMAPPED_LOCATIONS = 64;
const unaccounted = (reason, more = {}) => ({ state: "unknown", accounted: false, source_field: REQUIREMENT_SOURCE_FIELD,
  reason, ...more });
function compactResidual(facts) {
  if (facts?.accounted !== true) return unaccounted(facts?.reason ?? "the assessment owner returned no residual accounting");
  const { segments } = facts.unmapped;
  const omitted = segments.slice(COMPARISON_MEMBERS);
  return { state: facts.state, accounted: true, source_field: facts.source_field, source: facts.source, links: facts.links,
    linked: { interval_count: facts.linked.interval_count, length: facts.linked.length },
    length: facts.unmapped.length, location_unit: facts.source.unit,
    ...compactMembers(segments, ({ text, ...segment }) => ({ ...segment, ...compactText("text", text) })),
    ...(omitted.length === 0 ? {} : { omitted_locations: omitted.slice(0, UNMAPPED_LOCATIONS)
      .map(({ start, end }) => ({ start, end })) }) };
}
async function unmappedSourceText(unit, context) {
  if (context.population !== "all") return unaccounted("this session reads a selected population of the saved rows, " +
    "which cannot account for the whole source text");
  const [wkId, slice] = unit.split("#");
  try {
    const facts = await assessRequirementSourceResidualOperation({ repoRoot: context.sourceRoot, wkId,
      ...(slice === undefined ? {} : { selectedUnit: slice }) });
    return facts?.ok === false ? unaccounted("the assessment owner refused the residual accounting",
      { cause: { code: facts.code ?? null, message: facts.message ?? null } }) : compactResidual(facts);
  } catch (error) {
    return unaccounted("the residual accounting could not be read", { cause: cause(error) });
  }
}

async function requirementsDetailRead(unit, { requestContracts, acquireSavedUnitReference }) {
  const limit = (code, reason) => ({ limitation: { code, tool: READ_TOOL, then_select: REQUIREMENTS_SELECTION,
    ...(reason === undefined ? {} : { cause: reason }) } });
  try {
    const contract = requestContracts?.contractFor?.(READ_TOOL);
    if (!contract) return limit("requirements_detail_consumer_unavailable");
    if (typeof acquireSavedUnitReference !== "function") return limit("requirements_detail_reader_not_composed");
    let acquired;
    try {
      acquired = await acquireSavedUnitReference(unit);
    } catch (error) {
      return limit("requirements_detail_reference_unavailable", cause(error));
    }
    const call = { kind: "guidance", tool: READ_TOOL,
      arguments: { reference: acquired.reference, select: { ...REQUIREMENTS_SELECTION } },
      information: "Read every saved requirement row of this unit whole: constraints, generated CEL, typed bindings, " +
        "input and source links, with the complete passages and meanings this preview shortened. Reading changes nothing." };
    return await contract.acceptsArguments(call.arguments) === true
      ? { call, transport_retention: acquired.effects?.transport_retention ?? null }
      : limit("requirements_detail_full_contract_rejected");
  } catch (error) {
    return limit("requirements_detail_validation_failed", cause(error));
  }
}

export async function savedRequirementsComparison(unit, { workspace, sessionEnv, requestContracts,
  acquireSavedUnitReference, servedAssessment = null }) {
  const [wkId, slice] = unit.split("#");
  const residual = (unresolved, unmapped) => ({ explicit_unresolved: unresolved, unmapped_source_text: unmapped });
  const fidelity = "A source link records where a passage is. It establishes neither that the linked requirements " +
    "preserve the user's meaning nor that an implementation is correct.";
  let saved, source = null;
  try {
    saved = await obligationCoverageQueryOperation(async () => {
      const context = source = await resolveObligationCoverageQueryContext({ env: sessionEnv, workspace });
      assertObligationCoverageQueryScope(context, { unit });
      return queryControlledContractObligationCoverageOperation({ repoRoot: context.sourceRoot, wkId,
        ...(slice === undefined ? {} : { selectedUnit: slice }), view: "complete", population: context.population });
    });
  } catch (error) {
    saved = { ok: false, ...cause(error) };
  }

  const current = await servedGuidanceRead({ kind: "guidance", tool: READ_TOOL, arguments: { subject: unit },
    information: `Read this unit's current revision and its exact ${REQUIREMENT_SOURCE_FIELD} text before comparing or ` +
      "correcting its saved requirements; reading changes nothing." }, requestContracts);
  const correction = { executable: false, automatic: false, save_tool: "save_record", unit,
    member: "changes.requirements", rows_addressed_by: "requirements[].row_id as displayed",
    unresolved_member: "changes.requirements.unresolved",
    revision_from: "the current read's response.revision; no revision is supplied here",
    declaration_from: "save_record's current changes.requirements declaration",
    values: "caller_authored", repeated_passage: "the caller states user_requirement_occurrence; none is chosen here",
    ...(current.limitation ? { current_read_limitation: current.limitation } : { current_read: current.call }) };
  const authored = saved?.ok === false ? null : saved?.authored_requirements ?? null;
  if (authored === null) {
    return { comparison: { unit, instruction: REQUIREMENTS_COMPARISON_INSTRUCTION, status: "unavailable",
      limitation: { code: "saved_requirements_read_unavailable",
        cause: { code: saved?.code ?? null, message: saved?.message ?? "the saved contract read returned no authored requirements" } },
      residual: residual({ state: "unknown", reason: "the saved requirements could not be read" },
        unaccounted("the saved requirements could not be read")),
      link_meaning: fidelity, correction }, calls: current.call ? [current.call] : [] };
  }
  const detail = await requirementsDetailRead(unit, { requestContracts, acquireSavedUnitReference });
  const assessment = authored.state !== REQUIREMENT_BATCH_STATUS.incomplete ? null
    : servedAssessment ?? await servedUnitAssessment(unit, requestContracts);
  const states = Object.fromEntries(Object.values(REQUIREMENT_SOURCE_STATES).map(state =>
    [state, authored.rows.filter(row => row.source.state === state).length]));
  return { comparison: { unit, instruction: REQUIREMENTS_COMPARISON_INSTRUCTION, status: authored.status,
    state: authored.state, contract_content_digest: saved.contract_content_digest,
    source_field: REQUIREMENT_SOURCE_FIELD,
    rows: { ...compactMembers(authored.rows, comparisonRow), source_links: states },
    residual: residual(compactMembers(authored.unresolved, entry =>
      typeof entry.text === "string" ? { ...entry, ...compactText("text", entry.text) } : entry),
    await unmappedSourceText(unit, source)),
    link_meaning: fidelity,
    detail: detail.limitation ? { available: false, limitation: detail.limitation }
      : { available: true, call: detail.call, transport_retention: detail.transport_retention },
    ...(assessment === null ? {} : { assessment: assessment.limitation
      ? { available: false, limitation: assessment.limitation } : { available: true, call: assessment.call } }),
    correction }, calls: [...(detail.call ? [detail.call] : []), ...(current.call ? [current.call] : [])],
  assessment_call: assessment?.call ?? null };
}

const coverage = (assessed, unchecked) => ({ assessed, unchecked,
  assessed_count: assessed.length, unchecked_count: unchecked.length,
  total_count: assessed.length + unchecked.length });

const REVIEWER_PREVIEW_PLANE = "structured_dispatch";
function reviewerPreviewCapabilities(capabilities) {
  return { schema_version: capabilities.schema_version, enforcement: capabilities.enforcement,
    planes: capabilities.planes.filter(({ name, status }) => name === REVIEWER_PREVIEW_PLANE && status !== "available")
      .map(plane => ({ name: plane.name, available: plane.available, status: plane.status, blockers: plane.blockers,
        cause: plane.cause, gate_outcome: plane.gate_outcome, recovery: plane.recovery,
        corrective_action: plane.corrective_action })) };
}

export async function previewStartAgent({ request, context, workspace }) {
  const backend = context.dispatchBackend;
  const authorityFacts = await backend.getManagedLifecycleCapabilityAuthorityFacts();
  const lifecycle = await projectManagedLifecycleCapabilities({
    registeredToolNames: context.registeredToolNames, authorityFacts,
    requestContracts: context.requestContracts,
    isPaidTier: context.isPaidTier === true });
  const capabilitiesFor = role => role === "reviewer" ? reviewerPreviewCapabilities(lifecycle) : lifecycle;
  if (request.subject === undefined) {
    const facts = backend.getDispatchModelCapabilityFacts({ ...request, workspace_dir: workspace.dir });
    if (facts.refusal) return { accepted: false, refusal: facts.refusal };
    return { outcome: "preview", preview_kind: "capability", role: request.role,
      selection: facts, capabilities: capabilitiesFor(request.role), source: null,
      effects: { cache: "not_requested", child_started: false, canonical_written: false,
        runtime_prepared: false, integration_requested: false },
      coverage: coverage(["configured_model", "override_permission", "executor_availability", "capability_facts"],
        ["canonical_subject", "assignment", "CCE", "launch_time", "isolation"]) };
  }
  const selected = await resolveStartedAgentDispatchSelection({ args: request, ...context, jsonContent: value => value });
  if (selected.response) return selected.response;
  const args = selected.args;
  if (args.role === "worker" && args.diff_base_sha !== undefined) return { accepted: false,
    refusal: { code: "caller_supplied_committed_slice_authority", reason: "worker_review_pair_forbidden" } };
  const targetRefusal = backend.resolveWorkerTargetRefusal(args);
  if (targetRefusal !== null) return exactSliceTargetAuthoring(targetRefusal,
    { ...context, subject: args.subject, dir: workspace.dir });
  const admission = admitAgentDispatchRequest({ ...context, args, jsonContent: value => value });
  if (admission.response) return admission.response;
  const plan = backend.planLaunch({ ...args, workspace_dir: workspace.dir });
  if (plan.accepted !== true) return { accepted: false, refusal: plan.refusal };
  let source, assessment, graphDependent = false, scope = null, baseSelection = null, sliceAssessment = null,
    initiative = null, requirements = null;
  if (args.role === "reviewer" || args.role === "redteam") {
    const material = await backend.resolveAdvisoryReviewMaterial({ ...args, workspace_alias: workspace.repo });
    const target = material.normalized_target;
    source = { material_kind: material.material_kind, subject: args.subject,
      diff_base_sha: target.diff_base_sha, reviewed_sha: target.reviewed_sha,
      reviewed_tree: target.reviewed_tree_sha };
    assessment = { material_selected: true, execution_admitted: "unchecked" };
  } else {

    const readiness = await context.validateDispatch({ dir: workspace.dir, unitAddress: args.subject,
      dispatch_role: "implementation", mode: "strict", suppress_live_graph_resolution: true,
      worker_scope_preflight: preflightWorkerScope });
    scope = readiness.worker_scope_preflight ?? null;
    if (readiness.dispatchable === false &&
        readiness.decision_code === WORKER_SCOPE_BASE_SELECTION_MISSING_DECISION_CODE) {
      const root = await startAgentBaseCorrection({ wkId: args.subject.split("#", 1)[0], workspace, request });
      baseSelection = { correction: root.correction, ...await servedGuidanceRead(root.call, context.requestContracts) };
    }

    if (readiness.dispatchable === false && readiness.decision_code === MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE) {
      const authoring = missingInitiativeAuthoring(readiness);
      initiative = { authoring, ...await servedGuidanceRead({ kind: "guidance", ...missingInitiativeRead(authoring) },
        context.requestContracts) };
    }

    if (readiness.dispatchable === false && readiness.decision_code === CONTROLLED_ACCEPTANCE_INCOMPLETE &&
        args.role === "worker" && args.subject.includes("#")) {
      sliceAssessment = await servedUnitAssessment(args.subject, context.requestContracts);
    }

    const recovery = readiness.recovery?.graph_impact;
    graphDependent = graphDerivationRequiredForDispatch(recovery) || recovery === "nonrecoverable_missing_paths";
    assessment = { readiness: boundedRecoveryDetail(readiness, { dispatchable: readiness.dispatchable,
      ...(readiness.structural_readiness === undefined ? {} : { structural_readiness: readiness.structural_readiness }),
      ...(scope === null ? {} : { worker_scope_preflight: scope }),
      ...(initiative === null ? {} : { initiative_authoring: initiative.authoring }) }),
      graph: { state: graphDependent ? "not_assessed" : "not_required" },
      execution_admitted: "unchecked" };

    requirements = await savedRequirementsComparison(args.subject, { workspace, sessionEnv: context.sessionEnv,
      requestContracts: context.requestContracts, acquireSavedUnitReference: context.acquireSavedUnitReference,
      servedAssessment: sliceAssessment });
    const unknown = { state: "unknown", reason: graphDependent
      ? "committed graph snapshot not assessed" : "committed graph snapshot not required" };
    source = { subject: args.subject,
      revision: await readRecordAuthoringRevision({ repoRoot: workspace.dir, unit: args.subject }),
      repository_commit: unknown, repository_tree: unknown };
  }

  const scopeFacts = ["prospective_scope_base", "prospective_worker_scope"];
  const scopeAssessed = scope === null ? []
    : scope.status === "passed" || scope.status === "refused" ? scopeFacts
      : scope.reason?.code === WORKER_SCOPE_BASE_SELECTION_MISSING_DECISION_CODE ? scopeFacts.slice(0, 1) : [];
  const scopeCoverage = { assessed: scopeAssessed,
    unchecked: scope === null ? [] : scopeFacts.filter(fact => !scopeAssessed.includes(fact)) };

  const readinessOwners = [baseSelection, initiative, sliceAssessment].filter(owner => owner !== null);
  const readinessCalls = readinessOwners.flatMap(owner => owner.call ? [owner.call] : []);
  const comparisonCalls = readinessOwners.length === 0 && requirements?.assessment_call
    ? [requirements.assessment_call] : requirements?.calls ?? [];
  const nextCalls = readinessCalls.length > 0 ? readinessCalls : comparisonCalls;
  const read = requirements !== null && requirements.comparison.status !== "unavailable";
  const accounted = requirements?.comparison.residual.unmapped_source_text.accounted === true;
  return { outcome: "preview", preview_kind: "action", subject: args.subject, role: args.role,
    selection: { app: plan.app, model: plan.model, backend: plan.backend,
      executor_available: plan.executor_available }, capabilities: capabilitiesFor(args.role), source, assessment,

    ...(scope?.base?.selection === undefined ? {} : { base_selection: startAgentBaseSelection({
      wkId: args.subject.split("#", 1)[0], branch: scope.base.ref, selection: scope.base.selection,
      saved: scope.base.selection === WK_BASE_SELECTION.SAVED }) }),
    ...(baseSelection === null ? {} : { correction: baseSelection.correction,
      ...(baseSelection.limitation ? { readiness_guidance_limitation: baseSelection.limitation } : {}) }),
    ...(initiative?.limitation ? { readiness_guidance_limitation: initiative.limitation } : {}),
    ...(sliceAssessment?.limitation ? { contract_assessment_limitation: sliceAssessment.limitation } : {}),
    ...(requirements === null ? {} : { requirements_comparison: requirements.comparison }),
    ...(nextCalls.length === 0 ? {} : { next_calls: nextCalls }),
    effects: { cache: "not_consumed",
      child_started: false, canonical_written: false, runtime_prepared: false, integration_requested: false },
    coverage: coverage(["canonical_subject", "configured_model", "override_permission", "executor_availability",
      args.role === "worker" ? "configured_worker_target" : "review_material",
      ...(args.role === "worker" ? ["authored_readiness"] : []), ...scopeCoverage.assessed,
      ...(read ? ["saved_requirement_source_links"] : []), ...(accounted ? ["unmapped_requirement_source_text"] : [])],
      ["CCE", "launch_time", "isolation", "publication", "cleanup", ...(args.role === "worker" ? ["graph_admission"] : []),
        ...(graphDependent ? ["committed_graph"] : []), ...scopeCoverage.unchecked,
        ...(requirements === null ? [] : [...(read ? [] : ["saved_requirement_source_links"]),
          "requirement_meaning_fidelity", ...(accounted ? [] : ["unmapped_requirement_source_text"])])]) };
}
