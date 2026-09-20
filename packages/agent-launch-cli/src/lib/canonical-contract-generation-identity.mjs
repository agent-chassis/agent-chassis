import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  classifyControlledContractGenerationRepositoryPath,
  controlledContractGenerationDigest
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tool-shared.mjs";
import {
  CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES,
  ControlledContractCarrierSetManifestError,
  parseControlledContractCarrierSetManifest
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-manifest.mjs";

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readConfinedFile(filePath, { fail, invalidReason, unreadableReason, subject }) {
  try {
    const entry = lstatSync(filePath);
    if (!entry.isFile() || entry.isSymbolicLink() || realpathSync(filePath) !== filePath) {
      fail(invalidReason, `${subject} is not one confined regular file`);
    }
    return readFileSync(filePath);
  } catch (error) {
    if (error?.detail?.history_observation === true) throw error;
    fail(unreadableReason, `${subject} could not be read`, {
      cause_code: error?.code ?? null
    });
  }
}

function parseManifest({ mainRepo, wkId, focus, manifestPath, fail }) {
  const firstBytes = readConfinedFile(manifestPath, {
    fail,
    invalidReason: "contract_generation_manifest_invalid",
    unreadableReason: "contract_generation_manifest_unreadable",
    subject: "canonical contract-generation manifest"
  });
  let manifest;
  try {
    manifest = parseControlledContractCarrierSetManifest(firstBytes, { wkId, focus });
  } catch (error) {
    if (!(error instanceof ControlledContractCarrierSetManifestError)) throw error;
    const reason = error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MEMBER
      ? "contract_generation_member_invalid"
      : error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.MISSING ||
          error.code === CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES.INCOMPLETE
        ? "contract_generation_manifest_incomplete"
        : "contract_generation_manifest_malformed";
    fail(reason, error.message, { manifest_code: error.code });
  }

  const generationDirectory = path.join(
    mainRepo, "wiki", "contracts", manifest.generation.path
  );
  const descriptors = manifest.carrier_census
    .filter((member) => member.member_kind === "carrier" ||
      member.member_kind === "evaluation_input")
    .map((member) => {
      const memberPath = path.join(generationDirectory, member.filename);
      const bytes = readConfinedFile(memberPath, {
        fail,
        invalidReason: "contract_generation_member_invalid",
        unreadableReason: "contract_generation_member_unreadable",
        subject: "canonical contract-generation member"
      });
      if (bytes.byteLength !== member.byte_length ||
          sha256(bytes) !== member.content_digest) {
        fail("contract_generation_member_mismatch",
          "canonical contract-generation member bytes do not match the manifest", {
            carrier: member.filename
          });
      }
      try {
        JSON.parse(bytes.toString("utf8"));
      } catch {
        fail("contract_generation_member_malformed",
          "canonical contract-generation member is not JSON", {
            carrier: member.filename
          });
      }
      return Object.freeze({
        path: `wiki/contracts/${member.filename}`,
        content_digest: member.content_digest
      });
    });

  const embeddedBytes = readConfinedFile(
    path.join(generationDirectory, "manifest.json"), {
      fail,
      invalidReason: "contract_generation_manifest_invalid",
      unreadableReason: "contract_generation_manifest_unreadable",
      subject: "embedded contract-generation manifest"
    }
  );
  if (!firstBytes.equals(embeddedBytes)) {
    fail("contract_generation_changed",
      "visible and embedded contract-generation manifests differ");
  }
  let secondBytes;
  try {
    secondBytes = readFileSync(manifestPath);
  } catch (error) {
    fail("contract_generation_changed",
      "canonical contract generation changed while it was authenticated", {
        cause_code: error?.code ?? null
      });
  }
  if (!firstBytes.equals(secondBytes)) {
    fail("contract_generation_changed",
      "canonical contract generation changed while it was authenticated");
  }
  return Object.freeze({
    path: path.relative(mainRepo, manifestPath).split(path.sep).join("/"),
    content_digest: sha256(firstBytes),
    manifest_digest: manifest.manifest_digest,
    descriptors: Object.freeze(descriptors)
  });
}

function readSourceDescriptor({ contracts, wkId, entry, classification, fail }) {
  const sourcePath = path.join(contracts, entry.name);
  const firstBytes = readConfinedFile(sourcePath, {
    fail,
    invalidReason: "contract_generation_member_invalid",
    unreadableReason: "contract_generation_member_unreadable",
    subject: "canonical proof-authoring source"
  });
  let source;
  try {
    source = JSON.parse(firstBytes.toString("utf8"));
  } catch {
    fail("contract_generation_member_malformed",
      "canonical proof-authoring source is not JSON", { source: entry.name });
  }
  if (source === null || typeof source !== "object" || Array.isArray(source) ||
      source.wk_id !== wkId || source.focus !== classification.focus ||
      source.selected_unit !== (classification.selected_unit ?? null)) {
    fail("contract_generation_member_mismatch",
      "canonical proof-authoring source identity does not match its generation path", {
        source: entry.name
      });
  }
  let secondBytes;
  try {
    secondBytes = readFileSync(sourcePath);
  } catch (error) {
    fail("contract_generation_changed",
      "canonical proof-authoring source changed while it was authenticated", {
        source: entry.name,
        cause_code: error?.code ?? null
      });
  }
  if (!firstBytes.equals(secondBytes)) {
    fail("contract_generation_changed",
      "canonical proof-authoring source changed while it was authenticated", {
        source: entry.name
      });
  }
  return Object.freeze({
    path: `wiki/contracts/${entry.name}`,
    content_digest: sha256(firstBytes)
  });
}

export function readCompleteCanonicalContractGenerationIdentity({
  mainRepo,
  wkId,
  fail
}) {
  const contracts = path.join(mainRepo, "wiki", "contracts");
  let entries;
  try {
    entries = readdirSync(contracts, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Object.freeze({
        state: "absent",
        digest: "controlled-contract-generation:none",
        carrier_count: 0,
        manifest_digest: null,
        manifest_digests: Object.freeze([])
      });
    }
    fail("contract_generation_manifest_unreadable",
      "canonical contract-generation manifest directory could not be read", {
        cause_code: error?.code ?? null
      });
  }

  const selections = [];
  const manifestSuffix = ".carrier-set-manifest.json";
  for (const entry of entries) {
    const repositoryPath = `wiki/contracts/${entry.name}`;
    const classification = classifyControlledContractGenerationRepositoryPath({
      wkId,
      repositoryPath
    });
    if (classification.classification === "malformed_active_candidate" ||
        (classification.classification === "active_member" &&
          (!entry.isFile() || entry.isSymbolicLink()))) {
      fail("contract_generation_member_invalid",
        "flat active controlled-contract state is malformed or non-ordinary", {
          path: repositoryPath
        });
    }
    if (!entry.name.startsWith(wkId) || !entry.name.endsWith(manifestSuffix)) continue;
    const stem = entry.name.slice(0, -manifestSuffix.length);
    if (stem !== wkId && !stem.startsWith(`${wkId}-`)) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      fail("contract_generation_manifest_invalid",
        "canonical contract-generation manifest is not one regular file", {
          manifest: entry.name
        });
    }
    selections.push({
      focus: stem === wkId ? null : stem.slice(wkId.length + 1),
      manifestPath: path.join(contracts, entry.name)
    });
  }
  selections.sort((left, right) => left.manifestPath.localeCompare(right.manifestPath));
  if (selections.length === 0) {
    return Object.freeze({
      state: "absent",
      digest: "controlled-contract-generation:none",
      carrier_count: 0,
      manifest_digest: null,
      manifest_digests: Object.freeze([])
    });
  }

  const manifests = selections.map((selection) => parseManifest({
    mainRepo,
    wkId,
    fail,
    ...selection
  }));
  const selectedFocuses = new Set(selections.map(({ focus }) => focus));
  const sourceDescriptors = entries.flatMap((entry) => {
    const classification = classifyControlledContractGenerationRepositoryPath({
      wkId,
      repositoryPath: `wiki/contracts/${entry.name}`
    });
    if (classification.member !== true ||
        classification.carrier_kind !== "obligation_coverage" ||
        !selectedFocuses.has(classification.focus)) return [];
    return [readSourceDescriptor({ contracts, wkId, entry, classification, fail })];
  });
  const descriptors = [
    ...manifests.flatMap((manifest) => manifest.descriptors),
    ...sourceDescriptors
  ].sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(descriptors.map((descriptor) => descriptor.path)).size !== descriptors.length) {
    fail("contract_generation_member_invalid",
      "canonical contract generation selects the same member twice");
  }
  const manifestDigests = Object.freeze(manifests.map((manifest) => Object.freeze({
    path: manifest.path,
    content_digest: manifest.content_digest,
    manifest_digest: manifest.manifest_digest
  })));
  return Object.freeze({
    state: "present",
    digest: controlledContractGenerationDigest({ wkId, descriptors }),
    carrier_count: descriptors.length,
    manifest_digest: manifestDigests.length === 1 ? manifestDigests[0].manifest_digest : null,
    manifest_digests: manifestDigests
  });
}
