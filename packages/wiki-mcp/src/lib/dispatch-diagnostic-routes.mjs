

import {
  evaluateBootstrapReviewState,
  refuseCallerSuppliedIdentityFields,
  resolveCallerIdentity
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import {
  loadRuntimeBlockerTaxonomy
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
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
    dispatchReviewerAvailable
  } = ctx;

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
        "Report the coordinator/orchestrator preflight envelope: role/caller/target roles, subject, repo mount + docs/ + wiki/ writability, dispatch/reviewer/redteam/validate-dispatch availability, surface counts, the active blocker list (codes + diagnostics), writeback classification, and next_action. Default output is compact (booleans and counts); pass verbose:true for the full route list, write-surface arrays, write_policy roots, and filesystem_diagnostics — actionable blocker diagnostics are never hidden. The optional target_dispatch_role lets a coordinator preflight a worker dispatch (role=coordinator, target_dispatch_role=worker) without claiming a worker caller role, so a read-only orchestrator repo root is not misread as a direct-write blocker. Read-only, with write-probes only inside docs/ and wiki/ (probe dirs removed before returning); caller-supplied identity carriers are refused and the dispatch-identity bootstrap state is returned.",
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
        const availableRoutes = [...registeredToolNames];

        const graphImpactPersistence = graphImpactPersistenceAvailable();
        const dispatchAvailable = registeredToolNames.has(AGENT_DISPATCH_TOOL_NAME);
        const reviewerAvailable = dispatchReviewerAvailable();
        if (dispatchAvailable && reviewerAvailable) {
          availableRoutes.push("workspace_agent_dispatch:reviewer");
        }
        const preflight = await runCoordinationPreflight({
          dir: workspace.dir,
          role: args?.role ?? "coordinator",
          caller_session_role: args?.caller_session_role ?? null,
          target_dispatch_role: args?.target_dispatch_role ?? null,
          identity: identity,
          subject: args?.subject ?? null,
          available_structured_routes: availableRoutes,
          graph_impact_state: args?.graph_impact_state ?? null
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
        if (args?.verbose === true) {
          return jsonContent({ ...fullEnvelope, verbose: true });
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
          dispatch_available: dispatchAvailable,
          reviewer_dispatch_available: reviewerAvailable,
          redteam_dispatch_available: dispatchAvailable,
          validate_dispatch_available: validateDispatchAvailable,
          route_count: routes.length,
          allowed_surface_count: allowedSurfaces.length,
          forbidden_surface_count: forbiddenSurfaces.length,
          writeback: preflight.writeback,
          blockers: preflight.blockers,
          analysis_blocked: preflight.analysis_blocked,
          blocking: preflight.blocking,
          next_action: preflight.next_action,
          bootstrap_review: bootstrap,
          mcp_dispatch_reviewer_available: reviewerAvailable,
          graph_impact_persistence_available: graphImpactPersistence
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
