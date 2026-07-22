

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

export const WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION = Object.freeze({
  schema_version: "workspace-closed-input-commit-composition.v1",
  installed: true,
  tool_name: WORKER_COMMIT_TOOL_NAME,
  input_contract: "closed",
  binding_authority: "server_resolved"
});

const WIKI_MCP_COMMIT_BINDING_ENV_VAR = "WIKI_MCP_COMMIT_BINDING";
const WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR = "WIKI_MCP_COMMIT_LAUNCH_REF";
const WIKI_MCP_COMMIT_RUN_ID_ENV_VAR = "WIKI_MCP_COMMIT_RUN_ID";
const WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR = "WIKI_MCP_COMMIT_RETRY_ID";

const HOST_WRITE_AUTHORITY_ENDPOINT_ENV_VAR = "AGENT_LAUNCH_HOST_WRITE_AUTHORITY_TCP_ENDPOINT";
const AGENT_LAUNCH_SUBSTRATE_MODULE = "../../../agent-launch-cli/src/lib/host-write-authority-substrate.mjs";
const COMMIT_TOOL_EXPOSURE_GUARD_MODULE = "../../../agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
const EXACT_SLICE_UNIT_ADDRESS_RE = /^(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u;
const EXACT_SLICE_ASSIGNED_UNIT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;

const WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION_V1 = "worktree-identity-binding.v1";
const WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION_V2 = "worktree-identity-binding.v2";
const FULL_CHECKOUT_MODE = "full";

const EXACT_SPARSE_SLICE_BINDING_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address", "initiative",
  "record_id", "slice_id", "base_ref", "base_sha", "output_branch", "worktree_path",
  "read_scope", "repo_paths", "write_scope", "write_scope_source", "selected_unit",
  "source_digest", "source_version", "cone_dirs", "index_sparse"
]);
const EXACT_FULL_SLICE_BINDING_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address", "initiative",
  "record_id", "slice_id", "base_ref", "base_sha", "output_branch", "worktree_path",
  "read_scope", "repo_paths", "write_scope", "write_scope_source", "selected_unit",
  "source_digest", "source_version", "checkout_mode"
]);
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

function classifyCommitBindingCheckoutMode(binding) {
  const hasCone = Object.prototype.hasOwnProperty.call(binding, "cone_dirs");
  const hasIndexSparse = Object.prototype.hasOwnProperty.call(binding, "index_sparse");
  const hasCheckoutMode = Object.prototype.hasOwnProperty.call(binding, "checkout_mode");
  if (binding.schema_version === WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION_V1 &&
      hasCone && hasIndexSparse && !hasCheckoutMode) {
    return "v1-sparse";
  }
  if (binding.schema_version === WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION_V2 &&
      hasCheckoutMode && binding.checkout_mode === FULL_CHECKOUT_MODE &&
      !hasCone && !hasIndexSparse) {
    return "v2-full";
  }
  return null;
}

function assertExactCommitBindingFieldSet(binding, mode) {
  const expectedFields = mode === "v1-sparse"
    ? EXACT_SPARSE_SLICE_BINDING_FIELDS
    : EXACT_FULL_SLICE_BINDING_FIELDS;
  const missing = expectedFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(binding, field)
  );
  const extra = Object.keys(binding).filter(
    (key) => !expectedFields.includes(key)
  );
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `identity-store commit binding is not the exact canonical ${mode === "v1-sparse" ? "sparse" : "full"}-slice schema` +
      (missing.length > 0 ? `; missing ${JSON.stringify(missing)}` : "") +
      (extra.length > 0 ? `; unexpected ${JSON.stringify(extra)}` : "")
    );
  }
}

function assertDiscriminatedCheckoutBindingShape(binding) {
  const mode = classifyCommitBindingCheckoutMode(binding);
  if (mode === null) {
    throw new Error(
      "identity-store commit binding is neither exact discriminated checkout shape " +
      "(v1: schema_version \"worktree-identity-binding.v1\" + cone_dirs + index_sparse; " +
      "v2: schema_version \"worktree-identity-binding.v2\" + checkout_mode \"full\", no cone_dirs/index_sparse)"
    );
  }
  assertExactCommitBindingFieldSet(binding, mode);
  if (mode === "v1-sparse" && binding.index_sparse !== false) {
    throw new Error("identity-store commit binding v1 sparse index_sparse must be false");
  }
}

function projectVerifiedExactSliceSubject(binding, assignedUnit) {
  if (!isPlainObject(binding)) {
    throw new Error("identity-store commit binding must be an object");
  }
  assertDiscriminatedCheckoutBindingShape(binding);

  const unitMatch = typeof binding.unit_address === "string"
    ? EXACT_SLICE_UNIT_ADDRESS_RE.exec(binding.unit_address)
    : null;
  if (!unitMatch) {
    throw new Error("identity-store commit binding unit_address must identify one canonical exact slice");
  }
  const [, initiative, recordId, sliceId] = unitMatch;
  const subject = `${recordId}#${sliceId}`;
  const assignedMatch = typeof assignedUnit === "string"
    ? EXACT_SLICE_ASSIGNED_UNIT_RE.exec(assignedUnit)
    : null;
  if (!assignedMatch || assignedMatch[1] !== recordId || assignedMatch[2] !== sliceId) {
    throw new Error("launcher-assigned unit does not match the identity-store exact slice");
  }
  if (binding.initiative !== initiative) {
    throw new Error("identity-store commit binding initiative does not match unit_address");
  }
  if (binding.record_id !== recordId) {
    throw new Error("identity-store commit binding record_id does not match unit_address");
  }
  if (binding.slice_id !== sliceId) {
    throw new Error("identity-store commit binding slice_id does not match unit_address");
  }

  const selectedUnit = binding.selected_unit;
  if (!isPlainObject(selectedUnit) ||
      selectedUnit.kind !== "slice" ||
      selectedUnit.address !== subject ||
      selectedUnit.record_id !== recordId ||
      selectedUnit.slice_id !== sliceId ||
      !Object.prototype.hasOwnProperty.call(selectedUnit, "repo") ||
      !(selectedUnit.repo === null || (typeof selectedUnit.repo === "string" && selectedUnit.repo.length > 0))) {
    throw new Error("identity-store commit binding selected_unit does not match the exact slice");
  }

  const branch = `slice/${initiative}/${recordId}/${sliceId}`;
  if (binding.output_branch !== branch && binding.output_branch !== `refs/heads/${branch}`) {
    throw new Error("identity-store commit binding output_branch does not match the exact slice");
  }
  if (Object.prototype.hasOwnProperty.call(binding, "subject") && binding.subject !== subject) {
    throw new Error("identity-store commit binding subject conflicts with the exact slice");
  }

  return Object.freeze({ ...binding, subject });
}

function resolveCommitBindingFromCredential(credential, workspaceDir, assignedUnit) {
  if (!isPlainObject(credential)) {
    throw new Error("commit credential must be a launcher-provided object");
  }
  if (credential.kind === "direct_binding") {
    if (!isPlainObject(credential.binding) ||
        !Object.prototype.hasOwnProperty.call(credential.binding, "subject") ||
        credential.binding.subject !== assignedUnit) {
      throw new Error("direct commit binding requires an explicit subject matching the launcher-assigned unit");
    }
    return credential.binding;
  }
  if (credential.kind === "identity_store_tuple") {
    const binding = resolveWorktreeBinding({
      mainRepo: workspaceDir,
      launchRef: credential.launchRef,
      runId: credential.runId,
      retryId: credential.retryId
    });
    return projectVerifiedExactSliceSubject(binding, assignedUnit);
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

function normalizeCommitRef(outputBranch) {
  const branch = trimmed(outputBranch);
  if (!branch) {
    throw new Error("commit binding lacks output_branch");
  }
  const ref = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
  if (/^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/u.test(ref)) {
    return Object.freeze({ kind: "wk", ref });
  }
  if (/^refs\/heads\/slice\/IN-\d{4}\/WK-\d{4}\/SLICE-\d{3}$/u.test(ref)) {
    return Object.freeze({ kind: "slice", ref });
  }
  throw new Error("commit binding output_branch is outside the WK/slice exact-unit namespaces");
}

function resolveExpectedEnvelope(binding) {
  const value = binding.expected_envelope ?? binding.expectedEnvelope ?? binding.expected ?? null;
  return isPlainObject(value) ? value : null;
}

function resolveSparseBinding(binding) {

  if (binding.schema_version === WORKTREE_SUBSTRATE_BINDING_SCHEMA_VERSION_V2 ||
      binding.checkout_mode === FULL_CHECKOUT_MODE) {
    return null;
  }
  const hasSparseAuthority =
    Object.prototype.hasOwnProperty.call(binding, "cone_dirs") ||
    Object.prototype.hasOwnProperty.call(binding, "index_sparse");
  if (!hasSparseAuthority) return null;
  return Object.freeze({
    base_sha: binding.base_sha,
    cone_dirs: binding.cone_dirs,
    index_sparse: binding.index_sparse
  });
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

async function delegateManagedWorkerCommitToBroker({
  args,
  assignedUnit,
  credential,
  brokerEndpointValue,
  jsonContent
}) {

  const { assertClosedInputSchema } = await import(COMMIT_TOOL_EXPOSURE_GUARD_MODULE);
  assertClosedInputSchema(args);

  const {
    createHostWriteAuthorityBrokerChannel,
    createHostWriteAuthorityCommitAdapter,
    parseHostWriteAuthoritySidecarEndpoint
  } = await import(AGENT_LAUNCH_SUBSTRATE_MODULE);

  const endpoint = parseHostWriteAuthoritySidecarEndpoint(brokerEndpointValue);
  if (endpoint === null) {
    return jsonContent(
      createCommitRefusal("commit.broker_endpoint_invalid.v1", [
        "the launcher-projected host-write broker endpoint is malformed; the managed worker commit refuses to delegate rather than run Git in the confined namespace"
      ])
    );
  }

  const channel = createHostWriteAuthorityBrokerChannel({ endpoint });
  const commitAdapter = createHostWriteAuthorityCommitAdapter({ channel });
  const delegated = await commitAdapter({
    assigned_unit: assignedUnit,
    launch_ref: credential.launchRef,
    run_id: credential.runId,
    retry_id: credential.retryId
  });

  if (!delegated || delegated.accepted !== true) {
    return jsonContent(
      createCommitRefusal(
        "commit.broker_delegation_refused.v1",
        [
          "the host-write broker refused or could not complete the delegated managed-worker commit; failing closed"
        ],
        { broker_refusal: delegated?.refusal ?? null }
      )
    );
  }

  return jsonContent({
    workspaceRepo: null,
    tool: WORKER_COMMIT_TOOL_NAME,
    ...delegated.commit_result
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
        "Worker-only closed-input affordance. For a managed exact slice, materialize and verify the launcher-bound delta against the launcher-assigned write_scope, advance only the exact slice ref, and return awaiting confirmed worker termination and trusted WK integration; do not advance the WK ref or submit the slice for review. Trusted runtime subsequently integrates the committed slice into the WK and freezes the accumulated whole-WK target for findings-only review. Legacy direct-WK bindings, where supported, advance the WK ref and submit the launcher-assigned unit for findings-only review. The tool accepts no caller-supplied branch, path, base_sha, write_scope, subject, expected envelope, author identity, or commit message.",
      inputSchema: z.object({}).strict()
    },
    async (args) => {
      try {
        const rawAssignedUnit = env.WIKI_MCP_ASSIGNED_UNIT;
        const assignedUnit = trimmed(rawAssignedUnit);
        if (!assignedUnit) {
          return jsonContent(
            createCommitRefusal("commit.missing_assigned_unit.v1", [
              "WIKI_MCP_ASSIGNED_UNIT is not set; commit is only available for launcher-assigned worker-profile sessions"
            ])
          );
        }

        const credential = resolveCommitCredentialFromEnv(env);
        if (!credential) {
          return jsonContent(
            createCommitRefusal("commit.missing_launcher_binding.v1", [
              `${WIKI_MCP_COMMIT_BINDING_ENV_VAR} or the ${WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR}/${WIKI_MCP_COMMIT_RUN_ID_ENV_VAR} launcher tuple is required; commit refuses to derive identity from worker input or the current checkout`
            ])
          );
        }

        const brokerEndpointValue = trimmed(env[HOST_WRITE_AUTHORITY_ENDPOINT_ENV_VAR]);
        if (brokerEndpointValue && credential.kind === "identity_store_tuple") {
          return await delegateManagedWorkerCommitToBroker({
            args,
            assignedUnit,
            credential,
            brokerEndpointValue,
            jsonContent
          });
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos);
        let rawBinding = null;
        const admitted = admitWorkerCommitCall({
          credential,
          workerArgs: args,
          deps: {
            resolveBinding(value) {
              rawBinding = resolveCommitBindingFromCredential(value, workspace.dir, rawAssignedUnit);
              return rawBinding;
            }
          }
        });
        const binding = admitted.binding;
        const serverResolvedBinding = rawBinding ?? binding;
        const gitIdentity = resolveCommitGitIdentity(serverResolvedBinding, workspace.dir);
        const commitTarget = normalizeCommitRef(binding.output_branch);

        const materialized = materializeCommitObject({
          gitDir: gitIdentity.gitDir,
          workTree: gitIdentity.workTree,
          baseSha: binding.base_sha,
          message: admitted.server_generated_message,
          sparseBinding: resolveSparseBinding(serverResolvedBinding)
        });

        const scope = verifyAndMeasureCommitScope({
          gitDir: gitIdentity.gitDir,
          baseSha: materialized.base_sha,
          commit: materialized.commit,
          tree: materialized.tree,
          writeScope: binding.write_scope,
          expectedEnvelope: resolveExpectedEnvelope(serverResolvedBinding),
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

        let advanced;
        if (commitTarget.kind === "slice") {

          const { commitSliceRef } = await import("../../../agent-launch-cli/src/lib/slice-integration.mjs");
          advanced = commitSliceRef({
            repo: workspace.dir,
            sliceRef: commitTarget.ref,
            baseSha: materialized.base_sha,
            tree: materialized.tree,
            commit: materialized.commit
          });
        } else {
          advanced = advanceWkRef({
            gitDir: gitIdentity.gitDir,
            ref: commitTarget.ref,
            baseSha: materialized.base_sha,
            tree: materialized.tree,
            commit: materialized.commit
          });
        }

        const transition = commitTarget.kind === "slice"
          ? Object.freeze({
              submitted: false,
              status: "awaiting_worker_termination_and_wk_integration"
            })
          : createSubmitForReviewResponse(
              workspace.repo,
              assignedUnit,
              await setWorkRecordStatusByUnit({
                dir: workspace.dir,
                unitAddress: assignedUnit,
                status: "review"
              }),
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
