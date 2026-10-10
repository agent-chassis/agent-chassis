import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  constructAuthenticatedControlledContractGeneration
} from "../packages/wiki-core/src/lib/controlled-contract-generation-authentication.mjs";
import {
  canonicalJsonBytes,
  controlledContractGenerationDigest,
  digestBytes
} from "../packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs";

const CONTRACT_FIXTURE = new URL(
  "../packages/controlled-contract/examples/minimal-controlled-acceptance-contract.v1.json",
  import.meta.url);
const fixtureCache = new Map();

export function installManifestGenerationFixture({ repository, wkId, annotation = null }) {
  const bytes = annotation === null
    ? readFileSync(CONTRACT_FIXTURE)
    : canonicalJsonBytes(withAnnotation(JSON.parse(readFileSync(CONTRACT_FIXTURE, "utf8")), annotation));
  const basename = `${wkId}.controlled-acceptance.json`;
  const generationId = createHash("sha256").update(wkId).update(bytes).digest("hex");
  const generationPath = `.carrier-generations/${generationId}`;
  const contracts = path.join(repository, "wiki", "contracts");
  const generationDirectory = path.join(contracts, generationPath);
  mkdirSync(generationDirectory, { recursive: true });
  writeFileSync(path.join(generationDirectory, basename), bytes);
  writeFileSync(path.join(contracts, basename), bytes);
  const member = {
    member_kind: "carrier",
    carrier_kind: "contract",
    filename: basename,
    path: `${generationPath}/${basename}`,
    content_digest: digestBytes(bytes),
    byte_length: bytes.byteLength
  };
  const manifestBody = {
    schema_version: "controlled-contract-carrier-set-manifest.v1",
    repository: "agent-chassis/agent-chassis",
    wk_id: wkId,
    focus: null,
    profile: { profile_id: "canonical_authoring", profile_version: "1.0.0" },
    generation: { id: generationId, path: generationPath },
    carriers: [member],
    carrier_census: [member]
  };
  const manifest = {
    ...manifestBody,
    manifest_digest: digestBytes(canonicalJsonBytes(manifestBody))
  };
  const manifestBytes = canonicalJsonBytes(manifest);
  writeFileSync(path.join(contracts, `${wkId}.carrier-set-manifest.json`), manifestBytes);
  writeFileSync(path.join(generationDirectory, "manifest.json"), manifestBytes);
}

function withAnnotation(contract, annotation) {
  return { ...contract, annotations: [...(contract.annotations ?? []), annotation] };
}

export async function authenticatedGenerationFixture({
  repository,
  wkId,
  wkTipSha
}) {
  const cacheKey = JSON.stringify([repository, wkId, wkTipSha]);
  if (fixtureCache.has(cacheKey)) return fixtureCache.get(cacheKey);
  const bytes = await readFile(CONTRACT_FIXTURE);
  const basename = `${wkId}.controlled-acceptance.json`;
  const descriptor = {
    path: `wiki/contracts/${basename}`,
    basename,
    carrier_kind: "contract",
    focus: null,
    pack_digest: null,
    content_digest: digestBytes(bytes),
    byte_length: bytes.byteLength,
    bytes_base64: bytes.toString("base64")
  };
  const descriptors = [descriptor];
  const generationId = createHash("sha256").update(bytes).digest("hex");
  const generationPath = `.carrier-generations/${generationId}`;
  const manifestMember = {
    member_kind: "carrier",
    carrier_kind: "contract",
    filename: basename,
    path: `${generationPath}/${basename}`,
    content_digest: descriptor.content_digest,
    byte_length: descriptor.byte_length
  };
  const manifestBody = {
    schema_version: "controlled-contract-carrier-set-manifest.v1",
    repository: "agent-chassis/agent-chassis",
    wk_id: wkId,
    focus: null,
    profile: { profile_id: "canonical_authoring", profile_version: "1.0.0" },
    generation: {
      id: generationId,
      path: generationPath
    },
    carriers: [manifestMember],
    carrier_census: [manifestMember]
  };
  const manifest = {
    ...manifestBody,
    manifest_digest: digestBytes(canonicalJsonBytes(manifestBody))
  };
  const manifestBytes = canonicalJsonBytes(manifest);
  const manifestObservation = {
    path: `wiki/contracts/${wkId}.carrier-set-manifest.json`,
    content_digest: digestBytes(manifestBytes),
    byte_length: manifestBytes.byteLength,
    bytes_base64: manifestBytes.toString("base64")
  };
  const resolvedGeneration = Object.freeze({
    schema_version: "controlled-contract-resolved-generation.v1",
    record_id: wkId,
    count: 1,
    generation_digest: controlledContractGenerationDigest({ wkId, descriptors }),
    manifest_selection: Object.freeze([Object.freeze({
      focus: null,
      generation: generationId,
      manifest_content_digest: manifestObservation.content_digest
    })]),
    descriptors: Object.freeze([Object.freeze(descriptor)])
  });
  const recordBytes = canonicalJsonBytes({ id: wkId, initiative: "IN-0000" });
  const authenticated = await constructAuthenticatedControlledContractGeneration({
    repository,
    wkId,
    wkTipSha,
    recordObservation: {
      path: `wiki/work-records/${wkId}.json`,
      content_digest: digestBytes(recordBytes),
      byte_length: recordBytes.byteLength,
      bytes_base64: recordBytes.toString("base64")
    },
    resolvedGeneration,
    carrierObservations: descriptors,
    manifestObservations: [manifestObservation]
  });
  fixtureCache.set(cacheKey, authenticated);
  return authenticated;
}
