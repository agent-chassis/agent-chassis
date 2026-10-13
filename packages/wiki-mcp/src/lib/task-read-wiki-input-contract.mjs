

import { RECORD_AUTHORING_EXCEPTION_KINDS, describeRecordAuthoringException, recordAuthoringExceptionSchema } from
  "@agent-chassis/wiki-core/src/lib/record-authoring-exception.mjs";
import { INPUT_SCHEMA_EXPOSURE_CODES } from "./input-schema-exposure.mjs";
import { SAVE_RECORD_EXCEPTION_OPERATION } from "./save-record-input-navigation.mjs";
import { inputContractSourceDigest } from "./tool-discovery-input-guidance-delivery.mjs";
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
  MEMBER_REPEATED: "input_contract_member_repeated"
});
const REASONS = READ_WIKI_INPUT_CONTRACT_REASONS;

const COVERAGE = Object.freeze({
  structural: "complete for the selected members: each member, the change object's own constraints and every " +
    "local definition they reach are the registered owner's schema, unchanged",
  semantic: "not established by this schema: save_record validates the whole request and its owners decide " +
    "cross-member, saved-state and planning rules when a save is made"
});

const NO_ROUTE = (missingCapability, owner, reason) => ({ state: "no_supported_route", caller_correctable: false,
  missing_capability: missingCapability, owner, reason });

export function createReadWikiInputContractReader({ requestContracts, invalid, readTool }) {

  const refuse = (reason, { subject, cause, recovery, reads = [], ...facts }) => invalid(reason, { subject, cause, ...facts,
    ...(recovery === undefined ? {} : { recovery }), next_calls: [], effects: { reads, writes: [] },
    uncertainty: "none: nothing was written and no schema was disclosed" });

  async function guidanceCalls(guidance) {
    const reader = requestContracts?.contractFor(readTool) ?? null;
    const calls = new Map();
    for (const { topics } of guidance) {
      for (const topic of topics) {
        const offered = requirementGuidanceRecoveryCall(topic);
        if (offered === null || reader === null || !await reader.acceptsArguments(offered.arguments)) continue;
        calls.set(JSON.stringify(offered.arguments), offered);
      }
    }
    return [...calls.values()];
  }

  async function readCreationContract({ carrier, members, requireGrant, reopen }) {
    const tool = RECORD_KIND_CONTRACT_TOOL;
    const subject = carrier.subject;
    if (carrier.source_kind !== RECORD_KIND_SOURCE) {
      throw refuse(REASONS.TOOL_SOURCE_MISMATCH, { subject, tool, source_kind: carrier.source_kind,
        cause: `${tool}'s input contract is the initial object of a record kind; this reference names a ${carrier.source_kind}`,
        choice: `read the kind's own context with ${readTool}({subject:{record_kind:<kind>}}) and select through the reference it returns` });
    }
    requireGrant(RECORD_KIND_SOURCE, "input_contract");
    const kind = subject.record_kind;
    const source = (await reopen()).source;
    let selected;
    try {
      selected = source.select({ members });
    } catch (error) {
      if (error.code !== INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_MEMBER_UNKNOWN) throw error;
      const unknown = members.filter((member) => !source.members.includes(member));
      throw refuse(REASONS.MEMBER_NOT_APPLICABLE, { subject, record_kind: kind, tool, reads: [],
        requested_members: members, not_applicable: unknown, valid_members: source.members,
        cause: `${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not ${unknown.length === 1 ? "a member" : "members"} of the initial object ${tool} takes for a ${kind}`,
        choice: "select members from valid_members; kind and title are the request's own and are not selected here" });
    }
    return {

      revision: selected.digest,
      input_contract: { tool, record_kind: kind, variant: kind, members: selected.members,
        owner_schema_digest: selected.digest, schema: selected.schema },
      coverage: { structural: COVERAGE.structural.replace("change object's", "initial object's"),
        semantic: `not established by this schema: ${tool} validates the whole request and its owners decide ` +
          "cross-member and planning rules when the record is created" },
      guidance: selected.guidance,
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
      return { available: false, reason: `the unit's saved contract could not be read: ${error.message}` };
    }
    const obligations = Array.isArray(saved.obligations) ? saved.obligations : [];
    const unresolved = Array.isArray(saved.authored_requirements?.unresolved)
      ? saved.authored_requirements.unresolved.filter((entry) => typeof entry?.id === "string") : [];
    const declined = obligations.filter((row) => row.proof_opt_out === true);
    const excepted = unresolved.filter((entry) => entry.grammar_exception !== undefined);
    const acceptance = saved.controlled_acceptance ?? null;
    const rationaleOf = (value) => (typeof value === "string" ? { rationale: value } : { rationale: null, rationale_state: "not_recorded" });
    return { available: true,
      proof: { obligations: obligations.length,
        selected: obligations.filter((row) => row.proof_opt_out !== true && typeof row.selection?.proof_name === "string").length,
        declined: declined.length,
        undecided: obligations.filter((row) => row.proof_opt_out !== true && typeof row.selection?.proof_name !== "string").length,
        recorded: declined.map((row) => ({ subject: row.obligation_id, ...rationaleOf(row.proof_opt_out_rationale) })) },
      grammar: { unresolved_meanings: unresolved.length, exceptions: excepted.length,
        recorded: excepted.map((entry) => ({ subject: entry.id, text: entry.text, ...rationaleOf(entry.grammar_exception.rationale) })) },
      controlled_acceptance: { disposition: acceptance?.disposition ?? null, status: acceptance?.status ?? "unset",
        ...(acceptance?.disposition === "opted_out" ? rationaleOf(acceptance.rationale) : {}) } };
  }

  async function readExceptionContract({ carrier, select, requireGrant, reopen, readSavedContract }) {
    const { tool, kind = null } = select.input_contract;
    const subject = carrier.subject;
    if (!INPUT_CONTRACT_SOURCE_KINDS.includes(carrier.source_kind)) {
      throw refuse(REASONS.SOURCE_NOT_SAVED_UNIT, { subject, source_kind: carrier.source_kind,
        cause: `an exception contract is read through the reference of a saved work item or slice; this reference names a ${carrier.source_kind}`,
        choice: `read the saved unit's own context with ${readTool}({subject:<unit id>}) and select through the reference it returns` });
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
        source_refusal: error.envelope ?? { message: error.message },
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
    const kinds = kind === null ? RECORD_AUTHORING_EXCEPTION_KINDS : [kind];
    const schema = recordAuthoringExceptionSchema(kind);
    const saved = await savedExceptionFacts(unit, readSavedContract);
    const workItem = unit.split("#")[0];
    return {
      revision,
      input_contract: { tool, unit, operation: INPUT_CONTRACT_EXCEPTION_OPERATION, kinds,
        owner_schema_digest: inputContractSourceDigest(schema), schema },
      request: { variant: "{unit, revision, exception}", exclusive_with: ["changes", "maintenance_retry"],
        one_exception_per_request: true, revision_from: "this unit's current revision; a stale revision is refused and nothing is saved" },
      exceptions: kinds.map((name) => {
        const { schema: _schema, ...described } = describeRecordAuthoringException(name);

        const known = name === "controlled_acceptance" ? workItem : null;
        return { ...described,
          request_template: { executable: false, unit, revision,
            exception: { kind: name, action: "apply", subject: known, rationale: null },
            caller_input: [...(known === null ? ["exception.subject"] : []), "exception.rationale"],
            withdraw: { unit, revision, exception: { kind: name, action: "withdraw", subject: known } } },
          ...(saved.available ? { saved: saved[name] } : {}) };
      }),
      ...(saved.available ? {} : { saved: saved }),
      authorization: { reading_required: false, permit: "none: this read is no token and no precondition; a correctly formed request is accepted without it",
        decided_by: "the session role save_record is registered for, and the request's own revision and subject",
        eligibility: "not decided here: no rationale is read, classified or assessed" },
      effects: { reads: [carrier.source_kind], writes: [] },
      next_calls: []
    };
  }

  return async function readInputContract({ carrier, select, requireGrant, reopen, readSavedContract = null }) {
    if (select.input_contract.operation === INPUT_CONTRACT_EXCEPTION_OPERATION) {
      return readExceptionContract({ carrier, select, requireGrant, reopen, readSavedContract });
    }
    const { tool, members } = select.input_contract;
    const subject = carrier.subject;

    const repeated = [...new Set(members.filter((member, index) => members.indexOf(member) !== index))];
    if (repeated.length > 0) {
      throw refuse(REASONS.MEMBER_REPEATED, { subject, requested_members: members, repeated,
        cause: `${repeated.join(", ")} ${repeated.length === 1 ? "is" : "are"} named more than once`,
        choice: "name each member once" });
    }

    if (tool === RECORD_KIND_CONTRACT_TOOL) return readCreationContract({ carrier, members, requireGrant, reopen });
    if (carrier.source_kind === RECORD_KIND_SOURCE) {
      throw refuse(REASONS.TOOL_SOURCE_MISMATCH, { subject, tool, source_kind: carrier.source_kind,
        cause: `this reference names a record kind, whose input contract is ${RECORD_KIND_CONTRACT_TOOL}'s initial object; ${tool} takes the changes of a saved unit`,
        choice: `select {input_contract:{tool:"${RECORD_KIND_CONTRACT_TOOL}",members:[...]}} through this reference, or read a saved unit's context for ${tool}` });
    }
    if (!INPUT_CONTRACT_SOURCE_KINDS.includes(carrier.source_kind)) {
      throw refuse(REASONS.SOURCE_NOT_SAVED_UNIT, { subject, source_kind: carrier.source_kind,
        cause: `an input contract is read through the reference of a saved work item, slice, initiative or decision; this reference names a ${carrier.source_kind}`,
        choice: `read the saved unit's own context with ${readTool}({subject:<unit id>}) and select through the reference it returns` });
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
        source_refusal: error.envelope ?? { message: error.message },
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
    let selected;
    try {
      selected = source.select({ members });
    } catch (error) {
      if (error.code !== INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_MEMBER_UNKNOWN) throw error;
      const unknown = members.filter((member) => !source.members.includes(member));
      throw refuse(REASONS.MEMBER_NOT_APPLICABLE, { subject, unit, variant: variant.name, tool, reads: [carrier.source_kind],
        requested_members: members, not_applicable: unknown, valid_members: source.members,
        cause: `${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not ${unknown.length === 1 ? "a member" : "members"} of the ${variant.name} changes ${tool} takes for ${unit}`,
        choice: "select members from valid_members; no member is chosen or dropped for the caller" });
    }
    const observed = carrier.authoring_revision ?? carrier.revision ?? null;
    const current = resource.authoring_revision ?? resource.revision ?? null;
    return {

      revision: current,
      input_contract: { tool, unit, variant: variant.name, members: selected.members,
        owner_schema_digest: selected.digest, schema: selected.schema },
      coverage: COVERAGE,
      guidance: selected.guidance,
      next_calls: await guidanceCalls(selected.guidance),
      ...(observed === current ? {} : { recovered: { code: "source_moved",
        applied: "current_schema_of_same_unit_variant_and_members", attempts: 1,
        observed_revision: observed, current_revision: current,
        unchanged: { unit, variant: variant.name, members: selected.members },
        effects: "none: no save was retried and no authored value was applied" } })
    };
  };
}
