

import { types as utilTypes } from "node:util";
import { z } from "zod";
import { createToolInputValidationError, MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import { isCanonicalNextCallTool, buildContinuationCall, buildGuidanceCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { buildPublicMechanicalRefusal } from "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";
import { projectAdvanceCandidateResponse, deliverAdvanceCandidateResponse } from "./task-advance-candidate-response.mjs";
import { activeMcpInlineByteLimit, measureMcpInlineResultBytes } from "./mcp-response.mjs";
import { createCandidateInspectionDelivery } from "./task-inspect-candidate-delivery.mjs";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
import { candidateInspectionSubjectCorrection } from "./task-inspect-candidate-response.mjs";
import {
  TERMINAL_WK_CANDIDATE_CODES,
  defaultTerminalCandidateRunGit
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  projectTerminalCandidateExclusionRefusal,
  TERMINAL_CANDIDATE_EXCLUSION_REFUSED_CODE
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-terminal-candidate-coordination.mjs";
import { captureDiagnosticEvidence } from
  "@agent-chassis/agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import { DISPATCH_BLOCKER_CODES } from "./dispatch-tool-constants.mjs";
import {
  projectDispatchFailureDetail,
  dispatchRepoResolutionRefusal,
  recordOwnerRegisteredRequestSchema,
  requestSchemaAuthorityForRegistration,
  ownedNoRouteRecovery
} from "./dispatch-tool-helpers.mjs";
import {
  advanceSelectedTerminalCandidate,
  projectTerminalCandidateAdvanceFailure,
  TERMINAL_CANDIDATE_RUNTIME_CODES,
  projectTerminalCandidateRuntimeFailure,
  projectTerminalCandidateAdvancePrimitiveFailure
} from "./dispatch-terminal-candidate-runtime.mjs";

export const ADVANCE_CANDIDATE_TOOL_NAME = "workspace_advance_candidate";
export const INSPECT_CANDIDATE_TOOL_NAME = "workspace_inspect_candidate";
export const ADVANCE_CANDIDATE_RESULT_SCHEMA_VERSION = "workspace-advance-candidate.v1";

const SUBJECT_RE = /^WK-[0-9]{4}$/u;
const VERSION_RE = /^[0-9a-f]{64}$/u;
const REQUEST_FIELDS = Object.freeze(["subject", "version"]);

export function createAdvanceCandidateInputSchema(z) {
  return z.object({
    subject: z.string().regex(SUBJECT_RE),
    version: z.string().regex(VERSION_RE)
  }).strict();
}

export const ADVANCE_CANDIDATE_INPUT_SCHEMA = createAdvanceCandidateInputSchema(z);

export function advanceRequest(request) {
  const facts = requestRefusalFacts(request);
  if (facts.parsed === null || !facts.wellformed || !facts.subject || !facts.version ||
      facts.unknown.length > 0) {
    throw new TypeError("candidate advance request requires exactly {subject, version}");
  }
  return Object.freeze({ tool: ADVANCE_CANDIDATE_TOOL_NAME,
    arguments: Object.freeze({ ...facts.parsed }),
    successPredicate: Object.freeze({ fact: "ok", operator: "is_true" }) });
}

const NOT_PERFORMED = Object.freeze({
  integration: false,
  tests: false,
  proofs: false,
  review_dispatch: false,
  publication: false,
  merge: false,
  completion: false
});

const NO_ADVANCE_GATE = Object.freeze({
  configured: false,
  explanation: "no advance gate is composed for this server; the outcome is mechanical " +
    "and is neither an approval nor an audit verdict"
});

function ownerFailure(error) {
  const runtime = projectTerminalCandidateRuntimeFailure(error);
  if (runtime !== null) return { ...runtime, primitive: false };
  const primitive = projectTerminalCandidateAdvancePrimitiveFailure(error);
  return primitive === null ? null : { ...primitive, primitive: true };
}

function requestRefusalFacts(args) {
  if (typeof args !== "object" || args === null || Array.isArray(args) || utilTypes.isProxy(args)) {
    return { wellformed: false, unknown: [], subject: false, version: false, parsed: null };
  }
  const descriptors = Object.getOwnPropertyDescriptors(args);
  const dataOnly = Reflect.ownKeys(descriptors).every(key => Object.hasOwn(descriptors[key], "value"));

  const parsed = dataOnly ? ADVANCE_CANDIDATE_INPUT_SCHEMA.safeParse({
    subject: descriptors.subject?.value, version: descriptors.version?.value
  }) : { success: false };
  return {
    wellformed: dataOnly,
    unknown: Reflect.ownKeys(args).filter(key => typeof key !== "string" || !REQUEST_FIELDS.includes(key)).map(String).sort(),
    subject: dataOnly && typeof descriptors.subject?.value === "string" && SUBJECT_RE.test(descriptors.subject.value),
    version: dataOnly && typeof descriptors.version?.value === "string" && VERSION_RE.test(descriptors.version.value),
    parsed: parsed.success ? parsed.data : null
  };
}

function inspectContinuation(callArguments, requestContracts, recommended) {
  if (!isCanonicalNextCallTool(INSPECT_CANDIDATE_TOOL_NAME)) return null;
  const contract = requestContracts?.contractFor(INSPECT_CANDIDATE_TOOL_NAME);
  if (contract == null) return null;
  if (!Object.hasOwn(callArguments, "version")) {
    return buildGuidanceCall({ tool: INSPECT_CANDIDATE_TOOL_NAME, arguments: callArguments,
      information: "Observe current candidate status, then explicitly choose advancement if intended. " +
        "Inspection does not authorize a mutation or replacement selection."
    }, { requestSchema: contract.publishedRequestSchema(), registeredTools: new Set([INSPECT_CANDIDATE_TOOL_NAME]) });
  }
  return buildContinuationCall({
    tool: INSPECT_CANDIDATE_TOOL_NAME,
    arguments: callArguments,
    recommended,
    success_predicate: {
      fact: "state", operator: "equals", value: "historical_version"
    }
  }, { requestSchema: contract.publishedRequestSchema() });
}

function candidateNextCalls({ subject, advancedVersion = null, requestContracts }) {
  return Object.freeze([
    advancedVersion === null ? null
      : inspectContinuation({ subject, version: advancedVersion }, requestContracts, false)
  ].filter((call) => call !== null));
}

const NO_INSPECTOR_EXPLANATION =
  "no callable current-inspection contract is available on this server; " +
  "its canonical descriptor and serving schema must both be registered";

function envelope({ ok, outcome, subject, version, members, nextCalls, nextCallsExplanation = null }) {
  return Object.freeze({
    ...(members.mechanical_refusal ?? {}),
    schema_version: ADVANCE_CANDIDATE_RESULT_SCHEMA_VERSION,
    ...(members.mechanical_refusal === undefined ? {} : {
      mechanical_refusal_schema_version: members.mechanical_refusal.schema_version
    }),
    ok,
    outcome,
    subject: Object.freeze({ unit: subject }),
    selection: Object.freeze({ version }),
    ...Object.fromEntries(Object.entries(members).filter(([key]) => key !== "mechanical_refusal")),
    gate: NO_ADVANCE_GATE,
    performed: NOT_PERFORMED,
    next_calls: nextCalls,
    ...(nextCalls.length === 0 ? { next_calls_explanation: subject === null
      ? "no valid WK subject was supplied for an inspection call"
      : nextCallsExplanation ?? NO_INSPECTOR_EXPLANATION } : {})
  });
}

function knownEffects(progress, owner) {
  if (progress === null) {
    return {
      git_objects: null, candidate_refs: null,
      explanation: "the failure carries no advance stage from the advance owner, so what it " +
        "left behind is not established"
    };
  }
  const derived = progress.derived_candidate;
  const gitObjects = derived !== null ? "candidate_derivation_completed"
    : progress.stage === "derivation" ? "derivation_incomplete_objects_possible" : "none_created";
  if (progress.ref_transaction_attempted === false) {
    return { git_objects: gitObjects, derived_candidate: derived,
      candidate_refs: "unchanged_no_transaction_attempted" };
  }
  const refEffects = owner?.primitive === true && owner.refEffects === "unchanged"
    ? "unchanged" : "uncertain";
  return {
    git_objects: gitObjects, derived_candidate: derived, candidate_refs: refEffects,
    ...(refEffects === "uncertain" ? {
      explanation: "the ref transaction was attempted and its re-observation did not establish " +
        "every participating ref at its prestate"
    } : {})
  };
}

function refusalRecovery({ code, exclusion, progress, effects, inspectAvailable = false }) {
  const reissue = "inspect the current selection, then decide whether to issue a new explicit advance " +
    "with that observed version; inspection does not authorize mutation of a replacement selection";
  if (progress?.stage === "request") {
    return ownedNoRouteRecovery({ responsibleActor: "operator",
      prerequisite: "the server-bound dispatch backend supplies candidate advance exclusion",
      missingComponent: "terminal_candidate_advance_exclusion",
      operatorAction: "compose the dispatch backend with this server's canonical repository root" });
  }
  if (code === TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT && (progress === null ||
      progress.stage === "request")) {
    return ownedNoRouteRecovery({
      responsibleActor: "caller_retry",
      prerequisite: "the request is exactly {subject, version}: one WK id (WK-####) and one " +
        "lowercase 64-hex immutable version identity",
      retryCondition: "obtain a real current version through available inspection, then " +
        "decide on a new explicit advance with exactly those two members"
    });
  }
  if (exclusion !== null) {
    if (exclusion.status_observation) {
      const observation = exclusion.observation;
      if (observation?.state === "candidate_absent") {
        return ownedNoRouteRecovery({ responsibleActor: null,
          prerequisite: "a candidate exists before selected-version advancement",
          missingComponent: "candidate_only_preparation",
          explanation: "No current candidate exists. Advance neither prepares a candidate nor publishes work; " +
            "the requested version was not authenticated." });
      }
      if (observation?.state === "candidate_identity_invalid_or_moved") {
        return ownedNoRouteRecovery({ responsibleActor: null,
          prerequisite: `the observed candidate condition is corrected: ${observation.cause}`,
          missingComponent: "candidate_condition_recovery",
          explanation: "The candidate observation is invalid. Correct the stated owner condition before advancement; " +
            "advance repairs no candidate or generation, and the requested version was not authenticated." });
      }
      return ownedNoRouteRecovery({
        responsibleActor: null,
        prerequisite: "the currently selected candidate is stale against the current W",
        explanation: observation?.state === "candidate_healthy"
          ? "The current candidate is healthy, so that selection needs no advancement. " +
            "The requested version was not authenticated; this refusal changed nothing."
          : "The exclusion did not establish a stale current candidate. The requested version " +
            "was not authenticated and nothing was advanced; no supported correction was established."
      });
    }
    return ownedNoRouteRecovery({
      responsibleActor: "operator",
      prerequisite: "the dispatch backend is composed with this server's canonical repository root",
      missingComponent: "terminal_candidate_advance_exclusion",
      operatorAction: "start this wiki-mcp server through the launcher so the dispatch backend " +
        "holds the per-WK authority exclusion for the bound repository"
    });
  }
  if (code === TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_GENERATION_ABSENT) {
    return ownedNoRouteRecovery({
      responsibleActor: "coordinator",
      prerequisite: "the current W persists its controlled-contract generation",
      missingComponent: "current_controlled_contract_generation",
      explanation: "advance never persists or repairs the generation"
    });
  }
  if (code === TERMINAL_CANDIDATE_RUNTIME_CODES.CANONICAL_ROOT_INVALID) {
    return ownedNoRouteRecovery({ responsibleActor: "operator",
      prerequisite: "the server and backend bind the same launcher-minted canonical repository root",
      missingComponent: "canonical_repository_root_binding",
      operatorAction: "correct the server's repository-root configuration before candidate observation" });
  }
  if (code === TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_INPUT_MOVED) {
    return ownedNoRouteRecovery({ responsibleActor: "caller_retry",
      prerequisite: "the explicitly selected source and target stay in place for advancement",
      missingComponent: inspectAvailable ? null : INSPECT_CANDIDATE_TOOL_NAME,
      retryCondition: reissue,
      explanation: "a selected input moved; inspection informs a new decision and repairs no generation" });
  }
  if (["generation_authentication", "final_recheck"].includes(progress?.stage)) {
    return ownedNoRouteRecovery({ responsibleActor: null,
      prerequisite: "the current controlled generation authenticates at the captured W and " +
        "agrees with the original complete generation",
      missingComponent: "authenticated_current_controlled_generation",
      explanation: "the generation owner's diagnosed condition must be corrected; " +
        "advance persists and repairs no generation" });
  }
  if (effects.candidate_refs === "uncertain" || effects.candidate_refs === null) {
    return ownedNoRouteRecovery({
      responsibleActor: "coordinator",
      prerequisite: "the current candidate selection and its immutable version are observed again",
      missingComponent: inspectAvailable ? null : INSPECT_CANDIDATE_TOOL_NAME,
      retryCondition: reissue,
      explanation: "what this request left behind is not established; nothing is retried or " +
        "replaced automatically"
    });
  }
  if (progress?.stage === "selection") {
    return ownedNoRouteRecovery({ responsibleActor: "caller_retry",
      prerequisite: "the requested immutable version authenticates as the current selection",
      missingComponent: inspectAvailable ? null : INSPECT_CANDIDATE_TOOL_NAME,
      retryCondition: reissue,
      explanation: "nothing is reselected, substituted or retried automatically" });
  }
  return ownedNoRouteRecovery({ responsibleActor: null,
    prerequisite: `the diagnosed ${progress?.stage ?? "advance"} owner operation completes`,
    explanation: "the captured cause establishes the failing boundary; it supplies no unchanged " +
      "retry or authority to substitute a candidate, base, W or generation" });
}

function selectionFact(selection) {
  const text = (value) => (typeof value === "string" ? value : null);
  return { version_identity: text(selection?.version_identity), candidate: text(selection?.candidate) };
}

function refusalGuidance({ subject, requestContracts, code, exclusion, progress, effects, facts }) {
  const inspectAvailable = subject !== null && isCanonicalNextCallTool(INSPECT_CANDIDATE_TOOL_NAME) &&
    requestContracts?.contractFor(INSPECT_CANDIDATE_TOOL_NAME) != null;
  const recovery = refusalRecovery({ code, exclusion, progress, effects,
    inspectAvailable });
  const decidingFacts = facts.map(([field, value]) => ({ field, value }));
  const observedFacts = Object.fromEntries(facts);
  const requestSchemas = tool => requestContracts?.contractFor(tool)?.publishedRequestSchema();
  const registeredTools = new Set(inspectAvailable ? [INSPECT_CANDIDATE_TOOL_NAME] : []);
  let mechanicalRefusal;
  if (inspectAvailable && recovery.retry_condition !== undefined) {
    const { state, ...correction } = recovery;
    const call = buildGuidanceCall({ tool: INSPECT_CANDIDATE_TOOL_NAME, arguments: { subject },
        information: "observe the current candidate selection before deciding on a new explicit " +
          "version request; inspection repairs nothing and grants no mutation authority"
    }, { requestSchema: requestSchemas(INSPECT_CANDIDATE_TOOL_NAME), registeredTools });
    mechanicalRefusal = buildPublicMechanicalRefusal({
      code, deciding_facts: decidingFacts, observed_facts: observedFacts, next_calls: [call],
      recovery: { state: "guidance", operation: call.tool, information: call.information,
        blocker_unchanged: true, ...correction, selected_from: facts.map(([field]) => field) },
      route: ADVANCE_CANDIDATE_TOOL_NAME, request_schemas: requestSchemas, registered_tools: registeredTools
    });
  } else {
    mechanicalRefusal = buildPublicMechanicalRefusal({
      code, deciding_facts: decidingFacts, observed_facts: observedFacts, no_supported_route: true, recovery,
      route: ADVANCE_CANDIDATE_TOOL_NAME, request_schemas: requestSchemas
    });
  }
  return { mechanicalRefusal, nextCalls: mechanicalRefusal.next_calls ?? Object.freeze([]),
    nextCallsExplanation: recovery.retry_condition === undefined
      ? "inspection supplies no repair for this owner condition; apply the stated cause-specific correction"
      : null };
}

function refused({ subject, version, error, requestContracts, responseEnv }) {
  const exclusion = projectTerminalCandidateExclusionRefusal(error);
  const owner = exclusion === null ? ownerFailure(error) : null;
  const progress = projectTerminalCandidateAdvanceFailure(error);
  const code = exclusion !== null ? TERMINAL_CANDIDATE_EXCLUSION_REFUSED_CODE
    : owner?.code ?? DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION;
  const effects = knownEffects(progress, owner);
  const indeterminate = effects.candidate_refs === "uncertain" || effects.candidate_refs === null;
  const selectionMismatch = owner?.code === TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_INPUT_MOVED &&
    owner.detail?.field === "selected_version" && progress?.stage === "selection";
  const facts = [
    ["advance_candidate.completed", false],
    ["advance_candidate.stage", progress?.stage ?? null],
    ["advance_candidate.owner_cause_authenticated", exclusion !== null || owner !== null],
    ...(exclusion === null ? [] : [["advance_candidate.exclusion_reason", exclusion.reason]]),
    ...(selectionMismatch ? [
      ["advance_candidate.expected_selection", selectionFact(owner.detail.expected)],
      ["advance_candidate.observed_selection", selectionFact(owner.detail.observed)]
    ] : []),
    ["advance_candidate.candidate_refs", effects.candidate_refs]
  ];
  const evidence = captureDiagnosticEvidence(error);
  const diagnostic = projectDispatchFailureDetail({ evidence }, { env: responseEnv, nested: true });
  const guidance = refusalGuidance({ subject, requestContracts,
    code, exclusion, progress, effects, facts });
  const { nextCalls } = guidance;
  const body = envelope({
    ok: false,
    outcome: indeterminate ? "indeterminate" : "refused",
    subject,
    version,
    members: {
      stage: progress?.stage ?? null,
      source: progress?.source ?? null,
      target: progress?.target ?? null,
      advanced: null,
      unestablished: Object.freeze({
        ...(progress?.source == null ? { source: "the requested version has not authenticated as the selected source" } : {}),
        ...(progress?.target == null ? { target: "no evaluator-owned stale target was acquired" } : {}),
        advanced: "no complete advanced version was confirmed by the publication owner"
      }),
      cause: Object.freeze({
        code,
        owner_authenticated: exclusion !== null || owner !== null,
        ...(exclusion === null ? {} : { exclusion_reason: exclusion.reason }),
        ...(exclusion?.observation === undefined ? {} : { observation: exclusion.observation }),
        ...(owner?.primitive === true ? { candidate_failure: owner.projection } : {}),
        ...diagnostic
      }),
      known_effects: Object.freeze(effects),
      mechanical_refusal: guidance.mechanicalRefusal
    },
    nextCalls,
    nextCallsExplanation: guidance.nextCallsExplanation
  });
  return body;
}

export async function runAdvanceCandidateTask({
  mainRepo,
  request,
  backend,
  requestContracts = null,
  responseEnv = process.env,
  runGit = defaultTerminalCandidateRunGit,
  dependencies = {}
} = {}) {
  const requestFacts = requestRefusalFacts(request);
  const subject = requestFacts.subject ? Object.getOwnPropertyDescriptor(request, "subject").value : null;
  const version = requestFacts.version ? Object.getOwnPropertyDescriptor(request, "version").value : null;
  if (!requestFacts.wellformed || requestFacts.unknown.length > 0 || subject === null ||
      version === null) {
    const facts = [
      ["advance_candidate.completed", false],
      ["advance_candidate.request_wellformed", requestFacts.wellformed],
      ["advance_candidate.subject_valid", requestFacts.subject],
      ["advance_candidate.version_valid", requestFacts.version],
      ["advance_candidate.unknown_request_fields", requestFacts.unknown]
    ];
    const guidance = refusalGuidance({ subject, requestContracts,
      code: TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, exclusion: null, progress: null,
      effects: {}, facts });
    return envelope({
      ok: false,
      outcome: "refused",
      subject,
      version,
      members: {
        stage: "request",
        source: null,
        target: null,
        advanced: null,
        unestablished: Object.freeze({ source: "invalid request", target: "invalid request",
          advanced: "the advance engine was not invoked" }),
        cause: Object.freeze({
          code: TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, owner_authenticated: false
        }),
        known_effects: Object.freeze({
          git_objects: "none_created", derived_candidate: null,
          candidate_refs: "unchanged_no_transaction_attempted"
        }),
        mechanical_refusal: guidance.mechanicalRefusal
      },
      nextCalls: guidance.nextCalls,
      nextCallsExplanation: guidance.nextCallsExplanation
    });
  }
  const advance = advanceSelectedTerminalCandidate;
  let advanced;
  try {
    advanced = await advance({ mainRepo, wkId: subject, version, backend, runGit, dependencies });
  } catch (error) {
    return refused({ subject, version, error, requestContracts, responseEnv });
  }
  const converged = advanced.selection_state === "converged";
  return envelope({
    ok: true,
    outcome: converged ? "converged" : "advanced",
    subject,
    version,
    members: {
      stage: "ref_publication",
      source: advanced.source,
      target: advanced.target,
      advanced: advanced.advanced,
      version_state: advanced.version_state,
      selection_state: advanced.selection_state,
      write_attribution: converged ? "not_established" : "this_request",
      ...(advanced.unconfirmed_publication === null ? {} : {
        unconfirmed_publication: projectDispatchFailureDetail({ evidence: advanced.unconfirmed_publication },
          { env: responseEnv, nested: true })
      }),
      ...(converged ? {
        write_attribution_explanation: "the complete matching version and selection were " +
          "observed after an unacknowledged ref transaction; which writer produced them is " +
          "not established"
      } : {})
    },
    nextCalls: candidateNextCalls({
      subject, advancedVersion: advanced.advanced.version_identity, requestContracts
    })
  });
}

export function registerCandidateAdvanceTool({
  registerTool, workspaceRepos, resolveWorkspaceRepo, jsonContent, errorContent,
  dispatchBackend = null, responseEnv = process.env, requestSchemaAuthority = null,
  env = process.env, ownerCall = null, ownerRequestSchema = null
}) {
  const authority = requestSchemaAuthority ?? requestSchemaAuthorityForRegistration(registerTool);
  const requestContracts = registeredToolRequestContracts(registerTool);
  const definition = {
    writeSemantics: MCP_WRITE_SEMANTICS.NONE,
    description: "Advance an explicitly selected stale WK candidate to the current accumulated WK state. " +
      "Use the exact version_identity returned by workspace_inspect_candidate as version. " +
      "Updates the candidate version and current selection. Finish on success or continue the intended task; " +
      "the returned exact-version inspection is optional. Advance performs no review, external publication or completion.",
    inputSchema: ADVANCE_CANDIDATE_INPUT_SCHEMA,
    advertisedInputSchema: ADVANCE_CANDIDATE_INPUT_SCHEMA,
    inputValidationErrorProjector: ({ args, validationError }) => {
      const facts = requestRefusalFacts(args);
      const values = facts.wellformed ? Object.fromEntries(REQUEST_FIELDS.filter(key => Object.hasOwn(args, key))
        .map(key => [key, Object.getOwnPropertyDescriptor(args, key).value])) : {};
      const correction = candidateInspectionSubjectCorrection(values, { requestSchemaAuthority: authority });
      const parent = correction?.details.subject_correction.parent_subject;
      const clean = facts.wellformed && facts.unknown.length === 0;
      let call = null;
      let instruction = "Resolve the rejected fields without dropping caller intent. " +
        "Advance requires a root WK subject and an explicitly selected immutable version; nothing was advanced.";
      if (clean && parent !== undefined && facts.version) {
        const contract = requestContracts?.contractFor(ADVANCE_CANDIDATE_TOOL_NAME);
        const corrected = advanceRequest({ subject: parent, version: values.version });
        if (contract != null) call = buildContinuationCall({ tool: corrected.tool, arguments: corrected.arguments,
          recommended: false, success_predicate: corrected.successPredicate },
        { requestSchema: contract.publishedRequestSchema() });
        instruction = "Candidates belong to the parent WK. Use the parent subject with the same selected version " +
          "if that is your intended advancement; nothing was advanced by this refusal.";
      } else if (clean && !Object.hasOwn(values, "version") && (facts.subject || parent !== undefined)) {
        call = inspectContinuation({ subject: parent ?? values.subject }, requestContracts, false);
        instruction = call === null
          ? "The required version was omitted and no candidate inspection call is available here. " +
            "Stop until an explicitly selected immutable version is available; nothing was advanced."
          : "The required version was omitted. Inspect current candidate status only if needed to select it, " +
            "then explicitly choose advancement; inspection chooses no mutation.";
      } else if (clean && Object.hasOwn(values, "version") && !facts.version) {
        instruction = "Correct the supplied version to its issued lowercase 64-hex immutable identity. " +
          "Do not substitute a current candidate for the intended selection; nothing was advanced.";
      }
      return { terminal_result: errorContent(createToolInputValidationError({
        tool: ADVANCE_CANDIDATE_TOOL_NAME, validationError,
        details: { ...correction?.details, correction: instruction }, nextCalls: call === null ? [] : [call]
      })) };
    }
  };
  const registration = registerTool(ADVANCE_CANDIDATE_TOOL_NAME, definition, async args => {
    let workspace;
    try { workspace = resolveWorkspaceRepo(workspaceRepos, undefined); }
    catch (error) {
      const refusal = dispatchRepoResolutionRefusal(ADVANCE_CANDIDATE_TOOL_NAME, error);
      return refusal === null ? errorContent(error) : jsonContent(refusal.refusal);
    }
    const internal = await runAdvanceCandidateTask({ mainRepo: workspace.dir, request: args,
      backend: dispatchBackend, requestContracts, responseEnv });
    const body = projectAdvanceCandidateResponse(internal);
    if (measureMcpInlineResultBytes(body) <= activeMcpInlineByteLimit(responseEnv)) return jsonContent(body, { env: responseEnv });
    return deliverAdvanceCandidateResponse({ body, workspace, env, responseEnv, ownerCall, ownerRequestSchema });
  });

  const contracts = registeredToolRequestContracts(registerTool);
  if ((contracts !== null && contracts.contractFor(ADVANCE_CANDIDATE_TOOL_NAME) !== null) ||
      (registration !== undefined && registration !== null)) {
    recordOwnerRegisteredRequestSchema({ registerTool, toolName: ADVANCE_CANDIDATE_TOOL_NAME,
      declaredInput: ADVANCE_CANDIDATE_INPUT_SCHEMA });
  }
  return Object.freeze({ registration, readOriginal: request => createCandidateInspectionDelivery({
    workspace: resolveWorkspaceRepo(workspaceRepos, undefined), env, responseEnv,
    route: ADVANCE_CANDIDATE_TOOL_NAME, ownerCall, ownerRequestSchema }).readOriginal(request) });
}
