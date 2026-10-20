import { DEFAULT_EXCEPTION_PUBLICATION } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";
import { inputContractChoices } from "./task-read-wiki-input-contract-choices.mjs";
import { inferredRequirementCapabilities } from "./requirement-authoring-schema-guidance.mjs";
import { INPUT_SCHEMA_EXPOSURE_CODES } from './input-schema-exposure.mjs';

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

export function createSaveRecordInputNavigation({ requestContracts, saveTool, readTool, variantOf, exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION }) {
  const exposure = () => requestContracts?.contractFor(saveTool)?.inputSchemaExposure ?? null;
  const selection = (reference, members, options = {}) => ({ reads: [{ reference, select: { input_contract: { tool: saveTool, members, ...options } } }] });
  const accepted = async (argumentsValue) =>
    await requestContracts?.contractFor(readTool)?.acceptsArguments(argumentsValue) === true;

  async function contractCall(reference, members, facts = {}, options = {}) {
    const argumentsValue = selection(reference, members, options);
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
    const calls = [], capabilityCalls = [];
    for (const { job, purpose, groups } of variant.kind === "work_item" ? SAVE_RECORD_WORK_ITEM_JOBS : [SAVE_RECORD_WHOLE_RECORD_JOB]) {
      const chosen = new Set(source.groups.filter(({ name }) => groups.includes(name)).flatMap(({ members }) => members));
      const members = source.members.filter((member) => chosen.has(member));
      if (members.length === 0) continue;
      const branched = members.some(member => source.branches[member]);
      const call = await contractCall(reference, members, { job, purpose: branched ? `owner schema choices for ${job}` : purpose },
        branched ? { view: "choices" } : {});
      if (call !== null) calls.push(call);
      for (const choice of inputContractChoices({ source, tool: saveTool, reference, members, readTool })) {
        if (choice.arguments.reads[0].select.input_contract.branches && await accepted(choice.arguments)) capabilityCalls.push(choice);
      }
    }
    return [...calls, ...capabilityCalls];
  }

  async function focusedContext({ unit, reference, members }) {
    const resolved = sourceOf(unit);
    if (resolved === null) return { unavailable: { state: 'unavailable',
      cause: typeof unit !== 'string' || variantOf(unit) === undefined
        ? 'This subject has no supported save_record contract.'
        : 'The save input grammar is unavailable in this session.' } };
    let selected;
    try {
      selected = resolved.source.select({ members });
    } catch (error) {
      if (![INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_INVALID, INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_EMPTY,
        INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_MEMBER_UNKNOWN].includes(error.code)) throw error;
      return { refusal: { code: error.code, cause: error.message, requested_members: members,
        valid_members: resolved.source.members } };
    }
    const branched = selected.members.some(member => resolved.source.branches[member]);
    const call = await contractCall(reference, selected.members, { recommended: true,
      purpose: branched ? 'schema_choices_for_changes' : 'complete_schema_for_changes' },
    branched ? { view: 'choices' } : {});
    if (call === null) return { unavailable: { state: 'unavailable',
      cause: 'The serving reader does not accept the input contract for these members.' } };
    return { call, identity: { tool: saveTool, unit, variant: resolved.variant.name,
      members: selected.members } };
  }

  async function refusalGuidance({ unit, changes }) {
    if (typeof unit !== "string" || variantOf(unit) === undefined ||
        changes === null || typeof changes !== "object" || Array.isArray(changes)) return null;
    const requested = Object.keys(changes);
    if (requested.length === 0) return null;
    const unavailable = (_capability, _owner, reason, facts = {}) => ({ calls: [],
      unavailable: { state: 'unavailable', reason, ...facts } });
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
    const capabilities = members.includes('requirements') ? inferredRequirementCapabilities(changes.requirements) : undefined;
    const readyRows = changes.ready_slices;
    const readyModes = Array.isArray(readyRows) && readyRows.length && readyRows.every(row =>
      row && typeof row === 'object' && (Object.hasOwn(row, 'key') !== Object.hasOwn(row, 'id')))
      ? [...new Set(readyRows.map(row => Object.hasOwn(row, 'key') ? 'create' : 'update'))] : null;
    const options = capabilities === null || (members.includes('ready_slices') && readyModes === null)
      ? { view: 'choices' } : { ...(capabilities !== undefined || readyModes !== null ? { branches: {
        ...(capabilities === undefined ? {} : { requirements: capabilities }),
        ...(readyModes === null ? {} : { ready_slices: readyModes }) } } : {}) };
    const argumentsValue = { reads: [{ subject: unit, select: { input_contract: { tool: saveTool, members, ...options } } }] };
    const call = await accepted(argumentsValue) ? buildNextCall({ tool: readTool, arguments: argumentsValue,
      purpose: 'The accepted grammar of the rejected authored members; caller values remain to be chosen.' }) : null;
    if (call === null) {
      return unavailable(UNAVAILABLE.SELECTION, "central read-selection policy",
        `this session's ${readTool} does not accept the input_contract selection for this subject`,
      {});
    }
    return { calls: [call], members };
  }

  const exceptionSelection = (reference, facts = {}) =>
    ({ reads: [{ reference, select: { input_contract: { tool: saveTool, operation: SAVE_RECORD_EXCEPTION_OPERATION, ...facts } } }] });
  async function exceptionContractCall(reference, facts = {}, callFacts = {}) {
    if (facts.kind !== undefined && !exceptionPublication.includes(facts.kind)) return null;
    const argumentsValue = exceptionSelection(reference, facts);
    return await accepted(argumentsValue) ? buildNextCall({ tool: readTool, arguments: argumentsValue, ...callFacts }) : null;
  }

  async function exceptionGuidance({ unit, kind = null }) {
    if (typeof unit !== "string" || variantOf(unit)?.kind !== "work_item") return null;
    const unavailable = (_capability, _owner, reason, facts = {}) => ({ calls: [],
      unavailable: { state: 'unavailable', reason, ...facts } });
    if (kind !== null && !exceptionPublication.includes(kind)) return unavailable(
      "published_exception_contract", "host publication configuration",
      "The requested contract is not published in this session; publication does not change request acceptance");
    const narrowed = kind === null ? {} : { kind };
    if (requestContracts?.contractFor(readTool) == null) {
      return unavailable(UNAVAILABLE.READER, "session role grants", `${readTool} is not registered for this session`);
    }
    const argumentsValue = { reads: [{ subject: unit, select: { input_contract: {
      tool: saveTool, operation: SAVE_RECORD_EXCEPTION_OPERATION, ...narrowed } } }] };
    const call = await accepted(argumentsValue) ? buildNextCall({ tool: readTool, arguments: argumentsValue,
      purpose: 'The explicitly requested exception grammar and consequences; caller intent and rationale remain required.' }) : null;
    return call === null ? unavailable(UNAVAILABLE.SELECTION, "central read-selection policy",
      `this session's ${readTool} does not accept the exception input_contract selection for this subject`,
      {})
      : { calls: [call] };
  }

  return Object.freeze({ contractCall, jobChoices, focusedContext, refusalGuidance, exceptionContractCall, exceptionGuidance });
}
