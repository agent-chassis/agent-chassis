

import {
  evaluateBootstrapReviewState,
  refuseCallerSuppliedIdentityFields,
  resolveCallerIdentity
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import {
  loadRuntimeBlockerTaxonomy
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
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
import {
  compactRuntimeBlockerTaxonomy
} from "./dispatch-tool-helpers.mjs";
import {
  STDIO_MCP_CONDUIT_COMPOSITION_FACT_SOURCE,
  buildManagedStdioMcpCompositionRefusal
} from "@agent-chassis/agent-launch-cli/src/lib/stdio-mcp-conduit-composition-compatibility.mjs";
import {
  advanceTerminalReviewCandidate,
  evaluateTerminalReviewCandidateStatus,
  TERMINAL_CANDIDATE_RUNTIME_CODES
} from "./dispatch-terminal-candidate-runtime.mjs";
import {
  TERMINAL_WK_CANDIDATE_CODES
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

const CAPABILITY_FRESHNESS_FRESH = "fresh";

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
  validation_ownership: "missing_structured_transport",
  automatic_main_promotion: "managed_lifecycle_required"
});

function runtimeRouteFact(registeredToolNames, route) {
  return {
    available: registeredToolNames instanceof Set && registeredToolNames.has(route),
    source: `mcp.runtime_registration.${route}`,
    freshness: { state: CAPABILITY_FRESHNESS_FRESH, basis: "live_server_registration" }
  };
}

function normalizeCapabilityFact(name, fact) {
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
  return name === "structured_dispatch"
    ? {
        ...normalized,
        cause: available ? null : fact?.blocker?.cause ?? null,
        gate_outcome: fact?.gate_outcome ?? null,
        composition_compatibility: fact?.composition_compatibility ?? null
      }
    : normalized;
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
    validation_ownership: runtimeRouteFact(registeredToolNames, "workspace_run_validation"),
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
      normalizeCapabilityFact(name, facts[name])
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
    "agent_launch.terminal_candidate.exclusion_refused.v1"
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

  registerTool(
    "workspace_terminal_review_candidate_status",
    {
      description:
        "Read the launcher-owned terminal-review candidate state for one WK. Use only for a launcher-built managed terminal candidate; do not use for an operator-authorized direct-to-main review. Direct-to-main review first commits the exact scoped candidate, then uses workspace_agent_dispatch with a canonical WK or review-slice subject plus the complete diff_base_sha/reviewed_sha pair. The reviewer remains read-only and creates no Git objects. This route observes only exact candidate/fork/W authority and canonical coordination. Read-only; caller input cannot supply candidate identity, refs, SHAs, paths, policy, or pagination size.",
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
        "Advance only a mechanically authenticated stale-W terminal-review candidate. The launcher re-evaluates status inside its per-WK exclusion, derives deterministic C from exact B/W authority, and performs one fixed-ref CAS. Caller input cannot supply any candidate or Git authority.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: z.string().regex(/^WK-\d{4}$/u)
      }).strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args?.repo);
        const acceptedRepository = Object.hasOwn(args, "repo") ? workspace.repo : undefined;
        return jsonContent(await advanceCandidate({
          mainRepo: workspace.dir,
          wkId: args.wk_id,
          backend: dispatchBackend,
          acceptedRepository
        }));
      } catch (error) {
        return terminalCandidateRouteError(error);
      }
    }
  );

  registerTool(
    "workspace_runtime_blocker_taxonomy",
    {
      description:
        "Read the schema-backed runtime blocker taxonomy that workspace_coordination_preflight, workspace_agent_dispatch, and launcher diagnostics consume. Default output is a compact catalog (counts plus per-code code/category/blocking/summary/actor_recovery); pass verbose:true for full per-code detail, the graph_impact_state_map, the category/actor-recovery catalogs, and prose. Read-only; consumers MUST select blocker codes from this taxonomy rather than inventing ad hoc strings.",
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
        "Report a redacted, presence-only diagnostic of whether THIS running MCP server process sees the launcher-minted Chassis Control Engine worker_admission_v1 configuration (service URL, API key, worker-admission route, request-contract digest, and the NODE_ENGINE_WORKER_ADMISSION_AUTHORITY_BINDING that ratifies launch authority) and whether the remote-admission observability path is loaded. It reads the live server process.env the role=worker admission path uses — never a caller-supplied env — and returns only env-key source NAMES and booleans, never values, hashes, lengths, or bearer material. Read-only and behavior-neutral. To interpret a dispatch refusal: authority binding present:false means the ratification switch is unset on this runtime; a missing service/key/route/digest means the server env needs reconfigure/restart; an observability boolean false (or a missing worker_admission summary in a verbose dispatch envelope) means the server is running stale code.",
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
        "Report the read-only coordinator/orchestrator preflight envelope: roles, subject, repository/docs/wiki writability, structured-route availability, managed-lifecycle capabilities, freshness, blockers, writeback classification, next_action, and per-fact ownership. A proceed result covers only reported families and is not full launch readiness; projected facts retain their external owner and are not re-evaluated. Default output is compact; verbose:true adds every fact family, route list, write surfaces, policy roots, and filesystem diagnostics. target_dispatch_role can preflight a worker dispatch without claiming worker caller identity. Caller identity carriers are refused.",
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
          proceed_scope: preflight.proceed_scope,
          writeback: preflight.writeback,
          blockers: preflight.blockers,
          analysis_blocked: preflight.analysis_blocked,
          blocking: preflight.blocking,
          next_action: preflight.next_action,
          bootstrap_review: bootstrap,
          mcp_dispatch_reviewer_available: reviewerAvailable,
          graph_impact_persistence_available: graphImpactPersistence,
          capabilities
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
