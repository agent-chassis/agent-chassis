

import {
  evaluateBootstrapReviewState,
  refuseCallerSuppliedIdentityFields,
  resolveCallerIdentity
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import {
  loadRuntimeBlockerTaxonomy
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  COORDINATION_PREFLIGHT_COMPLETE_RETRIEVAL,
  authenticateCoordinationPreflightOwnerFacts,
  runCoordinationPreflight
} from "@agent-chassis/wiki-core/src/lib/coordination-preflight.mjs";

import {
  buildNodeEngineAdmissionRuntimeDiagnostic
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-worker-admission.mjs";
import {
  AGENT_DISPATCH_TOOL_NAME,
  VALIDATE_DISPATCH_TOOL_NAME
} from "./dispatch-tool-constants.mjs";
import { VERIFY_PROOF_TOOL_NAME } from "./verify-proof-public-result.mjs";
import {
  compactRuntimeBlockerTaxonomy
} from "./dispatch-tool-helpers.mjs";
import {
  STDIO_MCP_CONDUIT_COMPOSITION_FACT_SOURCE,
  buildManagedStdioMcpCompositionRefusal
} from "@agent-chassis/agent-launch-cli/src/lib/stdio-mcp-conduit-composition-compatibility.mjs";
import {
  advanceTerminalReviewCandidate,
  appendAcceptedRepository,
  evaluateTerminalReviewCandidateStatus,
  TERMINAL_CANDIDATE_RUNTIME_CODES
} from "./dispatch-terminal-candidate-runtime.mjs";
import {
  projectTerminalCandidateExclusionRefusal,
  TERMINAL_CANDIDATE_EXCLUSION_REFUSED_CODE
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-terminal-candidate-coordination.mjs";
import {
  TERMINAL_WK_CANDIDATE_CODES
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

const CAPABILITY_FRESHNESS_FRESH = "fresh";
const FORGE_HANDOFF_TOOL_NAME = "workspace_wk_forge_handoff";

export const MANAGED_LIFECYCLE_CAPABILITY_NAMES = Object.freeze([
  "structured_dispatch",
  "native_edit",
  "repository_read_boundary",
  "commit",
  "managed_worktree_provisioning",
  "slice_to_wk_integration",
  "wk_context_review",
  "validation_ownership",
  "automatic_main_promotion"
]);

const CAPABILITY_RECOVERY = Object.freeze({
  kind: "structured_route",
  route: "workspace_coordination_preflight",
  arguments: Object.freeze({ role: "coordinator", target_dispatch_role: "worker" })
});

const CAPABILITY_BLOCKER = Object.freeze({
  structured_dispatch: "missing_structured_transport",
  native_edit: "managed_lifecycle_required",
  repository_read_boundary: "managed_lifecycle_required",
  commit: "managed_lifecycle_required",
  managed_worktree_provisioning: "managed_worktree_provisioning_unavailable",
  slice_to_wk_integration: "managed_lifecycle_required",
  wk_context_review: "managed_lifecycle_required",
  validation_ownership: "missing_structured_transport"
});

const AUTOMATIC_MAIN_PROMOTION_BLOCKER = Object.freeze({
  unavailable: "automatic_main_promotion_unavailable",
  stale: "automatic_main_promotion_fact_stale",
  unknown: "automatic_main_promotion_fact_unknown"
});

function runtimeRouteFact(registeredToolNames, route) {
  return {
    available: registeredToolNames instanceof Set && registeredToolNames.has(route),
    source: `mcp.runtime_registration.${route}`,
    freshness: { state: CAPABILITY_FRESHNESS_FRESH, basis: "live_server_registration" }
  };
}

function automaticMainPromotionGuidance(normalized, registeredToolNames) {
  if (normalized.available) return normalized;
  const publicationRoute = runtimeRouteFact(registeredToolNames, FORGE_HANDOFF_TOOL_NAME);
  const discovery = publicationRoute.available
    ? {
        kind: "structured_route",
        route: "workspace_tools_describe",
        arguments: { tool_name: FORGE_HANDOFF_TOOL_NAME, verbose: true },
        purpose: "read_explicit_publication_route_and_prerequisites"
      }
    : null;
  return {
    ...normalized,
    blockers: [AUTOMATIC_MAIN_PROMOTION_BLOCKER[normalized.status] ??
      AUTOMATIC_MAIN_PROMOTION_BLOCKER.unknown],
    recovery: discovery,
    publication_guidance: {
      automatic_promotion: "unavailable_or_unestablished",
      explanation:
        "Explicit forge handoff is separate from automatic main promotion and does not merge or complete the WK.",
      publication_route: {
        tool_name: FORGE_HANDOFF_TOOL_NAME,
        registered: publicationRoute.available,
        authority: {
          source: publicationRoute.source,
          freshness: publicationRoute.freshness
        },
        registration_establishes: ["route_registration"],
        registration_does_not_establish: [
          "candidate_readiness",
          "forge_configuration",
          "forge_permission",
          "successful_publication",
          "merge"
        ]
      },
      discovery
    }
  };
}

function normalizeCapabilityFact(name, fact, registeredToolNames) {
  const freshnessState = fact?.freshness?.state ?? "unknown";
  const authoritative = typeof fact?.source === "string" && fact.source.length > 0;
  const fresh = freshnessState === CAPABILITY_FRESHNESS_FRESH;
  const available = authoritative && fresh && fact?.available === true;
  const normalized = {
    name,
    available,
    status: available ? "available" : fresh && authoritative && fact?.available === false
      ? "unavailable"
      : freshnessState === "stale"
        ? "stale"
        : "unknown",
    authority: {
      source: authoritative ? fact.source : null,
      freshness: {
        state: freshnessState,
        basis: fact?.freshness?.basis ?? null
      }
    },
    blockers: available ? [] : [fact?.blocker?.code ?? CAPABILITY_BLOCKER[name]],
    recovery: available ? null : fact?.blocker?.recovery ?? CAPABILITY_RECOVERY
  };
  const projection = name === "structured_dispatch"
    ? {
        ...normalized,
        cause: available ? null : fact?.blocker?.cause ?? null,
        gate_outcome: fact?.gate_outcome ?? null,
        composition_compatibility: fact?.composition_compatibility ?? null
      }
    : normalized;
  return name === "automatic_main_promotion"
    ? automaticMainPromotionGuidance(projection, registeredToolNames)
    : projection;
}

function missingCompositionProjection() {
  return Object.freeze({
    available: false,
    gate_outcome: "missing_fact",
    fact: null,
    blocker: buildManagedStdioMcpCompositionRefusal("missing_fact")
  });
}

function compositionCapabilityFact(projection) {
  return Object.freeze({
    available: projection?.available === true,
    source: STDIO_MCP_CONDUIT_COMPOSITION_FACT_SOURCE,
    freshness: Object.freeze({ state: "fresh", basis: "current_backend_generation" }),
    composition_compatibility: projection?.fact ?? null,
    gate_outcome: projection?.gate_outcome ?? "malformed_fact",
    blocker: projection?.available === true
      ? null
      : projection?.blocker ?? buildManagedStdioMcpCompositionRefusal("malformed_fact")
  });
}

export function projectManagedLifecycleCapabilities({
  registeredToolNames,
  isPaidTier = false,
  authorityFacts = {}
} = {}) {
  const routeRegistration = runtimeRouteFact(registeredToolNames, AGENT_DISPATCH_TOOL_NAME);
  const composition = authorityFacts.structured_dispatch ?? Object.freeze({
    available: false,
    source: STDIO_MCP_CONDUIT_COMPOSITION_FACT_SOURCE,
    freshness: Object.freeze({ state: "fresh", basis: "current_backend_generation" }),
    composition_compatibility: null,
    gate_outcome: "missing_fact",
    blocker: buildManagedStdioMcpCompositionRefusal("missing_fact")
  });
  const facts = {
    validation_ownership: runtimeRouteFact(registeredToolNames, VERIFY_PROOF_TOOL_NAME),
    ...authorityFacts,
    structured_dispatch: {
      ...composition,
      available: routeRegistration.available === true && composition.available === true
    }
  };
  return {
    schema_version: "managed-lifecycle-capabilities.v1",
    enforcement: isPaidTier
      ? { tier: "paid_cce", mode: "cce_enforced", audit_grade: true }
      : { tier: "free_local", mode: "free_substrate", audit_grade: false },
    route_registration: Object.freeze({
      structured_dispatch: Object.freeze({ ...routeRegistration })
    }),
    planes: MANAGED_LIFECYCLE_CAPABILITY_NAMES.map((name) =>
      normalizeCapabilityFact(name, facts[name], registeredToolNames)
    )
  };
}

export function compactCoordinationPreflightCoverage(coverage) {
  if (coverage === null || typeof coverage !== "object") {
    return null;
  }
  const families = Array.isArray(coverage.families) ? coverage.families : [];
  return {
    schema_version: coverage.schema_version,

    family_count: families.length,
    evaluated_locally_count: coverage.evaluated_locally_count,
    projected_count: coverage.projected_count,
    not_evaluated_count: coverage.not_evaluated_count,
    omitted_count: coverage.omitted_count,

    omitted_family_detail_count: families.length,
    local_handling_vocabulary: coverage.local_handling_vocabulary,
    family_ids: coverage.family_ids,
    deferred_boundaries: coverage.deferred_boundaries,
    complete_retrieval: coverage.complete_retrieval
  };
}

export const COORDINATION_PREFLIGHT_DEFERRED_BOUNDARIES_MEMBER = "coverage.deferred_boundaries";

export function compactCoordinationPreflightProceedScope(proceedScope, coverage) {
  if (proceedScope === null || typeof proceedScope !== "object") return null;
  const boundaries = Array.isArray(proceedScope.deferred_boundaries)
    ? proceedScope.deferred_boundaries
    : [];
  const retained = Array.isArray(coverage?.deferred_boundaries)
    ? coverage.deferred_boundaries
    : null;

  if (retained === null || JSON.stringify(retained) !== JSON.stringify(boundaries)) {
    return proceedScope;
  }
  const { deferred_boundaries: _boundaries, ...rest } = proceedScope;
  return {
    ...rest,
    deferred_boundary_count: boundaries.length,
    deferred_boundaries_member: COORDINATION_PREFLIGHT_DEFERRED_BOUNDARIES_MEMBER
  };
}

export function compactManagedLifecycleCapabilities(capabilities) {
  if (capabilities === null || typeof capabilities !== "object") return capabilities ?? null;
  const planes = Array.isArray(capabilities.planes) ? capabilities.planes : [];
  const notAvailable = planes.filter(({ status }) => status !== "available");
  const { planes: _planes, ...rest } = capabilities;
  return {
    ...rest,
    plane_count: planes.length,
    plane_status: Object.fromEntries(planes.map(({ name, status }) => [name, status])),
    unavailable_planes: notAvailable,
    complete_retrieval: {
      ...COORDINATION_PREFLIGHT_COMPLETE_RETRIEVAL,
      returns: "capabilities.planes"
    }
  };
}

function resolveCoordinationPreflightWorkspace(resolveWorkspaceRepo, workspaceRepos, repo) {
  if (repo || workspaceRepos?.currentAlias) {
    return resolveWorkspaceRepo(workspaceRepos, repo);
  }

  const defaultRepo = String(process.env.WIKI_MCP_DEFAULT_REPO || "").trim();
  if (defaultRepo && workspaceRepos?.repos instanceof Map && workspaceRepos.repos.has(defaultRepo)) {
    return resolveWorkspaceRepo(workspaceRepos, defaultRepo);
  }

  return resolveWorkspaceRepo(workspaceRepos, repo);
}

export function registerDiagnosticRoutes(ctx) {
  const {
    registerTool,
    registeredToolNames,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    graphImpactPersistenceAvailable,
    dispatchReviewerAvailable,
    dispatchBackend,
    isPaidTier,
    evaluateTerminalReviewCandidateStatus: evaluateCandidateStatus =
      evaluateTerminalReviewCandidateStatus,
    advanceTerminalReviewCandidate: advanceCandidate = advanceTerminalReviewCandidate
  } = ctx;

  const terminalCandidateRouteCodes = new Set([
    ...Object.values(TERMINAL_CANDIDATE_RUNTIME_CODES),
    TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
    TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
    TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID,
    TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED,
    TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
    TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES,
    TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
    TERMINAL_CANDIDATE_EXCLUSION_REFUSED_CODE
  ]);
  const terminalCandidateRouteError = (error) => {
    const code = terminalCandidateRouteCodes.has(error?.code)
      ? error.code
      : TERMINAL_CANDIDATE_RUNTIME_CODES.ROUTE_FAILURE;
    return jsonContent({
      schema_version: "agent_launch.terminal_candidate_route_refusal.v1",
      ok: false,
      code,
      message: "terminal candidate route refused"
    });
  };

  const terminalCandidateAdvanceRouteError = (error, wkId, acceptedRepository) => {
    const exclusion = projectTerminalCandidateExclusionRefusal(error);
    if (exclusion === null) return terminalCandidateRouteError(error);
    return jsonContent({
      schema_version: "agent_launch.terminal_candidate_route_refusal.v1",
      ok: false,
      code: TERMINAL_CANDIDATE_EXCLUSION_REFUSED_CODE,
      message: "terminal candidate route refused",
      reason: exclusion.reason,
      recovery: exclusion.status_observation ? "observe_candidate_status" : "unavailable",
      next_call: exclusion.status_observation
        ? appendAcceptedRepository(Object.freeze({
          tool: "workspace_terminal_review_candidate_status",
          arguments: Object.freeze({ wk_id: wkId })
        }), acceptedRepository)
        : null
    });
  };

  registerTool(
    "workspace_terminal_review_candidate_status",
    {
      description:
        "Read a launcher-built managed terminal candidate; do not use for an operator-authorized direct-to-main review. Use workspace_agent_dispatch with diff_base_sha/reviewed_sha; the read-only reviewer creates no Git objects.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: z.string().regex(/^WK-\d{4}$/u),
        continuation: z.string().optional()
      }).strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args?.repo);
        const acceptedRepository = Object.hasOwn(args, "repo") ? workspace.repo : undefined;
        return jsonContent(await evaluateCandidateStatus({
          mainRepo: workspace.dir,
          wkId: args.wk_id,
          backend: dispatchBackend,
          acceptedRepository,
          continuation: args.continuation ?? null
        }));
      } catch (error) {
        return terminalCandidateRouteError(error);
      }
    }
  );

  registerTool(
    "workspace_terminal_review_candidate_advance",
    {
      description:
        "Advance an authenticated stale-W terminal candidate. Launcher derives the target under per-WK exclusion and performs fixed-ref CAS. Caller candidate/Git authority refuses.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: z.string().regex(/^WK-\d{4}$/u)
      }).strict()
    },
    async (args) => {
      let acceptedRepository;
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args?.repo);
        acceptedRepository = Object.hasOwn(args, "repo") ? workspace.repo : undefined;
        return jsonContent(await advanceCandidate({
          mainRepo: workspace.dir,
          wkId: args.wk_id,
          backend: dispatchBackend,
          acceptedRepository
        }));
      } catch (error) {
        return terminalCandidateAdvanceRouteError(error, args.wk_id, acceptedRepository);
      }
    }
  );

  registerTool(
    "workspace_runtime_blocker_taxonomy",
    {
      description:
        "Read canonical runtime blocker codes and recovery guidance. Consumers must use these codes. Compact by default; verbose:true adds full detail and mappings. Read-only.",
      inputSchema: {
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const taxonomy = loadRuntimeBlockerTaxonomy();
        if (args?.verbose === true) {
          return jsonContent({ ...taxonomy, verbose: true });
        }
        return jsonContent(compactRuntimeBlockerTaxonomy(taxonomy));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_node_engine_admission_runtime_diagnostic",
    {
      description:
        "Diagnose this server’s launcher-minted admission configuration using redacted presence flags and key names only. Read-only; accepts no caller environment. Missing configuration requires operator reconfiguration/restart.",
      inputSchema: {}
    },
    async () => {
      try {

        const diagnostic = buildNodeEngineAdmissionRuntimeDiagnostic(process.env);
        return jsonContent(diagnostic);
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_coordination_preflight",
    {
      description:
        "Read coordinator capabilities, freshness, blockers and next actions. Results cover reported families only, not full launch readiness. verbose:true adds complete diagnostics. Worker-dispatch preflight grants no worker identity.",
      inputSchema: {
        verbose: z.boolean().optional(),
        repo: z.string().optional(),
        role: z.enum(["coordinator", "worker", "reviewer", "redteam", "human_operator", "unknown"]).optional(),
        caller_session_role: z
          .enum(["coordinator", "worker", "reviewer", "redteam", "human_operator", "unknown"])
          .optional(),

        target_dispatch_role: z
          .enum(["coordinator", "worker", "reviewer", "redteam", "human_operator", "unknown"])
          .optional(),
        subject: z.string().optional(),
        graph_impact_state: z
          .object({
            graph_state: z.string().optional(),
            staleness: z.string().optional(),
            dirty_state: z.string().optional(),
            overlay_state: z.string().optional()
          })
          .optional(),
        graph_impact_required: z.boolean().optional(),
        review_evidence_recorded: z.boolean().optional(),

        identity_envelope: z
          .object({
            schema_version: z.string().optional(),
            role_kind: z.string().optional(),
            trust_source: z.string().optional(),
            mint_evidence: z.string().nullable().optional()
          })
          .optional(),

        env: z.record(z.unknown()).optional(),
        request: z.record(z.unknown()).optional(),
        prompt: z.record(z.unknown()).optional(),
        argv: z.record(z.unknown()).optional(),
        claimed_identity: z
          .object({
            role: z.string().optional()
          })
          .optional()
      }
    },
    async (args) => {
      try {
        const refusal = refuseCallerSuppliedIdentityFields(args);
        if (refusal) {
          return jsonContent({
            schema_version: "coordination-preflight.v1",
            refused: true,
            refusal: refusal,
            preflight: null
          });
        }
        const workspace = resolveCoordinationPreflightWorkspace(
          resolveWorkspaceRepo,
          workspaceRepos,
          args?.repo
        );

        const identity =
          args?.identity_envelope == null ? null : resolveCallerIdentity(args.identity_envelope);

        authenticateCoordinationPreflightOwnerFacts({ identity });
        const availableRoutes = [...registeredToolNames];

        const graphImpactPersistence = graphImpactPersistenceAvailable();
        const dispatchAvailable = registeredToolNames.has(AGENT_DISPATCH_TOOL_NAME);
        const reviewerAvailable = dispatchReviewerAvailable();
        if (dispatchAvailable && reviewerAvailable) {
          availableRoutes.push("workspace_agent_dispatch:reviewer");
        }
        const structuredDispatchCompatibility =
          typeof dispatchBackend?.getManagedStdioMcpCompositionCompatibility === "function"
            ? dispatchBackend.getManagedStdioMcpCompositionCompatibility()
            : missingCompositionProjection();
        const preflight = await runCoordinationPreflight({
          dir: workspace.dir,
          role: args?.role ?? "coordinator",
          caller_session_role: args?.caller_session_role ?? null,
          target_dispatch_role: args?.target_dispatch_role ?? null,
          identity: identity,
          subject: args?.subject ?? null,
          available_structured_routes: availableRoutes,
          structured_dispatch_compatibility: structuredDispatchCompatibility,
          graph_impact_state: args?.graph_impact_state ?? null,

          cce_policy_projection: null
        });
        const bootstrap = evaluateBootstrapReviewState({
          mcp_dispatch_reviewer_available: reviewerAvailable,
          graph_impact_persistence_available: graphImpactPersistence,
          graph_impact_required: Boolean(args?.graph_impact_required),
          review_evidence_recorded: Boolean(args?.review_evidence_recorded)
        });
        const fullEnvelope = {
          workspaceRepo: workspace.repo,
          ...preflight,
          bootstrap_review: bootstrap,
          mcp_dispatch_reviewer_available: reviewerAvailable,
          graph_impact_persistence_available: graphImpactPersistence
        };
        const backendAuthorityFacts =
          typeof dispatchBackend?.getManagedLifecycleCapabilityAuthorityFacts === "function"
            ? await dispatchBackend.getManagedLifecycleCapabilityAuthorityFacts()
            : {};

        const authorityFacts = {
          ...backendAuthorityFacts,
          structured_dispatch: compositionCapabilityFact(
            structuredDispatchCompatibility
          )
        };
        const capabilities = projectManagedLifecycleCapabilities({
          registeredToolNames,
          isPaidTier,
          authorityFacts
        });
        if (args?.verbose === true) {
          return jsonContent({
            ...fullEnvelope,
            dispatch_route_registered: dispatchAvailable,
            reviewer_dispatch_route_registered: dispatchAvailable && reviewerAvailable,
            redteam_dispatch_route_registered: dispatchAvailable,
            dispatch_available: dispatchAvailable &&
              structuredDispatchCompatibility.available === true,
            reviewer_dispatch_available: reviewerAvailable &&
              structuredDispatchCompatibility.available === true,
            redteam_dispatch_available: dispatchAvailable &&
              structuredDispatchCompatibility.available === true,
            capabilities,
            verbose: true
          });
        }

        const routes = Array.isArray(preflight.available_structured_routes)
          ? preflight.available_structured_routes
          : [];
        const allowedSurfaces = Array.isArray(preflight.allowed_write_surfaces)
          ? preflight.allowed_write_surfaces
          : [];
        const forbiddenSurfaces = Array.isArray(preflight.forbidden_write_surfaces)
          ? preflight.forbidden_write_surfaces
          : [];
        const validateDispatchAvailable = registeredToolNames.has(VALIDATE_DISPATCH_TOOL_NAME);
        return jsonContent({
          schema_version: preflight.schema_version,
          verbose: false,
          workspaceRepo: workspace.repo,
          role: preflight.role,
          caller_session_role: preflight.caller_session_role,
          target_dispatch_role: preflight.target_dispatch_role,
          subject: preflight.subject,
          identity: preflight.identity,
          repo_mount_writable: preflight.repo_mount_writable,
          repo_readable: preflight.repo_readable,
          docs_writable: preflight.docs_writable,
          wiki_writable: preflight.wiki_writable,
          implementation_test_edits_forbidden: preflight.implementation_test_edits_forbidden,
          dispatch_route_registered: dispatchAvailable,
          reviewer_dispatch_route_registered: dispatchAvailable && reviewerAvailable,
          redteam_dispatch_route_registered: dispatchAvailable,
          dispatch_available: dispatchAvailable &&
            structuredDispatchCompatibility.available === true,
          reviewer_dispatch_available: reviewerAvailable &&
            structuredDispatchCompatibility.available === true,
          redteam_dispatch_available: dispatchAvailable &&
            structuredDispatchCompatibility.available === true,
          validate_dispatch_available: validateDispatchAvailable,
          route_count: routes.length,
          allowed_surface_count: allowedSurfaces.length,
          forbidden_surface_count: forbiddenSurfaces.length,
          structured_dispatch: preflight.structured_dispatch,
          coverage: compactCoordinationPreflightCoverage(preflight.coverage),
          proceed_scope: compactCoordinationPreflightProceedScope(
            preflight.proceed_scope,
            preflight.coverage
          ),
          writeback: preflight.writeback,
          blockers: preflight.blockers,
          analysis_blocked: preflight.analysis_blocked,
          blocking: preflight.blocking,
          next_action: preflight.next_action,
          bootstrap_review: bootstrap,
          mcp_dispatch_reviewer_available: reviewerAvailable,
          graph_impact_persistence_available: graphImpactPersistence,
          capabilities: compactManagedLifecycleCapabilities(capabilities)
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
