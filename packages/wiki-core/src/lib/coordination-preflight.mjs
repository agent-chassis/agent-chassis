

import { access, constants, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  evaluateGraphImpactBlocker,
  getRuntimeBlockerEntry,
  RUNTIME_BLOCKER_CODES,
  RUNTIME_BLOCKER_TAXONOMY_SCHEMA_VERSION
} from "./runtime-blocker-taxonomy.mjs";
import {
  AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
  CALLER_ROLE_KIND_VALUES,
  isAcceptedIdentityTrustSource
} from "./agent-dispatch-identity.mjs";

export const COORDINATION_PREFLIGHT_SCHEMA_VERSION = "coordination-preflight.v1";

export const COORDINATOR_ALLOWED_WRITE_SURFACES = Object.freeze([
  "docs/",
  "wiki/",
  "wiki/initiatives/",
  "wiki/decisions/",
  "wiki/issues/",
  "wiki/sources/",
  "wiki/work-records/"
]);

export const COORDINATOR_FORBIDDEN_WRITE_SURFACES = Object.freeze([
  "packages/",
  "tests/",
  ".agent-runs/"
]);

export const COORDINATION_PREFLIGHT_COVERAGE_SCHEMA_VERSION =
  "coordination-preflight-coverage.v1";

export const COORDINATION_PREFLIGHT_LOCAL_HANDLING_VALUES = Object.freeze([
  "evaluated_locally",
  "projected",
  "not_evaluated"
]);

export const COORDINATION_PREFLIGHT_FACT_FAMILY_IDS = Object.freeze([
  "coordinator_identity_and_role",
  "repository_docs_wiki_mount_and_writeback",
  "structured_route_registration",
  "launcher_active_composition_compatibility",
  "graph_impact",
  "local_dispatch_structural_readiness",
  "cce_declaration_admissibility_and_policy",
  "launcher_backend_provisioning_and_spawn_readiness"
]);

export const CCE_POLICY_PROJECTION_SCHEMA_VERSIONS = Object.freeze([
  "cce-boundary-policy-decision.v1",
  "launcher-authenticated-no-cce-authority-declaration.v1"
]);

export const COORDINATION_PREFLIGHT_COMPLETE_RETRIEVAL = Object.freeze({
  kind: "structured_route",
  route: "workspace_coordination_preflight",
  argument: "verbose",
  value: true,
  returns: "coverage.families"
});

const PROJECTION_BY_REFERENCE_SCHEMAS = new Set([
  "launcher-transition-plan.v1",
  ...CCE_POLICY_PROJECTION_SCHEMA_VERSIONS
]);

const OWNER_BOUND_IDENTITY_FACTS = new WeakSet();
const OWNER_BOUND_CCE_POLICY_PROJECTIONS = new WeakSet();

const READ_ONLY_ROLE_VALUES = Object.freeze(["reviewer", "redteam"]);

const ROLE_KIND_VALUES = Object.freeze([
  "coordinator",
  "worker",
  "reviewer",
  "redteam",
  "human_operator",
  "unknown"
]);

function freezeDeep(value) {
  if (PROJECTION_BY_REFERENCE_SCHEMAS.has(value?.schema_version) && Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      freezeDeep(value[key]);
    }
    return Object.freeze(value);
  }
  return value;
}

function buildBlocker(code, evidence = {}) {
  const entry = getRuntimeBlockerEntry(code);
  return {
    schema_version: RUNTIME_BLOCKER_TAXONOMY_SCHEMA_VERSION,
    code,
    category: entry?.category ?? null,
    blocking: Boolean(entry?.blocking),
    summary: entry?.summary ?? null,
    evidence
  };
}

function isReadOnlyDispatchRole(role) {
  return READ_ONLY_ROLE_VALUES.includes(role);
}

function isObjectReference(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function authenticateCoordinationPreflightOwnerFacts({
  identity = null,
  cce_policy_projection = null
} = {}) {
  if (isObjectReference(identity)) {
    OWNER_BOUND_IDENTITY_FACTS.add(identity);
  }
  if (isObjectReference(cce_policy_projection)) {
    OWNER_BOUND_CCE_POLICY_PROJECTIONS.add(cce_policy_projection);
  }
  return Object.freeze({ identity, cce_policy_projection });
}

function classifyIdentityProjection(identity) {
  if (identity === null || identity === undefined) {
    return { carrier_state: "absent", authenticated: false };
  }
  if (!isObjectReference(identity)) {
    return { carrier_state: "malformed_identity_envelope", authenticated: false };
  }
  if (identity.accepted === false) {
    return { carrier_state: "rejected_identity_envelope", authenticated: false };
  }
  const completeAcceptedShape =
    identity.schema_version === AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION &&
    identity.accepted === true &&
    CALLER_ROLE_KIND_VALUES.includes(identity.role_kind) &&
    isAcceptedIdentityTrustSource(identity.trust_source) &&
    Object.isFrozen(identity);
  if (!completeAcceptedShape) {
    return { carrier_state: "malformed_identity_envelope", authenticated: false };
  }
  if (!OWNER_BOUND_IDENTITY_FACTS.has(identity)) {
    return { carrier_state: "unauthenticated_identity_envelope", authenticated: false };
  }
  return { carrier_state: "accepted_owner_minted_identity", authenticated: true };
}

function classifyCcePolicyProjection(carrier) {
  if (carrier === null || carrier === undefined) {
    return { carrier_state: "absent", authenticated: false };
  }
  if (typeof carrier !== "object" || Array.isArray(carrier)) {
    return { carrier_state: "malformed_carrier", authenticated: false };
  }
  if (!CCE_POLICY_PROJECTION_SCHEMA_VERSIONS.includes(carrier.schema_version)) {
    return { carrier_state: "unrecognized_carrier", authenticated: false };
  }
  if (!Object.isFrozen(carrier)) {
    return { carrier_state: "unauthenticated_carrier", authenticated: false };
  }
  if (!OWNER_BOUND_CCE_POLICY_PROJECTIONS.has(carrier)) {

    return { carrier_state: "unauthenticated_carrier", authenticated: false };
  }
  return { carrier_state: "authenticated_projection", authenticated: true };
}

function buildFactFamilies({
  identityFact,
  compositionSupplied,
  graphImpactSupplied,
  validateDispatchRouteRegistered,
  ccePolicy,
  launcherPlanSupplied
}) {
  return [
    {
      family: "coordinator_identity_and_role",

      evaluation_origin: "workspace_agent_dispatch_identity_contract",
      local_handling: identityFact.authenticated ? "projected" : "not_evaluated",
      authoritative_boundary: "workspace_agent_dispatch_identity_contract",
      state: identityFact.carrier_state,
      discloses: ["role", "caller_session_role", "target_dispatch_role", "identity"]
    },
    {
      family: "repository_docs_wiki_mount_and_writeback",
      evaluation_origin: "coordination_preflight",
      local_handling: "evaluated_locally",
      authoritative_boundary: "coordination_preflight",
      state: "probed",
      discloses: [
        "repo_mount_writable",
        "repo_readable",
        "docs_writable",
        "wiki_writable",
        "writeback",
        "filesystem_diagnostics"
      ]
    },
    {
      family: "structured_route_registration",
      evaluation_origin: "mcp_runtime_registration",
      local_handling: "evaluated_locally",
      authoritative_boundary: "wiki_mcp_tool_registration",
      state: "live_registration_read",

      discloses: ["available_structured_routes", "structured_dispatch.route_registered"]
    },
    {
      family: "launcher_active_composition_compatibility",
      evaluation_origin: "launcher_stdio_mcp_composition_authority",
      local_handling: compositionSupplied ? "projected" : "not_evaluated",
      authoritative_boundary: "agent_launch_launcher",
      state: compositionSupplied ? "closed_gate_projected" : "no_composition_fact_supplied",
      discloses: ["structured_dispatch"]
    },
    {
      family: "graph_impact",
      evaluation_origin: graphImpactSupplied
        ? "coordination_preflight"
        : "workspace_code_index_graph_impact",

      local_handling: graphImpactSupplied ? "evaluated_locally" : "not_evaluated",
      authoritative_boundary: "workspace_code_index_graph_impact",
      state: graphImpactSupplied ? "degraded_state_mapped" : "no_graph_state_supplied",
      discloses: ["blockers"]
    },
    {
      family: "local_dispatch_structural_readiness",
      evaluation_origin: "workspace_validate_dispatch",

      local_handling: "not_evaluated",
      authoritative_boundary: "workspace_validate_dispatch",
      state: validateDispatchRouteRegistered
        ? "route_registered_not_called"
        : "route_not_registered",
      discloses: []
    },
    {
      family: "cce_declaration_admissibility_and_policy",
      evaluation_origin: "chassis_control_engine",
      local_handling: ccePolicy.authenticated ? "projected" : "not_evaluated",
      authoritative_boundary: "chassis_control_engine",
      state: ccePolicy.carrier_state,

      local_policy_verdict: null,
      policy_classification: ccePolicy.authenticated
        ? "cce_owned_projection"
        : "non_policy",
      projected_fact: ccePolicy.authenticated ? ccePolicy.carrier : null,
      discloses: ["coverage.families[cce_declaration_admissibility_and_policy]"]
    },
    {
      family: "launcher_backend_provisioning_and_spawn_readiness",
      evaluation_origin: "agent_launch_launcher",
      local_handling: launcherPlanSupplied ? "projected" : "not_evaluated",
      authoritative_boundary: "agent_launch_launcher",
      state: launcherPlanSupplied
        ? "transition_plan_projected"
        : "no_launcher_projection_supplied",

      discloses: ["launcher_transition_plan"]
    }
  ];
}

export function evaluateCoordinationPreflight({
  role = "unknown",
  caller_session_role = null,
  identity = null,
  subject = null,
  target_dispatch_role = null,
  repo_mount_writable = null,
  repo_readable = null,
  docs_writable = null,
  wiki_writable = null,
  available_structured_routes = [],
  structured_dispatch_compatibility = null,
  graph_impact_state = null,
  launcher_transition_plan = null,

  cce_policy_projection = null
} = {}) {
  if (launcher_transition_plan !== null &&
      (launcher_transition_plan?.schema_version !== "launcher-transition-plan.v1" ||
        !Object.isFrozen(launcher_transition_plan))) {
    throw new TypeError("coordination preflight requires the exact frozen launcher transition plan");
  }
  const normalizedRole = ROLE_KIND_VALUES.includes(role) ? role : "unknown";
  const normalizedCaller =
    caller_session_role === null
      ? null
      : ROLE_KIND_VALUES.includes(caller_session_role)
        ? caller_session_role
        : "unknown";

  const normalizedTargetDispatch =
    target_dispatch_role === null
      ? null
      : ROLE_KIND_VALUES.includes(target_dispatch_role)
        ? target_dispatch_role
        : "unknown";
  const coordinatorDispatchingWorker =
    normalizedRole === "coordinator" && normalizedTargetDispatch === "worker";

  const coordinatorDispatchingReadOnly =
    normalizedRole === "coordinator" && isReadOnlyDispatchRole(normalizedTargetDispatch);
  const readOnlyDispatchRequested =
    isReadOnlyDispatchRole(normalizedRole) ||
    (normalizedRole === "unknown" && isReadOnlyDispatchRole(normalizedCaller));

  const repoInputsReadable = repo_readable !== false;

  const blockers = [];
  const diagnostics = [];

  let writebackBlocked = false;
  let writebackRemediation = null;

  if (normalizedCaller && normalizedCaller !== normalizedRole) {
    blockers.push(
      buildBlocker(RUNTIME_BLOCKER_CODES.CALLER_ROLE_MISMATCH, {
        requested_role: normalizedRole,
        caller_session_role: normalizedCaller
      })
    );
  }

  if (identity && identity.accepted === false && identity.refusal_code) {
    blockers.push(
      buildBlocker(RUNTIME_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY, {
        identity_refusal_code: identity.refusal_code,
        identity_refusal_carrier: identity.detail?.carrier ?? null
      })
    );
  }

  const docsAndWikiWritable = docs_writable !== false && wiki_writable !== false;
  const mountReadOnly = repo_mount_writable === false;
  const docsOrWikiUnwritable = docs_writable === false || wiki_writable === false;

  if (readOnlyDispatchRequested && mountReadOnly) {
    if (!repoInputsReadable) {

      diagnostics.push(
        freezeDeep({
          kind: "read_only_mount_evidence",
          classification: "analysis_blocked",
          blocking: true,
          carveout_applied: false,
          read_only_dispatch_requested: true,
          repo_mount_writable,
          repo_readable,
          docs_writable,
          wiki_writable,
          summary:
            "Repo inputs are not readable, so findings-only analysis cannot proceed."
        })
      );
      blockers.push(
        buildBlocker(RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT, {
          classification: "analysis_blocked",
          repo_mount_writable,
          repo_readable,
          docs_writable,
          wiki_writable,
          read_only_dispatch_requested: true,
          read_only_dispatch_carveout_applied: false
        })
      );
    } else if (docsAndWikiWritable) {

      diagnostics.push(
        freezeDeep({
          kind: "read_only_mount_evidence",
          classification: "writeback_available",
          blocking: false,
          carveout_applied: true,
          read_only_dispatch_requested: true,
          repo_mount_writable,
          repo_readable,
          docs_writable,
          wiki_writable,
          summary:
            "Read-only dispatch can proceed because docs/ and wiki/ remain writable."
        })
      );
    } else {

      writebackBlocked = true;
      writebackRemediation =
        "Findings-only analysis can proceed now. Durable docs/ and wiki/ writeback is unavailable in this session; record conclusions through a writable coordinator session or operator follow-up rather than treating this as an analysis blocker.";
      diagnostics.push(
        freezeDeep({
          kind: "writeback_blocked_evidence",
          classification: "writeback_blocked",
          blocking: false,
          carveout_applied: true,
          read_only_dispatch_requested: true,
          repo_mount_writable,
          repo_readable,
          docs_writable,
          wiki_writable,
          summary: writebackRemediation
        })
      );
    }
  } else if (coordinatorDispatchingWorker && mountReadOnly) {

    if (docsAndWikiWritable) {
      diagnostics.push(
        freezeDeep({
          kind: "read_only_mount_evidence",
          classification: "coordinator_worker_dispatch",
          blocking: false,
          carveout_applied: true,
          coordinator_dispatching_worker: true,
          target_dispatch_role: normalizedTargetDispatch,
          repo_mount_writable,
          repo_readable,
          docs_writable,
          wiki_writable,
          summary:
            "Coordinator is preflighting a structured worker dispatch; implementation writes happen in the launcher-owned worker child session. Coordinator docs/ and wiki/ write authority is available."
        })
      );
    } else {

      diagnostics.push(
        freezeDeep({
          kind: "read_only_mount_evidence",
          classification: "analysis_blocked",
          blocking: true,
          carveout_applied: false,
          coordinator_dispatching_worker: true,
          target_dispatch_role: normalizedTargetDispatch,
          repo_mount_writable,
          repo_readable,
          docs_writable,
          wiki_writable,
          summary:
            "Read-only repo root with unavailable docs/ or wiki/ blocks coordinator write authority even when dispatching a worker."
        })
      );
      blockers.push(
        buildBlocker(RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT, {
          coordinator_worker_dispatch: true,
          repo_mount_writable,
          docs_writable,
          wiki_writable,
          read_only_dispatch_requested: readOnlyDispatchRequested,
          read_only_dispatch_carveout_applied: false
        })
      );
    }
  } else if (coordinatorDispatchingReadOnly && mountReadOnly) {

    if (docsAndWikiWritable) {
      diagnostics.push(
        freezeDeep({
          kind: "read_only_mount_evidence",
          classification: "coordinator_readonly_target_dispatch",
          blocking: false,
          carveout_applied: true,
          coordinator_dispatching_readonly_role: true,
          target_dispatch_role: normalizedTargetDispatch,
          repo_mount_writable,
          repo_readable,
          docs_writable,
          wiki_writable,
          summary:
            "Coordinator is preflighting a findings-only dispatch; no implementation writes required. Coordinator docs/ and wiki/ write authority is available."
        })
      );
    } else {

      diagnostics.push(
        freezeDeep({
          kind: "read_only_mount_evidence",
          classification: "analysis_blocked",
          blocking: true,
          carveout_applied: false,
          coordinator_dispatching_readonly_role: true,
          target_dispatch_role: normalizedTargetDispatch,
          repo_mount_writable,
          repo_readable,
          docs_writable,
          wiki_writable,
          summary:
            "Read-only repo root with unavailable docs/ or wiki/ blocks coordinator write authority even when dispatching a findings-only role."
        })
      );
      blockers.push(
        buildBlocker(RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT, {
          coordinator_readonly_target_dispatch: true,
          target_dispatch_role: normalizedTargetDispatch,
          repo_mount_writable,
          docs_writable,
          wiki_writable,
          read_only_dispatch_requested: readOnlyDispatchRequested,
          read_only_dispatch_carveout_applied: false
        })
      );
    }
  } else if (mountReadOnly) {

    diagnostics.push(
      freezeDeep({
        kind: "read_only_mount_evidence",
        classification: "analysis_blocked",
        blocking: true,
        carveout_applied: false,
        read_only_dispatch_requested: readOnlyDispatchRequested,
        repo_mount_writable,
        repo_readable,
        docs_writable,
        wiki_writable,
        summary: "Read-only repo root blocks required writes for the selected role."
      })
    );
    blockers.push(
      buildBlocker(RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT, {
        repo_mount_writable,
        docs_writable,
        wiki_writable,
        read_only_dispatch_requested: readOnlyDispatchRequested,
        read_only_dispatch_carveout_applied: false
      })
    );
  } else if (docsOrWikiUnwritable) {

    blockers.push(
      buildBlocker(RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT, {
        partial: true,
        repo_mount_writable,
        docs_writable,
        wiki_writable,
        read_only_dispatch_requested: readOnlyDispatchRequested,
        read_only_dispatch_carveout_applied: false
      })
    );
  }

  const routeNames = new Set(
    Array.isArray(available_structured_routes)
      ? available_structured_routes.filter((entry) => typeof entry === "string")
      : []
  );
  const reviewerRouteAvailable = routeNames.has("workspace_agent_dispatch:reviewer");
  const dispatchRouteAvailable = routeNames.has("workspace_agent_dispatch");
  if (!dispatchRouteAvailable) {
    blockers.push(
      buildBlocker(RUNTIME_BLOCKER_CODES.MISSING_STRUCTURED_TRANSPORT, {
        missing_route: "workspace_agent_dispatch"
      })
    );
  }
  if (!reviewerRouteAvailable) {
    blockers.push(
      buildBlocker(RUNTIME_BLOCKER_CODES.MANDATORY_REVIEW_TRANSPORT_BLOCKED, {
        missing_route: "workspace_agent_dispatch:reviewer",
        note:
          "when reviewer dispatch is unavailable in-session, mandatory findings-only review for bootstrap-covered implementation WKs must use the WK-0532 bootstrap exception"
      })
    );
  }

  const compositionProjection = structured_dispatch_compatibility === null
    ? null
    : freezeDeep({
        route_registered: dispatchRouteAvailable,
        available: dispatchRouteAvailable &&
          structured_dispatch_compatibility.available === true,
        gate_outcome: structured_dispatch_compatibility.gate_outcome ?? "malformed_fact",
        fact: structured_dispatch_compatibility.fact ?? null,
        blocker: structured_dispatch_compatibility.blocker ?? null
      });
  if (compositionProjection !== null && compositionProjection.available !== true) {
    const refusal = compositionProjection.blocker ?? {};
    blockers.push(
      buildBlocker(RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED, {
        cause: refusal.cause ?? "stdio_mcp_lifecycle_protocol_incompatible",
        recovery: refusal.recovery ??
          "deploy one coherent build and restart the long-lived backend",
        gate_outcome: compositionProjection.gate_outcome
      })
    );
  }

  if (graph_impact_state) {
    const graphBlocker = evaluateGraphImpactBlocker(graph_impact_state);
    if (graphBlocker) {
      blockers.push(graphBlocker);
    }
  }

  const blocking = blockers.some((entry) => entry.blocking);

  const nextAction = blocking
    ? "resolve_blockers"
    : writebackBlocked
      ? "proceed_read_only_dispatch_writeback_blocked"
      : "proceed";

  const ccePolicy = {
    ...classifyCcePolicyProjection(cce_policy_projection),
    carrier: cce_policy_projection
  };
  const identityFact = classifyIdentityProjection(identity);
  const families = buildFactFamilies({
    identityFact,
    compositionSupplied: structured_dispatch_compatibility !== null,
    graphImpactSupplied: Boolean(graph_impact_state),
    validateDispatchRouteRegistered: routeNames.has("workspace_validate_dispatch"),
    ccePolicy,
    launcherPlanSupplied: launcher_transition_plan !== null
  });
  const countBy = (handling) =>
    families.filter((entry) => entry.local_handling === handling).length;
  const evaluatedLocallyCount = countBy("evaluated_locally");
  const projectedCount = countBy("projected");
  const notEvaluatedCount = countBy("not_evaluated");
  const deferredBoundaries = families
    .filter((entry) => entry.local_handling !== "evaluated_locally")
    .map((entry) => ({
      family: entry.family,
      local_handling: entry.local_handling,
      authoritative_boundary: entry.authoritative_boundary
    }));

  const coverage = {
    schema_version: COORDINATION_PREFLIGHT_COVERAGE_SCHEMA_VERSION,
    local_handling_vocabulary: COORDINATION_PREFLIGHT_LOCAL_HANDLING_VALUES.slice(),
    family_ids: COORDINATION_PREFLIGHT_FACT_FAMILY_IDS.slice(),
    family_count: families.length,
    evaluated_locally_count: evaluatedLocallyCount,
    projected_count: projectedCount,
    not_evaluated_count: notEvaluatedCount,

    omitted_count: projectedCount + notEvaluatedCount,
    families,
    deferred_boundaries: deferredBoundaries,
    complete_retrieval: COORDINATION_PREFLIGHT_COMPLETE_RETRIEVAL
  };

  const proceedScope = {
    next_action: nextAction,
    proceed: !blocking,
    scope: "locally_evaluated_and_projected_coordination_facts",
    asserts_complete_launch_readiness: false,
    launch_readiness_owner: "agent_launch_launcher",
    deferred_boundaries: deferredBoundaries,
    summary:
      "A proceed result means no coordination blocker was found among the fact families preflight evaluated or reported. It is not complete launch readiness: the deferred boundaries listed here still own their own facts."
  };

  const writePolicy = {
    role: normalizedRole,
    allowed_roots: COORDINATOR_ALLOWED_WRITE_SURFACES.slice(),
    forbidden_roots: COORDINATOR_FORBIDDEN_WRITE_SURFACES.slice(),
    implementation_test_edits_forbidden: normalizedRole === "coordinator",

    enforcement_seam: "launcher_role_plan_admission",
    enforcement_seam_owner: "WK-0526"
  };

  return freezeDeep({
    schema_version: COORDINATION_PREFLIGHT_SCHEMA_VERSION,
    role: normalizedRole,
    caller_session_role: normalizedCaller,
    target_dispatch_role: normalizedTargetDispatch,
    subject: subject ?? null,
    identity: identity
      ? {
          accepted: Boolean(identity.accepted),
          role_kind: identity.role_kind ?? null,
          trust_source: identity.trust_source ?? null,
          refusal_code: identity.refusal_code ?? null
        }
      : null,
    allowed_write_surfaces: COORDINATOR_ALLOWED_WRITE_SURFACES.slice(),
    forbidden_write_surfaces: COORDINATOR_FORBIDDEN_WRITE_SURFACES.slice(),
    implementation_test_edits_forbidden: normalizedRole === "coordinator",
    write_policy: writePolicy,
    repo_mount_writable,
    repo_readable,
    docs_writable,
    wiki_writable,

    writeback: {
      docs_writable,
      wiki_writable,
      blocked: writebackBlocked,
      remediation: writebackRemediation
    },
    filesystem_diagnostics: diagnostics,
    available_structured_routes: [...routeNames].sort(),
    structured_dispatch: compositionProjection ?? freezeDeep({
      route_registered: dispatchRouteAvailable,
      available: dispatchRouteAvailable,
      gate_outcome: null,
      fact: null,
      blocker: null
    }),

    launcher_transition_plan,
    blockers,

    analysis_blocked: blocking,
    blocking,
    next_action: nextAction,

    coverage,
    proceed_scope: proceedScope
  });
}

async function probeWritable(targetPath) {

  try {
    await access(targetPath, constants.F_OK);
  } catch {
    return null;
  }
  try {
    const probeDir = await mkdtemp(path.join(targetPath, ".coordination-preflight-"));
    const probeFile = path.join(probeDir, "probe");
    await writeFile(probeFile, "probe", "utf8");
    await rm(probeDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
      return false;
    }
    if (code === "ENOENT") {
      return null;
    }
    return false;
  }
}

async function probeRepoMountWritable(repoDir) {
  try {
    const repoStat = await stat(repoDir);
    if (!repoStat.isDirectory()) {
      return false;
    }
  } catch {
    return null;
  }
  return probeWritable(repoDir);
}

async function probeRepoMountReadable(repoDir) {

  try {
    const repoStat = await stat(repoDir);
    if (!repoStat.isDirectory()) {
      return false;
    }
  } catch {
    return null;
  }
  try {
    await access(repoDir, constants.R_OK);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code === "ENOENT") {
      return null;
    }
    return false;
  }
}

export async function runCoordinationPreflight({
  dir,
  role = "coordinator",
  caller_session_role = null,
  identity = null,
  subject = null,
  target_dispatch_role = null,
  available_structured_routes = [],
  structured_dispatch_compatibility = null,
  graph_impact_state = null,
  launcher_transition_plan = null,
  cce_policy_projection = null
} = {}) {
  if (!dir) {
    throw new Error("runCoordinationPreflight requires a repository directory");
  }
  const [repoWritable, repoReadable, docsWritable, wikiWritable] = await Promise.all([
    probeRepoMountWritable(dir),
    probeRepoMountReadable(dir),
    probeWritable(path.join(dir, "docs")),
    probeWritable(path.join(dir, "wiki"))
  ]);
  return evaluateCoordinationPreflight({
    role,
    caller_session_role,
    identity,
    subject,
    target_dispatch_role,
    repo_mount_writable: repoWritable,
    repo_readable: repoReadable,
    docs_writable: docsWritable,
    wiki_writable: wikiWritable,
    available_structured_routes,
    structured_dispatch_compatibility,
    graph_impact_state,
    launcher_transition_plan,
    cce_policy_projection
  });
}

export const __testing = Object.freeze({
  probeWritable,
  probeRepoMountWritable,
  probeRepoMountReadable,
  tmpRoot: () => os.tmpdir()
});
