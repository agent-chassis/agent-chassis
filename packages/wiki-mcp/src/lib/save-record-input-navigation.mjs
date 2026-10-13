

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { SAVE_RECORD_WHOLE_RECORD_JOB, SAVE_RECORD_WORK_ITEM_JOBS } from "./save-record-input-exposure.mjs";

export const SAVE_RECORD_INPUT_NAVIGATION_UNAVAILABLE = Object.freeze({
  BINDING: "registered_save_record_input_schema_exposure",
  READER: "registered_saved_unit_reader",
  SELECTION: "granted_input_contract_read_selection",
  ACQUISITION: "saved_unit_reference_acquisition",
  SOURCE: "current_saved_unit_reference"
});
const UNAVAILABLE = SAVE_RECORD_INPUT_NAVIGATION_UNAVAILABLE;

export const SAVE_RECORD_EXCEPTION_OPERATION = "exception";

const PROBE_REFERENCE = Object.freeze({ ref_id: "AAAAAAAA" });

export function createSaveRecordInputNavigation({ requestContracts, saveTool, readTool, variantOf }) {
  const exposure = () => requestContracts?.contractFor(saveTool)?.inputSchemaExposure ?? null;
  const selection = (reference, members) => ({ reference, select: { input_contract: { tool: saveTool, members } } });
  const accepted = async (argumentsValue) =>
    await requestContracts?.contractFor(readTool)?.acceptsArguments(argumentsValue) === true;

  async function contractCall(reference, members, facts = {}) {
    const argumentsValue = selection(reference, members);
    return await accepted(argumentsValue) ? buildNextCall({ tool: readTool, arguments: argumentsValue, ...facts }) : null;
  }

  function sourceOf(unit) {
    const variant = typeof unit === "string" ? variantOf(unit) : undefined;
    const bound = exposure();
    return variant === undefined || bound === null ? null : { variant, source: bound.source(variant.name) };
  }

  async function jobChoices({ unit, reference }) {
    const resolved = sourceOf(unit);
    if (resolved === null) return [];
    const { variant, source } = resolved;
    const calls = [];
    for (const { job, purpose, groups } of variant.kind === "work_item" ? SAVE_RECORD_WORK_ITEM_JOBS : [SAVE_RECORD_WHOLE_RECORD_JOB]) {
      const chosen = new Set(source.groups.filter(({ name }) => groups.includes(name)).flatMap(({ members }) => members));
      const members = source.members.filter((member) => chosen.has(member));
      if (members.length === 0) continue;
      const call = await contractCall(reference, members, { job, purpose });
      if (call !== null) calls.push(call);
    }
    return calls;
  }

  async function refusalGuidance({ unit, changes, acquire }) {
    if (typeof unit !== "string" || variantOf(unit) === undefined ||
        changes === null || typeof changes !== "object" || Array.isArray(changes)) return null;
    const requested = Object.keys(changes);
    if (requested.length === 0) return null;
    const unavailable = (missingCapability, owner, reason, facts = {}) => ({ calls: [],
      unavailable: { state: "unavailable", missing_capability: missingCapability, owner, reason, ...facts } });
    const resolved = sourceOf(unit);
    if (resolved === null) {
      return unavailable(UNAVAILABLE.BINDING, `${saveTool} registration of this session`,
        `this session's ${saveTool} registration bound no input schema exposure, so no schema can be selected`);
    }
    const { source } = resolved;
    if (requested.some((member) => !source.members.includes(member))) return null;
    const members = source.members.filter((member) => requested.includes(member));
    if (requestContracts?.contractFor(readTool) == null) {
      return unavailable(UNAVAILABLE.READER, "session role grants", `${readTool} is not registered for this session`);
    }
    if (!await accepted(selection(PROBE_REFERENCE, members))) {
      return unavailable(UNAVAILABLE.SELECTION, "central read-selection policy",
        `this session's ${readTool} does not accept the input_contract selection`);
    }
    if (typeof acquire !== "function") {
      return unavailable(UNAVAILABLE.ACQUISITION, `${readTool} reader of this session`,
        "no reader is composed to return a current reference of the refused unit");
    }
    let acquired;
    try {
      acquired = await acquire(unit);
    } catch (error) {

      if (error?.envelope === undefined) throw error;
      return unavailable(UNAVAILABLE.SOURCE, `${readTool} reader of this session`,
        `the refused unit's current reference could not be read: ${error.message}`, { source_refusal: error.envelope });
    }
    const call = await contractCall(acquired.reference, members, { purpose:
      `the complete ${saveTool} schema of the members this request changed; read-only structural guidance, not a corrected save` });
    if (call === null) {
      return unavailable(UNAVAILABLE.SELECTION, "central read-selection policy",
        `this session's ${readTool} does not accept the input_contract selection for the acquired reference`,
      { reference_acquisition: acquired.effects });
    }
    return { calls: [call], members, reference_acquisition: acquired.effects };
  }

  const exceptionSelection = (reference, facts = {}) =>
    ({ reference, select: { input_contract: { tool: saveTool, operation: SAVE_RECORD_EXCEPTION_OPERATION, ...facts } } });
  async function exceptionContractCall(reference, facts = {}, callFacts = {}) {
    const argumentsValue = exceptionSelection(reference, facts);
    return await accepted(argumentsValue) ? buildNextCall({ tool: readTool, arguments: argumentsValue, ...callFacts }) : null;
  }

  async function exceptionGuidance({ unit, acquire, kind = null }) {
    if (typeof unit !== "string" || variantOf(unit)?.kind !== "work_item") return null;
    const unavailable = (missingCapability, owner, reason, facts = {}) => ({ calls: [],
      unavailable: { state: "unavailable", missing_capability: missingCapability, owner, reason, ...facts } });
    const narrowed = kind === null ? {} : { kind };
    if (requestContracts?.contractFor(readTool) == null) {
      return unavailable(UNAVAILABLE.READER, "session role grants", `${readTool} is not registered for this session`);
    }
    if (!await accepted(exceptionSelection(PROBE_REFERENCE, narrowed))) {
      return unavailable(UNAVAILABLE.SELECTION, "central read-selection policy",
        `this session's ${readTool} does not accept the exception input_contract selection`);
    }
    if (typeof acquire !== "function") {
      return unavailable(UNAVAILABLE.ACQUISITION, `${readTool} reader of this session`,
        "no reader is composed to return a current reference of the refused unit");
    }
    let acquired;
    try {
      acquired = await acquire(unit);
    } catch (error) {
      if (error?.envelope === undefined) throw error;
      return unavailable(UNAVAILABLE.SOURCE, `${readTool} reader of this session`,
        `the refused unit's current reference could not be read: ${error.message}`, { source_refusal: error.envelope });
    }
    const call = await exceptionContractCall(acquired.reference, narrowed, { purpose:
      `the explicit ${saveTool} exception contract: its kinds, request schema and consequences; read-only, never required and not a corrected request` });
    return call === null ? unavailable(UNAVAILABLE.SELECTION, "central read-selection policy",
      `this session's ${readTool} does not accept the exception input_contract selection for the acquired reference`,
      { reference_acquisition: acquired.effects })
      : { calls: [call], reference_acquisition: acquired.effects };
  }

  return Object.freeze({ contractCall, jobChoices, refusalGuidance, exceptionContractCall, exceptionGuidance });
}
