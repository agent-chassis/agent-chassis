

import { createControlledContractRefusal } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/refusal.mjs";
import { CONTRACT_ASSESSMENT_ROUTE } from "./controlled-contract-query-context.mjs";
import { errorContent } from "./mcp-response.mjs";
import { createToolInputValidationError } from "./register-tool.mjs";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
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
  const lookup = { search: { inventory: true, where: { initiative: args.unit, kind: "issues" } } };
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

export function registerContractAssessmentTool({ registerTool, z, workspace,
  sessionEnv = process.env, responseEnv = process.env, sourceDeps = {}, assessmentDeps = {} }) {
  const surface = createContractAssessmentSurface({ workspace, z, sessionEnv, responseEnv, sourceDeps, assessmentDeps });
  registerTool(CONTRACT_ASSESSMENT_ROUTE, {
    description: "Assess one saved contract by unit, or read an authenticated original by its source locator. " +
      "Reports semantic completeness separately from capability and source currentness. Executes and credits nothing. " +
      "Fresh assessment retains one noncanonical original; original reads retain nothing.",
    ...surface.inputContract,

    inputValidationErrorProjector: async ({ args, validationError }) => ({ terminal_result: errorContent(
      createToolInputValidationError({ tool: CONTRACT_ASSESSMENT_ROUTE, validationError,
        ...sliceFocusCorrection(args, surface.inputContract.inputSchema),
        ...await initiativeUnitCorrection(args, registeredToolRequestContracts(registerTool)) }), { env: responseEnv }) })
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
  return surface;
}
