import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  fail,
  normalizeControlledContractIdentity,
  classifyControlledContractRepositoryPath,
  resolveControlledContractRepository,
  inspectCarrierFile,
  deepFreezePlainData
} from "./controlled-contract-tool-shared.mjs";
import {
  carrierFromCanonicalSet,
  canonicalSetMemberDescriptor
} from "./controlled-contract-carrier-set-evaluation.mjs";
import {
  CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES,
  ControlledContractCarrierSetManifestError,
  parseControlledContractCarrierSetManifest
} from "./controlled-contract-carrier-set-manifest.mjs";

const AUTHENTICATED_RUNTIME_MEMBERS = new WeakMap();

export function authenticatedControlledContractRuntimeMembers(selection) {
  const members = AUTHENTICATED_RUNTIME_MEMBERS.get(selection);
  if (members === undefined) fail(
    "controlled_contract_generation_invalid",
    "runtime generation members require one carrier-set-owner selection"
  );
  return members;
}

export async function resolveCanonicalControlledContractCarrierSetImpl({
  repoRoot, wkId, focus = null
}, publication) {
  const {
    carrierSetFailure,
    carrierSetManifestPath,
    inspectCarrierSetMember
  } = publication;
  normalizeControlledContractIdentity({ wkId, focus });
  const store = await resolveControlledContractRepository(repoRoot);
  const manifestPath = carrierSetManifestPath(store, wkId, focus);
  const visible = await inspectCarrierFile(manifestPath, { required: false });
  const members = [];
  if (visible === null) {
    const entries = await readdir(store.contracts, { withFileTypes: true });
    for (const entry of entries) {
      const classification = classifyControlledContractRepositoryPath({
        wkId, repositoryPath: `wiki/contracts/${entry.name}`
      });
      if (classification.classification === "malformed_active_candidate") {
        fail(
          "controlled_contract_carrier_set_member_mismatch",
          "malformed same-WK controlled-contract carrier is present",
          { basename: entry.name, reason: classification.reason }
        );
      }
      if (classification.classification === "unsupported_nonmember" ||
          classification.member !== true ||
          classification.focus !== (focus ?? null)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) fail(
        "controlled_contract_carrier_set_member_mismatch",
        "legacy canonical carrier is not one regular file", { basename: entry.name });
      const inspected = await inspectCarrierFile(path.join(store.contracts, entry.name), {
        required: true
      });
      members.push(canonicalSetMemberDescriptor({
        filename: entry.name,
        carrierKind: classification.carrier_kind,
        inspected
      }));
    }
    members.sort((left, right) => left.filename.localeCompare(right.filename));
    return deepFreezePlainData({
      schema_version: "controlled-contract-canonical-carrier-set.v1",
      wk_id: wkId,
      focus: focus ?? null,
      source: "legacy_root",
      manifest_content_digest: null,
      manifest_digest: null,
      generation: null,
      profile: null,
      members,
      members_by_basename: Object.fromEntries(members.map((entry) =>
        [entry.filename, entry]))
    });
  }

  let manifest;
  try {
    manifest = parseControlledContractCarrierSetManifest(visible.bytes, {
      wkId,
      focus: focus ?? null
    });
  } catch (error) {
    if (!(error instanceof ControlledContractCarrierSetManifestError)) throw error;
    const code = error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MEMBER
      ? "member_mismatch"
      : error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MISSING ||
          error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.INCOMPLETE
        ? "partial_generation"
        : error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.DIGEST
          ? "digest_mismatch"
          : "manifest_mismatch";
    carrierSetFailure(code, error.message, error.details);
  }
  const generationId = manifest.generation.id;
  const generationPath = manifest.generation.path;
  const census = manifest.carrier_census;
  const generationDir = path.join(store.contracts, generationPath);
  for (const member of census) {
    if (member.member_kind !== "carrier" && member.member_kind !== "evaluation_input") {
      continue;
    }
    const inspected = await inspectCarrierSetMember(
      path.join(generationDir, member.filename), CONTROLLED_CONTRACT_MAX_JSON_BYTES
    );
    if (inspected.digest !== member.content_digest ||
        inspected.bytes.byteLength !== member.byte_length) {
      carrierSetFailure("digest_mismatch", "manifest-selected carrier content differs", {
        basename: member.filename
      });
    }
    members.push(canonicalSetMemberDescriptor({
      filename: member.filename,
      carrierKind: member.carrier_kind,
      inspected
    }));
  }
  members.sort((left, right) => left.filename.localeCompare(right.filename));
  const embedded = await inspectCarrierFile(path.join(generationDir, "manifest.json"), {
    required: true
  });
  if (embedded.digest !== visible.digest) carrierSetFailure("manifest_mismatch",
    "visible and generation-embedded manifests differ");
  return deepFreezePlainData({
    schema_version: "controlled-contract-canonical-carrier-set.v1",
    wk_id: wkId,
    focus: focus ?? null,
    source: "manifest",
    manifest_content_digest: visible.digest,
    manifest_digest: manifest.manifest_digest,
    generation: generationId,
    profile: structuredClone(manifest.profile),
    members,
    members_by_basename: Object.fromEntries(members.map((entry) =>
      [entry.filename, entry]))
  });
}

const CARRIER_SET_MANIFEST_SUFFIX = ".carrier-set-manifest.json";

export async function resolveCanonicalControlledContractCarrierDirectory({
  repoRoot, canonicalSet, store = null
}) {
  store ??= await resolveControlledContractRepository(repoRoot);
  if (canonicalSet?.source !== "manifest") return store.contracts;
  return path.join(store.contracts, ".carrier-generations", canonicalSet.generation);
}

async function publishedCarrierSetManifestFocuses(store, wkId) {
  let entries;
  try {
    entries = await readdir(store.contracts, { withFileTypes: true });
  } catch (error) {
    fail("controlled_contract_generation_enumeration_failed",
      "canonical controlled-contract generation could not be enumerated", {
        cause_code: error?.code ?? null
      });
  }
  const focuses = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(`${wkId}`) ||
        !entry.name.endsWith(CARRIER_SET_MANIFEST_SUFFIX)) continue;
    const stem = entry.name.slice(0, -CARRIER_SET_MANIFEST_SUFFIX.length);
    if (stem !== wkId && !stem.startsWith(`${wkId}-`)) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      carrierSetFailure("manifest_mismatch",
        "published carrier-set manifest is not one regular file",
        { basename: entry.name });
    }
    focuses.push(stem === wkId ? null : stem.slice(wkId.length + 1));
  }
  focuses.sort((left, right) =>
    `${left ?? ""}`.localeCompare(`${right ?? ""}`));
  return focuses;
}

export async function assertCanonicalCarrierSetIsNotFencedLegacyImpl({
  repoRoot, wkId, canonicalSet, store = null
}, { carrierSetFailure }) {
  if (canonicalSet?.source === "manifest") return;
  store ??= await resolveControlledContractRepository(repoRoot);
  const focuses = await publishedCarrierSetManifestFocuses(store, wkId);
  if (focuses.length === 0) return;
  carrierSetFailure("manifest_missing",
    "a published carrier-set manifest fences this record's legacy root carriers", {
      wk_id: wkId,
      focus: canonicalSet?.focus ?? null,
      published_manifest_focuses: focuses
    });
}

export async function resolveCanonicalControlledContractGenerationSelectionImpl({
  repoRoot, wkId
}, publication) {
  const { carrierSetFailure } = publication;
  normalizeControlledContractIdentity({ wkId, focus: null });
  const store = await resolveControlledContractRepository(repoRoot);
  const focuses = await publishedCarrierSetManifestFocuses(store, wkId);
  if (focuses.length === 0) return null;
  const manifests = [];
  const descriptors = [];
  const runtimeMembers = [];
  const selectedBasenames = new Set();
  for (const focus of focuses) {
    const canonicalSet = await resolveCanonicalControlledContractCarrierSetImpl({
      repoRoot, wkId, focus
    }, publication);
    if (canonicalSet.source !== "manifest") carrierSetFailure("manifest_missing",
      "published carrier-set manifest disappeared during generation selection",
      { focus: focus ?? null });
    manifests.push({
      focus: focus ?? null,
      generation: canonicalSet.generation,
      manifest_content_digest: canonicalSet.manifest_content_digest
    });
    const generationDirectory = await resolveCanonicalControlledContractCarrierDirectory({
      repoRoot, canonicalSet, store
    });
    for (const member of canonicalSet.members) {
      if (selectedBasenames.has(member.filename)) carrierSetFailure("member_mismatch",
        "published carrier-set manifests select the same carrier twice",
        { basename: member.filename });
      selectedBasenames.add(member.filename);
      const classification = classifyControlledContractRepositoryPath({
        wkId, repositoryPath: `wiki/contracts/${member.filename}`
      });
      const inspected = await inspectCarrierFile(
        path.join(generationDirectory, member.filename), { required: true });
      if (inspected.digest !== member.content_digest ||
          inspected.bytes.byteLength !== member.byte_length) {
        carrierSetFailure("digest_mismatch",
          "manifest-selected carrier content moved during generation selection",
          { basename: member.filename });
      }
      descriptors.push({

        path: `wiki/contracts/${member.filename}`,
        basename: member.filename,
        carrier_kind: classification.carrier_kind,
        focus: classification.focus,
        pack_digest: classification.pack_digest,
        content_digest: inspected.digest,
        byte_length: inspected.bytes.byteLength,
        bytes_base64: inspected.bytes.toString("base64")
      });
      runtimeMembers.push({
        schema_version: "controlled-contract-authenticated-runtime-member.v1",
        storage_mode: "manifest_generation",
        logical_filename: member.filename,
        repository_relative_path: path.relative(
          store.repository, path.join(generationDirectory, member.filename)
        ).split(path.sep).join("/"),
        content_digest: inspected.digest,
        manifest_generation: canonicalSet.generation,
        manifest_content_digest: canonicalSet.manifest_content_digest
      });
    }
  }
  descriptors.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const selection = deepFreezePlainData({
    schema_version: "controlled-contract-manifest-generation-selection.v1",
    wk_id: wkId,
    source: "manifest",
    manifests,
    descriptors
  });
  runtimeMembers.sort((left, right) =>
    left.logical_filename.localeCompare(right.logical_filename));
  AUTHENTICATED_RUNTIME_MEMBERS.set(selection, deepFreezePlainData(runtimeMembers));
  return selection;
}

export async function readControlledContractAuthoringCarriersImpl({
  repoRoot, wkId, focus = null, canonicalSet = null
}, publication) {
  normalizeControlledContractIdentity({ wkId, focus });
  canonicalSet ??= await resolveCanonicalControlledContractCarrierSetImpl({
    repoRoot, wkId, focus
  }, publication);
  const contract = carrierFromCanonicalSet({
    canonicalSet, wkId, focus, carrierKind: "contract"
  });
  const request = carrierFromCanonicalSet({
    canonicalSet, wkId, focus, carrierKind: "proof_plan_request"
  });
  const plan = carrierFromCanonicalSet({
    canonicalSet, wkId, focus, carrierKind: "proof_plan"
  });
  const selected = request?.content?.selected_packs;
  const pack = Array.isArray(selected) && selected.length === 1
    ? { profileId: selected[0].profile_id, profileVersion: selected[0].profile_version }
    : null;
  const evaluation = carrierFromCanonicalSet({
    canonicalSet, wkId, focus, carrierKind: "evaluation_input", pack
  });
  return Object.freeze({
    contract,
    evaluation_input: evaluation,
    proof_plan_request: request,
    proof_plan: plan
  });
}
