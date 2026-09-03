import { readFile } from "node:fs/promises";
import path from "node:path";

import { compiledValidators } from "./compiled-validator-cache.mjs";
import { loadAdmittedProofPack } from "./admitted-proof-packs.mjs";
import {
  canonicalDigest,
  normalizeContractForIdentity
} from "./contract-assessment.mjs";
import {
  canonicalJsonBytes,
  canonicalValue,
  compareCodeUnits,
  deepFreeze
} from "./deterministic-projection-primitives.mjs";
import { assertSchema } from "./exact-binding-common.mjs";
import {
  expectedPackSourceDigests,
  validateProofPlan
} from "./multi-pack-assessment.mjs";
import {
  PROOF_INTENT_ARTIFACT,
  PROOF_INTENT_DIGESTS,
  ProofIntentSelectionError,
  selectProofPacks
} from "./proof-intent-selection.mjs";
import { validateSuppliedProofPackBindings } from
  "./proof-pack-binding-assistance.mjs";
import { validateStableTestProofContract } from "./test-proof-contract-v1.mjs";

const packageRoot = new URL("../", import.meta.url);
const requestSchema = await readJson(new URL(
  "schema/controlled-contract-proof-plan-request.v1.schema.json", packageRoot
));
const { validateProofPlanRequest } = await compiledValidators(
  "controlled-contract.proof-plan-request.v1",
  { validators: { validateProofPlanRequest: requestSchema } }
);
const MAX_PROOF_PLAN_BYTES = 131_072;

class ProofPlanCompilerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofPlanCompilerError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareCodeUnits);
}

function packKey(value) {
  return `${value.profile_id}@${value.profile_version}`;
}

function packIdentity(value) {
  return { profile_id: value.profile_id, profile_version: value.profile_version };
}

function validateCompilerInput(input, unexpectedArguments) {
  if (unexpectedArguments.length > 0 || input === null ||
      typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new ProofPlanCompilerError(
      "proof_plan_compiler_input_invalid",
      "proof-plan compilation accepts exactly one plain input object"
    );
  }
  const supported = new Set(["contract", "request", "evaluationInputs"]);
  const unsupported = Reflect.ownKeys(input).filter((key) =>
    typeof key !== "string" || !supported.has(key));
  if (unsupported.length > 0) throw new ProofPlanCompilerError(
    "proof_plan_compiler_option_unsupported",
    "proof-plan compilation accepts no caller catalog, profile path, module, executable, environment, or alternate package root",
    { unsupported_options: unsupported.map(String).sort(compareCodeUnits) }
  );
  if (input.contract === null || typeof input.contract !== "object" ||
      Array.isArray(input.contract)) throw new ProofPlanCompilerError(
    "proof_plan_compiler_contract_invalid",
    "proof-plan compilation requires one controlled contract object"
  );
  const resolved = validateStableTestProofContract(input.contract);
  if (!resolved.valid) throw new ProofPlanCompilerError(
    "proof_plan_compiler_contract_invalid",
    "the controlled contract is schema-invalid",
    {
      contract_family: resolved.family,
      facts: structuredClone(resolved.facts),
      diagnostics: structuredClone(resolved.diagnostics)
    }
  );
  if (!validateProofPlanRequest(input.request)) throw new ProofPlanCompilerError(
    "proof_plan_request_schema_invalid",
    "the proof-plan request is schema-invalid",
    { diagnostics: structuredClone(validateProofPlanRequest.errors) }
  );
  const evaluationInputs = input.evaluationInputs ?? {};
  if (evaluationInputs === null || typeof evaluationInputs !== "object" ||
      Array.isArray(evaluationInputs) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(evaluationInputs))) {
    throw new ProofPlanCompilerError(
      "proof_plan_evaluation_inputs_invalid",
      "evaluationInputs must be one plain path-to-JSON object"
    );
  }
  return { contract: input.contract, request: input.request, evaluationInputs };
}

function assertSafeExactRelativePath(value, field, pack) {
  if (typeof value !== "string") return;
  const segments = value.split("/");
  if (path.posix.isAbsolute(value) || value.includes("\\") ||
      segments.some((segment) => segment.length === 0 || segment === "." ||
        segment === "..") || path.posix.normalize(value) !== value) {
    throw new ProofPlanCompilerError(
      "proof_plan_request_exact_path_invalid",
      "exact-binding contract and evaluation paths must be normalized relative paths confined beneath the declared capture root",
      { pack, field, value }
    );
  }
}

async function loadSelectedPacks(selectedPacks) {
  const keys = selectedPacks.map(packKey);
  if (new Set(keys).size !== keys.length) throw new ProofPlanCompilerError(
    "proof_plan_request_duplicate_pack",
    "the proof-plan request selects the same exact pack more than once"
  );
  const loaded = [];
  for (const selected of [...selectedPacks].sort((left, right) =>
    compareCodeUnits(packKey(left), packKey(right)))) {
    let pack;
    try {
      pack = await loadAdmittedProofPack(selected.profile_id);
    } catch (error) {
      throw new ProofPlanCompilerError(
        "proof_plan_request_pack_unadmitted",
        "a selected proof pack is not admitted by this package",
        { pack: packIdentity(selected), cause_code: error.code ?? null }
      );
    }
    if (pack.profile.profile_version !== selected.profile_version) {
      throw new ProofPlanCompilerError(
        "proof_plan_request_pack_version_stale",
        "a selected proof-pack version is not the admitted package-owned version",
        {
          pack: packIdentity(selected),
          admitted_version: pack.profile.profile_version
        }
      );
    }
    loaded.push({ selected, pack });
  }
  return loaded;
}

function assignIntents(requestedIntents, loaded) {
  const intentById = new Map(PROOF_INTENT_ARTIFACT.intents.map((intent) => [
    intent.intent_id, intent
  ]));
  const assignments = new Map(loaded.map(({ selected }) => [packKey(selected), []]));
  const diagnostics = [];
  for (const intentId of requestedIntents) {
    const capable = intentById.get(intentId)?.capable_packs ?? [];
    const selected = loaded.filter(({ selected: candidate }) =>
      capable.some((identity) => packKey(identity) === packKey(candidate))
    );
    if (selected.length === 0) diagnostics.push({
      code: "proof_plan_request_intent_unassigned",
      intent_id: intentId,
      selected_candidate_count: 0
    });
    else if (selected.length > 1) diagnostics.push({
      code: "proof_plan_request_intent_ambiguous",
      intent_id: intentId,
      selected_candidate_count: selected.length,
      selected_packs: selected.map(({ selected: value }) => packIdentity(value))
        .sort((left, right) => compareCodeUnits(packKey(left), packKey(right)))
    });
    else assignments.get(packKey(selected[0].selected)).push(intentId);
  }
  for (const { selected } of loaded) if (assignments.get(packKey(selected)).length === 0) {
    diagnostics.push({
      code: "proof_plan_request_pack_unassigned",
      pack: packIdentity(selected)
    });
  }
  if (diagnostics.length > 0) throw new ProofPlanCompilerError(
    "proof_plan_request_selection_incomplete",
    "the exact selected packs do not provide one unambiguous assignment for every requested controlled intent",
    { diagnostics: canonicalValue(diagnostics) }
  );
  return assignments;
}

function missingInputs(loaded, evaluationInputs) {
  const diagnostics = [];
  for (const { selected, pack } of loaded) {
    const identity = packIdentity(selected);
    if (!Object.hasOwn(selected, "evaluation_input_path")) diagnostics.push({
      code: "proof_plan_request_evaluation_input_path_missing", pack: identity
    });
    else if (!Object.hasOwn(evaluationInputs, selected.evaluation_input_path)) {
      diagnostics.push({
        code: "proof_plan_request_evaluation_input_unavailable",
        pack: identity,
        evaluation_input_path: selected.evaluation_input_path
      });
    }
    if (pack.admission_version === 2) {
      if (!Object.hasOwn(selected, "exact_capture") || selected.exact_capture === null) {
        diagnostics.push({
          code: "proof_plan_request_exact_capture_missing", pack: identity
        });
        for (const field of [
          "capture_root", "contract_path", "evaluation_input_path", "sources"
        ]) diagnostics.push({
          code: `proof_plan_request_exact_${field}_missing`, pack: identity
        });
      } else for (const field of [
        "capture_root", "contract_path", "evaluation_input_path", "sources"
      ]) if (!Object.hasOwn(selected.exact_capture, field)) diagnostics.push({
        code: `proof_plan_request_exact_${field}_missing`, pack: identity
      });
    } else if (Object.hasOwn(selected, "exact_capture") &&
        selected.exact_capture !== null) diagnostics.push({
      code: "proof_plan_request_exact_capture_unexpected", pack: identity
    });
  }
  return diagnostics.sort((left, right) => compareCodeUnits(
    JSON.stringify(canonicalValue(left)), JSON.stringify(canonicalValue(right))
  ));
}

async function buildPackEntry({ selected, pack }, assignments, contract,
  evaluationInputs) {
  const identity = packIdentity(selected);
  const evaluationInput = evaluationInputs[selected.evaluation_input_path];
  let bindingValidation;
  try {
    bindingValidation = await validateSuppliedProofPackBindings({
      contract,
      profileId: selected.profile_id,
      profileVersion: selected.profile_version,
      evaluationInput
    });
  } catch (error) {
    throw new ProofPlanCompilerError(
      "proof_plan_request_evaluation_input_invalid",
      "a selected pack evaluation input could not be validated against its admitted role contract",
      {
        pack: identity,
        cause_code: error.code ?? null,
        diagnostics: error.details?.diagnostics ?? []
      }
    );
  }
  if (bindingValidation.summary.status !== "valid") {
    throw new ProofPlanCompilerError(
      "proof_plan_request_evaluation_input_invalid",
      "a selected pack evaluation input contains invalid or incomplete role bindings",
      {
        pack: identity,
        incompatible_binding_count:
          bindingValidation.summary.incompatible_binding_count,
        evaluation_input_diagnostics:
          bindingValidation.evaluation_input_diagnostics
      }
    );
  }
  let exactBinding = null;
  let exactSources = null;
  if (pack.admission_version === 2) {
    assertSafeExactRelativePath(
      selected.exact_capture.contract_path, "contract_path", identity
    );
    assertSafeExactRelativePath(
      selected.exact_capture.evaluation_input_path,
      "evaluation_input_path", identity
    );
    try {
      assertSchema(
        "controlled-contract-exact-binding-sources.v1.schema.json",
        selected.exact_capture.sources,
        "proof_plan_request_exact_sources_invalid"
      );
    } catch (error) {
      throw new ProofPlanCompilerError(
        "proof_plan_request_exact_sources_invalid",
        "the selected pack exact-binding sources are schema-invalid",
        { pack: identity, diagnostics: error.details?.diagnostics ?? [] }
      );
    }
    exactSources = selected.exact_capture.sources;
    exactBinding = {
      capture_root: selected.exact_capture.capture_root,
      contract_path: selected.exact_capture.contract_path,
      evaluation_input_path: selected.exact_capture.evaluation_input_path,
      sources: structuredClone(exactSources)
    };
  }
  return {
    profile_id: selected.profile_id,
    profile_version: selected.profile_version,
    requested_intents: [...assignments.get(packKey(selected))],
    evaluation_input: { path: selected.evaluation_input_path },
    exact_binding: exactBinding,
    source_digests: expectedPackSourceDigests(pack, evaluationInput, exactSources)
  };
}

function canonicalProofPlanJson(plan) {
  if (!validateProofPlan(plan)) throw new ProofPlanCompilerError(
    "compiled_proof_plan_invalid",
    "canonical serialization requires a schema-valid controlled proof plan",
    { diagnostics: structuredClone(validateProofPlan.errors) }
  );
  const bytes = canonicalJsonBytes(plan, { file: true });
  if (bytes.byteLength > MAX_PROOF_PLAN_BYTES) throw new ProofPlanCompilerError(
    "compiled_proof_plan_too_large",
    "the compiled proof plan exceeds its declared UTF-8 byte bound",
    { byte_length: bytes.byteLength, maximum_bytes: MAX_PROOF_PLAN_BYTES }
  );
  return bytes.toString("utf8");
}

async function buildProofPlan(input, ...unexpectedArguments) {
  const { contract, request, evaluationInputs } = validateCompilerInput(
    input, unexpectedArguments
  );
  const requestedIntents = sortedUnique(request.requested_intents);
  let selection;
  try {
    selection = requestedIntents.length === 0 ? null : selectProofPacks({
      contract,
      requestedIntents,
      expectedDigests: PROOF_INTENT_DIGESTS
    });
  } catch (error) {
    if (error instanceof ProofIntentSelectionError) throw new ProofPlanCompilerError(
      error.code, error.message, error.details
    );
    throw error;
  }
  if (selection && (selection.uncovered_intents.length > 0 ||
      selection.hard_incompatibilities.length > 0)) {
    throw new ProofPlanCompilerError(
      "proof_plan_request_intent_not_assessable",
      "one or more requested intents are uncovered or incompatible",
      {
        uncovered_intents: selection.uncovered_intents,
        hard_incompatibilities: selection.hard_incompatibilities
      }
    );
  }
  const loaded = await loadSelectedPacks(request.selected_packs);
  const assignments = assignIntents(requestedIntents, loaded);
  const missing = missingInputs(loaded, evaluationInputs);
  if (missing.length > 0) throw new ProofPlanCompilerError(
    "proof_plan_request_missing_inputs",
    "the proof-plan request omits one or more required caller inputs",
    { diagnostics: missing }
  );
  const packs = [];
  for (const loadedPack of loaded) packs.push(await buildPackEntry(
    loadedPack, assignments, contract, evaluationInputs
  ));
  packs.sort((left, right) => compareCodeUnits(packKey(left), packKey(right)));
  const plan = canonicalValue({
    schema_version: "controlled-contract-proof-plan.v1",
    requested_intents: requestedIntents,
    digests: {
      contract: canonicalDigest(normalizeContractForIdentity(contract)),
      catalog: PROOF_INTENT_DIGESTS.catalog,
      vocabulary: PROOF_INTENT_DIGESTS.vocabulary,
      profiles: PROOF_INTENT_DIGESTS.profiles,
      intent_artifact: PROOF_INTENT_DIGESTS.intent_artifact
    },
    packs
  });
  canonicalProofPlanJson(plan);
  return deepFreeze(structuredClone(plan));
}

function normalizeFileRequest(request, requestDirectory, inputPath) {
  const normalized = structuredClone(request);
  normalized.selected_packs = normalized.selected_packs.map((selected) => {
    const result = structuredClone(selected);
    if (typeof result.evaluation_input_path === "string") {
      result.evaluation_input_path = path.resolve(
        requestDirectory, result.evaluation_input_path
      );
    }
    if (result.exact_capture &&
        typeof result.exact_capture.capture_root === "string") {
      result.exact_capture.capture_root = path.resolve(
        requestDirectory, result.exact_capture.capture_root
      );
      const identity = packIdentity(result);
      for (const field of ["contract_path", "evaluation_input_path"]) {
        assertSafeExactRelativePath(result.exact_capture[field], field, identity);
      }
      if (typeof result.exact_capture.contract_path === "string" &&
          path.resolve(result.exact_capture.capture_root,
            result.exact_capture.contract_path) !== inputPath) {
        throw new ProofPlanCompilerError(
          "proof_plan_request_exact_contract_path_conflict",
          "the exact capture contract path does not identify --input",
          { pack: identity }
        );
      }
      if (typeof result.exact_capture.evaluation_input_path === "string" &&
          typeof result.evaluation_input_path === "string" &&
          path.resolve(result.exact_capture.capture_root,
            result.exact_capture.evaluation_input_path) !==
              result.evaluation_input_path) {
        throw new ProofPlanCompilerError(
          "proof_plan_request_exact_evaluation_path_conflict",
          "the exact capture evaluation path does not identify this pack's evaluation input",
          { pack: identity }
        );
      }
    }
    return result;
  });
  return normalized;
}

async function parseJsonFile(file, code, label) {
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    throw new ProofPlanCompilerError(code, `could not read ${label} JSON`, {
      cause_code: error.code ?? null
    });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new ProofPlanCompilerError(code, `${label} is not valid JSON`, {
      cause: error.message
    });
  }
}

async function buildProofPlanFiles(input, ...unexpectedArguments) {
  if (unexpectedArguments.length > 0 || input === null ||
      typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Reflect.ownKeys(input).some((key) => typeof key !== "string" ||
        !["inputPath", "requestPath"].includes(key))) {
    throw new ProofPlanCompilerError(
      "proof_plan_compiler_file_arguments_invalid",
      "file compilation accepts exactly inputPath and requestPath"
    );
  }
  const { inputPath, requestPath } = input;
  if (typeof inputPath !== "string" || typeof requestPath !== "string") {
    throw new ProofPlanCompilerError(
      "proof_plan_compiler_file_arguments_invalid",
      "file compilation requires exact inputPath and requestPath strings"
    );
  }
  const resolvedInput = path.resolve(inputPath);
  const resolvedRequest = path.resolve(requestPath);
  const [contract, rawRequest] = await Promise.all([
    parseJsonFile(resolvedInput, "proof_plan_compiler_contract_read_failed", "contract"),
    parseJsonFile(resolvedRequest, "proof_plan_request_read_failed", "request")
  ]);
  if (!validateProofPlanRequest(rawRequest)) throw new ProofPlanCompilerError(
    "proof_plan_request_schema_invalid",
    "the proof-plan request is schema-invalid",
    { diagnostics: structuredClone(validateProofPlanRequest.errors) }
  );
  const request = normalizeFileRequest(
    rawRequest, path.dirname(resolvedRequest), resolvedInput
  );
  const evaluationInputs = {};
  for (const selected of request.selected_packs) {
    if (typeof selected.evaluation_input_path !== "string" ||
        Object.hasOwn(evaluationInputs, selected.evaluation_input_path)) continue;
    try {
      evaluationInputs[selected.evaluation_input_path] = await parseJsonFile(
        selected.evaluation_input_path,
        "proof_plan_request_evaluation_input_read_failed",
        "evaluation input"
      );
    } catch (error) {
      if (error.details?.cause_code !== "ENOENT") throw error;
    }
  }
  return buildProofPlan({ contract, request, evaluationInputs });
}

export {
  MAX_PROOF_PLAN_BYTES,
  ProofPlanCompilerError,
  buildProofPlan,
  buildProofPlanFiles,
  canonicalProofPlanJson,
  validateProofPlanRequest
};
