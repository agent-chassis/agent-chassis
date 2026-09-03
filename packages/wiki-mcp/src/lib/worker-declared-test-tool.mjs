

import path from "node:path";

import { classifyStableTestProofRuntimeReadiness } from
  "@agent-chassis/controlled-contract";

import {
  resolveAssignedUnit,
  resolveLauncherRunCredential,
  WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR,
  WIKI_MCP_COMMIT_RUN_ID_ENV_VAR
} from "./launcher-run-credential.mjs";

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
  authorizeValidationTarget,
  runManagedWorkerDeclaredTest,
  runWorkspaceAgentTestProofAttempt
} from "../../../agent-launch-cli/src/lib/workspace-agent-validation-runner.mjs";
import { extractTestProofRuntimeEvidenceReceipt } from
  "../../../agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import {
  mintLauncherTestProofAttemptContext,
  mintManagedWorkerTestProofRuntimeAuthority
} from "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import {
  resolveNodeTestUnitSections
} from "./work-record-node-test-validation.mjs";
import {
  projectWorkRecordTestProofValidation,
  resolveControlledContractTestProofRuntimeBindings,
  readWorkRecordById
} from "@agent-chassis/wiki-core";
import { executeVerifyProofReceiptPopulation } from
  "../../../agent-launch-core/src/lib/workspace-agent-verify-proof-capability.mjs";

export const WORKER_DECLARED_TEST_TOOL_NAME = "workspace_worker_run_declared_test";

export const WORKER_DECLARED_TEST_REFUSAL_CODES = Object.freeze({
  MISSING_ASSIGNED_UNIT: "worker_run_declared_test.missing_assigned_unit.v1",
  MISSING_LAUNCHER_BINDING: "worker_run_declared_test.missing_launcher_binding.v1",
  CALLER_SUPPLIED_BINDING: "worker_run_declared_test.caller_supplied_binding.v1",
  BINDING_UNRESOLVED: "worker_run_declared_test.binding_unresolved.v1",
  UNIT_UNRESOLVED: "worker_run_declared_test.unit_unresolved.v1",
  NO_DECLARED_TARGETS: "worker_run_declared_test.no_declared_targets.v1",
  TEST_PROOF_RECEIPT_INCOMPLETE: "worker_run_declared_test.test_proof_receipt_incomplete.v1"
});

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

export function projectWorkerProofExecutionReadiness({
  selection, verificationIds, wkId
}) {
  const rows = verificationIds.map((verificationId) => {
    const matches = selection?.bindings?.filter(
      (binding) => binding?.verification_claim_id === verificationId
    ) ?? [];
    if (matches.length !== 1) return null;
    const binding = matches[0];
    const readiness = classifyStableTestProofRuntimeReadiness(binding);
    const candidates = readiness.current_test_ids.slice(0, 16);
    return Object.freeze({
      verification_id: verificationId,
      status: readiness.status,
      reason: readiness.reason,
      selected_test_id: readiness.selected_test_id,
      candidate_test_ids: Object.freeze(candidates),
      candidate_total: readiness.candidate_total,
      candidate_test_ids_omitted: readiness.candidate_total - candidates.length,
      complete_retrieval: Object.freeze({
        tool: "workspace_controlled_test_proof_query",
        arguments: Object.freeze({ wk_id: wkId, verification_ids: [verificationId] })
      })
    });
  });
  if (rows.some((row) => row === null)) return null;
  const nonready = rows.filter(({ status }) => status !== "ready");
  return Object.freeze({
    status: nonready.length === 0 ? "ready" : "not_ready",
    ...(nonready.length === 0 ? {} : { authority_limb: "mechanical_failure" }),
    admissibility_effect: "none",
    bindings: Object.freeze(rows)
  });
}

export function buildWorkerDeclaredTestSuccess({
  workspaceRepo,
  assignedUnit,
  authorizedTargets,
  verificationIds,
  proofExecutionReadiness = null,
  testProofRuntimeEvidence = null,
  result,
  target = null
}) {
  const proofStarted = Array.isArray(testProofRuntimeEvidence);
  if (proofExecutionReadiness?.status === "not_ready" && proofStarted) {
    throw new TypeError("nonready pre-proof results cannot carry proof evidence");
  }
  return Object.freeze({
    tool: WORKER_DECLARED_TEST_TOOL_NAME,
    workspaceRepo,
    assigned_unit: assignedUnit,
    authorized_targets: authorizedTargets,
    verification_ids: verificationIds,
    ...(proofExecutionReadiness === null
      ? {} : { proof_execution_readiness: proofExecutionReadiness }),
    ...(proofStarted ? { test_proof_runtime_evidence: testProofRuntimeEvidence } : {}),
    ...result,
    ...(target === null ? {} : { target })
  });
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
  const queryProofBindings = deps.resolveControlledContractTestProofRuntimeBindings ??
    resolveControlledContractTestProofRuntimeBindings;
  const mintProofAuthority = deps.mintManagedWorkerTestProofRuntimeAuthority ??
    mintManagedWorkerTestProofRuntimeAuthority;
  const mintProofContext = deps.mintLauncherTestProofAttemptContext ??
    mintLauncherTestProofAttemptContext;
  const runProofAttempt = deps.runWorkspaceAgentTestProofAttempt ??
    runWorkspaceAgentTestProofAttempt;
  const extractProofReceipt = deps.extractTestProofRuntimeEvidenceReceipt ??
    extractTestProofRuntimeEvidenceReceipt;

  registerTool(
    WORKER_DECLARED_TEST_TOOL_NAME,
    {
      description:
        "Worker-only launcher capability that runs one declared node test for the assigned unit and returns its output. Side effect: process_spawn. Input is exactly { target }. Unit and worktree come from the launcher-minted run binding; caller unit, repo, workspace, worktree, cwd, or target-set fields are refused. Only acceptance.validation[] entries with operation node_test authorize targets. The launcher runs the test in a network-denied bubblewrap process with a clean environment, read-only repository and dependency mounts, and ephemeral writable tmpfs. Unavailable or mismatched dependency mounts produce advisory degraded evidence. Node, argv, cwd, environment, timeout, and output bounds are launcher-owned. Results grant no admission, review, or closure authority and add no admission metric.",
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

        const assignedUnit = resolveAssignedUnit(env);
        if (!assignedUnit) {
          return jsonContent(
            createRefusal(WORKER_DECLARED_TEST_REFUSAL_CODES.MISSING_ASSIGNED_UNIT, [
              "WIKI_MCP_ASSIGNED_UNIT is not set; the declared-test capability is only available for launcher-assigned worker sessions"
            ])
          );
        }

        const credential = resolveLauncherRunCredential(env);
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
        const selectedUnit = loaded?.record
          ? resolveNodeTestUnitSections(loaded.record, authority.slice_id)
          : null;
        if (!selectedUnit) {
          return jsonContent(
            createRefusal(WORKER_DECLARED_TEST_REFUSAL_CODES.UNIT_UNRESOLVED, [
              `the launcher-bound unit could not be resolved from canonical work records: ${authority.unit_address}`
            ], { unit: authority.unit_address })
          );
        }
        const projection = projectWorkRecordTestProofValidation({
          selectedUnit
        });
        const authorizedTargets = projection.targets;
        if (authorizedTargets.length === 0) {
          return jsonContent(
            createRefusal(WORKER_DECLARED_TEST_REFUSAL_CODES.NO_DECLARED_TARGETS, [
              `the launcher-bound unit declares no node_test targets; add one to acceptance.validation[] with operation node_test`
            ], { unit: authority.unit_address, authorized_targets: [] })
          );
        }

        const targetAuthorization = authorizeValidationTarget({
          workspaceDir: authority.worktree_path,
          target: args.target,
          authorizedTargets
        });
        const canonicalTarget = targetAuthorization.ok === true
          ? targetAuthorization.posixRelative
          : args.target;
        const result = await runDeclaredTest({
          authority,
          target: canonicalTarget,
          authorizedTargets
        });
        const verificationIds = targetAuthorization.ok === true
          ? projection.validation_bindings[canonicalTarget] ?? Object.freeze([])
          : Object.freeze([]);
        let testProofRuntimeEvidence = [];
        let proofExecutionReadiness = null;
        if (verificationIds.length > 0) {
          const proofAuthority = mintProofAuthority({ authority });
          let resolvedSelection;
          try {
            resolvedSelection = await queryProofBindings({
              repoRoot: proofAuthority.worktree_path,
              wkId: proofAuthority.wk_id ?? proofAuthority.record_id,
              verificationIds
            });
          } catch (error) {
            return jsonContent(createRefusal(
              WORKER_DECLARED_TEST_REFUSAL_CODES.TEST_PROOF_RECEIPT_INCOMPLETE,
              ["the declared proof binding population could not be resolved",
                error?.message ?? String(error)],
              { unit: authority.unit_address, refusal_code: error?.code ?? null }
            ));
          }
          proofExecutionReadiness = projectWorkerProofExecutionReadiness({
            selection: resolvedSelection,
            verificationIds,
            wkId: authority.record_id
          });
          if (proofExecutionReadiness === null) return jsonContent(createRefusal(
            WORKER_DECLARED_TEST_REFUSAL_CODES.TEST_PROOF_RECEIPT_INCOMPLETE,
            "the declared proof binding population is missing or ambiguous",
            { unit: authority.unit_address, verification_ids: verificationIds }
          ));
          if (proofExecutionReadiness.status === "not_ready") return jsonContent(
            buildWorkerDeclaredTestSuccess({
              workspaceRepo: workspace.repo,
              assignedUnit,
              authorizedTargets,
              verificationIds,
              proofExecutionReadiness,
              result,
              target: targetAuthorization.ok === true ? canonicalTarget : null
            })
          );
          let executed;
          try {
            executed = await executeVerifyProofReceiptPopulation({
              proofAuthority,
              targets: [canonicalTarget],
              validationBindings: { [canonicalTarget]: verificationIds },
              resolveBindings: async () => resolvedSelection,
              mintAttemptContext: mintProofContext,
              runAttempt: runProofAttempt,
              extractReceipt: extractProofReceipt
            });
          } catch (error) {
            return jsonContent(createRefusal(
              WORKER_DECLARED_TEST_REFUSAL_CODES.TEST_PROOF_RECEIPT_INCOMPLETE,
              ["a declared verification completed without complete exact runtime evidence",
                error?.message ?? String(error)],
              { unit: authority.unit_address, refusal_code: error?.code ?? null }
            ));
          }
          testProofRuntimeEvidence = [...executed.receipts_by_target[canonicalTarget]]
            .sort((left, right) => left.evidence_identity.verification_id.localeCompare(
              right.evidence_identity.verification_id));
          if (testProofRuntimeEvidence.length !== verificationIds.length) {
            return jsonContent(createRefusal(
              WORKER_DECLARED_TEST_REFUSAL_CODES.TEST_PROOF_RECEIPT_INCOMPLETE,
              "every declared verification requires one complete runtime-evidence receipt",
              { unit: authority.unit_address, verification_ids: verificationIds }
            ));
          }
        }
        return jsonContent(buildWorkerDeclaredTestSuccess({
          workspaceRepo: workspace.repo,
          assignedUnit,
          authorizedTargets,
          verificationIds,
          proofExecutionReadiness,
          testProofRuntimeEvidence: verificationIds.length > 0
            ? testProofRuntimeEvidence : null,
          result,
          target: targetAuthorization.ok === true ? canonicalTarget : null
        }));
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
