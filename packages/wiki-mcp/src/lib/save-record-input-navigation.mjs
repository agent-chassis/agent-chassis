import { DEFAULT_EXCEPTION_PUBLICATION } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";
import { inputContractChoices } from "./task-read-wiki-input-contract-choices.mjs";
import { inferredRequirementCapabilities } from "./requirement-authoring-schema-guidance.mjs";
import { fieldPath } from '@agent-chassis/wiki-core/src/operations/controlled-contract/contract-requirement-normalization.mjs';
import { INPUT_SCHEMA_EXPOSURE_CODES } from './input-schema-exposure.mjs';

import { buildNextCall, requestContractErrors } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
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
  const accepted = async (argumentsValue) => {
    const reader = requestContracts?.contractFor(readTool);

    return reader != null && await reader.acceptsArguments(argumentsValue) === true &&
      requestContractErrors(readTool, argumentsValue, reader.publishedRequestSchema()).length === 0;
  };

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

  async function refusalGuidance({ unit, changes, revision, diagnostics = [] }) {
    if (typeof unit !== "string" || variantOf(unit) === undefined) return null;
    const isObject = changes !== null && typeof changes === 'object' && !Array.isArray(changes);
    if (changes !== undefined && changes !== null && !isObject) return { calls: [],
      object_shape: { path: ['changes'], expected: 'object',
        correction: 'Resend the intended change members as a JSON object value. Strings (including serialized objects) and arrays are not accepted; no content was parsed or discarded.' } };
    const requested = isObject ? Object.keys(changes) : [];
    const needsMembers = requested.length === 0;
    const unresolved = needsMembers ? { unresolved_inputs: ['changes'],
      caller_choice: 'Choose supported change members and author their intended values; no edit was inferred.' } : {};
    const unavailable = (reason, facts = {}) => ({ calls: [], ...facts,
      unavailable: { state: 'unavailable', reason } });
    const resolved = sourceOf(unit);
    if (resolved === null) return unavailable(
      `this session's ${saveTool} registration bound no input schema exposure, so no schema can be selected`, unresolved);
    const { source } = resolved;
    const intended = source.members.filter(member => requested.includes(member));
    const needsGrammar = issue => {
      const rule = issue.constraint;
      if (rule?.rule || ['enum', 'const', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum',
        'pattern', 'uniqueItems'].includes(rule?.keyword)) return false;
      if (['invalid_enum_value', 'invalid_literal', 'too_small', 'too_big'].includes(issue.code)) return false;
      return true;
    };
    const paths = diagnostics.filter(needsGrammar).map(issue => Array.isArray(issue.path) ? issue.path : fieldPath(issue.path));
    const diagnosed = new Set(paths.filter(path => path[0] === 'changes').map(path => path[1]));
    const members = intended.filter(member => diagnosed.has(member));
    const unknown = requested.filter(member => !source.members.includes(member));
    const needsDiscovery = needsMembers || unknown.length > 0 || diagnostics.some(issue =>
      issue.code === 'unrecognized_keys' && issue.path?.length === 0);
    const facts = { ...(members.length ? { members } : {}), ...unresolved,
      ...(unknown.length ? { unresolved_members: unknown,
        caller_choice: 'Choose how to express the unsupported member intent using supported members, or explicitly omit it. ' +
          (members.length ? 'The focused grammar covers only recognized members. ' : '') +
          'No rejected intent was dropped or corrected.' } : {}) };
    if (requestContracts?.contractFor(readTool) == null)
      return unavailable(`${readTool} is not registered for this session`, facts);
    const reads = [];
    if (members.length) {
      const capabilities = members.includes('requirements') ? inferredRequirementCapabilities(changes.requirements) : undefined;
      const readyRows = changes.ready_slices;
      const readyModes = Array.isArray(readyRows) && readyRows.length && readyRows.every(row =>
        row && typeof row === 'object' && (Object.hasOwn(row, 'key') !== Object.hasOwn(row, 'id')))
        ? [...new Set(readyRows.map(row => Object.hasOwn(row, 'key') ? 'create' : 'update'))] : null;
      const options = capabilities === null || (members.includes('ready_slices') && readyModes === null)
        ? { view: 'choices' } : { ...(capabilities !== undefined || readyModes !== null ? { branches: {
          ...(capabilities === undefined ? {} : { requirements: capabilities }),
          ...(readyModes === null ? {} : { ready_slices: readyModes }) } } : {}) };
      reads.push({ subject: unit, select: { input_contract: { tool: saveTool, members, ...options } },
        ...(typeof revision === 'string' && revision.length ? {} : { for_changes: members }) });
    }
    if (!(typeof revision === 'string' && revision.length) && intended.length && !members.length)
      reads.push({ subject: unit, for_changes: intended });
    if (needsDiscovery) reads.push({ subject: unit,
      select: { input_contract: { tool: saveTool, members: source.members, view: 'choices' } } });
    const offered = [];
    for (const read of reads) if (await accepted({ reads: [read] })) offered.push(read);
    const purpose = needsDiscovery
      ? 'Discover supported members and the recognized fields; caller choices remain unresolved. Reads change nothing.'
      : 'The accepted grammar and any missing current write context for this unit; caller values remain to be chosen.';
    const calls = offered.length === 0 ? [] : await accepted({ reads: offered })
      ? [buildNextCall({ tool: readTool, arguments: { reads: offered }, purpose })]
      : offered.map(read => buildNextCall({ tool: readTool, arguments: { reads: [read] }, purpose }));
    return { calls, ...facts, ...(offered.length === reads.length ? {} : { unavailable: { state: 'unavailable',
      reason: `this session's ${readTool} does not accept the needed input_contract or authoring-context selection for this subject` } }) };
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
