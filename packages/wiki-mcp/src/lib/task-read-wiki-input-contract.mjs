import { DEFAULT_EXCEPTION_PUBLICATION } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";
import { selectedResponseCorrectableError } from "./selected-response-snapshot.mjs";
import { inputContractChoices, inputContractSelectionError } from "./task-read-wiki-input-contract-choices.mjs";
import { sessionExceptionKinds } from "./record-authoring-session-exposure.mjs";
import { recordAuthoringAvailability } from "@agent-chassis/wiki-core/src/lib/record-authoring-availability.mjs";

import { RECORD_AUTHORING_EXCEPTION_KINDS, describeRecordAuthoringException, recordAuthoringExceptionSchema } from
  "@agent-chassis/wiki-core/src/lib/record-authoring-exception.mjs";
import { INPUT_SCHEMA_EXPOSURE_CODES } from "./input-schema-exposure.mjs";
import { SAVE_RECORD_EXCEPTION_OPERATION } from "./save-record-input-navigation.mjs";
import { requirementGuidanceRecoveryCall } from "./requirement-authoring-guidance.mjs";
import { RECORD_KIND_CONTRACT_TOOL } from "./task-read-wiki-record-kind.mjs";
import { SAVE_RECORD_TOOL_NAME, saveRecordUnitVariant } from "./task-save-record-tools.mjs";

export const INPUT_CONTRACT_TOOLS = Object.freeze([SAVE_RECORD_TOOL_NAME, RECORD_KIND_CONTRACT_TOOL]);

export const INPUT_CONTRACT_EXCEPTION_OPERATION = SAVE_RECORD_EXCEPTION_OPERATION;

export const INPUT_CONTRACT_SOURCE_KINDS = Object.freeze(["record", "canonical_record"]);

const RECORD_KIND_SOURCE = "record_kind";
export const READ_WIKI_INPUT_CONTRACT_REASONS = Object.freeze({
  SOURCE_NOT_SAVED_UNIT: "input_contract_source_not_saved_unit",
  BINDING_UNAVAILABLE: "input_contract_binding_unavailable",
  SOURCE_UNAVAILABLE: "input_contract_source_unavailable",
  UNIT_NOT_SAVEABLE: "input_contract_unit_not_saveable",
  TOOL_SOURCE_MISMATCH: "input_contract_tool_source_mismatch",
  MEMBER_NOT_APPLICABLE: "input_contract_member_not_applicable",
  MEMBER_REPEATED: "input_contract_member_repeated",
  EXCEPTION_IS_OPERATION: "input_contract_exception_is_operation"
});
const REASONS = READ_WIKI_INPUT_CONTRACT_REASONS;

const NO_ROUTE = (missingCapability, owner, reason) => ({ state: "no_supported_route", caller_correctable: false,
  missing_capability: missingCapability, owner, reason });

export function createReadWikiInputContractReader({ requestContracts, invalid, readTool, registeredTier = null, exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION }) {

  const refuse = (reason, { subject, cause, recovery, reads = [], next_calls = [], ...facts }) => invalid(reason, { subject, cause, ...facts,
    ...(recovery === undefined ? {} : { recovery }), next_calls, effects: { reads, writes: [] } });

  async function guidanceCalls(guidance) {
    const reader = requestContracts?.contractFor(readTool) ?? null;
    const calls = new Map();
    for (const { topics } of guidance) {
      for (const topic of topics) {
        const offered = requirementGuidanceRecoveryCall(topic, registeredTier, exceptionPublication);
        if (offered === null || reader === null || !await reader.acceptsArguments(offered.arguments)) continue;
        calls.set(JSON.stringify(offered.arguments), offered);
      }
    }
    return [...calls.values()];
  }

  async function choicesResult(source, tool, reference, members) {

    source.select({ members });
    const calls = inputContractChoices({ source, tool, reference, members, readTool });
    for (const call of calls) if (await requestContracts?.contractFor(readTool)?.acceptsArguments(call.arguments) !== true) {
      throw new TypeError('input_contract_choice_not_accepted: serving reader rejected a published capability choice');
    }
    return { input_contract: { tool, view: "choices", members,
      capabilities: Object.fromEntries(Object.entries(source.branches).filter(([member]) => members.includes(member))
        .map(([member, { capability_schema_digests: _digests, ...meaning }]) => [member, meaning])) }, next_calls: calls };
  }

  async function branchRefusal(error, source, selector, reference, subject) {
    const { tool, members } = selector;
    const next_calls = inputContractChoices({ source, tool, reference, members, readTool, branches: selector.branches });
    for (const call of next_calls) if (await requestContracts?.contractFor(readTool)?.acceptsArguments(call.arguments) !== true) {
      throw new TypeError('input_contract_choice_not_accepted: serving reader rejected a published capability choice');
    }
    const unavailable = Object.keys(selector.branches ?? {}).filter(member => !Object.hasOwn(source.branches, member));
    return invalid(error.code, { subject, cause: error.message, requested_members: members,
      ...(selector.branches === undefined ? {} : { requested_branches: selector.branches }),
      choice: next_calls.length ? 'Choose a supported branch or the complete member schema; each offered call retains the other requested members and valid branches.'
        : unavailable.length ? `This source publishes no branch selection for ${unavailable.join(', ')}. Choose the intended source and members or explicitly remove that branch constraint; no alternate source or scope is inferred.`
          : 'Choose whether to include the branch owner in members or remove its branch constraint; neither decision was inferred.',
      effects: { reads: [], writes: [] }, next_calls });
  }

  async function readCreationContract({ carrier, members, selector, reference, requireGrant, reopen }) {
    const tool = RECORD_KIND_CONTRACT_TOOL;
    const subject = carrier.subject;
    if (!recordAuthoringAvailability(registeredTier).compile_requirements && members.includes("requirements")) {
      throw refuse("record_authoring_operation_unavailable", { subject, tool, member: "requirements", operation: "compile_requirements", changed: false,
        cause: "Requirement compilation is unavailable in this serving session; no authoring schema was disclosed.",
        recovery: NO_ROUTE("compile_requirements", "serving authoring operation", "Compilation is unavailable in this session; required meaning and applicability remain unchanged and incomplete") });
    }
    if (carrier.source_kind !== RECORD_KIND_SOURCE) {
      throw refuse(REASONS.TOOL_SOURCE_MISMATCH, { subject, tool, source_kind: carrier.source_kind,
        cause: `${tool}'s input contract is the initial object of a record kind; the selected source names a ${carrier.source_kind}`,
        choice: 'Choose the intended record_kind; request this same input_contract selection directly with reads:[{subject:{record_kind:<chosen kind>},select:{input_contract:<same selection>}}]. No kind or creation intent is inferred.' });
    }
    requireGrant(RECORD_KIND_SOURCE, "input_contract");
    const kind = subject.record_kind;
    const source = (await reopen()).source;
    let selected;
    try {
      if (selector.view === "choices") return await choicesResult(source, tool, reference, members);
      selected = source.select({ members, ...(selector.branches ? { branches: selector.branches } : {}) });
    } catch (error) {
      if (inputContractSelectionError(error)) throw await branchRefusal(error, source, { ...selector, members }, reference, subject);
      if (error.code !== INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_MEMBER_UNKNOWN) throw error;
      const unknown = members.filter((member) => !source.members.includes(member));
      throw refuse(REASONS.MEMBER_NOT_APPLICABLE, { subject, record_kind: kind, tool, reads: [],
        requested_members: members, not_applicable: unknown, valid_members: source.members,
        selection_context: { tool: readTool, reference,
          binding: `Choose needed valid_members[i]; call {reads:[{reference,select:{input_contract:{tool:"${tool}",members:[...chosen members]}}}]} unchanged.` },
        cause: `${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not ${unknown.length === 1 ? "a member" : "members"} of the initial object ${tool} takes for a ${kind}`,
        choice: "select members from valid_members; kind and title are the request's own and are not selected here" });
    }
    return {
      input_contract: { tool, record_kind: kind, variant: kind, members: selected.members,
        ...(selected.branches ? { branches: selected.branches } : {}), schema: selected.schema },
      next_calls: await guidanceCalls(selected.guidance)
    };
  }

  async function savedExceptionFacts(unit, readSavedContract) {
    if (typeof readSavedContract !== "function") {
      return { available: false, reason: "this session reads no saved contract for the unit" };
    }
    let saved;
    try {
      saved = await readSavedContract(unit);
    } catch (error) {
      if (error?.envelope === undefined && typeof error?.code !== "string") throw error;
      return { available: false, reason: `the unit's saved contract could not be read: ${error.message}`,
        cause: { code: error.code ?? null, message: error.message,
          ...(error.envelope === undefined ? {} : { refusal: error.envelope }),
          ...(error.details === undefined ? {} : { details: error.details }) } };
    }
    const { resolvePublicSelections, projectPublicSelection } = await import('@agent-chassis/wiki-core/src/operations/controlled-contract/public-selection.mjs');
    const coverage = saved.coverage;
    const obligations = coverage.obligations;
    const projected = projectPublicSelection((await resolvePublicSelections({ source: saved, population: 'requirements', intent: 'read' })).results[0]);
    if (projected.status !== 'ok') return { available: false, cause: projected.issue };
    const unresolved = projected.value.members.filter(entry => entry.kind === 'unresolved');
    const declined = obligations.filter(row => row.proof_opt_out === true);
    const excepted = unresolved.filter(entry => entry.grammar_exception !== undefined);
    const acceptance = coverage.controlled_acceptance ?? null;
    const rationaleOf = (value) => (typeof value === "string" ? { rationale: value } : { rationale: null, rationale_state: "not_recorded" });
    return { available: true,
      proof: { obligations: obligations.length,
        selected: obligations.filter((row) => row.proof_opt_out !== true && typeof row.selection?.proof_name === "string").length,
        declined: declined.length,
        undecided: obligations.filter((row) => row.proof_opt_out !== true && typeof row.selection?.proof_name !== "string").length,
        recorded: declined.map((row) => ({ subject: row.obligation_id, ...rationaleOf(row.proof_opt_out_rationale) })) },
      grammar: { unresolved_meanings: unresolved.length, exceptions: excepted.length,
        choices: unresolved.map(entry => ({ subject: entry.selector,
          ...(entry.grammar_exception === undefined ? {} : { exception: entry.grammar_exception }) })) },
      controlled_acceptance: { disposition: acceptance?.disposition ?? null, status: acceptance?.status ?? "unset",
        ...(acceptance?.disposition === "opted_out" ? { ...rationaleOf(acceptance.rationale),
          ...(acceptance.proof_posture?.controlled_contract?.source_passages === undefined ? {}
            : { source_passages: acceptance.proof_posture.controlled_contract.source_passages }) } : {}) } };
  }

  async function readExceptionContract({ carrier, select, requireGrant, reopen, readSavedContract, reference }) {
    const { tool, kind = null } = select.input_contract;
    const subject = carrier.subject;
    if (!INPUT_CONTRACT_SOURCE_KINDS.includes(carrier.source_kind)) {
      throw refuse(REASONS.SOURCE_NOT_SAVED_UNIT, { subject, source_kind: carrier.source_kind,
        cause: `an exception contract requires a saved work item or slice; the selected source names a ${carrier.source_kind}`,
        choice: 'Choose the intended saved-unit subject; request this same input_contract selection directly in reads. No unit is inferred and no preliminary context read is required.' });
    }
    requireGrant(carrier.source_kind, "input_contract");
    if ((requestContracts?.contractFor(tool)?.inputSchemaExposure ?? null) === null) {
      throw refuse(REASONS.BINDING_UNAVAILABLE, { subject, tool,
        cause: `this session has no registered ${tool} input contract to read from`,
        recovery: NO_ROUTE(`registered_${tool}_input_schema_exposure`, `${tool} registration of this session`,
          `${tool} is not registered for this session, so it takes no exception request and no read supplies its contract`) });
    }
    let resource;
    try {
      resource = await reopen();
    } catch (error) {
      throw refuse(REASONS.SOURCE_UNAVAILABLE, { subject, reads: [carrier.source_kind],
        cause: `the saved unit this reference names could not be read again: ${error.message}`,
        source_refusal: error.envelope ?? { code: error.code, message: error.message, details: error.details },
        recovery: NO_ROUTE("the_same_saved_unit", "the saved record's owner",
          "an exception names one existing saved subject of that unit; no other unit is substituted for one that cannot be read") });
    }
    const unit = resource.unit;
    if (typeof unit !== "string" || unit !== subject || saveRecordUnitVariant(unit)?.kind !== "work_item") {
      throw refuse(REASONS.UNIT_NOT_SAVEABLE, { subject, reads: [carrier.source_kind],
        cause: `${tool} records an exception on a work item or one of its slices; this unit takes none`,
        recovery: NO_ROUTE(`${tool}_exception_for_unit`, `${tool} registration of this session`,
          "no exception kind applies to this unit") });
    }
    const revision = resource.authoring_revision ?? resource.revision ?? null;
    if (kind !== null && !exceptionPublication.includes(kind)) throw refuse("controlled_acceptance_opt_out_not_published", {
      subject, tool, operation: "exception", publication: "not_published", changed: false,
      cause: "The host presentation configuration does not publish the requested whole-unit opt-out contract. No schema or request template was disclosed; this setting does not change request acceptance.",
      recovery: NO_ROUTE("published_exception_contract", "host publication configuration",
        "The operator can change the host publication setting and restart the session/server") });
    const kinds = exceptionPublication.kinds(sessionExceptionKinds(registeredTier, kind === null ? RECORD_AUTHORING_EXCEPTION_KINDS : [kind]));
    if (kinds.length === 0) throw refuse("record_authoring_operation_unavailable", { subject, tool, operation: "grammar_exception", member: "exception", changed: false,
      cause: "Grammar exception authoring is unavailable in this serving session; no schema was disclosed.",
      recovery: NO_ROUTE("grammar_exception", "serving authoring operation", "Grammar exception authoring is unavailable in this session; no applicability choice is changed") });
    const schema = kind === null ? { ...recordAuthoringExceptionSchema(), oneOf: kinds.flatMap(name => recordAuthoringExceptionSchema(name).oneOf) } : recordAuthoringExceptionSchema(kind);
    const saved = await savedExceptionFacts(unit, readSavedContract);
    const workItem = unit.split("#")[0];
    return {
      revision,
      input_contract: { tool, unit, operation: INPUT_CONTRACT_EXCEPTION_OPERATION, kinds,
        schema },
      request: { variant: "{unit, revision, exception}", exclusive_with: ["changes", "maintenance_retry"],
        one_exception_per_request: true, revision_from: "this unit's current revision; a stale revision is refused and nothing is saved" },
      exceptions: kinds.map((name) => {
        const { schema: _schema, ...described } = describeRecordAuthoringException(name);

        const known = name === "controlled_acceptance" ? workItem : null;
        return { ...described,
          request_template: { executable: false, unit, revision,
            exception: { kind: name, action: "apply", subject: known, rationale: null,
              ...(name === "proof" ? {} : { source_passages: null }) },
            caller_input: [...(known === null ? ["exception.subject"] : []), "exception.rationale",
              ...(name === "proof" ? [] : ["exception.source_passages"])],
            ...(name === "proof" ? {} : { source_accounting: "Optional: replace source_passages with caller-authored exact passage selections, choosing user_requirement_occurrence where repeated, or omit it to save an accounting draft with zero inferred passage coverage. Reapplying replaces the saved passage list; preserve existing intended bindings and rationale." }),
            withdraw: { unit, revision, exception: { kind: name, action: "withdraw", subject: known } } },
          ...(saved.available ? { saved: saved[name] } : {}) };
      }),
      ...(saved.available ? (kind === null && !exceptionPublication.includes("controlled_acceptance")
        ? { saved: { controlled_acceptance: saved.controlled_acceptance } } : {}) : { saved: saved }),
      authorization: { reading_required: false, permit: "none: this read is no token and no precondition; a correctly formed request is accepted without it",
        decided_by: "the session role save_record is registered for, and the request's own revision and subject",
        eligibility: "not decided here: no rationale is read, classified or assessed" },
      next_calls: typeof readSavedContract !== 'function' ? [] : [
        ...(kinds.includes('proof') ? [{ tool: readTool, arguments: { reads: [{ reference, select: { contract: 'obligations' } }] } }] : []),
        ...(kinds.includes('grammar') ? [{ tool: readTool, arguments: { reads: [{ reference,
          select: { contract: 'requirements' } }] } }] : [])]
    };
  }

  return async function readInputContract({ carrier, select, requireGrant, reopen, readSavedContract = null, reference }) {
    if (select.input_contract.operation === INPUT_CONTRACT_EXCEPTION_OPERATION) {
      return readExceptionContract({ carrier, select, requireGrant, reopen, readSavedContract, reference });
    }
    const selector = select.input_contract;
    const { tool, members = ["requirements"] } = selector;
    if (!recordAuthoringAvailability(registeredTier).compile_requirements && members.includes("requirements")) {
      throw refuse("record_authoring_operation_unavailable", { subject: carrier.subject, tool, member: "requirements", operation: "compile_requirements", changed: false,
        cause: "Requirement compilation is unavailable in this serving session; no authoring schema was disclosed.",
        recovery: NO_ROUTE("compile_requirements", "serving authoring operation", "Compilation is unavailable in this session; required meaning and applicability remain unchanged and incomplete") });
    }
    const subject = carrier.subject;

    const repeated = [...new Set(members.filter((member, index) => members.indexOf(member) !== index))];
    if (repeated.length > 0) {
      throw refuse(REASONS.MEMBER_REPEATED, { subject, requested_members: members, repeated,
        next_calls: [{ tool: readTool, arguments: { reads: [{ reference, select: { input_contract: { ...selector, members: [...new Set(members)] } } }] } }],
        cause: `${repeated.join(", ")} ${repeated.length === 1 ? "is" : "are"} named more than once`,
        choice: "name each member once" });
    }

    if (tool === RECORD_KIND_CONTRACT_TOOL) return readCreationContract({ carrier, members, selector, reference, requireGrant, reopen });
    if (carrier.source_kind === RECORD_KIND_SOURCE) {
      throw refuse(REASONS.TOOL_SOURCE_MISMATCH, { subject, tool, source_kind: carrier.source_kind,
        cause: `the selected source names a record kind, whose input contract is ${RECORD_KIND_CONTRACT_TOOL}'s initial object; ${tool} takes the changes of a saved unit`,
        choice: `Choose whether to read ${RECORD_KIND_CONTRACT_TOOL}'s initial-object contract through this reference or ${tool}'s changes contract through an intended saved-unit subject. Preserve the needed members and branches in a bulk read; creation or editing intent is not inferred.` });
    }
    if (!INPUT_CONTRACT_SOURCE_KINDS.includes(carrier.source_kind)) {
      throw refuse(REASONS.SOURCE_NOT_SAVED_UNIT, { subject, source_kind: carrier.source_kind,
        cause: `an input contract requires a saved work item, slice, initiative or decision; the selected source names a ${carrier.source_kind}`,
        choice: 'Choose the intended saved-unit subject; request this same input_contract selection directly in reads. No unit is inferred and no preliminary context read is required.' });
    }
    requireGrant(carrier.source_kind, "input_contract");
    const exposure = requestContracts?.contractFor(tool)?.inputSchemaExposure ?? null;
    if (exposure === null) {
      throw refuse(REASONS.BINDING_UNAVAILABLE, { subject, tool,
        cause: `this session has no registered ${tool} input contract to read from`,
        recovery: NO_ROUTE(`registered_${tool}_input_schema_exposure`, `${tool} registration of this session`,
          `${tool} is not registered for this session, or its registration bound no input schema exposure; no read supplies one`) });
    }
    let resource;
    try {
      resource = await reopen();
    } catch (error) {
      throw refuse(REASONS.SOURCE_UNAVAILABLE, { subject, reads: [carrier.source_kind],
        cause: `the saved unit this reference names could not be read again: ${error.message}`,
        source_refusal: error.envelope ?? { code: error.code, message: error.message, details: error.details },
        recovery: NO_ROUTE("the_same_saved_unit", "the saved record's owner",
          "the schema of a unit is selected by that unit; no other unit or variant is substituted for one that cannot be read") });
    }
    const unit = resource.unit;
    const variant = typeof unit === "string" && unit === subject ? saveRecordUnitVariant(unit) : undefined;
    if (variant === undefined) {
      throw refuse(REASONS.UNIT_NOT_SAVEABLE, { subject, reads: [carrier.source_kind],
        cause: `${tool} declares no save variant for this unit address`,
        recovery: NO_ROUTE(`${tool}_variant_for_unit`, `${tool} registration of this session`,
          "no registered save variant applies to this unit") });
    }
    const source = exposure.source(variant.name);
    if (members.includes("exception") && variant.kind === "work_item") {

      const replacement = { tool: readTool, arguments: { reads: [{ reference,
        select: { input_contract: { tool, operation: INPUT_CONTRACT_EXCEPTION_OPERATION } } }] } };
      if (await requestContracts?.contractFor(readTool)?.acceptsArguments(replacement.arguments) === true) {
        throw selectedResponseCorrectableError(readTool, REASONS.EXCEPTION_IS_OPERATION, { subject, unit, tool,
          effects: { reads: [carrier.source_kind], writes: [] },
          requested_members: members, not_applicable: members.filter(member => !source.members.includes(member)),
          valid_members: source.members,
          cause: "exception is a separate save_record operation, not a changes member; no requested member was selected or dropped",
          choice: "Read the exception operation through the replacement call. Select any ordinary changes members separately.",
        }, { arguments: replacement.arguments,
          requestSchema: requestContracts.contractFor(readTool).publishedRequestSchema(),
          prerequisite: 'The same authenticated saved-unit reference and serving exception operation remain available.',
          successCondition: 'The exception operation schema is read; no requested changes member is selected and nothing is written.' });
      }
    }
    let selected;
    try {
      if (selector.view === "choices") return await choicesResult(source, tool, reference, members);
      selected = source.select({ members, ...(selector.branches ? { branches: selector.branches } : {}) });
    } catch (error) {
      if (inputContractSelectionError(error)) throw await branchRefusal(error, source, { ...selector, members }, reference, subject);
      if (error.code !== INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_MEMBER_UNKNOWN) throw error;
      const unknown = members.filter((member) => !source.members.includes(member));
      throw refuse(REASONS.MEMBER_NOT_APPLICABLE, { subject, unit, variant: variant.name, tool, reads: [carrier.source_kind],
        requested_members: members, not_applicable: unknown, valid_members: source.members,
        selection_context: { tool: readTool, reference,
          binding: `Choose needed valid_members[i]; call {reads:[{reference,select:{input_contract:{tool:"${tool}",members:[...chosen members]}}}]} unchanged.` },
        cause: `${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not ${unknown.length === 1 ? "a member" : "members"} of the ${variant.name} changes ${tool} takes for ${unit}`,
        choice: "select members from valid_members; no member is chosen or dropped for the caller" });
    }
    const observed = carrier.authoring_revision ?? carrier.revision ?? null;
    const current = resource.authoring_revision ?? resource.revision ?? null;
    return {

      revision: current,
      input_contract: { tool, unit, variant: variant.name, members: selected.members,
        ...(selected.branches ? { branches: selected.branches } : {}), schema: selected.schema },
      next_calls: await guidanceCalls(selected.guidance),
      ...(observed === current ? {} : { recovered: { code: 'source_moved',
        cause: 'The current schema of the same unit and requested members was served; no save was retried or authored value changed.' } })
    };
  };
}
