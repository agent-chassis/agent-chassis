

import {
  createHash
} from "node:crypto";
import {
  readdir
} from "node:fs/promises";
import path from "node:path";
import {
  CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  CANONICAL_AUTHORING_PROFILE_ID,
  CANONICAL_AUTHORING_PROFILE_VERSION,
  isPlainObject,
  normalizeControlledContractIdentity,
  classifyControlledContractCarrierBasename,
  digestBytes,
  canonicalJsonBytes,
  deepFreezePlainData,
} from "./controlled-contract-tool-shared.mjs";
import {
  loadControlledContractSharedContract,
  loadControlledContractProofPlanCompiler,
  loadEvaluationInputSchema
} from "../operations/controlled-contract/package-runtime.mjs";
import {
  constructControlledContractCarrierSetManifest,
  canonicalControlledContractCarrierSetManifestBytes
} from "./controlled-contract-carrier-set-manifest.mjs";
import {
  carrierSetFailure,
  carrierSetEntryIdentity,
  samePlainData,
  inspectCarrierSetMember,
  sameJsonValue
} from "./controlled-contract-carrier-set-validation.mjs";

function canonicalAuthoringProfile() {
  return Object.freeze({
    profile_id: CANONICAL_AUTHORING_PROFILE_ID,
    profile_version: CANONICAL_AUTHORING_PROFILE_VERSION
  });
}

export function canonicalAuthoringEntries(input) {
  if (!isPlainObject(input.canonical_members) ||
      Object.keys(input.canonical_members).length === 0) {
    carrierSetFailure("carrier_missing",
      "canonical authoring requires one complete nonempty basename-addressed population");
  }
  const entries = [];
  for (const filename of Object.keys(input.canonical_members).sort()) {
    const classification = classifyControlledContractCarrierBasename({
      wkId: input.wkId, basename: filename
    });
    if (classification.member !== true ||
        classification.focus !== (input.focus ?? null)) {
      carrierSetFailure("member_mismatch",
        "canonical authoring member basename is foreign or noncanonical", { filename });
    }
    const content = input.canonical_members[filename];
    if (!isPlainObject(content)) carrierSetFailure("carrier_invalid",
      "canonical authoring carriers must be plain JSON objects", { filename });
    const bytes = canonicalJsonBytes(content);
    if (bytes.byteLength === 0 || bytes.byteLength > CONTROLLED_CONTRACT_MAX_JSON_BYTES) {
      carrierSetFailure("carrier_invalid",
        "canonical authoring carrier exceeds its byte boundary", { filename });
    }
    entries.push({
      member_kind: classification.carrier_kind === "evaluation_input"
        ? "evaluation_input" : "carrier",
      carrier_kind: classification.carrier_kind,
      filename,
      content: structuredClone(content),
      bytes
    });
  }
  return entries;
}

export async function validateCanonicalAuthoringEntries({ wkId, focus, entries,
  compilerContract = null }) {
  const byKind = new Map();
  for (const entry of entries) {
    const values = byKind.get(entry.carrier_kind) ?? [];
    values.push(entry);
    byKind.set(entry.carrier_kind, values);
  }
  for (const kind of ["contract", "proof_plan_request", "proof_plan"]) {
    if ((byKind.get(kind)?.length ?? 0) > 1) carrierSetFailure("member_mismatch",
      "canonical authoring generation repeats one singleton carrier kind", {
        carrier_kind: kind
      });
  }
  const pkg = await loadControlledContractSharedContract();
  const contract = byKind.get("contract")?.[0]?.content ?? null;
  if (contract !== null) {
    const validation = pkg.validateNativeTestProofAuthoringContract(contract);
    if (!validation.valid) carrierSetFailure("contract_invalid",
      "canonical authoring contract failed package validation", {
        diagnostics: validation.diagnostics
      });
  }
  const validateEvaluationInput = await loadEvaluationInputSchema();
  for (const evaluation of byKind.get("evaluation_input") ?? []) {
    if (!validateEvaluationInput(evaluation.content)) carrierSetFailure("evaluation_invalid",
      "canonical authoring evaluation input failed package schema validation", {
        filename: evaluation.filename,
        diagnostics: structuredClone(validateEvaluationInput.errors ?? [])
      });
  }
  const request = byKind.get("proof_plan_request")?.[0]?.content ?? null;
  if (request !== null) {
    if (contract === null || !Array.isArray(request.selected_packs)) {
      carrierSetFailure("generated_binding_invalid",
        "canonical proof-plan request has no complete contract binding");
    }
    const evaluations = Object.fromEntries((byKind.get("evaluation_input") ?? [])
      .map((entry) => [entry.filename, entry.content]));
    const missing = request.selected_packs.filter(({ evaluation_input_path: filename }) =>
      typeof filename !== "string" || !Object.hasOwn(evaluations, filename));
    if (missing.length > 0) carrierSetFailure("evaluation_population_mismatch",
      "canonical request references an absent generation member");
    let plan;
    const compiler = await loadControlledContractProofPlanCompiler();
    try {
      plan = await compiler.buildProofPlan({
        contract: compilerContract ?? contract,
        request,
        evaluationInputs: evaluations
      });
    } catch (error) {
      carrierSetFailure("generated_binding_invalid",
        "canonical authoring population cannot build one proof plan", {
          cause_code: error?.code ?? null
        });
    }
    const persistedPlan = byKind.get("proof_plan")?.[0]?.content ?? null;
    if (persistedPlan !== null && !samePlainData(plan, persistedPlan)) {
      carrierSetFailure("proof_plan_stale",
        "canonical authoring proof plan differs from its exact generation sources");
    }
  } else if (byKind.has("proof_plan")) {
    carrierSetFailure("proof_plan_stale",
      "canonical proof plan cannot exist without its request");
  }
  void wkId;
  void focus;
}

export async function resolveCanonicalAuthoringCompilerContract({
  repoRoot, wkId, focus, entries, compilerContract = null,
  proofSourceOverride = null
}) {
  if (compilerContract !== null) return compilerContract;
  const native = entries.find(entry => entry.carrier_kind === "contract");
  if (native === undefined) return null;
  const { resolveSavedProofSource, resolveDerivedProofContract } = await import(
    "../operations/controlled-contract/saved-proof-source.mjs"
  );
  const source = proofSourceOverride ?? await resolveSavedProofSource({
    repoRoot, wkId, focus: focus ?? null, selectedUnit: null
  });
  return (await resolveDerivedProofContract({
    ...source,
    canonicalContract: {
      content: native.content,
      content_digest: digestBytes(native.bytes)
    }
  }))?.content ?? native.content;
}

export async function projectControlledContractCanonicalAuthoringPopulation(input) {
  if (!isPlainObject(input) || typeof input.repository !== "string" ||
      input.repository.length === 0) carrierSetFailure("input_invalid",
    "canonical authoring projection requires one durable repository identity");
  normalizeControlledContractIdentity({ wkId: input.wkId,
    focus: input.focus ?? null });
  const entries = canonicalAuthoringEntries(input);
  await validateCanonicalAuthoringEntries({ wkId: input.wkId,
    focus: input.focus ?? null, entries });
  const generation = canonicalAuthoringGeneration({ input, entries });
  const generationPath = path.posix.join(".carrier-generations", generation);
  const manifest = canonicalAuthoringManifest({ input, entries,
    generation, generationPath });
  const manifestBytes = canonicalControlledContractCarrierSetManifestBytes(manifest);
  return deepFreezePlainData({
    generation,
    manifest_digest: manifest.manifest_digest,
    manifest_content_digest: digestBytes(manifestBytes),
    carrier_count: entries.length
  });
}

export function canonicalAuthoringGeneration({ input, entries }) {
  return createHash("sha256").update(canonicalJsonBytes({
    repository: input.repository,
    wk_id: input.wkId,
    focus: input.focus ?? null,
    profile: canonicalAuthoringProfile(),
    carriers: entries.map(carrierSetEntryIdentity)
  })).digest("hex");
}

export function canonicalAuthoringManifest({ input, entries, generation, generationPath }) {
  const census = entries.map((entry) => ({
    member_kind: entry.member_kind,
    carrier_kind: entry.carrier_kind,
    filename: entry.filename,
    path: path.posix.join(generationPath, entry.filename),
    content_digest: digestBytes(entry.bytes),
    byte_length: entry.bytes.byteLength
  }));
  return constructControlledContractCarrierSetManifest({
    repository: input.repository,
    wkId: input.wkId,
    focus: input.focus ?? null,
    profile: canonicalAuthoringProfile(),
    generation,
    generationPath,
    members: census
  });
}

export async function validateCanonicalAuthoringDirectory({ directory, entries, manifest }) {
  const expected = [...entries.map(({ filename }) => filename), "manifest.json"].sort();
  const observed = (await readdir(directory)).sort();
  if (!sameJsonValue(expected, observed)) carrierSetFailure("member_mismatch",
    "canonical authoring generation contains a missing or extra member");
  for (const entry of entries) {
    const inspected = await inspectCarrierSetMember(
      path.join(directory, entry.filename), CONTROLLED_CONTRACT_MAX_JSON_BYTES, {
        filename: entry.filename,
        generation: manifest.generation.id,
        generation_path: manifest.generation.path
      }
    );
    if (inspected.digest !== digestBytes(entry.bytes) ||
        !inspected.bytes.equals(entry.bytes)) carrierSetFailure("digest_mismatch",
      "canonical authoring generation member bytes differ", { filename: entry.filename });
  }
  const embedded = await inspectCarrierSetMember(
    path.join(directory, "manifest.json"), CONTROLLED_CONTRACT_MAX_JSON_BYTES, {
      filename: "manifest.json",
      generation: manifest.generation.id,
      generation_path: manifest.generation.path
    }
  );
  const expectedManifest = canonicalControlledContractCarrierSetManifestBytes(manifest);
  if (!embedded.bytes.equals(expectedManifest)) carrierSetFailure("manifest_mismatch",
    "embedded canonical authoring manifest bytes differ");
}
