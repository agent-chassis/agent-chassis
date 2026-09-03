

import {
  CARRIER_TARGETS,
  CONTROLLED_CONTRACT_PATCH_LIMITS,
  ControlledContractToolError,
  applyControlledContractCarrierPatch,
  assertControlledContractAuthorableCarrierKind,
  assertControlledContractCarrierExpectedDigest,
  assertControlledContractOperationInput,
  composeProofPlanRequestEvaluationInputPaths,
  composeProofPlanRequestPatchEvaluationInputPaths,
  controlledContractCarrierTargetCause,
  controlledContractContentDigest,
  diffControlledContractCarrierContent,
  patchControlledContractVerificationBundles,
  queryControlledContractCarrierContent,
  readCanonicalProofPlanInputs,
  readControlledContractCarrierFile,
  resolveCanonicalControlledContractCarrierSet,
  writeControlledContractCarrierFile
} from "../../lib/controlled-contract-tools.mjs";
import { assertCanonicalCarrierSetIsNotFencedLegacy } from
  "../../lib/controlled-contract-carrier-set-tools.mjs";
import { addressedEvaluationInputPack, loadControlledContractPackage } from
  "./package-runtime.mjs";
import { validateAuthorableCarrier } from "./authorable-carrier-validation.mjs";
import { controlledContractOperation } from "./refusal.mjs";

function proofPlanBuildNextCall(input, expectedContentDigest) {
  return Object.freeze({
    tool: "workspace_controlled_proof_plan_build",
    arguments: Object.freeze({
      wk_id: input.wkId,
      ...(input.focus === undefined || input.focus === null ? {} : { focus: input.focus }),
      expected_content_digest: expectedContentDigest
    }),
    recommended: true
  });
}

function absentProofPlanMetadata(input) {
  return Object.freeze({
    schema_version: "controlled-contract-proof-plan-metadata.v1",
    carrier_kind: "proof_plan",
    exists: false,
    content_digest: null,
    rebuild_expected_content_digest: null,
    source_binding_status: "absent",
    next_calls: Object.freeze([proofPlanBuildNextCall(input, null)])
  });
}

async function resolveFencedPublicCarrierSet(input) {
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
  return canonicalSet;
}

export async function readControlledContractCarrierOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "carrierKind", "profileId", "profileVersion"
    ]);
    const pack = addressedEvaluationInputPack(input);
    const canonicalSet = await resolveFencedPublicCarrierSet(input);
    return readControlledContractCarrierFile({ ...input, pack, canonicalSet });
  });
}

export async function writeControlledContractCarrierOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "carrierKind", "content", "expectedContentDigest",
      "profileId", "profileVersion"
    ]);
    if (!["contract", "evaluation_input"].includes(input.carrierKind)) {
      throw new ControlledContractToolError("controlled_contract_carrier_write_forbidden",
        "operator recovery write supports only contract and evaluation_input carriers");
    }
    const pack = addressedEvaluationInputPack(input);
    const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null
    });
    return writeControlledContractCarrierFile({
      ...input,
      pack,
      canonicalSet,
      preferPack: pack !== null && input.expectedContentDigest === null
    });
  });
}

export async function createControlledContractCarrierOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "carrierKind", "content", "expectedContentDigest",
      "profileId", "profileVersion"
    ]);
    assertControlledContractAuthorableCarrierKind(input.carrierKind);
    const pack = addressedEvaluationInputPack(input);
    const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null
    });
    if (input.expectedContentDigest !== null) throw new ControlledContractToolError(
      "controlled_contract_create_expected_absence_required", "create requires expected_content_digest null"
    );
    await assertControlledContractCarrierExpectedDigest({
      ...input,
      expectedContentDigest: null,
      pack,
      canonicalSet,
      preferPack: pack !== null
    });
    const content = input.carrierKind === "proof_plan_request"
      ? await composeProofPlanRequestEvaluationInputPaths({ ...input, canonicalSet })
      : input.content;
    controlledContractContentDigest(content);
    await validateAuthorableCarrier(input, content, canonicalSet);
    const write = await writeControlledContractCarrierFile({
      ...input,
      content,
      pack,
      canonicalSet,
      preferPack: pack !== null
    });
    return Object.freeze({
      carrier_kind: input.carrierKind,
      prior_content_digest: null,
      content_digest: write.content_digest,
      validation_status: "valid"
    });
  });
}

export async function queryControlledContractCarrierOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "carrierKind", "selectors", "target", "filter", "cursor",
      "profileId", "profileVersion"
    ]);
    const pack = addressedEvaluationInputPack(input);
    if (input.carrierKind === "proof_plan") {
      if (input.selectors !== undefined || input.target !== undefined || input.filter !== undefined || input.cursor !== undefined)
        throw new ControlledContractToolError("controlled_contract_proof_plan_query_invalid",
          "proof-plan query exposes metadata only and accepts no content selector");
      const canonicalSet = await resolveFencedPublicCarrierSet(input);
      let plan;
      try {
        plan = await readControlledContractCarrierFile({ ...input, canonicalSet });
      } catch (error) {
        if (error?.code !== "controlled_contract_carrier_not_found") throw error;
        plan = null;
      }
      let loaded;
      try {
        loaded = await readCanonicalProofPlanInputs({ ...input, canonicalSet });
      } catch (error) {
        if (plan !== null || error?.code !== "controlled_contract_carrier_not_found") throw error;

        await readControlledContractCarrierFile({
          ...input, carrierKind: "contract", canonicalSet
        });
        return absentProofPlanMetadata(input);
      }
      const missing = loaded.request.content.selected_packs
        .filter(({ evaluation_input_path: filename }) =>
          typeof filename === "string" && !Object.hasOwn(loaded.evaluationInputs, filename))
        .sort((left, right) => {
          const leftIdentity = `${left.profile_id}\0${left.profile_version}`;
          const rightIdentity = `${right.profile_id}\0${right.profile_version}`;
          return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
        });
      if (missing.length > 0) return Object.freeze({
        schema_version: "controlled-contract-proof-plan-metadata.v1",
        carrier_kind: "proof_plan",
        exists: plan !== null,
        content_digest: plan?.content_digest ?? null,
        rebuild_expected_content_digest: plan?.content_digest ?? null,
        source_binding_status: "incomplete",
        missing_input_count: missing.length,
        next_calls: Object.freeze([{
          tool: "workspace_controlled_contract_authoring_describe",
          arguments: Object.freeze({ carrier_kind: "evaluation_input" }),
          recommended: true
        }])
      });
      const pkg = await loadControlledContractPackage();
      const current = await pkg.buildProofPlan({ contract: loaded.contract.content,
        request: loaded.request.content, evaluationInputs: loaded.evaluationInputs });
      const currentDigest = controlledContractContentDigest(current);
      const sourceBindingStatus = plan === null
        ? "absent"
        : currentDigest === plan.content_digest ? "current" : "stale";
      return Object.freeze({ schema_version: "controlled-contract-proof-plan-metadata.v1",
        carrier_kind: "proof_plan", exists: plan !== null,
        content_digest: plan?.content_digest ?? null,
        rebuild_expected_content_digest: plan?.content_digest ?? null,
        source_binding_status: sourceBindingStatus,
        ...(plan === null ? {} : {
          stored_source_digests: plan.content.digests ?? null,
          current_source_digests: current.digests ?? null
        }),
        ...(sourceBindingStatus === "current" ? {} : {
          next_calls: Object.freeze([
            proofPlanBuildNextCall(input, plan?.content_digest ?? null)
          ])
        })
      });
    }
    assertControlledContractAuthorableCarrierKind(input.carrierKind);
    if (input.selectors === undefined && input.target !== undefined &&
        !Object.hasOwn(CARRIER_TARGETS[input.carrierKind] ?? {}, input.target)) {
      const cause = controlledContractCarrierTargetCause({
        carrierKind: input.carrierKind,
        target: input.target,
        wkId: input.wkId,
        focus: input.focus ?? null,
        profileId: input.profileId,
        profileVersion: input.profileVersion
      });
      throw new ControlledContractToolError(cause.cause,
        "target is not mutable for this carrier kind", cause);
    }
    const canonicalSet = await resolveFencedPublicCarrierSet(input);
    const carrier = await readControlledContractCarrierFile({ ...input, pack, canonicalSet });
    return queryControlledContractCarrierContent({ carrier, selectors: input.selectors,
      target: input.target ?? null, filter: input.filter ?? null, cursor: input.cursor ?? null });
  });
}

export async function patchControlledContractCarrierOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "carrierKind", "expectedContentDigest", "operations",
      "profileId", "profileVersion"
    ]);
    assertControlledContractAuthorableCarrierKind(input.carrierKind);
    const pack = addressedEvaluationInputPack(input);
    const requestBytes = Buffer.byteLength(JSON.stringify({
      wk_id: input.wkId, focus: input.focus ?? null, carrier_kind: input.carrierKind,
      expected_content_digest: input.expectedContentDigest, operations: input.operations
    }), "utf8");
    if (requestBytes > CONTROLLED_CONTRACT_PATCH_LIMITS.request_bytes) {
      throw new ControlledContractToolError("controlled_contract_patch_request_too_large",
        "complete patch request exceeds 65,536 UTF-8 bytes", { byte_length: requestBytes });
    }
    const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null
    });
    const operations = input.carrierKind === "proof_plan_request"
      ? await composeProofPlanRequestPatchEvaluationInputPaths({ ...input, canonicalSet })
      : input.operations;
    const carrier = await readControlledContractCarrierFile({
      ...input, pack, canonicalSet
    });
    if (carrier.content_digest !== input.expectedContentDigest) throw new ControlledContractToolError(
      "controlled_contract_stale_content_digest", "canonical carrier content changed",
      { expected_content_digest: input.expectedContentDigest,
        actual_content_digest: carrier.content_digest }
    );
    const patched = applyControlledContractCarrierPatch({
      content: carrier.content, carrierKind: input.carrierKind, operations
    });
    const nextDigest = controlledContractContentDigest(patched.content);
    await validateAuthorableCarrier(input, patched.content, canonicalSet);
    const noOp = nextDigest === carrier.content_digest;
    const changed = noOp ? {} : diffControlledContractCarrierContent({
      before: carrier.content, after: patched.content, carrierKind: input.carrierKind
    });
    const receipt = {
      changed,
      prior_content_digest: carrier.content_digest,
      content_digest: nextDigest,
      written: !noOp, no_op: noOp,
      validation_status: "valid",
      invalidation: { proof_plan: noOp ? "unchanged" : "stale",
        assessment: noOp ? "unchanged" : "stale" }
    };
    if (Buffer.byteLength(JSON.stringify(receipt), "utf8") >
        CONTROLLED_CONTRACT_PATCH_LIMITS.receipt_bytes) throw new ControlledContractToolError(
      "controlled_contract_patch_receipt_too_large", "patch receipt exceeds 8,192 UTF-8 bytes"
    );
    if (!noOp) await writeControlledContractCarrierFile({
      ...input,
      content: patched.content,
      pack,
      canonicalSet
    });
    return Object.freeze(receipt);
  });
}

export async function patchControlledContractVerificationBundleOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "expectedContentDigest", "operations"
    ]);
    return patchControlledContractVerificationBundles(input);
  });
}
