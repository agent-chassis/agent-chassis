import path from "node:path";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";

import {
  CONTROLLED_CONTRACT_PATCH_LIMITS,
  ControlledContractToolError,
  applyControlledContractCarrierPatch,
  assertBoundedStringArray,
  assertControlledContractAuthorableCarrierKind,
  assertControlledContractCarrierExpectedDigest,
  assertControlledContractOperationInput,
  bindProofPlanRequestEvaluationInputPaths,
  bindProofPlanRequestPatchEvaluationInputPaths,
  controlledContractCarrierFilename,
  controlledContractContentDigest,
  diffControlledContractCarrierContent,
  queryControlledContractCarrierContent,
  readCanonicalProofPlanInputs,
  readControlledContractAssessmentArtifactFile,
  readControlledContractCarrierFile,
  writeControlledContractCarrierFile,
  writeControlledContractProofPlanFile
} from "../lib/controlled-contract-tools.mjs";
import {
  bindingInspectionCursorPosition,
  compactBindingInspection,
  compactProofPackDescription,
  describeControlledContractAuthoring
} from "../lib/controlled-contract-authoring-projections.mjs";

const CONTROLLED_CONTRACT_MODULE_SPECIFIER = "@agent-chassis/controlled-contract";
const PROOF_PLAN_REQUEST_SCHEMA_SPECIFIER =
  "@agent-chassis/controlled-contract/schema/controlled-contract-proof-plan-request.v1.schema.json";
let controlledContractPackagePromise = null;
let evaluationInputValidatorPromise = null;
let proofPlanRequestSchemaPromise = null;

function loadControlledContractPackage() {
  controlledContractPackagePromise ??= import(CONTROLLED_CONTRACT_MODULE_SPECIFIER);
  return controlledContractPackagePromise;
}
function loadProofPlanRequestSchema() {
  proofPlanRequestSchemaPromise ??= readFile(
    new URL(import.meta.resolve(PROOF_PLAN_REQUEST_SCHEMA_SPECIFIER)),
    "utf8"
  ).then(JSON.parse);
  return proofPlanRequestSchemaPromise;
}

async function validateAuthorableCarrier(input, content) {
  const pkg = await loadControlledContractPackage();
  if (input.carrierKind === "contract") {
    const resolved = pkg.validateAndResolveNativeContractV034(content);
    if (!resolved.schema_valid || resolved.diagnostics.length > 0) throw new ControlledContractToolError(
      "controlled_contract_carrier_validation_failed", "contract failed package validation",
      { diagnostics: [...resolved.schema_errors, ...resolved.diagnostics] }
    );
    return;
  }
  if (input.carrierKind === "evaluation_input") {
    evaluationInputValidatorPromise ??= Promise.resolve(new Ajv2020({ strict: true, allErrors: true })
      .compile(pkg.VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034));
    const validate = await evaluationInputValidatorPromise;
    if (!validate(content)) throw new ControlledContractToolError(
      "controlled_contract_carrier_validation_failed", "evaluation input failed package-schema validation",
      { diagnostics: structuredClone(validate.errors) }
    );
    let request;
    try {
      request = await readControlledContractCarrierFile({ ...input, carrierKind: "proof_plan_request" });
    } catch (error) {
      if (error?.code === "controlled_contract_carrier_not_found") return;
      throw error;
    }
    const filename = controlledContractCarrierFilename(input);
    if (!request.content.selected_packs?.some(({ evaluation_input_path: value }) => value === filename)) return;
    const loaded = await readCanonicalProofPlanInputs({
      ...input, requestContent: request.content, evaluationOverrides: { [filename]: content }
    });
    await pkg.buildProofPlan({ contract: loaded.contract.content, request: request.content,
      evaluationInputs: loaded.evaluationInputs });
    return;
  }
  const loaded = await readCanonicalProofPlanInputs({ ...input, requestContent: content });
  await pkg.buildProofPlan({ contract: loaded.contract.content, request: content,
    evaluationInputs: loaded.evaluationInputs });
}

function sanitizeErrorDetail(value) {
  if (typeof value === "string") {
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
      return "[server-resolved-path]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeErrorDetail);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      sanitizeErrorDetail(entry)
    ]));
  }
  return value;
}

export function createControlledContractRefusal(error) {
  const reasonCode = typeof error?.code === "string"
    ? error.code
    : "controlled_contract_operation_failed";
  const refusal = new ControlledContractToolError(
    reasonCode,
    error instanceof Error ? error.message : String(error),
    sanitizeErrorDetail(error?.details ?? {})
  );
  refusal.envelope = Object.freeze({
    schema_version: "controlled-contract-mcp-refusal.v1",
    ok: false,
    warning: Object.freeze({
      code: "controlled_contract_request_refused",
      severity: "blocking",
      message: `controlled-contract MCP request refused: ${reasonCode}`,
      payload: Object.freeze({
        schema_version: "controlled-contract-refusal-payload.v1",
        reason_code: reasonCode,
        details: sanitizeErrorDetail(error?.details ?? {})
      })
    })
  });
  return refusal;
}

async function controlledContractOperation(callback) {
  try {
    return await callback();
  } catch (error) {
    throw createControlledContractRefusal(error);
  }
}

export async function readControlledContractCarrierOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["repoRoot", "wkId", "focus", "carrierKind"]);
    return readControlledContractCarrierFile(input);
  });
}

export async function writeControlledContractCarrierOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "carrierKind", "content", "expectedContentDigest"
    ]);
    if (!["contract", "evaluation_input"].includes(input.carrierKind)) {
      throw new ControlledContractToolError("controlled_contract_carrier_write_forbidden",
        "operator recovery write supports only contract and evaluation_input carriers");
    }
    return writeControlledContractCarrierFile(input);
  });
}

export async function createControlledContractCarrierOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "carrierKind", "content", "expectedContentDigest"
    ]);
    assertControlledContractAuthorableCarrierKind(input.carrierKind);
    if (input.expectedContentDigest !== null) throw new ControlledContractToolError(
      "controlled_contract_create_expected_absence_required", "create requires expected_content_digest null"
    );
    await assertControlledContractCarrierExpectedDigest({ ...input, expectedContentDigest: null });
    const content = input.carrierKind === "proof_plan_request"
      ? bindProofPlanRequestEvaluationInputPaths(input)
      : input.content;
    controlledContractContentDigest(content);
    await validateAuthorableCarrier(input, content);
    const write = await writeControlledContractCarrierFile({ ...input, content });
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
      "repoRoot", "wkId", "focus", "carrierKind", "selectors", "target", "filter", "cursor"
    ]);
    if (input.carrierKind === "proof_plan") {
      if (input.selectors !== undefined || input.target !== undefined || input.filter !== undefined || input.cursor !== undefined)
        throw new ControlledContractToolError("controlled_contract_proof_plan_query_invalid",
          "proof-plan query exposes metadata only and accepts no content selector");
      let plan;
      try { plan = await readControlledContractCarrierFile(input); } catch (error) {
        if (error?.code !== "controlled_contract_carrier_not_found") throw error;
        return Object.freeze({ schema_version: "controlled-contract-proof-plan-metadata.v1",
          carrier_kind: "proof_plan", exists: false, content_digest: null,
          rebuild_expected_content_digest: null, source_binding_status: "absent" });
      }
      const loaded = await readCanonicalProofPlanInputs(input);
      const pkg = await loadControlledContractPackage();
      const current = await pkg.buildProofPlan({ contract: loaded.contract.content,
        request: loaded.request.content, evaluationInputs: loaded.evaluationInputs });
      const currentDigest = controlledContractContentDigest(current);
      return Object.freeze({ schema_version: "controlled-contract-proof-plan-metadata.v1",
        carrier_kind: "proof_plan", exists: true, content_digest: plan.content_digest,
        rebuild_expected_content_digest: plan.content_digest,
        source_binding_status: currentDigest === plan.content_digest ? "current" : "stale",
        stored_source_digests: plan.content.digests ?? null,
        current_source_digests: current.digests ?? null });
    }
    assertControlledContractAuthorableCarrierKind(input.carrierKind);
    const carrier = await readControlledContractCarrierFile(input);
    return queryControlledContractCarrierContent({ carrier, selectors: input.selectors,
      target: input.target ?? null, filter: input.filter ?? null, cursor: input.cursor ?? null });
  });
}

export async function describeControlledContractAuthoringOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["carrierKind", "target"]);
    assertControlledContractAuthorableCarrierKind(input.carrierKind);
    const pkg = await loadControlledContractPackage();
    return describeControlledContractAuthoring({ carrierKind: input.carrierKind,
      target: input.target ?? null, schemas: { contract: pkg.NATIVE_CONTRACT_SCHEMA_V034,
        evaluation_input: pkg.VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034,
        proof_plan_request: await loadProofPlanRequestSchema() } });
  });
}

export async function patchControlledContractCarrierOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "carrierKind", "expectedContentDigest", "operations"
    ]);
    assertControlledContractAuthorableCarrierKind(input.carrierKind);
    const requestBytes = Buffer.byteLength(JSON.stringify({
      wk_id: input.wkId, focus: input.focus ?? null, carrier_kind: input.carrierKind,
      expected_content_digest: input.expectedContentDigest, operations: input.operations
    }), "utf8");
    if (requestBytes > CONTROLLED_CONTRACT_PATCH_LIMITS.request_bytes) {
      throw new ControlledContractToolError("controlled_contract_patch_request_too_large",
        "complete patch request exceeds 65,536 UTF-8 bytes", { byte_length: requestBytes });
    }
    const operations = input.carrierKind === "proof_plan_request"
      ? bindProofPlanRequestPatchEvaluationInputPaths(input)
      : input.operations;
    const carrier = await readControlledContractCarrierFile(input);
    if (carrier.content_digest !== input.expectedContentDigest) throw new ControlledContractToolError(
      "controlled_contract_stale_content_digest", "canonical carrier content changed",
      { expected_content_digest: input.expectedContentDigest,
        actual_content_digest: carrier.content_digest }
    );
    const patched = applyControlledContractCarrierPatch({
      content: carrier.content, carrierKind: input.carrierKind, operations
    });
    const nextDigest = controlledContractContentDigest(patched.content);
    await validateAuthorableCarrier(input, patched.content);
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
    if (!noOp) await writeControlledContractCarrierFile({ ...input, content: patched.content });
    return Object.freeze(receipt);
  });
}

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
    const { compactProofIntentSelection, selectProofPacks } =
      await loadControlledContractPackage();
    return compactProofIntentSelection(selectProofPacks({
      contract: carrier.content,
      requestedIntents
    }));
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
        carrierKind: "evaluation_input"
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
    return compactBindingInspection(page, { roles: input.roles, statuses: input.statuses,
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

export async function assessControlledContractOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["repoRoot", "wkId", "focus"]);
    const contract = await readControlledContractCarrierFile({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      carrierKind: "contract"
    });
    const plan = await readControlledContractCarrierFile({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      carrierKind: "proof_plan"
    });
    const {
      assessProofPlanFiles,
      compactMultiPackAssessment,
      writeMultiPackAssessmentBundle
    } = await loadControlledContractPackage();
    const contractsDirectory = path.resolve(input.repoRoot, "wiki", "contracts");
    const projected = await assessProofPlanFiles({
      inputPath: path.join(contractsDirectory, contract.filename),
      proofPlanPath: path.join(contractsDirectory, plan.filename)
    });
    await writeMultiPackAssessmentBundle(projected, { repositoryRoot: input.repoRoot });
    return compactMultiPackAssessment(projected.assessment);
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
