

import path from "node:path";

import {
  ControlledContractToolError,
  assertControlledContractOperationInput,
  controlledContractContentDigest,
  readCanonicalProofPlanInputs,
  readControlledContractAssessmentArtifactFile,
  readControlledContractCarrierFile,
  resolveCanonicalControlledContractCarrierSet,
  withCanonicalControlledContractSourceLease
} from "../../lib/controlled-contract-tools.mjs";
import {
  assertCanonicalCarrierSetIsNotFencedLegacy,
  resolveCanonicalControlledContractCarrierDirectory
} from "../../lib/controlled-contract-carrier-set-tools.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";
import { projectControlledContractProofAssessmentSummary } from
  "./assessment-semantic-projection.mjs";
import { controlledContractOperation } from "./refusal.mjs";
import {
  projectCrossCarrierIntegrityAxis,
  resolveControlledContractRefactorSnapshot
} from "./refactor-semantic-operations.mjs";

const ASSESSMENT_SNAPSHOTS = new WeakMap();
let controlledContractAssessmentHook = null;

export function setControlledContractAssessmentHookForTest(hook = null) {
  if (hook !== null && typeof hook !== "function") {
    throw new TypeError("controlled contract assessment hook must be a function or null");
  }
  controlledContractAssessmentHook = hook;
}

async function assessmentBoundary(boundary, details) {
  if (controlledContractAssessmentHook !== null) {
    await controlledContractAssessmentHook(boundary, Object.freeze(details));
  }
}

async function resolveProofAssessmentSourceIdentity(input) {
  const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
    repoRoot: input.repoRoot,
    wkId: input.wkId,
    focus: input.focus ?? null
  });
  await assertCanonicalCarrierSetIsNotFencedLegacy({
    repoRoot: input.repoRoot,
    wkId: input.wkId,
    canonicalSet
  });
  const [contract, plan] = await Promise.all([
    readControlledContractCarrierFile({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
      carrierKind: "contract", canonicalSet
    }),
    readControlledContractCarrierFile({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
      carrierKind: "proof_plan", canonicalSet
    })
  ]);
  return Object.freeze({
    work_record_id: input.wkId,
    focus: input.focus ?? null,
    generation_id: typeof canonicalSet.generation === "string"
      ? canonicalSet.generation : canonicalSet.generation?.id ?? null,
    manifest_digest: canonicalSet.manifest_content_digest ?? null,
    controlled_contract_digest: contract.content_digest,
    proof_plan_digest: plan.content_digest
  });
}

export function consumeControlledContractAssessmentSnapshot(result) {
  const snapshot = result && typeof result === "object"
    ? ASSESSMENT_SNAPSHOTS.get(result) ?? null : null;
  if (snapshot !== null) ASSESSMENT_SNAPSHOTS.delete(result);
  return snapshot;
}

export function assertControlledContractAssessmentRefactorSourceCurrent(
  sourceIdentity, refactorSource
) {
  if (refactorSource.generation === sourceIdentity.generation_id &&
      refactorSource.manifestDigest === sourceIdentity.manifest_digest) return true;
  throw new ControlledContractToolError(
    "controlled_contract_assessment_source_generation_changed",
    "canonical generation changed while assessment integrity was materialized",
    { changed: false, expected_generation: sourceIdentity.generation_id,
      actual_generation: refactorSource.generation,
      expected_manifest_digest: sourceIdentity.manifest_digest,
      actual_manifest_digest: refactorSource.manifestDigest }
  );
}

export async function assessControlledContractOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "summaryByteAllowance"
    ]);

    const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null
    });
    await assertCanonicalCarrierSetIsNotFencedLegacy({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      canonicalSet
    });
    const contract = await readControlledContractCarrierFile({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      carrierKind: "contract",
      canonicalSet
    });
    const {
      assessProofPlanFiles,
      buildControlledContractAssessmentRecovery,
      writeMultiPackAssessmentBundle
    } = await loadControlledContractPackage();
    const recover = (reasonCode, options = {}) =>
      buildControlledContractAssessmentRecovery({
        reasonCode,
        contractIdentity: {
          carrier_kind: "contract",
          wk_id: contract.wk_id,
          focus: contract.focus,
          content_digest: contract.content_digest
        },
        ...options
      });
    const contractsDirectory = await resolveCanonicalControlledContractCarrierDirectory({
      repoRoot: input.repoRoot,
      canonicalSet
    });
    const assessPlan = async (plan) => {
      const sourceIdentity = Object.freeze({
        work_record_id: input.wkId,
        focus: input.focus ?? null,
        generation_id: typeof canonicalSet.generation === "string"
          ? canonicalSet.generation : canonicalSet.generation?.id ?? null,
        manifest_digest: canonicalSet.manifest_content_digest ?? null,
        controlled_contract_digest: contract.content_digest,
        proof_plan_digest: plan.content_digest
      });
      await assessmentBoundary("assessment_initial_validation_completed", {
        source_identity: sourceIdentity
      });
      return withCanonicalControlledContractSourceLease({
        repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
        canonicalSet, mutation: { carrierKind: "contract" }
      }, async (leased) => {
        assertControlledContractAssessmentRefactorSourceCurrent(
          sourceIdentity, {
            generation: typeof leased.canonical_set.generation === "string"
              ? leased.canonical_set.generation : leased.canonical_set.generation?.id ?? null,
            manifestDigest: leased.manifest_content_digest
          });
        const refactorSource = await resolveControlledContractRefactorSnapshot(input);
        const sourceCurrent = assertControlledContractAssessmentRefactorSourceCurrent(
          sourceIdentity,
          refactorSource
        );
        const refactorContract = refactorSource.liveCarriers.find(
          ({ carrier_kind: kind }) => kind === "contract")?.content;
        const identity = refactorContract?.propositions?.[0]?.proposition_id ??
          refactorContract?.claims?.[0]?.claim_id ?? null;
        if (typeof identity !== "string") {
          throw new ControlledContractToolError(
            "controlled_contract_assessment_refactor_identity_unavailable",
            "assessment requires one package-classifiable controlled-contract identity",
            { changed: false }
          );
        }
        let refactorPackageResult;
        try {
          refactorPackageResult = (await loadControlledContractPackage())
            .buildControlledContractRefactorClosure({
              live_carriers: refactorSource.liveCarriers,
              mode: {
                kind: "rename_identity",
                old_identity: identity,
                new_identity: `assessment-${
                  controlledContractContentDigest(identity).slice(7, 31)}`
              }
            });
        } catch (error) {
          if (error?.code !== "controlled_contract_refactor_closure_incomplete" ||
              error.integrity === undefined || typeof error.result_digest !== "string") {
            throw error;
          }
          refactorPackageResult = error;
        }
        const crossCarrierIntegrity = projectCrossCarrierIntegrityAxis(
          refactorPackageResult,
          { currentGeneration: sourceIdentity.generation_id }
        );
        const projected = await assessProofPlanFiles({
          inputPath: path.join(contractsDirectory, contract.filename),
          proofPlanPath: path.join(contractsDirectory, plan.filename)
        });
        await writeMultiPackAssessmentBundle(projected,
          { repositoryRoot: input.repoRoot });
        const assessment = Object.freeze({
          ...projected.assessment,
          cross_carrier_integrity: crossCarrierIntegrity
        });
        const summary = projectControlledContractProofAssessmentSummary(
          assessment, sourceIdentity, input.summaryByteAllowance, sourceCurrent);
        ASSESSMENT_SNAPSHOTS.set(summary, Object.freeze({
          family: "proof",
          assessment,
          source_identity: sourceIdentity,
          refactor_package_result: refactorPackageResult,
          resolve_current_source_identity: () => resolveProofAssessmentSourceIdentity(input)
        }));
        return summary;
      });
    };
    let plan = null;
    try {
      plan = await readControlledContractCarrierFile({
        repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
        carrierKind: "proof_plan", canonicalSet
      });
    } catch (error) {
      if (error?.code !== "controlled_contract_carrier_not_found") throw error;
    }

    if (plan) {
      const loaded = await readCanonicalProofPlanInputs({ ...input, canonicalSet });
      const current = await (await loadControlledContractPackage()).buildProofPlan({
        contract: loaded.contract.content,
        request: loaded.request.content,
        evaluationInputs: loaded.evaluationInputs
      });
      const currentDigest = controlledContractContentDigest(current);
      if (currentDigest === plan.content_digest) return assessPlan(plan);
      return recover("controlled_contract_proof_plan_stale", {
        staleContentDigest: plan.content_digest
      });
    }

    let request;
    try {
      request = await readControlledContractCarrierFile({
        repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
        carrierKind: "proof_plan_request", canonicalSet
      });
    } catch (error) {
      if (error?.code !== "controlled_contract_carrier_not_found") throw error;
      return recover("controlled_contract_proof_plan_request_missing");
    }

    const loaded = await readCanonicalProofPlanInputs({
      ...input, requestContent: request.content, canonicalSet
    });
    const missingEvaluation = request.content.selected_packs.find((selected) =>
      typeof selected?.evaluation_input_path === "string" &&
      !Object.hasOwn(loaded.evaluationInputs, selected.evaluation_input_path));
    if (missingEvaluation) {
      return recover("controlled_contract_evaluation_input_missing");
    }

    const pkg = await loadControlledContractPackage();
    await pkg.buildProofPlan({ contract: loaded.contract.content,
      request: request.content, evaluationInputs: loaded.evaluationInputs });
    return recover("controlled_contract_proof_plan_missing");
  });
}

export async function readControlledContractAssessmentArtifactOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "assessmentIdentity", "artifactFile"
    ]);
    return readControlledContractAssessmentArtifactFile(input);
  });
}
