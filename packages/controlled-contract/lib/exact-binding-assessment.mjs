import {
  ExactBindingError,
  canonicalDigest
} from "./exact-binding-common.mjs";
import { loadExactBindingAdmissionV1 } from "./exact-binding-admission.mjs";
import {
  PinnedCaptureRoot,
  captureAndEvaluateExactBindingsV1
} from "./exact-binding-capture.mjs";
import {
  parseExactBindingAssessmentRequestJson,
  snapshotExactBindingAssessmentRequest
} from "./exact-binding-plain-data.mjs";
import { assertAdmittedProofPackSnapshot } from "./admitted-proof-packs.mjs";

function parseCapturedJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ExactBindingError(
      `exact_binding_${label}_json_invalid`,
      `captured ${label} is not valid JSON`,
      { cause: error.message }
    );
  }
}

function validateVocabularyIdentity(vocabularyIdentity) {
  if (!vocabularyIdentity || typeof vocabularyIdentity !== "object" ||
      Array.isArray(vocabularyIdentity) ||
      Object.keys(vocabularyIdentity).length !== 2 ||
      typeof vocabularyIdentity.version !== "string" ||
      !/^[0-9a-f]{64}$/u.test(vocabularyIdentity.complete_digest ?? "")) {
    throw new ExactBindingError(
      "exact_binding_vocabulary_identity_invalid",
      "trusted vocabulary identity must contain version and complete_digest"
    );
  }
}

async function assessFrozenRequest(request, trusted) {
  validateVocabularyIdentity(trusted.vocabularyIdentity);
  const pack = await loadExactBindingAdmissionV1(
    trusted.packDirectory,
    request.profileId
  );
  const pinnedRoot = await PinnedCaptureRoot.open(trusted.captureRoot);
  try {
    const [contractBytes, evaluationInputBytes] = await Promise.all([
      pinnedRoot.captureArtifact(request.contractPath),
      pinnedRoot.captureArtifact(request.evaluationInputPath)
    ]);
    const contract = parseCapturedJson(contractBytes, "contract");
    const evaluationInput = parseCapturedJson(
      evaluationInputBytes, "evaluation_input"
    );
    const context = {
      contract_digest: canonicalDigest(contract),
      profile_digest: pack.profile_digest,
      evaluation_input_digest: canonicalDigest(evaluationInput),
      vocabulary_version: trusted.vocabularyIdentity.version,
      vocabulary_complete_digest: trusted.vocabularyIdentity.complete_digest,
      admission_digest: pack.admission_digest,
      exact_binding_declaration_digest: pack.exact_binding_declaration_digest,
      exact_binding_certification_digest: pack.exact_binding_certification_digest
    };
    return await captureAndEvaluateExactBindingsV1({
      request,
      declaration: pack.declaration,
      evaluationInput,
      context,
      expectedContext: context,
      pinnedRoot
    });
  } finally {
    await pinnedRoot.close();
  }
}

async function captureFrozenAggregateRequest(request, trusted) {
  validateVocabularyIdentity(trusted.vocabularyIdentity);
  const pack = assertAdmittedProofPackSnapshot(trusted.proofPack);
  if (pack.admission_version !== 2 || !pack.declaration) {
    throw new ExactBindingError(
      "exact_binding_pack_required",
      "an exact-bound aggregate requires a v2 admitted proof pack"
    );
  }
  const pinnedRoot = await PinnedCaptureRoot.open(trusted.captureRoot);
  try {
    const [contractBytes, evaluationInputBytes] = await Promise.all([
      pinnedRoot.captureArtifact(request.contractPath),
      pinnedRoot.captureArtifact(request.evaluationInputPath)
    ]);
    const contract = parseCapturedJson(contractBytes, "contract");
    const evaluationInput = parseCapturedJson(
      evaluationInputBytes, "evaluation_input"
    );
    const context = {
      contract_digest: canonicalDigest(contract),
      profile_digest: pack.profile_digest,
      evaluation_input_digest: canonicalDigest(evaluationInput),
      vocabulary_version: trusted.vocabularyIdentity.version,
      vocabulary_complete_digest: trusted.vocabularyIdentity.complete_digest,
      admission_digest: pack.admission_digest,
      exact_binding_declaration_digest: pack.exact_binding_declaration_digest,
      exact_binding_certification_digest: pack.exact_binding_certification_digest
    };
    const exactBindingResult = await captureAndEvaluateExactBindingsV1({
      request,
      declaration: pack.declaration,
      evaluationInput,
      context,
      expectedContext: context,
      pinnedRoot
    });
    return {
      contract,
      contractSource: contractBytes.toString("utf8"),
      evaluationInput,
      evaluationInputSource: evaluationInputBytes.toString("utf8"),
      exactBindingResult,
      exactBindingSources: request.exactBindingSources
    };
  } finally {
    await pinnedRoot.close();
  }
}

async function captureExactBoundAssessmentInputsV1(request, trusted) {
  const frozenRequest = snapshotExactBindingAssessmentRequest(request);
  return captureFrozenAggregateRequest(frozenRequest, trusted);
}

async function assessExactBindingFilesV1(request, trusted) {
  const frozenRequest = snapshotExactBindingAssessmentRequest(request);
  return assessFrozenRequest(frozenRequest, trusted);
}

async function assessExactBindingSerializedRequestV1(requestBytes, trusted) {
  const frozenRequest = parseExactBindingAssessmentRequestJson(requestBytes);
  return assessFrozenRequest(frozenRequest, trusted);
}

export {
  assessExactBindingFilesV1,
  assessExactBindingSerializedRequestV1,
  captureExactBoundAssessmentInputsV1
};
