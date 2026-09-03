

import { createHash } from "node:crypto";

import {
  ControlledContractToolError,
  assertBoundedStringArray,
  assertControlledContractCarrierExpectedDigest,
  assertControlledContractOperationInput,
  CONTROLLED_CONTRACT_PROOF_PACK_SELECTION_RESULT_SCHEMA_VERSION,
  normalizeControlledContractIdentity,
  readCanonicalProofPlanInputs,
  readControlledContractCarrierFile,
  writeControlledContractProofPlanFile
} from "../../lib/controlled-contract-tools.mjs";
import {
  bindingInspectionCursorPosition,
  compactBindingInspection,
  compactProofPackDescription
} from "../../lib/controlled-contract-authoring-projections.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";
import { controlledContractOperation } from "./refusal.mjs";

export const CONTROLLED_CONTRACT_PROOF_PACK_SELECTION_PROJECTION_VERSION =
  "controlled-contract-proof-pack-task-context.v3";

const PROOF_PACK_DESCRIBE_TOOL = "workspace_controlled_proof_pack_describe";
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;

function freezeProjection(value) {
  if (Array.isArray(value)) {
    for (const entry of value) freezeProjection(entry);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) freezeProjection(entry);
  }
  return Object.freeze(value);
}

function selectionDigest(selection) {
  return `sha256:${createHash("sha256").update(JSON.stringify(selection)).digest("hex")}`;
}

function assertSelectionProjectionInput({ selection, contractContentDigest,
  authoringProjections, intentArtifact }) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection) ||
      selection.schema_version !==
        CONTROLLED_CONTRACT_PROOF_PACK_SELECTION_RESULT_SCHEMA_VERSION ||
      !selection.decision || typeof selection.decision !== "object" ||
      !Array.isArray(selection.requested_intents) || !Array.isArray(selection.candidates) ||
      !Array.isArray(selection.per_intent_outcomes) ||
      !Array.isArray(selection.compatible_candidates) ||
      !Array.isArray(authoringProjections) ||
      !intentArtifact || !Array.isArray(intentArtifact.intents) ||
      !SHA256_DIGEST.test(contractContentDigest)) {
    throw new ControlledContractToolError(
      "controlled_contract_proof_pack_selection_projection_invalid",
      "proof-pack selection projection requires a package result and current contract digest"
    );
  }
  if (authoringProjections.length !== selection.candidates.length) {
    throw new ControlledContractToolError(
      "controlled_contract_proof_pack_selection_projection_invalid",
      "proof-pack task context requires one authoring projection per candidate"
    );
  }
  for (const intent of selection.requested_intents) {
    if (typeof intent !== "string" || intent.length === 0) {
      throw new ControlledContractToolError(
        "controlled_contract_proof_pack_selection_projection_invalid",
        "proof-pack selection projection received an invalid requested intent identity"
      );
    }
  }
  for (const candidate of selection.candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
        typeof candidate.profile_id !== "string" || candidate.profile_id.length === 0 ||
        typeof candidate.profile_version !== "string" || candidate.profile_version.length === 0 ||
        !Array.isArray(candidate.requested_intents) ||
        candidate.requested_intents.some((intent) =>
          typeof intent !== "string" || intent.length === 0)) {
      throw new ControlledContractToolError(
        "controlled_contract_proof_pack_selection_projection_invalid",
        "proof-pack selection projection received an invalid candidate identity"
      );
    }
  }
}

function exactInspectionCalls({ candidate, wkId, focus }) {
  return [{
    tool: PROOF_PACK_DESCRIBE_TOOL,
    arguments: {
      wk_id: wkId,
      ...(focus === null ? {} : { focus }),
      profile_id: candidate.profile_id,
      profile_version: candidate.profile_version,
      requested_intents: [...candidate.requested_intents]
    }
  }, {
    tool: "workspace_controlled_proof_pack_bindings_inspect",
    arguments: {
      wk_id: wkId,
      ...(focus === null ? {} : { focus }),
      profile_id: candidate.profile_id,
      profile_version: candidate.profile_version,
      requested_intents: [...candidate.requested_intents]
    }
  }];
}

function candidateTaskContext({ candidate, authoring }) {
  const identityMatches = authoring.profile_id === candidate.profile_id &&
    authoring.profile_version === candidate.profile_version;
  if (!identityMatches) throw new ControlledContractToolError(
    "controlled_contract_proof_pack_selection_projection_invalid",
    "candidate and authoring projection identities do not match"
  );
  return {
    profile_id: candidate.profile_id,
    profile_version: candidate.profile_version,
    requested_intents: [...candidate.requested_intents],
    intent_distinctions: structuredClone(authoring.intent_distinctions),
    guarantee: candidate.guarantee,
    compatibility: structuredClone(authoring.compatibility),
    exact_binding_required: candidate.exact_binding_required,
    missing_compatible_reference_types:
      structuredClone(candidate.missing_compatible_reference_types),
    bindings: {
      required_inputs: structuredClone(candidate.required_inputs),
      evaluation_input_skeleton: structuredClone(authoring.evaluation_input_skeleton),
      role_constraints: structuredClone(authoring.role_constraints)
    },
    explicit_exclusions: structuredClone(authoring.explicit_exclusions),
    proof_obligations: structuredClone(authoring.proof_obligations),
    source_digests: structuredClone(authoring.source_digests)
  };
}

export function projectProofPackSelectionTaskContext({
  selection,
  contractContentDigest,
  authoringProjections,
  intentArtifact,
  wkId,
  focus = null
}) {
  assertSelectionProjectionInput({ selection, contractContentDigest,
    authoringProjections, intentArtifact });
  const requested = new Set(selection.requested_intents);
  const definitions = intentArtifact.intents.filter(({ intent_id: intentId }) =>
    requested.has(intentId)).map((intent) => structuredClone(intent));
  if (definitions.length !== requested.size) throw new ControlledContractToolError(
    "controlled_contract_proof_pack_selection_projection_invalid",
    "requested proof-intent definitions are incomplete"
  );
  const candidates = selection.candidates.map((candidate, index) =>
    candidateTaskContext({ candidate, authoring: authoringProjections[index] }));
  const compatibleCandidates = selection.compatible_candidates.map((candidate) => ({
    ...structuredClone(candidate),
    inspection_calls: exactInspectionCalls({ candidate, wkId, focus })
  }));
  return freezeProjection({
    schema_version: CONTROLLED_CONTRACT_PROOF_PACK_SELECTION_PROJECTION_VERSION,
    task: {
      wk_id: wkId,
      focus,
      requested_intent_ids: [...selection.requested_intents],
      requested_intent_definitions: definitions
    },
    selection: {
      schema_version: selection.schema_version,
      decision: structuredClone(selection.decision),
      requested_intents: structuredClone(selection.requested_intents),
      per_intent_outcomes: structuredClone(selection.per_intent_outcomes),
      compatible_candidates: compatibleCandidates,
      hard_incompatibilities: structuredClone(selection.hard_incompatibilities),
      authority: selection.authority
    },
    candidates,
    source_digests: {
      contract: contractContentDigest,
      selection: selectionDigest(selection),
      catalog: selection.digests.catalog,
      vocabulary: selection.digests.vocabulary,
      profiles: selection.digests.profiles,
      intent_artifact: selection.digests.intent_artifact
    }
  });
}

export const projectProofPackSelectionSummary = projectProofPackSelectionTaskContext;

export async function queryControlledVocabularyOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["text", "kinds"]);
    if (typeof input.text !== "string" || Buffer.byteLength(input.text, "utf8") > 4096) {
      throw new ControlledContractToolError(
        "controlled_contract_vocabulary_query_invalid",
        "text must be a bounded string"
      );
    }
    const kinds = input.kinds === undefined
      ? undefined
      : assertBoundedStringArray(input.kinds, { field: "kinds", maximumItems: 4 });
    const { searchVocabulary } = await loadControlledContractPackage();
    return searchVocabulary({ text: input.text, ...(kinds ? { kinds } : {}) });
  });
}

export async function discoverControlledProofIntentsOperation(input = {}) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["query", "limit"]);
    const { discoverProofIntents } = await loadControlledContractPackage();
    return discoverProofIntents(input);
  });
}

export async function selectProofPacksOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "requestedIntents"
    ]);
    const requestedIntents = assertBoundedStringArray(input.requestedIntents, {
      field: "requested_intents",
      maximumItems: 28
    });
    const carrier = await readControlledContractCarrierFile({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      carrierKind: "contract"
    });
    const [{ selectProofPacksV2 }, { describeProofPackAuthoring,
      PROOF_INTENT_ARTIFACT }] = await Promise.all([
      import("@agent-chassis/controlled-contract/proof-intents"),
      loadControlledContractPackage()
    ]);
    const selection = selectProofPacksV2({
      contract: carrier.content,
      requestedIntents
    });
    const authoringProjections = selection.candidates.map((candidate) =>
      describeProofPackAuthoring({
        profileId: candidate.profile_id,
        profileVersion: candidate.profile_version,
        requestedIntents: candidate.requested_intents
      }));
    return projectProofPackSelectionTaskContext({
      selection,
      contractContentDigest: carrier.content_digest,
      authoringProjections,
      intentArtifact: PROOF_INTENT_ARTIFACT,
      wkId: input.wkId,
      focus: input.focus ?? null
    });
  });
}

export async function describeProofPackOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["profileId", "profileVersion", "requestedIntents",
      "sections", "selectors", "cursor"]);
    const requestedIntents = input.requestedIntents === undefined
      ? null
      : assertBoundedStringArray(input.requestedIntents, {
        field: "requested_intents",
        maximumItems: 28
      });
    const { describeProofPackAuthoring } = await loadControlledContractPackage();
    const full = await describeProofPackAuthoring({
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      requestedIntents
    });
    return compactProofPackDescription(full, { sections: input.sections,
      selectors: input.selectors, cursor: input.cursor ?? null });
  });
}

export async function inspectProofPackBindingsOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "profileId", "profileVersion",
      "requestedIntents", "evaluationFocus", "roles", "statuses", "cursor",
      "workspaceRepo"
    ]);
    normalizeControlledContractIdentity({
      wkId: input.wkId,
      focus: input.evaluationFocus === undefined ? null : input.evaluationFocus
    });
    const contract = await readControlledContractCarrierFile({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      carrierKind: "contract"
    });
    const evaluation = input.evaluationFocus === undefined
      ? null
      : await readControlledContractCarrierFile({
        repoRoot: input.repoRoot,
        wkId: input.wkId,
        focus: input.evaluationFocus,
        carrierKind: "evaluation_input",
        pack: { profileId: input.profileId, profileVersion: input.profileVersion }
      });
    const requestedIntents = input.requestedIntents === undefined
      ? null
      : assertBoundedStringArray(input.requestedIntents, {
        field: "requested_intents",
        maximumItems: 28
      });
    const { inspectProofPackBindingsPage } = await loadControlledContractPackage();
    const page = await inspectProofPackBindingsPage({
      contract: contract.content,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      requestedIntents,
      evaluationInput: evaluation?.content ?? null,
      roles: input.roles, statuses: input.statuses,
      offset: bindingInspectionCursorPosition(input.cursor),
      maximumItems: input.roles?.length || input.statuses?.length || input.cursor ? 128 : 0
    });

    return compactBindingInspection(page, {
      roles: input.roles,
      statuses: input.statuses,
      cursor: input.cursor ?? null,
      prefix: input.workspaceRepo ? { workspaceRepo: input.workspaceRepo } : {},
      cursorBinding: { wk: input.wkId, focus: input.focus ?? null,
        evaluation_focus: input.evaluationFocus === undefined ? "absent" :
          input.evaluationFocus === null ? "root" : input.evaluationFocus } });
  });
}

export async function buildProofPlanOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "expectedContentDigest"
    ]);
    await assertControlledContractCarrierExpectedDigest({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      carrierKind: "proof_plan",
      expectedContentDigest: input.expectedContentDigest
    });
    const loaded = await readCanonicalProofPlanInputs(input);
    const { buildProofPlan } = await loadControlledContractPackage();
    const plan = await buildProofPlan({
      contract: loaded.contract.content,
      request: loaded.request.content,
      evaluationInputs: loaded.evaluationInputs
    });
    const write = await writeControlledContractProofPlanFile({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      content: plan,
      expectedContentDigest: input.expectedContentDigest
    });
    return Object.freeze({
      schema_version: "controlled-contract-proof-plan-build.v1",
      plan,
      carrier: write,
      authority: "non_authoritative"
    });
  });
}
