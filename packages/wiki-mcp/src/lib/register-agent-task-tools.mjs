import { DEFAULT_EXCEPTION_PUBLICATION } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";
import { ORCHESTRATOR_GUIDANCE_ARTIFACTS } from "@agent-chassis/agent-launch-core/src/lib/orchestrator-guidance-generation.mjs";
import { registerFeedbackTools } from "./feedback-tools.mjs";

import { readFileSync } from "node:fs";
import { z } from "zod";
import { generateAndLint, validateWorkRecordDispatch } from "@agent-chassis/wiki-core";
import { validateWorkRecordDispatchLaunchIntentById, revalidateWorkRecordDispatchPrivateHandoffById } from
  "@agent-chassis/wiki-core/src/lib/work-record-dispatch.mjs";
import { refreshWorkRecordAdmissionDerivedEvidenceById } from
  "@agent-chassis/wiki-core/src/operations/work-records-admission-evidence.mjs";
import { generateAndPersistWorkRecordGraphImpactByUnit } from
  "@agent-chassis/wiki-core/src/operations/work-record-graph-impact-generate.mjs";
import { SESSION_ROLE_TOOL_ACCESS_POLICY_PATH } from "@agent-chassis/wiki-core/src/lib/tool-discovery/gating.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { registerReadWikiTools } from "./task-read-wiki.mjs";
import { createWorkspaceReadRepoResolver } from "./wiki-core-tools.mjs";
import { registerCreateRecordTools } from "./task-create-record.mjs";
import { registerSaveRecordTools } from "./task-save-record-tools.mjs";
import { registerContractAssessmentTool } from "./task-assess-contract-tools.mjs";
import { registerFindProofsTool } from "./proof-discovery-tools.mjs";
import { registerStartAgentTool } from "./task-start-agent-tools.mjs";
import { createGetRunResultTask, GET_RUN_RESULT_RETAINED_INPUT_SCHEMA,
  GET_RUN_RESULT_RECORDED_INPUT_SCHEMA, GET_RUN_RESULT_COORDINATOR_RECORDED_INPUT_SCHEMA,
  GET_RUN_RESULT_COORDINATOR_OUTCOME_INPUT_SCHEMA } from "./task-get-run-result.mjs";
import { GET_RUN_RESULT_LIVE_INPUT_SCHEMA, GET_RUN_RESULT_ASSIGNED_INPUT_SCHEMA, GET_RUN_RESULT_INVENTORY_INPUT_SCHEMA } from "./task-get-run-result-observation.mjs";
import { registerIntegrateWorkTools } from "./task-integrate-work-tools.mjs";
import { registerVerifyProofTask } from "./task-verify-proof.mjs";
import { createRequestAssignmentChangeSurface } from "./task-request-assignment-change.mjs";
import { createDeliverWorkSurface } from "./task-deliver-work.mjs";
import { registerCandidateInspectionTool } from "./task-inspect-candidate.mjs";
import { registerCandidateAdvanceTool } from "./task-advance-candidate.mjs";
import { registerPublishWorkTool } from "./task-publish-work.mjs";
import { registerCheckLandingTool } from "./dispatch-tools/landing-status-route.mjs";
import { registerToolDocReadTools } from "./tool-doc-read-tools.mjs";
import { bindRegisteredToolRequestContracts, registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
import { bindActiveRegisteredToolNames, recordOwnerRegisteredRequestSchema,
  requestSchemaAuthorityForRegistration } from "./dispatch-tool-helpers.mjs";
import { isAuthenticatedLauncherNoCceAuthorityCapability } from "./launcher-no-cce-authority.mjs";
import { shouldExposeTool } from "./tool-profile.mjs";
import { guardToolHandler } from "./mcp-response.mjs";
import { selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";
import { projectToolInputValidationFailure } from "./register-tool.mjs";

export function registerAgentTaskTools({ registerTool, workspaceRepos, resolveWorkspaceRepo,
  jsonContent, errorContent, sessionRole, sessionEnv, responseEnv, registeredTier, exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION,
  dispatchBackend, dispatchSessionIdentity, wkForgeHandoffAdapter, wkLandingStatusAdapter,
  launcherNoCceAuthorityCapability, registeredToolNames, packageDocsCarrier = null, docsCarrier, verifyProofDeps = {}, assignmentChangeTermination = null }) {
  const workspace = Object.freeze(resolveWorkspaceRepo(workspaceRepos));
  const host = { workspace, z, sessionEnv, responseEnv };
  const requestContracts = registeredToolRequestContracts(registerTool);
  const servingRegistrar = registerTool;
  registerTool = (name, config, handler) => servingRegistrar(name, {
    ...config,
    advertisedInputSchema: config.advertisedInputSchema ?? config.inputSchema,
    inputValidationErrorProjector: config.inputValidationErrorProjector ?? (async ({ args, validationError }) => ({
      terminal_result: { ...jsonContent(await projectToolInputValidationFailure({ tool: name, args,
        validationError }),
      { env: responseEnv }), isError: true }
    }))
  }, handler);
  bindRegisteredToolRequestContracts(registerTool, { lookup: requestContracts });
  bindActiveRegisteredToolNames(registerTool, registeredToolNames);
  const authority = requestSchemaAuthorityForRegistration(registerTool);
  const granted = name => shouldExposeTool(sessionRole, name);
  const bind = fn => fn({ registerTool, ...host });
  registerFeedbackTools({ registerTool, ...host, sessionRole, packageDocsCarrier, docsCarrier });
  const policy = JSON.parse(readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8"));
  const assessment = granted("workspace_assess_contract") ? registerContractAssessmentTool({ registerTool, ...host, registeredTier }) : null;

  const authoring = { registerTool, ...host, registeredTier, exceptionPublication, assessment, generateAndLint,
    resolveRetainedFindingsSource: dispatchBackend?.resolveRetainedFindingsSource, dispatchSessionIdentity };
  const create = granted("workspace_create_record") ? registerCreateRecordTools(authoring) : null;

  let read = null;
  const save = granted("save_record") ? registerSaveRecordTools({ ...authoring,
    acquireSavedUnitReference: unit => read.acquireSavedUnitReference(unit) }) : null;

  const selectedGuidance = new Set(ORCHESTRATOR_GUIDANCE_ARTIFACTS.filter(artifact => artifact.registeredTier === registeredTier && exceptionPublication.guidance(artifact)).map(artifact => artifact.path));
  const allGuidance = new Set(ORCHESTRATOR_GUIDANCE_ARTIFACTS.map(artifact => artifact.path));
  const augmentDescriptor = descriptor => ({ ...descriptor, tools: descriptor.tools.map(tool => ({ ...tool,
    docs_refs: (tool.docs_refs ?? []).filter(reference => exceptionPublication.document(reference) && reference !== "docs/tool-discovery-tiers.md" &&
      (registeredTier === "paid_cce" || reference !== "docs/mcp-controlled-contract-operations.md") &&
      (!allGuidance.has(reference) || selectedGuidance.has(reference))) })) });
  const { readAdvertisedDoc } = registerToolDocReadTools({ registerTool: () => undefined,
    z, jsonContent, errorContent, docsCarrier, sessionRole, registeredTier, augmentDescriptor });
  const originalCall = source => ({ tool: "workspace_read_wiki", arguments: { reference: source } });
  let inspection, advance, publication, landing;
  read = registerReadWikiTools({ registerTool, workspaceRepos, z, jsonContent, errorContent,
    resolveWorkspaceRepo, resolveWorkspaceReadRepo: createWorkspaceReadRepoResolver({ workspaceRepos, resolveWorkspaceRepo }),
    sessionRole, registeredTier, exceptionPublication, policy, env: { ...sessionEnv, ...responseEnv }, readPackageDocument: readAdvertisedDoc,
    readOriginalReference: async ({ args, source, binding }) => {
      if (args.select !== undefined || args.reference.finding_id !== undefined) return null;
      switch (binding.route) {
        case "workspace_save_record": return save?.readOriginal(source) ?? null;
        case "workspace_create_record": return create?.readOriginal(source) ?? null;
        case "workspace_inspect_candidate": return inspection?.readOriginal({ subject: binding.unit, source }) ?? null;
        case "workspace_advance_candidate": return advance?.readOriginal({ subject: binding.unit, source }) ?? null;
        case "workspace_publish_work": return publication?.readOriginal({ subject: binding.unit, source }) ?? null;
        case "workspace_check_landing": return landing?.readOriginal({ subject: binding.unit, source }) ?? null;
        default: return null;
      }
    } });
  if (registeredToolNames.has(read.name)) recordOwnerRegisteredRequestSchema({ registerTool,
    toolName: read.name, declaredInput: read.config.inputSchema._def.schema });
  const originalOwner = { ownerCall: originalCall,
    ownerRequestSchema: selectedResponseRequestSchema(read.config.inputSchema._def.schema) };
  if (granted("workspace_find_proofs")) registerFindProofsTool({ defineTool: registerTool,
    ...host, jsonContent, errorContent });
  if (granted("get_run_result")) {
    const task = createGetRunResultTask({ ...host, requestContracts, receivingRole: sessionRole,
      preparedDispatchBackend: dispatchBackend, dispatchSessionIdentity });
    const variants = [GET_RUN_RESULT_RETAINED_INPUT_SCHEMA, GET_RUN_RESULT_RECORDED_INPUT_SCHEMA,
      GET_RUN_RESULT_LIVE_INPUT_SCHEMA, GET_RUN_RESULT_ASSIGNED_INPUT_SCHEMA,
      GET_RUN_RESULT_INVENTORY_INPUT_SCHEMA, GET_RUN_RESULT_COORDINATOR_RECORDED_INPUT_SCHEMA,
      GET_RUN_RESULT_COORDINATOR_OUTCOME_INPUT_SCHEMA];

    const advertised = z.object(Object.assign({}, ...variants.map(schema => Object.fromEntries(
      Object.entries(schema.shape).map(([key, value]) => [key, value.optional()]))),
      { detail: GET_RUN_RESULT_RETAINED_INPUT_SCHEMA.shape.detail })).strict();

    recordOwnerRegisteredRequestSchema({ registerTool, toolName: "get_run_result", declaredInput: advertised });
    registerTool("get_run_result", { description: "Observe a known subject/attempt (optional bounded wait), " +
      "read your assigned attempt, or read one authenticated result/recorded invocation. " +
      "Choose one published request alternative; optional fields belong only to that alternative. " +
      "Subject observation and recorded-attempt reads require an orchestrator; assigned reads require the authenticated worker. " +
      "Retained reads preserve producer role restrictions. Use returned result and invocation references unchanged. Reads launch, rerun and integrate nothing.",
      inputSchema: z.union(variants), advertisedInputSchema: advertised,

      publishedInputSchemaProjection: converted => ({ ...converted, not: { not: { anyOf: variants.map(schema => ({
        required: Object.entries(schema.shape).filter(([, value]) => !value.isOptional()).map(([key]) => key),
        properties: Object.fromEntries([
          ...Object.keys(advertised.shape).filter(key => !Object.hasOwn(schema.shape, key)).map(key => [key, false]),
          ...(schema.shape.detail?.shape?.member?._def.typeName === "ZodLiteral"
            ? [["detail", { properties: { member: { const: schema.shape.detail.shape.member.value } } }]] : [])
        ])
      })) } } }),
      inputValidationErrorProjector: async ({ args, validationError }) => {
        const schema = Object.hasOwn(args, "result") ? variants[0]
          : Object.hasOwn(args, "recorded_invocation") ? (Object.hasOwn(args, "subject")
            ? Object.hasOwn(args, "detail") ? variants[6] : variants[5] : variants[1])
            : Object.hasOwn(args, "subject") && Object.hasOwn(args, "detail") ? variants[4]
            : Object.keys(variants[2].shape).some(key => Object.hasOwn(args, key)) ? variants[2] : variants[3];
        const parsed = schema.safeParse(args);
        const issues = parsed.success ? validationError.issues : parsed.error.issues;
        const mixed = issues.some(issue => issue.code === "unrecognized_keys" && issue.path.length === 0 &&
          issue.keys.some(key => Object.hasOwn(advertised.shape, key)));
        const failure = await projectToolInputValidationFailure({ tool: "get_run_result", args,
          validationError: parsed.success ? validationError : parsed.error });
        return { terminal_result: { ...jsonContent(mixed ? { ...failure, next_calls: [],
          correction: "Choose exactly one result, recorded invocation or observation selector." } : failure,
        { env: responseEnv }), isError: true } };
      } }, guardToolHandler(async args => {
      const value = await (args.result !== undefined ? task.deliverRetained(args)
        : args.subject !== undefined && (args.detail !== undefined || args.recorded_invocation !== undefined) ? task.coordinator(args)
          : args.recorded_invocation !== undefined ? task.deliverRecorded(args)
          : task.observe(args).then(observation => task.deliverObservation(observation, args)));

      return args.result !== undefined || args.recorded_invocation === undefined || args.subject === undefined || args.detail !== undefined || (args.subject !== undefined && args.proof !== undefined)
        ? value : jsonContent(value, { env: responseEnv });
    }, { env: responseEnv }));
  }
  if (granted("start_agent")) registerStartAgentTool({ registerTool, ...host, requestContracts,
    acquireSavedUnitReference: unit => read.acquireSavedUnitReference(unit),
    buildResultCall: argumentsValue => buildNextCall({ tool: "get_run_result", arguments: argumentsValue }),
    dispatchContext: { registerTool, registeredToolNames, dispatchBackend, dispatchSessionIdentity, registeredTier,
      launcherConfirmedNoCceAuthority: isAuthenticatedLauncherNoCceAuthorityCapability(launcherNoCceAuthorityCapability),

      validateDispatch: options => validateWorkRecordDispatch(options, { registeredTier }),
      validateLaunchIntent: validateWorkRecordDispatchLaunchIntentById,
      revalidatePrivateHandoff: revalidateWorkRecordDispatchPrivateHandoffById,
      generateGraphImpactEvidence: generateAndPersistWorkRecordGraphImpactByUnit,
      refreshAdmissionEvidence: refreshWorkRecordAdmissionDerivedEvidenceById,
      isPaidTier: registeredTier === "paid_cce" } });
  if (granted("integrate_work")) registerIntegrateWorkTools({ registerTool, ...host, preparedDispatchBackend: dispatchBackend });
  if (granted("verify_proof")) registerVerifyProofTask({ registerTool, ...host,
    jsonContent, errorContent, deps: verifyProofDeps, receivingRole: sessionRole });
  if (sessionRole === "worker" && granted("request_assignment_change")) {
    const task = createRequestAssignmentChangeSurface({ ...host, assignmentChangeTermination });
    registerTool("request_assignment_change", { description: "Request correction of missing or contradictory required paths, configuration, context, authority or instructions; do not work around missing required context. Use completed_work and remaining_work as the handoff, even with partial work. Acceptance immediately ends this worker: no final report or subsequent call. Refusals allow recovery only within existing authority; prior acceptance remains terminal. The coordinator decides revisions.",
      inputSchema: task.inputSchema,
      inputValidationErrorProjector: async ({ args, validationError }) => ({ terminal_result: {
        ...jsonContent(await task.inputFailure(args, validationError), { env: responseEnv }), isError: true
      } }) }, guardToolHandler(async args => {

      const refusal = await task.prepare(args);
      return { ...jsonContent(refusal, { env: responseEnv }), isError: true };
    }, { env: responseEnv }));
  }
  if (granted("workspace_deliver_work")) {
    const task = createDeliverWorkSurface({ ...host, publicDelivery: true });
    registerTool("workspace_deliver_work", { description: "Commit and deliver the authenticated worker's assigned uncommitted changes, fulfilling the assignment's commit requirement. " +
      "Call before any separate Git commit. Empty request; commits only assigned paths and integrates nothing.", ...task.inputContract,
      inputValidationErrorProjector: async ({ args, validationError }) => ({ terminal_result: {
        ...jsonContent({ ...await projectToolInputValidationFailure({ tool: 'workspace_deliver_work', args, validationError }),
          next_calls: registeredToolNames.has('workspace_read_wiki') && sessionRole === 'worker'
            ? [buildNextCall({ tool: 'workspace_read_wiki', arguments: { assignment: true } })] : [],
          correction: "Delivery accepts an empty request for this authenticated assignment. The optional read inspects the launcher assignment when available. Explicitly resolve the rejected inputs before choosing to deliver; no corrected mutation was selected." }, { env: responseEnv }),
        isError: true } }) },
    guardToolHandler(async args => {
      const frame = await task.prepare(args);
      return task.deliver(frame);
    }, { env: responseEnv }));
  }
  const candidateHost = { registerTool, workspaceRepos, resolveWorkspaceRepo, jsonContent, errorContent,
    dispatchBackend, env: sessionEnv, responseEnv, requestSchemaAuthority: authority };
  if (granted("workspace_inspect_candidate")) inspection = registerCandidateInspectionTool({ ...candidateHost, ...originalOwner });
  if (granted("workspace_advance_candidate")) advance = registerCandidateAdvanceTool({ ...candidateHost, ...originalOwner });
  if (granted("workspace_publish_work")) publication = registerPublishWorkTool({ ...candidateHost,
    wkForgeHandoffAdapter, ...originalOwner });
  if (granted("workspace_check_landing")) landing = registerCheckLandingTool({ registerTool, ...host,
    env: sessionEnv, wkLandingStatusAdapter, requestSchemaAuthority: authority, ...originalOwner });
}
