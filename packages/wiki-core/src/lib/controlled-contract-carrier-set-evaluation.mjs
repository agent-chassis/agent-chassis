import path from "node:path";
import {
  CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  fail,
  isPlainObject,
  normalizeControlledContractIdentity,
  controlledContractCarrierFilename,
  normalizeControlledContractPackIdentity,
  packIdentityDigest,
  controlledContractPackCarrierFilename,
  classifyControlledContractCarrierBasename,
  digestBytes,
  canonicalJsonBytes,
  resolveControlledContractRepository,
  inspectCarrierFile,
  parseCarrierJson,
  deepFreezePlainData
} from "./controlled-contract-tool-shared.mjs";

export function selectedPackIdentityKey(value) {
  return `${value.profile_id}@${value.profile_version}`;
}

export async function readCanonicalProofPlanRequestImpl({
  repoRoot, wkId, focus, canonicalSet = null
}, { resolveCanonicalControlledContractCarrierSet }) {
  const store = await resolveControlledContractRepository(repoRoot);
  canonicalSet ??= await resolveCanonicalControlledContractCarrierSet({
    repoRoot, wkId, focus
  });
  const filename = controlledContractCarrierFilename({
    wkId, focus, carrierKind: "proof_plan_request"
  });
  return {
    store,
    canonicalSet,
    content: canonicalSet.members_by_basename[filename]?.content ?? null
  };
}

export function persistedEvaluationInputBindings({ wkId, focus = null, content }) {
  const bindings = new Map();
  const selectedPacks = content?.selected_packs;
  if (!Array.isArray(selectedPacks)) return bindings;
  for (const selected of selectedPacks) {
    if (!isPlainObject(selected) || typeof selected.profile_id !== "string" ||
        typeof selected.profile_version !== "string") continue;
    const classified = classifyControlledContractCarrierBasename({
      wkId, basename: selected.evaluation_input_path
    });
    if (classified.member !== true) continue;
    if (classified.carrier_kind !== "evaluation_input") {
      fail(
        "controlled_contract_proof_input_path_forbidden",
        "proof-plan request binds a same-WK carrier of the wrong kind"
      );
    }
    if (classified.pack_namespace !== null &&
        (classified.focus !== (focus ?? null) ||
         classified.pack_namespace !== `pack-sha256-${packIdentityDigest({
          profileId: selected.profile_id,
          profileVersion: selected.profile_version
        })}`)) continue;
    bindings.set(selectedPackIdentityKey(selected), selected.evaluation_input_path);
  }
  return bindings;
}

function assertUnboundFallbackIsNotAnotherPacksInput({ identity, filename, bindings }) {
  const requested = `${identity.profileId}@${identity.profileVersion}`;
  for (const [key, bound] of bindings) {
    if (bound === filename && key !== requested) {
      fail(
        "controlled_contract_proof_input_path_forbidden",
        "canonical evaluation input is already bound to another selected proof pack"
      );
    }
  }
}

export function authenticatedSelectedPackEvaluationBasename({
  wkId, focus = null, selectedPack, request = null
}) {
  const identity = normalizeControlledContractPackIdentity({
    profileId: selectedPack?.profile_id,
    profileVersion: selectedPack?.profile_version
  });
  const basename = selectedPack?.evaluation_input_path;
  if (typeof basename !== "string" || basename.length === 0) {
    fail("controlled_contract_proof_input_path_forbidden",
      "the authenticated selected pack carries no evaluation-input basename");
  }

  const classified = classifyControlledContractCarrierBasename({ wkId, basename });
  if (classified.member !== true ||
      classified.carrier_kind !== "evaluation_input" ||
      classified.focus !== (focus ?? null)) {
    fail("controlled_contract_proof_input_path_forbidden",
      "authenticated evaluation-input basename is not this WK and focus's canonical carrier");
  }
  if (classified.pack_namespace !== null) {
    const namespaced = controlledContractPackCarrierFilename({
      wkId, focus, ...identity
    });
    if (basename !== namespaced) {
      fail("controlled_contract_proof_input_path_forbidden",
        "authenticated evaluation-input basename belongs to another proof pack");
    }
    return basename;
  }
  const legacy = controlledContractCarrierFilename({
    wkId, focus, carrierKind: "evaluation_input"
  });
  if (basename !== legacy) {
    fail("controlled_contract_proof_input_path_forbidden",
      "authenticated evaluation-input basename is not a canonical evaluation input");
  }
  assertUnboundFallbackIsNotAnotherPacksInput({
    identity,
    filename: legacy,
    bindings: persistedEvaluationInputBindings({ wkId, focus, content: request })
  });
  return legacy;
}

async function resolveEvaluationInputFilename({
  repoRoot,
  wkId,
  focus,
  pack,
  preferPack = false
}, { resolveCanonicalControlledContractCarrierSet }) {
  const identity = normalizeControlledContractPackIdentity(pack);
  const { store, canonicalSet, content } = await readCanonicalProofPlanRequestImpl({
    repoRoot, wkId, focus
  }, { resolveCanonicalControlledContractCarrierSet });
  const bindings = persistedEvaluationInputBindings({ wkId, focus, content });
  const bound = bindings
    .get(`${identity.profileId}@${identity.profileVersion}`);
  if (bound !== undefined) return { filename: bound, binding: "request_bound" };
  if (preferPack) return {
    filename: controlledContractPackCarrierFilename({ wkId, focus, ...identity }),
    binding: "derived"
  };
  const filename = await resolveComposedEvaluationInputPath({
    store, canonicalSet, wkId, focus, identity, bindings, selectedPackCount: 1
  });
  assertUnboundFallbackIsNotAnotherPacksInput({ identity, filename, bindings });
  return { filename, binding: "derived" };
}

async function resolveCarrierFilename({
  repoRoot,
  wkId,
  focus,
  carrierKind,
  pack = null,
  preferPack = false
}, { resolveCanonicalControlledContractCarrierSet }) {
  const filename = controlledContractCarrierFilename({ wkId, focus, carrierKind });
  if (pack === null || pack === undefined) return filename;
  if (carrierKind !== "evaluation_input") {
    fail(
      "controlled_contract_pack_identity_forbidden",
      "only an evaluation-input carrier is addressed by exact pack identity"
    );
  }
  return (await resolveEvaluationInputFilename({
    repoRoot, wkId, focus, pack, preferPack
  }, { resolveCanonicalControlledContractCarrierSet })).filename;
}

export async function resolveControlledContractEvaluationInputBindingImpl({
  repoRoot,
  wkId,
  focus = null,
  pack = null
}, { resolveCanonicalControlledContractCarrierSet }) {
  normalizeControlledContractIdentity({ wkId, focus });
  const resolved = pack === null || pack === undefined
    ? { filename: controlledContractCarrierFilename({ wkId, focus,
      carrierKind: "evaluation_input" }), binding: "identity" }
    : await resolveEvaluationInputFilename(
      { repoRoot, wkId, focus, pack },
      { resolveCanonicalControlledContractCarrierSet }
    );
  return Object.freeze({
    schema_version: "controlled-contract-evaluation-input-binding.v1",
    wk_id: wkId,
    focus: focus ?? null,
    filename: resolved.filename,
    binding: resolved.binding
  });
}

export async function readControlledContractCarrierFileImpl({
  repoRoot,
  wkId,
  focus = null,
  carrierKind,
  pack = null,
  canonicalSet = null
}, { resolveCanonicalControlledContractCarrierSet }) {
  normalizeControlledContractIdentity({ wkId, focus });
  canonicalSet ??= await resolveCanonicalControlledContractCarrierSet({
    repoRoot, wkId, focus
  });
  return carrierFromCanonicalSet({
    canonicalSet, wkId, focus, carrierKind, pack, required: true
  });
}

export function carrierFromCanonicalSet({
  canonicalSet, wkId, focus, carrierKind, pack = null, preferPack = false,
  basename = null, required = false
}) {

  const filename = basename ?? resolveManifestControlledContractCarrierFilename({
    canonicalSet, wkId, focus, carrierKind, pack, preferPack
  });
  const member = canonicalSet.members_by_basename[filename] ?? null;
  if (member === null) {
    if (!required) return null;
    fail("controlled_contract_carrier_not_found",
      "canonical controlled-contract carrier is absent", { carrier_kind: carrierKind });
  }
  return Object.freeze({
    schema_version: "controlled-contract-canonical-carrier.v1",
    wk_id: wkId,
    focus: focus ?? null,
    carrier_kind: carrierKind,
    filename,
    content_digest: member.content_digest,
    content: structuredClone(member.content)
  });
}

export function resolveManifestControlledContractCarrierFilename({
  canonicalSet, wkId, focus, carrierKind, pack = null, preferPack = false
}) {
  if (carrierKind !== "evaluation_input" || pack === null || pack === undefined) {
    return controlledContractCarrierFilename({ wkId, focus, carrierKind });
  }
  const identity = normalizeControlledContractPackIdentity(pack);
  const requestName = controlledContractCarrierFilename({
    wkId, focus, carrierKind: "proof_plan_request"
  });
  const request = canonicalSet.members_by_basename[requestName]?.content ?? null;
  const bindings = persistedEvaluationInputBindings({ wkId, focus, content: request });
  const bound = bindings.get(`${identity.profileId}@${identity.profileVersion}`);
  if (bound !== undefined) return bound;
  const namespaced = controlledContractPackCarrierFilename({
    wkId, focus, profileId: identity.profileId, profileVersion: identity.profileVersion
  });
  if (preferPack || Object.hasOwn(canonicalSet.members_by_basename, namespaced)) {
    return namespaced;
  }
  const legacy = controlledContractCarrierFilename({
    wkId, focus, carrierKind: "evaluation_input"
  });
  assertUnboundFallbackIsNotAnotherPacksInput({ identity, filename: legacy, bindings });
  return legacy;
}

export function canonicalSetMemberDescriptor({ filename, carrierKind, inspected }) {
  return Object.freeze({
    filename,
    carrier_kind: carrierKind,
    content_digest: inspected.digest,
    byte_length: inspected.bytes.byteLength,
    content: deepFreezePlainData(parseCarrierJson(inspected.bytes))
  });
}

export function assertBoundedStringArray(value, {
  field,
  maximumItems = 32,
  maximumBytes = 4096,
  allowEmpty = false
}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
      value.length > maximumItems || value.some((item) =>
        typeof item !== "string" || item.length === 0 ||
        Buffer.byteLength(item, "utf8") > maximumBytes)) {
    fail("controlled_contract_bounded_input_invalid", `${field} is not a bounded string array`, {
      field
    });
  }
  return [...value];
}

async function resolveComposedEvaluationInputPath({
  store, canonicalSet = null, wkId, focus, identity, bindings, selectedPackCount
}) {
  const bound = bindings.get(`${identity.profileId}@${identity.profileVersion}`);
  if (bound !== undefined) return bound;
  const packFilename = controlledContractPackCarrierFilename({ wkId, focus, ...identity });
  if (selectedPackCount > 1) return packFilename;
  const exists = canonicalSet === null
    ? await inspectCarrierFile(path.join(store.contracts, packFilename),
      { required: false }).then((entry) => entry !== null)
    : Object.hasOwn(canonicalSet.members_by_basename, packFilename);
  return !exists
    ? controlledContractCarrierFilename({ wkId, focus, carrierKind: "evaluation_input" })
    : packFilename;
}

export async function composeSelectedProofPack({
  store, canonicalSet = null, wkId, focus, selectedPack, bindings, selectedPackCount
}) {
  if (!isPlainObject(selectedPack)) return structuredClone(selectedPack);
  const identity = normalizeControlledContractPackIdentity({
    profileId: selectedPack.profile_id,
    profileVersion: selectedPack.profile_version
  });
  const evaluationInputPath = await resolveComposedEvaluationInputPath({
    store, canonicalSet, wkId, focus, identity, bindings, selectedPackCount
  });
  if (Object.hasOwn(selectedPack, "evaluation_input_path") &&
      selectedPack.evaluation_input_path !== evaluationInputPath) {
    fail(
      "controlled_contract_proof_input_path_forbidden",
      "selected-pack evaluation_input_path is server-derived and must not select another path"
    );
  }
  return { ...structuredClone(selectedPack), evaluation_input_path: evaluationInputPath };
}

export function projectedSelectedPackCount({ content, operations }) {
  const keys = new Set();
  for (const selected of Array.isArray(content?.selected_packs) ? content.selected_packs : []) {
    if (isPlainObject(selected)) keys.add(selectedPackIdentityKey(selected));
  }
  for (const operation of operations) {
    if (!isPlainObject(operation) || operation.target !== "selected_packs") continue;
    const key = typeof operation.id === "string" && operation.id.length > 0
      ? operation.id
      : isPlainObject(operation.value) ? selectedPackIdentityKey(operation.value) : null;
    if (key === null) continue;
    if (operation.op === "upsert") keys.add(key);
    else if (operation.op === "remove") keys.delete(key);
  }
  return keys.size;
}

export async function readCanonicalProofPlanInputsImpl({
  repoRoot, wkId, focus = null, requestContent, evaluationOverrides = {},
  canonicalSet = null
}, { resolveCanonicalControlledContractCarrierSet }) {
  normalizeControlledContractIdentity({ wkId, focus });
  canonicalSet ??= await resolveCanonicalControlledContractCarrierSet({
    repoRoot, wkId, focus
  });
  const contract = carrierFromCanonicalSet({
    canonicalSet, wkId, focus, carrierKind: "contract", required: true
  });
  const request = requestContent === undefined
    ? carrierFromCanonicalSet({
      canonicalSet, wkId, focus, carrierKind: "proof_plan_request", required: true
    })
    : { content: requestContent };
  const store = await resolveControlledContractRepository(repoRoot);
  const selectedPacks = request.content?.selected_packs;
  if (!Array.isArray(selectedPacks)) {
    fail("controlled_contract_proof_plan_request_invalid", "proof-plan request has no selected_packs array");
  }
  const evaluationInputs = {};
  for (const selected of selectedPacks) {
    const evaluationPath = selected?.evaluation_input_path;
    if (typeof evaluationPath !== "string") continue;
    const classified = classifyControlledContractCarrierBasename({
      wkId, basename: evaluationPath
    });

    const wrongKind = classified.member === true &&
      classified.carrier_kind !== "evaluation_input";
    const namespacedMismatch = classified.member === true &&
      classified.pack_namespace !== null &&
      (classified.focus !== (focus ?? null) ||
       typeof selected?.profile_id !== "string" ||
       typeof selected?.profile_version !== "string" ||
       classified.pack_namespace !== `pack-sha256-${packIdentityDigest({
         profileId: selected.profile_id,
         profileVersion: selected.profile_version
       })}`);
    if (classified.member !== true || wrongKind || namespacedMismatch) {
      fail(
        "controlled_contract_proof_input_path_forbidden",
        "proof-plan request references a non-canonical or mismatched evaluation input"
      );
    }
    if (Object.hasOwn(evaluationOverrides, evaluationPath)) {
      evaluationInputs[evaluationPath] = evaluationOverrides[evaluationPath];
    } else {
      const selected = canonicalSet.members_by_basename[evaluationPath];
      if (selected) evaluationInputs[evaluationPath] = structuredClone(selected.content);
    }
  }
  return Object.freeze({ store, contract, request, evaluationInputs });
}
