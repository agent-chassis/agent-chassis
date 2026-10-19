

import path from "node:path";

import { z } from "zod";

import {
  defaultTerminalCandidateRunGit,
  deriveTerminalCandidateCurrentRef,
  observeExactDirectCommitRef,
  projectTerminalWkCandidateVersion,
  TERMINAL_WK_CANDIDATE_CODES,
  TerminalWkCandidateError
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  authenticateCurrentControlledContractGenerationAtW
} from "@agent-chassis/agent-launch-cli/src/lib/controlled-carrier-attachment-primitive.mjs";
import {
  authenticatedControlledContractGenerationsEqual,
  projectAuthenticatedControlledContractGeneration
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-generation-authentication.mjs";
import {
  authenticateHistoricalTerminalCandidate
} from "./dispatch-terminal-candidate-authentication.mjs";
import {
  observeTerminalCandidateFacts,
  observeTerminalReviewConsumer
} from "./dispatch-terminal-candidate-runtime.mjs";
import { dispatchRepoResolutionRefusal,
  requestSchemaAuthorityForRegistration } from "./dispatch-tool-helpers.mjs";
import { createToolInputValidationError, MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import {
  candidateInspectionSubjectCorrection,
  createCandidateInspectionResponder,
  INSPECT_CANDIDATE_TOOL_NAME
} from "./task-inspect-candidate-response.mjs";
import { withDeclaredCrossFieldRules } from "./zod-request-constraint-declarations.mjs";
import { advanceRequest as ownerAdvanceRequest } from "./task-advance-candidate.mjs";
import { createCandidateInspectionDelivery } from "./task-inspect-candidate-delivery.mjs";
import { candidateDifferenceMeaning } from "./task-inspect-candidate-meaning.mjs";

export const CURRENT_CANDIDATE_REOBSERVATION_KIND = "reobserve_current_once";

function isTypedMovement(failure) {
  return failure instanceof TerminalWkCandidateError &&
    failure.code === TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED;
}

function moved(message, detail) {
  throw new TerminalWkCandidateError(message, {
    code: TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED,
    detail
  });
}

async function assertRefStillNames({ mainRepo, runGit, field, ref, subject, expected }) {
  const actual = await observeExactDirectCommitRef({ mainRepo, ref, runGit, subject });
  if (actual !== expected) {
    moved(`${subject} moved during current candidate observation`, {
      field, ref, expected, actual
    });
  }
}

async function assertObservationStillHolds({ mainRepo, wkId, runGit, observation }) {
  const { candidate, context } = observation;
  await assertRefStillNames({
    mainRepo, runGit,
    field: "current_ref",
    ref: deriveTerminalCandidateCurrentRef({ canonicalWkId: wkId }),
    subject: "current candidate ref",
    expected: candidate === null ? null : candidate.candidate
  });
  if (candidate !== null) {
    await assertRefStillNames({
      mainRepo, runGit,
      field: "version_ref",
      ref: context.versionDecision?.immutable_version_ref ?? context.observedVersion.version_ref,
      subject: "immutable candidate version ref",
      expected: candidate.candidate
    });
    await assertRefStillNames({
      mainRepo, runGit,
      field: "fork_ref",
      ref: context.snapshot.forkRef,
      subject: "durable WK fork ref",
      expected: candidate.base
    });
  }
  const { binding, authenticated } = await authenticateCurrentControlledContractGenerationAtW({
    repoRoot: mainRepo, wkId, deps: { runGit }
  });
  if (authenticated.wk_tip_sha !== observation.observed_w) {
    moved("persistent WK ref moved during current candidate observation", {
      field: "wk_tip",
      ref: binding.ref,
      expected: observation.observed_w,
      actual: authenticated.wk_tip_sha
    });
  }
  if (!authenticatedControlledContractGenerationsEqual(
    context.generationAuthentication, authenticated)) {
    moved("current controlled generation moved during current candidate observation", {
      field: "controlled_generation",
      wk_tip: authenticated.wk_tip_sha,
      expected: projectAuthenticatedControlledContractGeneration(context.generationAuthentication),
      actual: projectAuthenticatedControlledContractGeneration(authenticated)
    });
  }
}

async function attemptCurrentObservation({ mainRepo, wkId, runGit, dependencies, observeFacts }) {
  let observation;
  try {
    observation = await observeFacts({ mainRepo, wkId, runGit, dependencies });
  } catch (failure) {
    return { observation: null, failure };
  }
  if (observation.state === "candidate_identity_invalid_or_moved") {
    return { observation, failure: observation.context.failure };
  }
  try {
    await assertObservationStillHolds({ mainRepo, wkId, runGit, observation });
  } catch (failure) {
    return { observation: null, failure };
  }
  return { observation, failure: null };
}

export async function observeCurrentTerminalCandidate({
  mainRepo,
  wkId,
  runGit = defaultTerminalCandidateRunGit,
  dependencies = {}
} = {}) {
  const observeFacts = dependencies.observeTerminalCandidateFacts ?? observeTerminalCandidateFacts;
  const attempt = () => attemptCurrentObservation({
    mainRepo, wkId, runGit, dependencies, observeFacts
  });
  const first = await attempt();
  if (!isTypedMovement(first.failure)) {
    return Object.freeze({
      observation: first.observation,
      failure: first.failure,
      automatic_correction: null
    });
  }
  const fresh = await attempt();
  return Object.freeze({
    observation: fresh.observation,
    failure: fresh.failure,
    automatic_correction: Object.freeze({
      kind: CURRENT_CANDIDATE_REOBSERVATION_KIND,
      original_condition: Object.freeze({ failure: first.failure }),
      verified_outcome: Object.freeze({ observation: fresh.observation, failure: fresh.failure })
    })
  });
}

const versionKeySelectsHistory = Object.freeze({
  declaration: Object.freeze({
    constraint: "present_key_defined",
    field: "version",
    statement: "Omit version for the current candidate. A present version key selects that " +
      "immutable version and must hold its 64 lowercase hexadecimal identity."
  }),
  enforce(value, context) {
    if (Object.hasOwn(value, "version") && value.version === undefined) {
      context.addIssue({ code: "custom", path: ["version"],
        message: "version is present but undefined; omit the key for the current candidate" });
    }
  }
});

export const CANDIDATE_INSPECTION_INPUT_SCHEMA = withDeclaredCrossFieldRules(z.object({
  subject: z.string().regex(/^WK-[0-9]{4}$/u),
  version: z.string().regex(/^[0-9a-f]{64}$/u).optional()
}).strict(), [versionKeySelectsHistory]);

const HISTORICAL_ONLY = Object.freeze({ kind: "historical_only" });

function rejectedFields(issues) {
  return [...new Set(issues.flatMap((issue) =>
    (issue.keys ?? [null]).map((key) => [...issue.path, ...(key === null ? [] : [key])]
      .join(".") || "request")))];
}

function parseInspectionRequest(request) {
  const parsed = CANDIDATE_INSPECTION_INPUT_SCHEMA.safeParse(request);
  if (parsed.success) return parsed.data;
  throw new TerminalWkCandidateError(
    "candidate inspection accepts exactly a WK subject and an optional immutable version", {
      code: TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      detail: {
        rejected_fields: rejectedFields(parsed.error.issues),
        issues: parsed.error.issues.map(({ path: at, code, message }) => ({ path: at, code, message }))
      }
    });
}

function selectionResult({ subject, selection, state = null, candidate = null, currentness,
  review = null, failure = null, automaticCorrection = null, current = null, historical = null }) {
  return Object.freeze({
    subject,
    selection,
    state,
    candidate,
    currentness,
    review,
    failure,
    automatic_correction: automaticCorrection,
    context: Object.freeze({ current, historical })
  });
}

export function createCandidateInspectionTask({
  mainRepo,
  runGit = defaultTerminalCandidateRunGit,
  backend = null,
  dependencies = {},
  requestSchemaAuthority = null,
  advanceRequest = ownerAdvanceRequest,
  responseEnv = process.env
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      path.resolve(mainRepo) !== mainRepo || typeof runGit !== "function") {
    throw new TerminalWkCandidateError(
      "candidate inspection requires the server-bound repository and a Git runner", {
        code: TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT
      });
  }
  const observeCurrent = dependencies.observeCurrentTerminalCandidate ?? observeCurrentTerminalCandidate;
  const authenticateHistorical = dependencies.authenticateHistoricalTerminalCandidate ??
    authenticateHistoricalTerminalCandidate;
  const observeReview = dependencies.observeTerminalReviewConsumer ?? observeTerminalReviewConsumer;

  async function reviewOf(observation, wkId) {
    if (observation?.state !== "candidate_healthy") return null;
    try {
      return await observeReview({
        mainRepo, wkId, backend, candidateRecord: observation.context.candidateRecord
      });
    } catch (failure) {
      return Object.freeze({
        compatibility: null, subject: null, cause: null, divergence: null, failure
      });
    }
  }

  async function inspect(request) {
    const parsed = parseInspectionRequest(request);
    const subject = Object.freeze({ unit: parsed.subject });
    if (!Object.hasOwn(parsed, "version")) {
      const current = await observeCurrent({ mainRepo, wkId: parsed.subject, runGit });
      const { observation } = current;
      return selectionResult({
        subject,
        selection: Object.freeze({ kind: "current" }),
        state: observation?.state ?? null,
        candidate: observation?.candidate ?? null,
        currentness: observation === null ? null
          : Object.freeze({ kind: "evaluated_current", observed_w: observation.observed_w }),
        review: await reviewOf(observation, parsed.subject),
        failure: current.failure,
        automaticCorrection: current.automatic_correction,
        current
      });
    }
    const selection = Object.freeze({ kind: "historical", version: parsed.version });
    let historical;
    let candidate;
    try {
      historical = await authenticateHistorical({
        mainRepo, wkId: parsed.subject, versionIdentity: parsed.version, runGit
      });
      candidate = projectTerminalWkCandidateVersion(historical);
    } catch (failure) {
      return selectionResult({ subject, selection, currentness: HISTORICAL_ONLY, failure });
    }
    return selectionResult({
      subject, selection, state: "historical_version", candidate, currentness: HISTORICAL_ONLY,
      historical
    });
  }

  const responder = createCandidateInspectionResponder({
    requestSchemaAuthority, advanceRequest, responseEnv
  });
  const respond = async (request) => {
    const selection = await inspect(request);
    return { ...responder.prepare(selection),
      semanticDetail: candidateDifferenceMeaning({ mainRepo, wkId: selection.subject.unit, selection, requestSchemaAuthority }) };
  };

  return Object.freeze({ inputSchema: CANDIDATE_INSPECTION_INPUT_SCHEMA, inspect, respond });
}

export function registerCandidateInspectionTool({
  registerTool,
  workspaceRepos,
  resolveWorkspaceRepo,
  jsonContent,
  errorContent,
  dispatchBackend = null,
  env = process.env,
  responseEnv = process.env,
  requestSchemaAuthority = null,
  advanceRequest = ownerAdvanceRequest,
  ownerCall = null,
  ownerRequestSchema = null
}) {
  const authority = requestSchemaAuthority ?? requestSchemaAuthorityForRegistration(registerTool);
  registerTool(INSPECT_CANDIDATE_TOOL_NAME, {
    writeSemantics: MCP_WRITE_SEMANTICS.NONE,
    description:
      "Inspect a WK's current exact terminal candidate, or one immutable version of it. " +
      "Observation only: constructs, advances, publishes and reviews nothing.",
    inputSchema: CANDIDATE_INSPECTION_INPUT_SCHEMA,

    inputValidationErrorProjector: ({ args, validationError }) => {
      const correction = candidateInspectionSubjectCorrection(args, { requestSchemaAuthority: authority });
      return {
        terminal_result: errorContent(createToolInputValidationError({
          tool: INSPECT_CANDIDATE_TOOL_NAME,
          validationError,
          details: correction?.details ?? {},
          nextCalls: correction?.next_calls ?? []
        }))
      };
    }
  }, async (args) => {
    let workspace;
    try {
      workspace = resolveWorkspaceRepo(workspaceRepos, undefined);
    } catch (error) {
      const refusal = dispatchRepoResolutionRefusal(INSPECT_CANDIDATE_TOOL_NAME, error);
      return refusal === null ? errorContent(error) : jsonContent(refusal.refusal);
    }
    const prepared = await createCandidateInspectionTask({
      mainRepo: workspace.dir, backend: dispatchBackend, requestSchemaAuthority: authority, advanceRequest,
      responseEnv
    }).respond(args);
    const delivery = createCandidateInspectionDelivery({ workspace, env, responseEnv,
      ownerCall, ownerRequestSchema });

    return (await delivery.deliver(prepared)).result;
  });

  return Object.freeze({ readOriginal: (request) => createCandidateInspectionDelivery({
    workspace: resolveWorkspaceRepo(workspaceRepos, undefined), env, responseEnv,
    ownerCall, ownerRequestSchema
  }).readOriginal(request) });
}
