

import {
  ControlledContractToolError,
  assertControlledContractOperationInput
} from "../lib/controlled-contract-tools.mjs";
import { createControlledContractRefusal } from "./controlled-contract.mjs";
import {
  COMMON_PROOF_CAPTURE_REFUSAL_CODES,
  createCommonProofCaptureDependencies,
  createCommonProofCaptureSelection,
  resolveAndPersistCommonProofCapture
} from "../lib/common-proof-capture-tools.mjs";

export const COMMON_PROOF_CAPTURE_REQUEST_KEYS = Object.freeze([
  "family", "focus", "profileId", "profileVersion", "repository", "unit",
  "verificationId", "wkId"
]);

export const COMMON_PROOF_CAPTURE_OPERATION_REASON_CODES = Object.freeze({
  REPOSITORY_ALIAS_UNRESOLVED: "common_proof_capture_repository_alias_unresolved"
});

export function createCommonProofCaptureOperation({
  repositories = {},
  resolveLauncherReceipt = null,
  loadPackageCapabilities,
  now
} = {}) {
  if (repositories === null || typeof repositories !== "object" ||
      Array.isArray(repositories)) {
    throw new ControlledContractToolError(
      COMMON_PROOF_CAPTURE_REFUSAL_CODES.DEPENDENCIES_UNTRUSTED,
      "the configured repository registry must be one plain alias-to-root object"
    );
  }

  const registry = Object.freeze(new Map(Object.entries(repositories)));
  const dependencies = createCommonProofCaptureDependencies({
    resolveLauncherReceipt,
    ...(loadPackageCapabilities === undefined ? {} : { loadPackageCapabilities }),
    ...(now === undefined ? {} : { now })
  });

  return async function commonProofCaptureOperation(request) {
    try {
      assertControlledContractOperationInput(request, COMMON_PROOF_CAPTURE_REQUEST_KEYS);
      const alias = request.repository;
      if (typeof alias !== "string" || !registry.has(alias)) {
        throw new ControlledContractToolError(
          COMMON_PROOF_CAPTURE_OPERATION_REASON_CODES.REPOSITORY_ALIAS_UNRESOLVED,
          "the requested repository alias is not one configured canonical repository",
          { repository: typeof alias === "string" ? alias : null }
        );
      }
      const selection = createCommonProofCaptureSelection({
        repositoryAlias: alias,
        repoRoot: registry.get(alias),
        wkId: request.wkId,
        unitAddress: request.unit,
        focus: request.focus ?? null,
        family: request.family,
        profileId: request.profileId,
        profileVersion: request.profileVersion,
        verificationId: request.verificationId ?? null
      });
      return await resolveAndPersistCommonProofCapture({ selection, dependencies });
    } catch (error) {
      throw createControlledContractRefusal(error);
    }
  };
}

export const commonProofCaptureOperation = createCommonProofCaptureOperation();
