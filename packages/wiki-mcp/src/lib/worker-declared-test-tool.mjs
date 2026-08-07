

import path from "node:path";

import {
  resolveWorktreeBinding
} from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  verifyExactSliceCommitBinding
} from "../../../agent-launch-cli/src/lib/exact-slice-commit-binding.mjs";
import {
  assertNoCallerSuppliedBinding,
  mintManagedWorkerTestRunAuthority
} from "../../../agent-launch-cli/src/lib/managed-worker-test-run-authority.mjs";
import {
  runManagedWorkerDeclaredTest
} from "../../../agent-launch-cli/src/lib/workspace-agent-validation-runner.mjs";
import {
  collectAuthorizedNodeTestTargets,
  resolveNodeTestUnitSections
} from "./work-record-read-tools.mjs";
import { readWorkRecordById } from "@agent-chassis/wiki-core";

export const WORKER_DECLARED_TEST_TOOL_NAME = "workspace_worker_run_declared_test";

const WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR = "WIKI_MCP_COMMIT_LAUNCH_REF";
const WIKI_MCP_COMMIT_RUN_ID_ENV_VAR = "WIKI_MCP_COMMIT_RUN_ID";
const WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR = "WIKI_MCP_COMMIT_RETRY_ID";

export const WORKER_DECLARED_TEST_REFUSAL_CODES = Object.freeze({
  MISSING_ASSIGNED_UNIT: "worker_run_declared_test.missing_assigned_unit.v1",
  MISSING_LAUNCHER_BINDING: "worker_run_declared_test.missing_launcher_binding.v1",
  CALLER_SUPPLIED_BINDING: "worker_run_declared_test.caller_supplied_binding.v1",
  BINDING_UNRESOLVED: "worker_run_declared_test.binding_unresolved.v1",
  UNIT_UNRESOLVED: "worker_run_declared_test.unit_unresolved.v1",
  NO_DECLARED_TARGETS: "worker_run_declared_test.no_declared_targets.v1"
});

function trimmed(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseNonNegativeIntegerString(value, label) {
  const text = trimmed(value);
  if (!text) return null;
  if (!/^(0|[1-9]\d*)$/u.test(text)) {
    throw new Error(`${label} must be a non-negative integer string`);
  }
  return Number.parseInt(text, 10);
}

function resolveRunCredentialFromEnv(env) {
  const launchRef = trimmed(env[WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR]);
  const runId = trimmed(env[WIKI_MCP_COMMIT_RUN_ID_ENV_VAR]);
  if (!launchRef || !runId) return null;
  return Object.freeze({
    launchRef,
    runId,
    retryId:
      parseNonNegativeIntegerString(
        env[WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR],
        WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR
      ) ?? 0
  });
}

function createRefusal(decisionCode, reasons, extra = {}) {
  return {
    tool: WORKER_DECLARED_TEST_TOOL_NAME,
    ran: false,
    accepted: false,
    decision_code: decisionCode,
    reasons: Array.isArray(reasons) ? reasons : [reasons],
    advisory: true,
    admission_effect: "none",
    review_effect: "none",
    closure_effect: "none",
    ...extra
  };
}

export function registerWorkerDeclaredTestTool({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  env = process.env,
  deps = {}
}) {
  const resolveBinding = deps.resolveWorktreeBinding ?? resolveWorktreeBinding;
  const verifyBinding = deps.verifyExactSliceCommitBinding ?? verifyExactSliceCommitBinding;
  const readRecord = deps.readWorkRecordById ?? readWorkRecordById;
  const runDeclaredTest = deps.runManagedWorkerDeclaredTest ?? runManagedWorkerDeclaredTest;

  registerTool(
    WORKER_DECLARED_TEST_TOOL_NAME,
    {
      description:
        "Worker-only launcher-owned capability: run one of the launcher-assigned unit's DECLARED node tests and return its output, so a worker can check its own delivery before committing. Side effect: process_spawn. Caller input is exactly { target }. The unit and the worktree are bound from the dispatched run's launcher-minted identity binding and are never taken from caller input; a caller-supplied unit, record, repo, workspace, worktree, cwd, or target set is refused rather than overridden. The target is authorized solely from the BOUND unit's sections.structured_validation.allowed[] entries with command node_test; an undeclared target is refused, never widened. The test runs launcher-side in a separate bubblewrap-confined process against the run's own worktree, network-denied, with a launcher-minted clean env, the repository mounted READ-ONLY (so no test byproduct can reach the write scope or the delivery commit) and an ephemeral tmpfs as the only writable location. A launcher-owned read-only dependency mount makes bare-specifier workspace imports resolve; when it is unavailable, stale, or mismatched the run degrades and records advisory evidence rather than refusing. Node binary, argv, cwd, env, timeout, and output bounds are launcher facts and cannot be supplied or overridden. The result is advisory: it carries no admission, review, or closure authority, adds no admission metric, and does not satisfy the mandatory findings-only review.",
      inputSchema: z.object({ target: z.string() }).strict()
    },
    async (args) => {
      try {

        try {
          assertNoCallerSuppliedBinding(args, { allowedKeys: ["target"] });
        } catch (error) {
          return jsonContent(
            createRefusal(
              WORKER_DECLARED_TEST_REFUSAL_CODES.CALLER_SUPPLIED_BINDING,
              [error?.message ?? String(error)],
              { refusal_code: typeof error?.code === "string" ? error.code : null }
            )
          );
        }

        const assignedUnit = trimmed(env.WIKI_MCP_ASSIGNED_UNIT);
        if (!assignedUnit) {
          return jsonContent(
            createRefusal(WORKER_DECLARED_TEST_REFUSAL_CODES.MISSING_ASSIGNED_UNIT, [
              "WIKI_MCP_ASSIGNED_UNIT is not set; the declared-test capability is only available for launcher-assigned worker sessions"
            ])
          );
        }

        const credential = resolveRunCredentialFromEnv(env);
        if (!credential) {
          return jsonContent(
            createRefusal(WORKER_DECLARED_TEST_REFUSAL_CODES.MISSING_LAUNCHER_BINDING, [
              `${WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR}/${WIKI_MCP_COMMIT_RUN_ID_ENV_VAR} launcher tuple is required; the declared-test capability refuses to derive its unit or its worktree from worker input, serialized environment bindings, or the current checkout`
            ])
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos);
        const mainRepo = path.resolve(workspace.dir);
        let authority;
        try {
          const binding = verifyBinding({
            binding: resolveBinding({
              mainRepo,
              launchRef: credential.launchRef,
              runId: credential.runId,
              retryId: credential.retryId
            }),
            mainRepo,
            assignedUnit,
            launchRef: credential.launchRef,
            runId: credential.runId,
            retryId: credential.retryId
          });
          authority = mintManagedWorkerTestRunAuthority({ commitBinding: binding, mainRepo });
        } catch (error) {
          return jsonContent(
            createRefusal(
              WORKER_DECLARED_TEST_REFUSAL_CODES.BINDING_UNRESOLVED,
              [error?.message ?? String(error)],
              { refusal_code: typeof error?.code === "string" ? error.code : null }
            )
          );
        }

        const loaded = await readRecord({ dir: mainRepo, id: authority.record_id });
        const sections = loaded?.record
          ? resolveNodeTestUnitSections(loaded.record, authority.slice_id)
          : null;
        if (!sections) {
          return jsonContent(
            createRefusal(WORKER_DECLARED_TEST_REFUSAL_CODES.UNIT_UNRESOLVED, [
              `the launcher-bound unit could not be resolved from canonical work records: ${authority.unit_address}`
            ], { unit: authority.unit_address })
          );
        }
        const authorizedTargets = [...collectAuthorizedNodeTestTargets(sections)].sort();
        if (authorizedTargets.length === 0) {
          return jsonContent(
            createRefusal(WORKER_DECLARED_TEST_REFUSAL_CODES.NO_DECLARED_TARGETS, [
              `the launcher-bound unit declares no node_test targets; add one to sections.structured_validation.allowed[] with command node_test`
            ], { unit: authority.unit_address, authorized_targets: [] })
          );
        }

        const result = await runDeclaredTest({
          authority,
          target: args.target,
          authorizedTargets
        });
        return jsonContent({
          tool: WORKER_DECLARED_TEST_TOOL_NAME,
          workspaceRepo: workspace.repo,
          assigned_unit: assignedUnit,
          authorized_targets: authorizedTargets,
          ...result
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
