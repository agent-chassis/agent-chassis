

import {
  refuseObligationCoverageQuery
} from "@agent-chassis/wiki-core/src/operations/controlled-contract/obligation-coverage-query.mjs";

import { parseToolProfile } from "./tool-profile.mjs";

const loadLauncherRunCredential = () => import("./launcher-run-credential.mjs");
const loadWorkerBindingOwners = async () => ({
  ...(await import("../../../agent-launch-cli/src/lib/exact-slice-commit-binding.mjs")),
  ...(await import("../../../agent-launch-cli/src/lib/worktree-substrate-identity.mjs"))
});

export const OBLIGATION_COVERAGE_QUERY_AUTHORITY_SCHEMA_VERSION =
  "obligation-coverage-query-authority.v1";
export const REVIEW_MATERIALIZATION_ENV_VAR = "WIKI_MCP_REVIEW_MATERIALIZATION_DIR";
const ROUTE = "workspace_controlled_contract_obligation_coverage_query";

export const CONTRACT_ASSESSMENT_ROUTE = "workspace_assess_contract";
const FINDINGS_ROLES = new Set(["reviewer", "redteam"]);

const CANONICAL_ROLES = new Set(["orchestrator", "operator"]);

export const QUERY_CONSUMER = "query";
export const ASSESSMENT_CONSUMER = "assessment";
const CONSUMERS = new Set([QUERY_CONSUMER, ASSESSMENT_CONSUMER]);

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sourceUnavailable({ role, failedCondition, subject }) {
  return refuseObligationCoverageQuery("obligation_coverage_query_source_unavailable",
    `The ${role} session's authenticated controlled-contract source is unavailable: ${failedCondition}`, {
      phase: "source",
      failed_condition: failedCondition,
      subject,
      actor: role,

      recovery: role === "worker"
        ? {
            actor: "coordinator_or_operator",
            action: "relaunch the managed worker so its launcher-bound worktree identity is established",
            caller_correctable: false
          }
        : {
            state: "no_supported_route",
            actor: "coordinator_or_operator",
            cause: failedCondition,
            caller_correctable: false
          },
      next_calls: []
    });
}

function assessmentExcludesWorker() {
  return refuseObligationCoverageQuery("contract_assessment_worker_excluded",
    "Contract assessment is not available to a worker session: it reads the canonical or the " +
    "authenticated review source, never a worker's assigned population", {
      phase: "source",
      failed_condition: "assessment_excludes_worker_population",
      subject: { tool_profile: "worker", consumer: ASSESSMENT_CONSUMER },
      actor: "worker",
      recovery: {
        actor: "orchestrator_or_operator",
        action: "assess the contract from an orchestrator or operator session; " +
          "relaunching the worker does not grant assessment",
        caller_correctable: false
      },
      next_calls: []
    });
}

function runIdentity(credential) {
  return { launch_ref: credential.launchRef, run_id: credential.runId, retry_id: credential.retryId };
}

async function launcherState(env, deps, role) {
  try {
    const state = (deps.resolveLauncherRunState ??
      (await loadLauncherRunCredential()).resolveLauncherRunState)(env);
    if (state?.role !== role) {
      return sourceUnavailable({ role, failedCondition: "launcher_role_mismatch",
        subject: { tool_profile: role } });
    }
    return state;
  } catch (error) {
    if (error?.code === "obligation_coverage_query_source_unavailable") throw error;
    return sourceUnavailable({ role, failedCondition: "launcher_session_unauthenticated",
      subject: { tool_profile: role, launcher_refusal: typeof error?.code === "string" ? error.code : null } });
  }
}

async function findingsContext({ env, role, workspace }) {
  const owner = await loadLauncherRunCredential();
  let source;
  try {
    source = owner.resolveAuthenticatedFindingsSource(env);
  } catch (error) {
    if (!(error instanceof owner.FindingsSourceRefusal)) throw error;
    return sourceUnavailable({ role, failedCondition: error.code, subject: error.subject });
  }
  return Object.freeze({
    role,
    sourceRoot: source.sourceRoot,
    population: "all",
    managed: true,
    assignedUnit: null,
    identity: Object.freeze({
      role,
      run: { kind: "advisory", run_id: source.runId },
      assigned_unit: source.assignedUnit,
      source: { kind: "frozen_review_materialization", repository: workspace.repo,
        binding: source.binding, materialization: source.sourceRoot },
      population: { kind: "repository" }
    })
  });
}

async function workerContext({ env, deps, workspace }) {
  const role = "worker";
  const state = await launcherState(env, deps, role);
  const credential = state.credential;
  if (credential?.kind !== "identity_store_tuple" || typeof state.assignedUnit !== "string") {
    return sourceUnavailable({ role, failedCondition: "launcher_run_credential_absent",
      subject: { assigned_unit: state.assignedUnit ?? null } });
  }
  let binding;
  try {
    const owners = await loadWorkerBindingOwners();
    binding = owners.verifyExactSliceCommitBinding({
      binding: (deps.resolveWorktreeBinding ?? owners.resolveWorktreeBinding)({ mainRepo: workspace.dir,
        launchRef: credential.launchRef, runId: credential.runId, retryId: credential.retryId }),
      mainRepo: workspace.dir,
      assignedUnit: state.assignedUnit,
      launchRef: credential.launchRef,
      runId: credential.runId,
      retryId: credential.retryId
    });
  } catch {
    return sourceUnavailable({ role, failedCondition: "worker_worktree_binding_unverified",
      subject: { assigned_unit: state.assignedUnit } });
  }
  return Object.freeze({
    role,
    sourceRoot: binding.worktree_path,
    population: "assigned",
    managed: true,
    assignedUnit: state.assignedUnit,
    identity: Object.freeze({
      role,
      run: runIdentity(credential),
      assigned_unit: state.assignedUnit,
      source: { kind: "worker_assignment_worktree", repository: workspace.repo,
        unit_address: binding.unit_address, base_sha: binding.base_sha,
        source_digest: binding.source_digest, worktree_path: binding.worktree_path },
      population: { kind: "assigned", unit: state.assignedUnit }
    })
  });
}

export async function resolveObligationCoverageQueryContext({ env = process.env, workspace, deps = {},
  consumer = QUERY_CONSUMER }) {
  if (!CONSUMERS.has(consumer)) throw new TypeError("unsupported controlled-contract source consumer");
  let role;
  try {
    role = parseToolProfile(env);
  } catch {
    const profile = trimmed(env?.WIKI_MCP_TOOL_PROFILE);
    return sourceUnavailable({ role: profile || "unknown", failedCondition: "session_role_unsupported",
      subject: { tool_profile: profile || null } });
  }
  if (FINDINGS_ROLES.has(role)) return findingsContext({ env, role, workspace });

  if (role === "worker" && consumer === ASSESSMENT_CONSUMER) return assessmentExcludesWorker();
  if (role === "worker") return workerContext({ env, deps, workspace });
  if (!CANONICAL_ROLES.has(role) || trimmed(env?.[REVIEW_MATERIALIZATION_ENV_VAR]) !== "") {
    return sourceUnavailable({ role,
      failedCondition: CANONICAL_ROLES.has(role) ? "review_materialization_bound_to_non_findings_role"
        : "session_role_unsupported",
      subject: { tool_profile: role } });
  }
  return Object.freeze({
    role,
    sourceRoot: workspace.dir,
    population: "all",
    managed: false,
    assignedUnit: null,
    identity: Object.freeze({
      role,
      source: { kind: "canonical_workspace", repository: workspace.repo },
      population: { kind: "repository" }
    })
  });
}

export function assertObligationCoverageQueryScope(context, { unit, focus }) {
  if (context.assignedUnit === null) return;
  const rejected = [...(unit === context.assignedUnit ? [] : ["unit"]),
    ...(focus === undefined || focus === null ? [] : ["focus"])];
  if (rejected.length === 0) return;
  refuseObligationCoverageQuery("obligation_coverage_query_assignment_scope",
    "A managed worker reads only the controlled contract of its assigned unit", {
      phase: "request",
      failed_condition: "selection_outside_assignment",
      subject: { requested_unit: unit, ...(focus ? { requested_focus: focus } : {}),
        assigned_unit: context.assignedUnit },
      actor: "worker",
      rejected_arguments: rejected,
      recovery: { actor: "worker", action: "query the assigned unit without focus", caller_correctable: true },
      next_calls: [{ tool: ROUTE, arguments: { unit: context.assignedUnit } }]
    });
}

function authorityIdentity(context, { route, unit }) {
  return { schema_version: OBLIGATION_COVERAGE_QUERY_AUTHORITY_SCHEMA_VERSION, route, unit,
    ...context.identity };
}

export function obligationCoverageQueryAuthorityIdentity(context, { unit, sourceGeneration }) {
  return Object.freeze({
    ...authorityIdentity(context, { route: ROUTE, unit }),
    ...(context.managed ? { source_generation: sourceGeneration ?? null } : {})
  });
}

export function contractAssessmentAuthorityIdentity(context, { unit }) {
  return Object.freeze(authorityIdentity(context, { route: CONTRACT_ASSESSMENT_ROUTE, unit }));
}

export function queryObservationIdentity(focus, revision) {
  if (revision === null) return null;
  return focus === undefined || focus === null ? revision : `${focus}@${revision}`;
}

export function parseQueryObservationIdentity(observation) {
  if (typeof observation !== "string") return null;
  const at = observation.lastIndexOf("@");
  return at < 0 ? { focus: null, revision: observation }
    : { focus: observation.slice(0, at), revision: observation.slice(at + 1) };
}
