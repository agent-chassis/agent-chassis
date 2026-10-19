

import path from "node:path";
import { randomUUID } from "node:crypto";
import { recordManagedCompletion } from "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { createSubmitForReviewResponse } from "./server-composition-helpers.mjs";
import { createToolInputValidationError } from "./register-tool.mjs";
import { describeRetentionFailure, measureMcpInlineResultBytes } from "./mcp-response.mjs";
import { selectedResponseDeliveryBound } from "./selected-response-snapshot.mjs";
import { createDeliveryOriginals } from "./task-deliver-work-result.mjs";
import {
  resolveLauncherRunCredential,
  resolveAssignedUnit,
  WIKI_MCP_ASSIGNED_UNIT_ENV_VAR,
  WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR,
  WIKI_MCP_COMMIT_RUN_ID_ENV_VAR
} from "./launcher-run-credential.mjs";
import { materializeCommitObject } from "../../../agent-launch-cli/src/lib/commit-object-primitive.mjs";

import {
  verifyExactSliceCommitBinding,
  resolveCommitGitIdentity,
  normalizeCommitRef,
  resolveExpectedEnvelope,
  resolveCommitWriteScopeMatcher
} from "../../../agent-launch-cli/src/lib/exact-slice-commit-binding.mjs";
import { createWorkerScopeTreeReader } from "../../../agent-launch-cli/src/lib/backend-worker-scope-tree.mjs";
import { defaultRunGit } from "../../../agent-launch-cli/src/lib/worktree-substrate-primitives.mjs";
import { CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT } from "../../../wiki-core/src/lib/controlled-contract-private-path-policy.mjs";
import { verifyAndMeasureCommitScope } from "../../../agent-launch-cli/src/lib/commit-scope-envelope.mjs";
import {
  admitWorkerCommitCall,
  WORKER_COMMIT_TOOL_NAME
} from "../../../agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import {
  resolveWorktreeBinding
} from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  persistExactSliceImplementationReviewTransition
} from "../../../wiki-core/src/operations/work-record-slice-review-acceptance.mjs";
import { serializeWorkRecordDiagnosticValue } from
  "@agent-chassis/wiki-core/src/operations/work-record-persistence-diagnostics.mjs";

export { WORKER_COMMIT_TOOL_NAME };

export const WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION = Object.freeze({
  schema_version: "workspace-closed-input-commit-composition.v1",
  installed: true,
  tool_name: WORKER_COMMIT_TOOL_NAME,
  input_contract: "closed",
  binding_authority: "server_resolved"
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const BINDING_RESOLUTION_STAGE = "binding_resolution";
const BINDING_RESOLUTION_DIAGNOSTIC_PATH = "workspace_commit.binding_resolution";

function declareBindingResolutionFailure(error, resolution) {
  if (!resolution.threw || error === null || typeof error !== "object" ||
      !Object.hasOwn(error, "cause") || error.cause !== resolution.error) {
    return error;
  }
  const declared = new Error(error.message);
  try {
    declared.envelope = {
      ...serializeWorkRecordDiagnosticValue(error, { path: BINDING_RESOLUTION_DIAGNOSTIC_PATH }),
      stage: BINDING_RESOLUTION_STAGE,
      diagnostic_serialization: { state: "complete" }
    };
  } catch (serializationError) {
    declared.envelope = {
      code: typeof error.code === "string" ? error.code : null,
      message: typeof error.message === "string" ? error.message : null,
      stage: BINDING_RESOLUTION_STAGE,
      diagnostic_serialization: {
        state: "failed",
        cause: serializeWorkRecordDiagnosticValue(serializationError, {
          path: `${BINDING_RESOLUTION_DIAGNOSTIC_PATH}.serialization_failure`
        })
      }
    };
  }
  return declared;
}

function createCommitRefusal(decisionCode, reasons, extra = {}) {
  return {
    tool: WORKER_COMMIT_TOOL_NAME,
    committed: false,
    commit_object: "not_created",
    delivery_ref: "unchanged",
    submitted_for_review: false,
    valid: false,
    written: false,
    decision_code: decisionCode,
    reasons: Array.isArray(reasons) ? reasons : [reasons],
    ...extra
  };
}

function createCommitResponse(workspaceRepo, assignedUnit, result) {
  return {
    workspaceRepo,
    tool: WORKER_COMMIT_TOOL_NAME,

    committed: result.facts.submitted_for_review === true,
    ...result.facts,
    assigned_unit: assignedUnit,
    commit: result.commit,
    tree: result.tree,
    base_sha: result.base_sha,
    ref: result.ref,
    idempotent: result.idempotent,
    ref_advanced: result.ref_advanced,
    empty_delivery: result.empty_delivery,
    changed_paths: result.scope.changed_paths,
    metrics: result.scope.metrics,
    baseline: result.scope.baseline,
    attestation: result.scope.attestation,
    expected_envelope_invariant: result.scope.expected_envelope_invariant,
    transition: result.transition
  };
}

function serializeTransactionCause(error, diagnosticPath) {
  try {
    return {
      cause: serializeWorkRecordDiagnosticValue(error, { path: diagnosticPath }),
      diagnostic_serialization: { state: "complete" }
    };
  } catch (serializationError) {
    return {
      cause: null,
      diagnostic_serialization: {
        state: "failed",
        cause: serializeWorkRecordDiagnosticValue(serializationError, {
          path: `${diagnosticPath}.serialization_failure`
        })
      }
    };
  }
}

function boundedTransitionFacts({ state, validation = null, result = null, error = null }) {
  const threw = state === "threw";
  return {
    state,
    decision_code: validation?.decision_code ??
      (typeof error?.code === "string" ? error.code : null),
    reason: validation?.reason ?? (threw ? "transition_threw" : null),
    valid: typeof result?.valid === "boolean" ? result.valid : null,
    written: typeof result?.written === "boolean" ? result.written : null,
    no_op: typeof result?.no_op === "boolean" ? result.no_op : null,
    status: typeof result?.status === "string" ? result.status : null,
    ...(threw ? serializeTransactionCause(error, "workspace_commit.canonical_review") : {})
  };
}

function unprovenSubmissionEffect(validation, result) {
  if (validation?.reason === "write_not_confirmed") {
    return result.written === false ? false : null;
  }
  if (validation?.reason === "review_state_not_confirmed") {
    return typeof result.status === "string" ? false : null;
  }
  return null;
}

function boundedCompensationFacts(error, advanced) {
  const detail = isPlainObject(error?.detail) ? error.detail : {};
  return {
    state: "failed",
    decision_code: typeof error?.code === "string" ? error.code :
      "agent_launch.slice_integration.slice_commit_compensation_failed.v1",
    ref: advanced.ref,
    published_commit: advanced.commit,
    prior_tip: advanced.prior_tip,
    observed_tip: typeof detail.observed_tip === "string" ? detail.observed_tip : null,
    ...serializeTransactionCause(error, "workspace_commit.compensation")
  };
}

function deliveryRefEffect(advanced, compensation) {
  if (compensation.state === "restored") return "restored";
  if (compensation.state === "failed") {
    return compensation.observed_tip === compensation.published_commit ? "advanced" : "unknown";
  }
  if (advanced.ref_advanced === true) return "advanced";
  return advanced.ref_advanced === false ? "unchanged" : "unknown";
}

function classifyPublicationFailure(error, { codes, ref, baseSha, candidate }) {
  const detail = isPlainObject(error?.detail) ? error.detail : {};
  const observedTip = typeof detail.observed_tip === "string" ? detail.observed_tip : null;
  const bound = Boolean(codes) && detail.ref === ref && detail.base_sha === baseSha;
  const noPublication = bound && (
    (error.code === codes.SLICE_COMMIT_CONFLICT && observedTip !== null && observedTip !== candidate) ||
    (error.code === codes.SLICE_COMMIT_READ_INDETERMINATE && !Object.hasOwn(detail, "attempted_commit"))
  );
  return { deliveryRef: noPublication ? "unchanged" : "unknown", observedTip };
}

const CHECKOUT_NOT_ATTEMPTED = Object.freeze({ state: "not_attempted",
  facts: Object.freeze({ state: "not_attempted", code: null }) });

function projectTransactionFacts({
  materialized = null,
  ref,
  advanced = null,
  attempted = advanced !== null,
  deliveryRef,
  observedTip = null,
  submitted,
  canonicalReview = { state: "not_attempted" },
  compensation = { state: "not_required" },
  checkout = CHECKOUT_NOT_ATTEMPTED
}) {
  return {
    commit_object: materialized === null ? "unknown" : "created",
    delivery_ref: deliveryRef,
    submitted_for_review: submitted,
    checkout: checkout.state,
    transaction: {
      schema_version: "workspace-exact-slice-commit-transaction.v1",
      ref: advanced?.ref ?? ref,
      base_sha: advanced?.base_sha ?? materialized?.base_sha ?? null,
      delivered_tree: advanced?.tree ?? materialized?.tree ?? null,
      candidate_commit: materialized?.commit ?? null,
      delivery_commit: advanced?.commit ?? null,
      prior_tip: advanced?.prior_tip ?? null,
      attempted_commit: attempted ? materialized?.commit ?? null : null,
      published_commit: advanced?.ref_advanced === true ? advanced.commit : null,
      observed_tip: observedTip ?? compensation.observed_tip ?? null,
      canonical_review: canonicalReview,
      compensation,
      checkout: checkout.facts
    }
  };
}

function createTransactionRefusal(facts) {
  const { canonical_review: transition, compensation } = facts.transaction;
  const partial = compensation.state === "failed";
  const compensated = compensation.state === "restored";
  return createCommitRefusal(
    partial
      ? "commit.exact_slice_transaction_partial.v1"
      : compensated
        ? "commit.review_transition_failed_compensated.v1"
        : "commit.review_transition_failed_unpublished.v1",
    [partial
      ? "the exact slice ref was published, canonical review was not proven, and exact CAS compensation did not complete"
      : compensated
        ? "canonical review was not proven; the exact slice ref publication was CAS-compensated to its authenticated prior tip"
        : "canonical review was not proven; this invocation published no ref change"],
    { written: transition.written, ...facts }
  );
}

const MATERIALIZATION_STAGE = "materialization";
const SCOPE_VERIFICATION_STAGE = "scope_verification";
const PUBLICATION_STAGE = "publication";

function declareTransactionFailure(error, progress) {
  const publication = progress.stage === PUBLICATION_STAGE
    ? classifyPublicationFailure(error, {
        codes: progress.sliceCodes,
        ref: progress.ref,
        baseSha: progress.materialized.base_sha,
        candidate: progress.materialized.commit
      })
    : { deliveryRef: "unchanged", observedTip: null };
  const declared = new Error(typeof error?.message === "string" ? error.message : String(error));
  declared.envelope = {
    code: typeof error?.code === "string" ? error.code : null,
    message: declared.message,
    stage: progress.stage,
    tool: WORKER_COMMIT_TOOL_NAME,
    committed: false,
    ...projectTransactionFacts({
      materialized: progress.materialized,
      ref: progress.ref,
      attempted: progress.stage === PUBLICATION_STAGE,
      deliveryRef: publication.deliveryRef,
      observedTip: publication.observedTip,
      submitted: false
    }),
    ...serializeTransactionCause(error, `workspace_commit.${progress.stage}`)
  };
  return declared;
}

function resolveCommitBindingFromCredential(credential, mainRepo, assignedUnit) {
  if (!isPlainObject(credential)) {
    throw new Error("commit credential must be a launcher-provided object");
  }
  if (credential.kind !== "identity_store_tuple") {
    throw new Error(`unsupported commit credential kind: ${JSON.stringify(credential.kind)}`);
  }
  const identityStoreBinding = resolveWorktreeBinding({
    mainRepo,
    launchRef: credential.launchRef,
    runId: credential.runId,
    retryId: credential.retryId
  });

  return {
    identityStoreBinding,
    verified: verifyExactSliceCommitBinding({
      binding: identityStoreBinding,
      mainRepo,
      assignedUnit,
      launchRef: credential.launchRef,
      runId: credential.runId,
      retryId: credential.retryId
    })
  };
}

const RETAIN_OPERATION = "retain_delivery_original";
const RESPONSE_STATE_OWNER = "wiki-mcp response state (WIKI_MCP_RESPONSE_STATE_DIR)";
const NOT_ATTEMPTED = Object.freeze({ state: "not_attempted" });

const ORIGINAL_PHASES = Object.freeze([
  "materialization", "scope_verification", "publication", "canonical_review", "compensation", "checkout"
]);
const SHORT_FACT_MAX_CHARS = 256;

const isShortFact = (value) => value === null || typeof value === "boolean" || typeof value === "number" ||
  (typeof value === "string" && value.length <= SHORT_FACT_MAX_CHARS);

function settledFactsOf(outcome) {
  const settled = {};
  const omitted = [];
  const keep = (target, source, prefix) => {
    for (const [key, value] of Object.entries(source)) {
      if (isShortFact(value)) target[key] = value;
      else if (!isPlainObject(value)) omitted.push(`${prefix}${key}`);
    }
  };
  keep(settled, outcome, "");
  if (isPlainObject(outcome.transaction)) {
    settled.transaction = {};
    keep(settled.transaction, outcome.transaction, "transaction.");
    for (const phase of ["canonical_review", "compensation", "checkout"]) {
      if (!isPlainObject(outcome.transaction[phase])) continue;
      settled.transaction[phase] = {};
      keep(settled.transaction[phase], outcome.transaction[phase], `transaction.${phase}.`);
      for (const member of Object.keys(outcome.transaction[phase])) {
        if (isPlainObject(outcome.transaction[phase][member])) omitted.push(`transaction.${phase}.${member}`);
      }
    }
  }
  for (const [key, value] of Object.entries(outcome)) {
    if (key !== "transaction" && isPlainObject(value)) omitted.push(key);
  }
  return { ...settled, omitted_facts: omitted };
}

function projectOutputFailure({ outcome, error, stage, assignedUnit, env }) {
  const bound = selectedResponseDeliveryBound(env);
  const failure = describeRetentionFailure(error, { operation: RETAIN_OPERATION, subject: { unit: assignedUnit } });
  const { cause: _cause, cause_serialization_failure: _serialization, ...known } = failure;
  const frame = (settled, retentionFailure) => ({
    ...settled,
    output: {
      state: "failed",
      failed_output: "complete_original",
      stage,
      unit: assignedUnit,
      response_state_owner: RESPONSE_STATE_OWNER,
      recoverable: false
    },
    original: { available: false, locator: null, operator_only: true, retention_failure: retentionFailure }
  });
  const settled = settledFactsOf(outcome);
  for (const candidate of [
    frame(outcome, failure),
    frame(settled, failure),
    frame(settled, { ...known, cause_omitted: true })
  ]) {
    if (measureMcpInlineResultBytes(candidate, { isError: true }) <= bound) return candidate;
  }

  const { tool, committed, commit_object: commitObject, delivery_ref: deliveryRef,
    submitted_for_review: submitted, checkout } = outcome;
  return frame({ tool, committed, commit_object: commitObject, delivery_ref: deliveryRef,
    submitted_for_review: submitted, checkout,
    omitted_facts: Object.keys(outcome).filter((key) => !["tool", "committed", "commit_object", "delivery_ref",
      "submitted_for_review", "checkout"].includes(key)) },
  { retained: false, failed_operation: RETAIN_OPERATION, cause_omitted: true });
}

export function createWorkspaceCommitExecution({
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  setWorkRecordStatusByUnit,
  env = process.env,

  responseEnv = env,

  finalizeCheckout = null
}) {

  const closedInputSchema = z.object({}).strict();
  const handler = async (args) => {
      const bindingResolution = { threw: false, error: undefined };
      const progress = { stage: null, ref: null, materialized: null, sliceCodes: null };

      let deliveryIntent = null;
      const capture = { originals: null, observations: null, assignedUnit: null, settled: false, outcome: null };

      const outputOptions = () => ({ deliveryObservation: {
        identity: capture.observations?.identity ?? null,
        phases: capture.observations,
        ref: progress.ref,
        transactionOutcome: capture.outcome
      } });
      const respondJson = (payload) => jsonContent(payload, outputOptions());
      const respondError = (error) => errorContent(error, outputOptions());
      const settle = (outcome, { isError = false } = {}) => {
        const respond = (payload) => {
          if (!isError) return respondJson(payload);
          const declared = new Error(typeof payload.message === "string" ? payload.message : "delivery failed");
          declared.envelope = payload;
          return respondError(declared);
        };
        capture.settled = true;
        capture.outcome = outcome;
        let locator;
        try {

          const original = {
            ...capture.observations,
            outcome: { is_error: isError, response: JSON.parse(JSON.stringify(outcome)) }
          };

          locator = capture.originals.retain({ original });
        } catch (error) {
          const declared = new Error("the complete delivery original could not be retained");
          declared.envelope = projectOutputFailure({
            outcome, error,
            stage: capture.originals.retentionFailureStage() ?? "original_serialization",
            assignedUnit: capture.assignedUnit, env: responseEnv
          });
          return respondError(declared);
        }
        return respond({ ...outcome, original: { available: true, operator_only: true, locator } });
      };
      try {
        const rawAssignedUnit = env?.[WIKI_MCP_ASSIGNED_UNIT_ENV_VAR];
        const assignedUnit = resolveAssignedUnit(env);
        if (!assignedUnit) {
          return respondJson(
            createCommitRefusal("commit.missing_assigned_unit.v1", [
              "WIKI_MCP_ASSIGNED_UNIT is not set; commit is only available for launcher-assigned worker-profile sessions"
            ])
          );
        }

        const credential = resolveLauncherRunCredential(env);
        if (!credential) {
          return respondJson(
            createCommitRefusal("commit.missing_launcher_binding.v1", [
              `${WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR}/${WIKI_MCP_COMMIT_RUN_ID_ENV_VAR} launcher tuple is required; commit refuses to derive identity from worker input, serialized environment bindings, or the current checkout`
            ])
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos);

        const mainRepo = path.resolve(workspace.dir);
        let rawBinding = null;
        let identityStoreBinding = null;
        const admitted = admitWorkerCommitCall({
          credential,
          workerArgs: args,
          deps: {
            resolveBinding(value) {
              try {
                ({ identityStoreBinding, verified: rawBinding } =
                  resolveCommitBindingFromCredential(value, mainRepo, rawAssignedUnit));
                const intent = { alternative: "delivery", intent_id: randomUUID(),
                  phase: "before_materialization", known_effects: "no commit/ref/status effect at intent acquisition" };
                const claimed = recordManagedCompletion({ mainRepo, subject: rawAssignedUnit,
                  sliceBinding: identityStoreBinding, completion: intent });
                if (!claimed.ok) throw Object.assign(new Error(claimed.cause ?? claimed.refusal?.reason ?? claimed.code),
                  { code: claimed.code ?? claimed.refusal?.code, completion: claimed });
                deliveryIntent = intent;
              } catch (error) {
                bindingResolution.threw = true;
                bindingResolution.error = error;
                throw error;
              }
              return rawBinding;
            }
          }
        });
        const binding = admitted.binding;
        const serverResolvedBinding = rawBinding ?? binding;
        const gitIdentity = resolveCommitGitIdentity(serverResolvedBinding, mainRepo);

        const sliceRef = normalizeCommitRef(binding.output_branch).ref;

        const observations = {
          identity: {
            repository: workspace.repo,
            unit: assignedUnit,
            launch_ref: credential.launchRef,
            run_id: credential.runId,
            retry_id: credential.retryId,
            binding: identityStoreBinding
          },
          ...Object.fromEntries(ORIGINAL_PHASES.map((phase) => [phase, NOT_ATTEMPTED]))
        };
        capture.originals = createDeliveryOriginals({
          workspace: { repo: workspace.repo, dir: workspace.dir },
          binding: identityStoreBinding,
          credential,
          assignedUnit: rawAssignedUnit,
          responseEnv
        });
        capture.observations = observations;
        capture.assignedUnit = assignedUnit;

        progress.ref = sliceRef;
        progress.stage = MATERIALIZATION_STAGE;
        const materialized = materializeCommitObject({
          gitDir: gitIdentity.gitDir,
          workTree: gitIdentity.workTree,
          baseSha: binding.base_sha,
          message: admitted.server_generated_message
        });
        progress.materialized = materialized;
        observations.materialization = { state: "returned", result: materialized };

        progress.stage = SCOPE_VERIFICATION_STAGE;
        const scope = verifyAndMeasureCommitScope({
          gitDir: gitIdentity.gitDir,
          baseSha: materialized.base_sha,
          commit: materialized.commit,
          tree: materialized.tree,
          writeScope: binding.write_scope,
          expectedEnvelope: resolveExpectedEnvelope(serverResolvedBinding),
          deps: {

            resolveWriteScope(writeScope) {
              return resolveCommitWriteScopeMatcher(
                createWorkerScopeTreeReader({ runGit: defaultRunGit, mainRepo, baseSha: binding.base_sha }),
                writeScope,
                [CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT]
              );
            }
          }
        });
        observations.scope_verification = { state: "returned", result: scope };
        if (scope.contained !== true) {

          const released = recordManagedCompletion({ mainRepo, subject: rawAssignedUnit,
            sliceBinding: identityStoreBinding, completion: { alternative: "delivery",
              intent_id: `release-${deliveryIntent.intent_id}`, released_intent_id: deliveryIntent.intent_id,
              phase: "released_zero_effects", known_effects: "delivery ref unchanged; canonical review not attempted" } });
          if (!released.ok) throw Object.assign(new Error("zero-effect delivery intent release refused"),
            { code: released.code ?? released.refusal?.code, cause: released });
          progress.stage = null;
          return settle(
            createCommitRefusal("commit.write_scope_refused.v1", [
              "materialized commit object is not structurally contained in the launcher-assigned write_scope"
            ], {
              materialized,
              scope,
              ...projectTransactionFacts({
                materialized,
                ref: sliceRef,
                deliveryRef: "unchanged",
                submitted: false
              })
            })
          );
        }

        progress.stage = PUBLICATION_STAGE;

        const exactSlicePrimitives = await import("../../../agent-launch-cli/src/lib/slice-integration.mjs");
        progress.sliceCodes = exactSlicePrimitives.SLICE_INTEGRATION_DIAGNOSTIC_CODES;
        const advanced = exactSlicePrimitives.commitSliceRef({
          repo: mainRepo,
          sliceRef,
          baseSha: materialized.base_sha,
          tree: materialized.tree,
          commit: materialized.commit
        });
        progress.stage = null;
        observations.publication = { state: "returned", result: advanced };

        let persistedTransition;
        let transitionFacts;
        try {
          persistedTransition = await persistExactSliceImplementationReviewTransition({
            dir: workspace.dir,
            unitAddress: assignedUnit,
            writeStatus: setWorkRecordStatusByUnit
          });

          observations.canonical_review = {
            state: "returned",
            result: persistedTransition.result,
            validation: persistedTransition.validation
          };
          transitionFacts = boundedTransitionFacts({
            state: persistedTransition.validation.ok ? "review" : "invalid",
            validation: persistedTransition.validation,
            result: persistedTransition.result
          });
        } catch (error) {
          persistedTransition = null;
          observations.canonical_review = { state: "threw", cause: error };
          transitionFacts = boundedTransitionFacts({ state: "threw", error });
        }

        if (transitionFacts.state !== "review") {
          let compensation = { state: "not_required" };
          if (advanced.ref_advanced === true) {
            try {
              const restored = exactSlicePrimitives.compensateCommittedSliceRef({
                repo: mainRepo,
                sliceRef: advanced.ref,
                publishedCommit: advanced.commit,
                priorTip: advanced.prior_tip
              });
              observations.compensation = { state: "returned", result: restored };
              compensation = {
                state: "restored",
                ref: advanced.ref,
                published_commit: advanced.commit,
                restored_tip: advanced.prior_tip
              };
            } catch (error) {
              observations.compensation = { state: "threw", cause: error };
              compensation = boundedCompensationFacts(error, advanced);
            }
          }
          return settle(createTransactionRefusal(projectTransactionFacts({
            materialized,
            ref: sliceRef,
            advanced,
            deliveryRef: deliveryRefEffect(advanced, compensation),
            submitted: unprovenSubmissionEffect(
              persistedTransition?.validation,
              persistedTransition?.result
            ),
            canonicalReview: transitionFacts,
            compensation
          })));
        }

        const transition = createSubmitForReviewResponse(
          workspace.repo,
          assignedUnit,
          persistedTransition.result
        );
        const compensation = { state: "not_required" };

        let checkout = CHECKOUT_NOT_ATTEMPTED;
        if (typeof finalizeCheckout === "function") {
          checkout = await finalizeCheckout({ workspaceDir: workspace.dir, credential,
            assignedUnit: rawAssignedUnit, deliveryCommit: advanced.commit });
          observations.checkout = { state: "returned", result: checkout };
        }
        return settle(
          createCommitResponse(workspace.repo, assignedUnit, {
            commit: advanced.commit,
            tree: advanced.tree,
            base_sha: advanced.base_sha,
            ref: advanced.ref,
            idempotent: advanced.idempotent,
            ref_advanced: advanced.ref_advanced,
            empty_delivery: advanced.empty_delivery,
            scope,
            transition,

            facts: projectTransactionFacts({
              materialized,
              ref: sliceRef,
              advanced,
              deliveryRef: deliveryRefEffect(advanced, compensation),
              submitted: transition.submitted,
              canonicalReview: transitionFacts,
              compensation,
              checkout
            })
          })
        );
      } catch (error) {
        if (progress.stage !== null && !capture.settled) {

          capture.observations[progress.stage] = { state: "threw", cause: error };
          return settle(declareTransactionFailure(error, progress).envelope, { isError: true });
        }
        return respondError(declareBindingResolutionFailure(error, bindingResolution));
      }
    };
  return Object.freeze({
    inputContract: Object.freeze({ inputSchema: closedInputSchema.default({}), advertisedInputSchema: closedInputSchema }),
    handler
  });
}

export function registerWorkspaceCommitTool({ registerTool, ...options }) {
  const { inputContract, handler } = createWorkspaceCommitExecution(options);
  const { errorContent } = options;
  registerTool(
    WORKER_COMMIT_TOOL_NAME,
    {
      description:
        "Commit only the launcher-bound worker delta and move its unit to review. Exact-slice commit submits for review; it advances no WK ref or integration authority. Closed input: identity, scope, refs and commit settings are launcher-owned.",
      ...inputContract,
      inputValidationErrorProjector: ({ validationError }) => ({
        terminal_result: errorContent(createToolInputValidationError({
          tool: WORKER_COMMIT_TOOL_NAME,
          validationError,
          nextCalls: [{ tool: WORKER_COMMIT_TOOL_NAME, arguments: {}, recommended: true }]
        }))
      })
    },
    handler
  );
}
