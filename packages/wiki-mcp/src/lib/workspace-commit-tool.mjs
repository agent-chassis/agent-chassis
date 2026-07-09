

import path from "node:path";
import {
  advanceWkRef,
  materializeCommitObject
} from "../../../agent-launch-cli/src/lib/commit-object-primitive.mjs";
import { verifyAndMeasureCommitScope } from "../../../agent-launch-cli/src/lib/commit-scope-envelope.mjs";
import {
  admitWorkerCommitCall,
  WORKER_COMMIT_TOOL_NAME
} from "../../../agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import {
  resolveWorktreeBinding
} from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  deriveWritableMountsFromWriteScope
} from "../../../agent-launch-cli/src/lib/workspace-agent-write-scope.mjs";

export { WORKER_COMMIT_TOOL_NAME };

const WIKI_MCP_COMMIT_BINDING_ENV_VAR = "WIKI_MCP_COMMIT_BINDING";
const WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR = "WIKI_MCP_COMMIT_LAUNCH_REF";
const WIKI_MCP_COMMIT_RUN_ID_ENV_VAR = "WIKI_MCP_COMMIT_RUN_ID";
const WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR = "WIKI_MCP_COMMIT_RETRY_ID";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimmed(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function createCommitRefusal(decisionCode, reasons, extra = {}) {
  return {
    tool: WORKER_COMMIT_TOOL_NAME,
    committed: false,
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
    committed: true,
    submitted_for_review: Boolean(result.transition?.submitted),
    assigned_unit: assignedUnit,
    commit: result.commit,
    tree: result.tree,
    base_sha: result.base_sha,
    ref: result.ref,
    idempotent: result.idempotent,
    changed_paths: result.scope.changed_paths,
    metrics: result.scope.metrics,
    baseline: result.scope.baseline,
    attestation: result.scope.attestation,
    expected_envelope_invariant: result.scope.expected_envelope_invariant,
    transition: result.transition
  };
}

function createSubmitForReviewResponse(workspaceRepo, assignedUnit, result, createCompactWorkRecordEditResponse) {
  return {
    tool: "workspace_submit_for_review",
    submitted: Boolean(result?.valid) && (Boolean(result?.written) || Boolean(result?.no_op)),
    assigned_unit: assignedUnit,
    ...createCompactWorkRecordEditResponse(workspaceRepo, result)
  };
}

function parseOptionalJsonObject(raw, label) {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) return parsed;
  } catch (error) {
    throw new Error(`${label} must be a JSON object: ${error?.message ?? String(error)}`);
  }
  throw new Error(`${label} must be a JSON object`);
}

function parseNonNegativeIntegerString(value, label) {
  const text = trimmed(value);
  if (!text) return null;
  if (!/^(0|[1-9]\d*)$/u.test(text)) {
    throw new Error(`${label} must be a non-negative integer string`);
  }
  return Number.parseInt(text, 10);
}

function resolveCommitCredentialFromEnv(env) {
  const directBinding = parseOptionalJsonObject(env[WIKI_MCP_COMMIT_BINDING_ENV_VAR], WIKI_MCP_COMMIT_BINDING_ENV_VAR);
  if (directBinding) {
    return Object.freeze({ kind: "direct_binding", binding: directBinding });
  }
  const launchRef = trimmed(env[WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR]);
  const runId = trimmed(env[WIKI_MCP_COMMIT_RUN_ID_ENV_VAR]);
  if (!launchRef || !runId) {
    return null;
  }
  return Object.freeze({
    kind: "identity_store_tuple",
    launchRef,
    runId,
    retryId: parseNonNegativeIntegerString(env[WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR], WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR) ?? 0
  });
}

function resolveCommitBindingFromCredential(credential, workspaceDir) {
  if (!isPlainObject(credential)) {
    throw new Error("commit credential must be a launcher-provided object");
  }
  if (credential.kind === "direct_binding") {
    return credential.binding;
  }
  if (credential.kind === "identity_store_tuple") {
    return resolveWorktreeBinding({
      mainRepo: workspaceDir,
      launchRef: credential.launchRef,
      runId: credential.runId,
      retryId: credential.retryId
    });
  }
  throw new Error(`unsupported commit credential kind: ${JSON.stringify(credential.kind)}`);
}

function firstNonEmptyString(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function resolveCommitGitIdentity(binding, workspaceDir) {
  const direct = binding.provisionedWorktreeGitBinding ??
    binding.provisioned_worktree_git_binding ??
    binding.provisionedWorktreeGitIdentity ??
    binding.provisioned_worktree_git_identity ??
    binding.git_binding ??
    binding.git_identity ??
    binding;
  const workTree =
    firstNonEmptyString(direct, ["worktreePath", "worktree_path"]) ??
    firstNonEmptyString(binding, ["worktree_path", "worktreePath"]);
  if (!workTree) {
    throw new Error("commit binding lacks server-derived worktreePath/worktree_path");
  }
  const gitDir =
    firstNonEmptyString(direct, ["gitDir", "git_dir", "worktreeGitDir", "worktree_git_dir"]) ??
    path.join(workspaceDir, ".git", "worktrees", path.basename(workTree));
  return Object.freeze({ gitDir, workTree });
}

function normalizeWkRef(outputBranch) {
  const branch = trimmed(outputBranch);
  if (!branch) {
    throw new Error("commit binding lacks output_branch");
  }
  return branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
}

function resolveExpectedEnvelope(binding) {
  const value = binding.expected_envelope ?? binding.expectedEnvelope ?? binding.expected ?? null;
  return isPlainObject(value) ? value : null;
}

function resolveWriteScopeMatcher(workspaceDir, writeScope) {
  const mounts = deriveWritableMountsFromWriteScope({ workspaceDir, writeScope });
  const repoRoot = path.resolve(workspaceDir);
  const files = new Set(
    mounts.writableFiles.map((file) => path.relative(repoRoot, file).split(path.sep).join("/"))
  );
  const roots = mounts.writableRoots.map((root) => path.relative(repoRoot, root).split(path.sep).join("/"));
  const globRoots = (Array.isArray(writeScope) ? writeScope : [])
    .filter((entry) => typeof entry === "string" && entry.endsWith("/**"))
    .map((entry) => entry.slice(0, -3).replace(/\/+$/u, ""))
    .filter((entry) => entry.length > 0 && !path.isAbsolute(entry) && !entry.split("/").includes(".."));
  return Object.freeze({
    matches(relPath) {
      if (typeof relPath !== "string" || relPath.length === 0) return false;
      if (path.isAbsolute(relPath) || relPath.split("/").includes("..")) return false;
      if (files.has(relPath)) return true;
      return [...roots, ...globRoots].some((root) => relPath === root || relPath.startsWith(`${root}/`));
    }
  });
}

export function registerWorkspaceCommitTool({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  createCompactWorkRecordEditResponse,
  setWorkRecordStatusByUnit,
  env = process.env
}) {
  registerTool(
    WORKER_COMMIT_TOOL_NAME,
    {
      description:
        "Worker-only affordance: materialize the launcher-provisioned worktree into an immutable commit object, verify that object against the launcher-assigned write_scope, advance the WK ref, and submit the launcher-assigned unit for findings-only review. The tool accepts no caller-supplied branch, path, base_sha, write_scope, subject, expected envelope, author identity, or commit message.",
      inputSchema: z.object({}).strict()
    },
    async (args) => {
      try {
        const assignedUnit = trimmed(env.WIKI_MCP_ASSIGNED_UNIT);
        if (!assignedUnit) {
          return jsonContent(
            createCommitRefusal("commit.missing_assigned_unit.v1", [
              "WIKI_MCP_ASSIGNED_UNIT is not set; commit is only available for launcher-assigned worker-profile sessions"
            ])
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos);
        const credential = resolveCommitCredentialFromEnv(env);
        if (!credential) {
          return jsonContent(
            createCommitRefusal("commit.missing_launcher_binding.v1", [
              `${WIKI_MCP_COMMIT_BINDING_ENV_VAR} or the ${WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR}/${WIKI_MCP_COMMIT_RUN_ID_ENV_VAR} launcher tuple is required; commit refuses to derive identity from worker input or the current checkout`
            ])
          );
        }

        let rawBinding = null;
        const admitted = admitWorkerCommitCall({
          credential,
          workerArgs: args,
          deps: {
            resolveBinding(value) {
              rawBinding = resolveCommitBindingFromCredential(value, workspace.dir);
              return rawBinding;
            }
          }
        });
        const binding = admitted.binding;
        const gitIdentity = resolveCommitGitIdentity(rawBinding ?? binding, workspace.dir);
        const ref = normalizeWkRef(binding.output_branch);

        const materialized = materializeCommitObject({
          gitDir: gitIdentity.gitDir,
          workTree: gitIdentity.workTree,
          baseSha: binding.base_sha,
          message: admitted.server_generated_message
        });

        const scope = verifyAndMeasureCommitScope({
          gitDir: gitIdentity.gitDir,
          baseSha: materialized.base_sha,
          commit: materialized.commit,
          tree: materialized.tree,
          writeScope: binding.write_scope,
          expectedEnvelope: resolveExpectedEnvelope(rawBinding ?? binding),
          deps: {
            resolveWriteScope(writeScope) {
              return resolveWriteScopeMatcher(workspace.dir, writeScope);
            }
          }
        });
        if (scope.contained !== true) {
          return jsonContent(
            createCommitRefusal("commit.write_scope_refused.v1", [
              "materialized commit object is not structurally contained in the launcher-assigned write_scope"
            ], {
              materialized,
              scope
            })
          );
        }

        const advanced = advanceWkRef({
          gitDir: gitIdentity.gitDir,
          ref,
          baseSha: materialized.base_sha,
          tree: materialized.tree,
          commit: materialized.commit
        });

        const transitionResult = await setWorkRecordStatusByUnit({
          dir: workspace.dir,
          unitAddress: assignedUnit,
          status: "review"
        });
        const transition = createSubmitForReviewResponse(
          workspace.repo,
          assignedUnit,
          transitionResult,
          createCompactWorkRecordEditResponse
        );
        return jsonContent(
          createCommitResponse(workspace.repo, assignedUnit, {
            commit: advanced.commit,
            tree: advanced.tree,
            base_sha: advanced.base_sha,
            ref: advanced.ref,
            idempotent: advanced.idempotent,
            scope,
            transition
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
