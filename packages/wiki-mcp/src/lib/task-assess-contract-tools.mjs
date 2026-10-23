

import { createControlledContractRefusal } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/refusal.mjs";
import { CONTRACT_ASSESSMENT_ROUTE } from "./controlled-contract-query-context.mjs";
import { errorContent, jsonContent } from "./mcp-response.mjs";
import { projectToolInputValidationFailure } from "./register-tool.mjs";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
import { recordOwnerRegisteredRequestSchema } from "./dispatch-tool-helpers.mjs";
import { contractAssessmentCall, createContractAssessmentSurface } from "./task-assess-contract-surface.mjs";

function sliceFocusCorrection(args, inputSchema) {
  const { focus, ...rest } = args !== null && typeof args === "object" ? args : {};
  const digits = typeof focus === "string" ? /^slice-([0-9]+)$/u.exec(focus)?.[1] : undefined;
  if (digits === undefined || typeof rest.unit !== "string" || Object.hasOwn(rest, "original")) return {};
  const replacement = { ...rest, unit: `${rest.unit}#SLICE-${digits}` };
  if (!inputSchema.safeParse(replacement).success) return {};
  return { details: { correction: `focus selects a named contract of the unit and never a slice; '${focus}' is a ` +
    "reserved slice spelling. A slice is selected by unit. To assess that slice, send the returned call; it was not " +
    "run, the parent unit was not assessed, and the slice was not checked to exist." },
  nextCalls: [contractAssessmentCall(replacement)] };
}

async function initiativeUnitCorrection(args, contracts) {
  const keys = args !== null && typeof args === "object" ? Object.keys(args) : [];
  if (keys.length !== 1 || typeof args.unit !== "string" || !/^IN-[0-9]{4}$/u.test(args.unit)) return {};
  const lookup = { reads: [{ search: { inventory: true, where: { initiative: args.unit, kind: "issues" } } }] };
  const offered = await contracts?.contractFor("workspace_read_wiki")?.acceptsArguments(lookup) === true;
  const creation = contracts?.contractFor("workspace_create_record") != null
    ? "through workspace_create_record" : "that this session has no registered tool for";
  return { details: { correction: `'${args.unit}' is an initiative. Assessment requires a work-record identity ` +
    "(WK-NNNN) or a slice identity (WK-NNNN#SLICE-NNN) as unit and assesses no initiative. " + (offered
    ? "The returned read-only call lists that initiative's work records; it was not run, its results are passages " +
      "and several can belong to one work record. Select the work record matching your intent and assess that identity"
    : "This session registers no reader accepting a work-record lookup by initiative, so no call is returned. " +
      "Assess the work-record identity matching your intent") + "; none was selected, assessed or created. If no " +
    `work record matches, creating one is your explicit decision with your own authored inputs ${creation}; no ` +
    "creation call is returned." },
  nextCalls: offered ? [{ tool: "workspace_read_wiki", arguments: lookup }] : [] };
}

function diagnosisReadCorrection(args, inputSchema) {
  if (args === null || typeof args !== 'object' ||
      !['original', 'diagnoses', 'diagnosis', 'view'].some(key => Object.hasOwn(args, key))) return {};
  const details = { required_shape: 'Read chosen retained diagnoses with {original:{source,diagnoses:[{diagnosis_id,obligation_id?},...]}}. ' +
    'Use the returned source and diagnosis_id unchanged; obligation_id optionally restricts that entry. ' +
    'For the complete inventory use {original:{source,view:"diagnoses"}} instead. ' +
    'Top-level unit, focus and obligation_id must restate the original scope when supplied.',
  correction: 'Preserve the retained source and your chosen diagnoses. Supply missing choices explicitly; ' +
    'diagnoses is a nonempty ordered array, and view cannot be combined with it.' };
  const replacement = structuredClone(args);
  const original = replacement.original;
  if (original === null || typeof original !== 'object' || Array.isArray(original)) return { details };
  let changed = false;
  for (const key of ['diagnoses', 'view']) {
    if (!Object.hasOwn(replacement, key)) continue;
    if (Object.hasOwn(original, key)) return { details };
    original[key] = replacement[key];
    delete replacement[key];
    changed = true;
  }
  if (original.diagnoses !== null && typeof original.diagnoses === 'object' && !Array.isArray(original.diagnoses)) {
    original.diagnoses = [original.diagnoses];
    changed = true;
  }
  if (!changed || !inputSchema.safeParse(replacement).success) return { details };
  return { details: { ...details, correction: 'The returned call preserves your supplied source, selections and scope in the required shape. ' +
    'It was not run; the source and selections will be authenticated when called.' },
  nextCalls: [contractAssessmentCall(replacement)] };
}

export function registerContractAssessmentTool({ registerTool, z, workspace,
  sessionEnv = process.env, responseEnv = process.env, sourceDeps = {}, assessmentDeps = {}, registeredTier }) {
  const surface = createContractAssessmentSurface({ workspace, z, sessionEnv, responseEnv, sourceDeps, assessmentDeps, registeredTier,
    requestContracts: () => registeredToolRequestContracts(registerTool) });
  registerTool(CONTRACT_ASSESSMENT_ROUTE, {
    description: "Assess one saved contract by unit, or read an authenticated original by its source locator. " +
      "Distinguishes missing meaning, invalid authored input and unavailable validation. " +
      "Follow returned diagnosis and correction calls. Executes and credits no proofs.",
    ...surface.inputContract,

    inputValidationErrorProjector: async ({ args, validationError }) => {
      const guidance = { ...diagnosisReadCorrection(args, surface.inputContract.inputSchema),
        ...sliceFocusCorrection(args, surface.inputContract.inputSchema),
        ...await initiativeUnitCorrection(args, registeredToolRequestContracts(registerTool)) };
      const failure = await projectToolInputValidationFailure({ tool: CONTRACT_ASSESSMENT_ROUTE, args, validationError,
        inputSchema: surface.inputContract.inputSchema,
        ownerGuidance: guidance.details ?? null,
        notEvaluated: [{ path: [], cause: 'The rejected request was not run: no assessment, canonical write or proof execution occurred.' }] });

      return { terminal_result: { ...jsonContent({ ...failure, next_calls: guidance.nextCalls ?? [] }, { env: responseEnv }), isError: true } };
    }
  }, async (request) => {
    try {
      return await surface.respond(request);
    } catch (error) {

      const choices = error?.details?.choices;
      if (error?.details?.failed_condition === "original_and_current_selection_conflict") {
        error.details = { ...error.details, next_calls: Object.values(choices).map(contractAssessmentCall) };
      }
      return errorContent(error?.envelope ? error : createControlledContractRefusal(error), { env: responseEnv });
    }
  });
  recordOwnerRegisteredRequestSchema({ registerTool, toolName: CONTRACT_ASSESSMENT_ROUTE,
    declaredInput: surface.inputContract.inputSchema._def.schema });
  return surface;
}
