import { summarizeLoadedWorkRecord } from "@agent-chassis/wiki-core/src/operations/work-record-summary.mjs";
import { parseWorkRecordSummaryUnit } from "@agent-chassis/wiki-core/src/lib/work-record-summary.mjs";
import { ORDINARY_READ_FIELDS } from
  "@agent-chassis/wiki-core/src/lib/work-record-ordinary-field-read.mjs";
import {
  WORK_RECORD_AMBIGUITY_MAX_CHOICES,
  WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES,
  WORK_RECORD_SELECTION_MAX_UTF8_BYTES,
  isUnicodeScalarString
} from "@agent-chassis/wiki-core/src/lib/work-record-entry-schema.mjs";
import { buildNextCall } from "./mcp-response.mjs";
import { projectLoadedRecordContractFields, projectLoadedSliceEnumeration,
  SUMMARY_TOOL_FAMILY, responseSizeMetadata } from "./work-record-compact-read-continuation.mjs";
import { projectLeanOrdinaryFieldPage } from "./work-record-read-navigation.mjs";
import { declareRequestConstraints } from "./zod-request-constraint-declarations.mjs";

const TASK_MEMBERS = Object.freeze(["text", "index", "status"]);
const SELECTION_SCALAR_STATEMENT = "Expected Unicode scalar text";
const SELECTION_BYTES_STATEMENT =
  `Selection must be at most ${WORK_RECORD_SELECTION_MAX_UTF8_BYTES} UTF-8 bytes`;

function ordinaryFieldReadNodes(z) {
  const scalarText = declareRequestConstraints(
    z.string().min(1).refine(isUnicodeScalarString, SELECTION_SCALAR_STATEMENT),
    [{ constraint: "unicode_scalar_string", statement: SELECTION_SCALAR_STATEMENT }]
  );
  const selectionText = declareRequestConstraints(
    scalarText.refine(value => Buffer.byteLength(value, "utf8") <= WORK_RECORD_SELECTION_MAX_UTF8_BYTES,
      SELECTION_BYTES_STATEMENT),
    [{ constraint: "max_bytes", maximum_bytes: WORK_RECORD_SELECTION_MAX_UTF8_BYTES,
      measurement: "utf8_bytes", statement: SELECTION_BYTES_STATEMENT }]
  );
  return {
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive(),
    limit: z.number().int().positive(),
    index: z.number().int().nonnegative(),
    text: z.string().trim().min(1),
    reference_only: z.boolean(),
    selection: z.object({
      text: selectionText,
      occurrence: z.number().int().nonnegative().optional(),
      choice_limit: z.number().int().positive().max(WORK_RECORD_AMBIGUITY_MAX_CHOICES).optional()
    }).strict()
  };
}

export function ordinaryFieldReadSchema(z) {
  const node = ordinaryFieldReadNodes(z);
  const range = { offset: node.offset.optional(), length: node.length.optional() };
  const textOptions = { ...range, reference_only: node.reference_only.optional(),
    selection: node.selection.optional() };
  const taskField = "sections.tasks";
  const scalarFields = ORDINARY_READ_FIELDS.filter((field) => field !== taskField);
  const [textMember, ...scalarMembers] = TASK_MEMBERS;
  const variants = [
    ...scalarFields.map((field) =>
      z.object({ field: z.literal(field), ...textOptions }).strict()),
    z.object({ field: z.literal(taskField), offset: range.offset, limit: node.limit.optional() }).strict(),
    z.object({ field: z.literal(taskField), all: z.literal(true) }).strict()
  ];
  for (const selector of ["index", "text"]) {
    variants.push(z.object({ field: z.literal(taskField), [selector]: node[selector],
      member: z.literal(textMember), ...textOptions }).strict());
    variants.push(z.object({ field: z.literal(taskField), [selector]: node[selector],
      member: z.enum(scalarMembers).optional() }).strict());
  }
  return z.union(variants);
}

export function ordinaryFieldReadAdvertisedSchema(z) {
  const node = ordinaryFieldReadNodes(z);
  return z.object({
    field: z.enum(ORDINARY_READ_FIELDS),
    offset: node.offset.optional(),
    length: node.length.optional(),
    limit: node.limit.optional(),
    all: z.literal(true).optional(),
    index: node.index.optional(),
    text: node.text.optional(),
    member: z.enum(TASK_MEMBERS).optional(),
    reference_only: node.reference_only.optional(),
    selection: node.selection.optional()
  }).strict();
}

export function ordinaryRecoveryCall(args) {
  const identity = Object.fromEntries(["repo", "id", "unit", "path"].filter(key => args[key] !== undefined).map(key => [key, args[key]]));
  const field = args.ordinary_field?.field ?? args.field;
  const restarted = { ...identity, ordinary_field: field === "sections.tasks"
    ? { field, offset: 0 } : { field } };
  if (args.selected_record === true) restarted.selected_record = true;
  if (["slice_offset", "slice_limit", "slice_status"].some(key => Object.hasOwn(args, key))) {
    restarted.slice_offset = 0;
    for (const key of ["slice_limit", "slice_status"]) if (args[key] !== undefined) restarted[key] = args[key];
  }
  return buildNextCall({ tool: SUMMARY_TOOL_FAMILY, arguments: restarted, recommended: true });
}

export async function runOrdinaryFieldRead({ workspaceDir, workspaceRepo, recordId, args, selector, readWorkRecordById }) {
  const loaded = await readWorkRecordById({ dir: workspaceDir, id: recordId });
  const projectOrdinary = ordinaryField => summarizeLoadedWorkRecord({
    loaded,
    parsedUnit: parseWorkRecordSummaryUnit(args.unit ?? recordId),
    ordinary_field: ordinaryField,
    expected_source_digest: args.expected_source_digest ?? null,
    repository: workspaceRepo
  });
  let result = await projectOrdinary(args.ordinary_field);
  if (!result.valid) {
    if (result.diagnostics.some(issue => issue.code === "stale_source_digest")) {

      if (selector.slice_page) result = { ...projectLoadedSliceEnumeration({ toolFamily: SUMMARY_TOOL_FAMILY,
        recordId, loaded, request: selector.slice_page }), ...result };
      result.next_calls = [ordinaryRecoveryCall(args)];
    } else if (result.ordinary_field?.selection?.state === "ambiguous") {
      const choices = result.ordinary_field.selection.choices;
      result.next_calls = choices.map(choice => {
        const selectedRange = {
          ...args.ordinary_field,
          offset: choice.offset,
          length: choice.length,
          reference_only: true
        };
        delete selectedRange.selection;
        return buildNextCall({
          tool: SUMMARY_TOOL_FAMILY,
          arguments: {
            ...args,
            ordinary_field: selectedRange,
            expected_source_digest: result.source_digest
          },
          recommended: choice.occurrence === 0
        });
      });
      while (serializedProductBytes(workspaceRepo, result) >
          WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES && choices.length > 1) {
        choices.pop();
        result.next_calls.pop();
        result.ordinary_field.selection.returned_count = choices.length;
        result.ordinary_field.selection.has_more = true;
      }
      if (!compactProductFits(workspaceRepo, result)) {
        result = compactResultTooLarge({ workspaceRepo, result, args });
      }
    } else {
      result.next_calls = [];
    }
    return withResponseSize(workspaceRepo, result);
  }
  result = composeOrdinarySuccess({ result, args, selector, recordId, loaded });

  const lean = !selector.selected_record && !selector.slice_page && reusableTextResult(result);
  const fits = candidate => lean
    ? leanPageFits(candidate)
    : compactProductFits(workspaceRepo, candidate);
  const finish = candidate => lean && candidate.valid
    ? projectLeanOrdinaryFieldPage(candidate)
    : withResponseSize(workspaceRepo, candidate);
  if (!reusableTextResult(result) || result.ordinary_field.body_included === true || fits(result)) {
    return finish(result);
  }

  const fitted = await fitReusableTextSuccess({
    initialResult: result,
    args,
    selector,
    recordId,
    loaded,
    projectOrdinary,
    fits
  });
  return finish(fitted ?? compactResultTooLarge({ workspaceRepo, result, args }));
}

function reusableTextResult(result) {
  return typeof result?.ordinary_field?.reference === "string" ||
    result?.ordinary_field?.selection !== undefined;
}

function composeOrdinarySuccess({ result, args, selector, recordId, loaded,
  sliceRowLimit = null, originalSliceRequestedLimit = null }) {
  const nextCalls = [];
  if (selector.selected_record) result = { ...projectLoadedRecordContractFields({
    toolFamily: SUMMARY_TOOL_FAMILY, recordId, loaded }), ...result };
  if (selector.slice_page) {
    const request = sliceRowLimit === null
      ? selector.slice_page
      : { ...selector.slice_page, limit: sliceRowLimit };
    const pageResult = projectLoadedSliceEnumeration({ toolFamily: SUMMARY_TOOL_FAMILY,
      recordId, loaded, request });
    if (sliceRowLimit !== null && pageResult.slice_page) {
      pageResult.slice_page = {
        ...pageResult.slice_page,
        requested_limit: originalSliceRequestedLimit,
        limit_clamped: true,
        limit_clamp_reason: "response_size_class"
      };
    }
    result = { ...pageResult, ...result };
    for (const call of pageResult.next_calls) {
      nextCalls.push(buildNextCall({ tool: SUMMARY_TOOL_FAMILY,
        arguments: { ...args, slice_offset: call.arguments.slice_offset,
          expected_source_digest: result.source_digest }, recommended: true }));
    }
  }
  if (result.ordinary_field.has_more) {
    nextCalls.push(buildNextCall({ tool: SUMMARY_TOOL_FAMILY, arguments: {
      ...args, ordinary_field: { ...args.ordinary_field, offset: result.ordinary_field.next_offset },
      expected_source_digest: result.source_digest }, recommended: true }));
  }
  result.next_calls = nextCalls;
  return result;
}

async function fitReusableTextSuccess({ initialResult, args, selector,
  recordId, loaded, projectOrdinary, fits }) {
  const initialSliceCount = selector.slice_page ? initialResult.slice_page?.returned ?? 0 : null;
  const originalSliceRequestedLimit = selector.slice_page
    ? initialResult.slice_page?.requested_limit ?? selector.slice_page.limit
    : null;
  const sliceCounts = initialSliceCount === null
    ? [null]
    : initialSliceCount === 0
      ? [0]
      : Array.from({ length: initialSliceCount }, (_, index) => initialSliceCount - index);

  for (const sliceCount of sliceCounts) {
    const fitted = composeOrdinarySuccess({
      result: await projectOrdinary(args.ordinary_field),
      args,
      selector,
      recordId,
      loaded,
      sliceRowLimit: sliceCount !== null && sliceCount !== initialSliceCount ? sliceCount : null,
      originalSliceRequestedLimit
    });
    if (fits(fitted)) return fitted;
  }
  return null;
}

function compactResultTooLarge({ workspaceRepo, result, args }) {
  const nextCalls = [];
  const identity = Object.fromEntries(["repo", "id", "unit", "path"]
    .filter(key => args[key] !== undefined).map(key => [key, args[key]]));
  nextCalls.push(buildNextCall({
    tool: SUMMARY_TOOL_FAMILY,
    arguments: { ...identity, ordinary_field: args.ordinary_field,
      expected_source_digest: result.source_digest },
    recommended: true
  }));
  if (args.selected_record === true) {
    nextCalls.push(buildNextCall({ tool: SUMMARY_TOOL_FAMILY,
      arguments: { ...identity, selected_record: true }, recommended: false }));
  } else if (["slice_offset", "slice_limit", "slice_status"].some(key => Object.hasOwn(args, key))) {
    const sliceArguments = { ...identity, slice_offset: args.slice_offset ?? 0,
      expected_source_digest: result.source_digest };
    for (const key of ["slice_limit", "slice_status"]) {
      if (args[key] !== undefined) sliceArguments[key] = args[key];
    }
    nextCalls.push(buildNextCall({ tool: SUMMARY_TOOL_FAMILY,
      arguments: sliceArguments, recommended: false }));
  }
  const refusal = {
    record_id: result.record_id,
    selected_unit: result.selected_unit,
    source_digest: result.source_digest,
    valid: false,
    ordinary_field: null,
    diagnostics: [{
      code: "ordinary_field_compact_result_too_large",
      severity: "error",
      authority_limb: "mechanical",
      message: `The ordinary-field result cannot fit ${WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES} UTF-8 bytes without losing required metadata`,
      path: "ordinary_field"
    }],
    next_calls: nextCalls
  };

  if (!compactProductFits(workspaceRepo, refusal)) refusal.next_calls = [];
  return refusal;
}

function leanPageFits(result) {
  return Buffer.byteLength(JSON.stringify(projectLeanOrdinaryFieldPage(result)), "utf8") <=
    WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES;
}

function compactProductFits(workspaceRepo, result) {
  return serializedProductBytes(workspaceRepo, result) <=
    WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES;
}

function serializedProductBytes(workspaceRepo, result) {
  const product = { workspaceRepo, ...result };
  return responseSizeMetadata({
    ...product,
    response_size: responseSizeMetadata(product)
  }).bytes;
}

function withResponseSize(workspaceRepo, result) {
  return {
    ...result,
    response_size: responseSizeMetadata({ workspaceRepo, ...result })
  };
}
