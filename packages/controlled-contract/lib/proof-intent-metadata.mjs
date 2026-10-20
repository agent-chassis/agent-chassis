

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import {
  loadAdmittedProofPackMeaning,
  readProofPackCatalog
} from "./admitted-proof-packs.mjs";
import { compiledValidators } from "./compiled-validator-cache.mjs";
import {
  canonicalDigest,
  canonicalValue,
  compareCodeUnits,
  deepFreeze
} from "./deterministic-projection-primitives.mjs";
import { validateIntentArtifact } from "./proof-authoring-schemas.mjs";
import { discoverySourceIdentity, loadProofDiscoveryPopulation } from "./proof-discovery-scope.mjs";
import { VOCABULARY_DIGESTS, VOCABULARY_VERSION } from "./vocabulary-v1.mjs";

export const PROOF_INTENT_METADATA_SCHEMA_VERSION =
  "controlled-contract-proof-intent-metadata.v1";
export const PROOF_INTENT_METADATA_PATH = "proof-intents/metadata.v1.json";
export const PROOF_INTENT_METADATA_BUILD_COMMAND = "npm run build:intent-metadata";

const packageRoot = new URL("../", import.meta.url);
const INTENT_CATALOG_PATH = "proof-intents/catalog.json";
const PACK_CATALOG_PATH = "profiles/catalog.json";
const INTENT_CATALOG_SCHEMA_PATH =
  "schema/controlled-contract-proof-intent-catalog.v2.schema.json";
const DISCOVERY_RESULT_SCHEMA_PATH =
  "schema/controlled-contract-proof-intent-discovery.v1.schema.json";
const PACK_INPUT_FILES = Object.freeze([
  "profile.json", "admission.json", "parameter-contract.json",
  "component-exclusion-applicability.json"
]);
const LISTED_LIMIT = 8;

export class ProofIntentMetadataError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofIntentMetadataError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

export class ProofIntentSelectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofIntentSelectionError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

export class ProofIntentDiscoveryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofIntentDiscoveryError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

const [catalogSchema, discoverySchema] = await Promise.all([
  readJson(new URL(INTENT_CATALOG_SCHEMA_PATH, packageRoot)),
  readJson(new URL(DISCOVERY_RESULT_SCHEMA_PATH, packageRoot))
]);
export const {
  validateProofIntentCatalog
} = await compiledValidators("controlled-contract.proof-intent-discovery.v1", {
  validators: { validateProofIntentCatalog: catalogSchema }
});

export const PROOF_INTENT_DISCOVERY_RESULT_VALIDATOR = Object.freeze({
  groupId: "controlled-contract.proof-intent-discovery-result.v1",
  declaration: Object.freeze({
    validators: Object.freeze({ validateProofIntentDiscoveryResult: discoverySchema })
  }),
  directory: new URL("validators/proof-intent-discovery-result/", packageRoot),
  rebuildCommand: PROOF_INTENT_METADATA_BUILD_COMMAND
});

function packKey({ profile_id: profileId, profile_version: profileVersion }) {
  return `${profileId}@${profileVersion}`;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareCodeUnits);
}

export function normalizeSearchText(value) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function selectionCanonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function selectionDigest(value) {
  return createHash("sha256").update(selectionCanonicalJson(value)).digest("hex");
}

export function normalizeIntentArtifact(value) {
  const normalized = structuredClone(value);
  normalized.intents = normalized.intents.map((intent) => ({
    ...intent,
    discovery_terms: sortedUnique(intent.discovery_terms),
    capable_packs: [...intent.capable_packs].sort((left, right) =>
      compareCodeUnits(packKey(left), packKey(right))
    ),
    compatibility: Object.fromEntries(Object.entries(intent.compatibility).map(
      ([key, values]) => [key, sortedUnique(values)]
    )),
    required_evaluation_inputs: sortedUnique(intent.required_evaluation_inputs),
    distinctions: [...intent.distinctions].sort((left, right) =>
      compareCodeUnits(left.from_intent_id, right.from_intent_id)
    )
  })).sort((left, right) => compareCodeUnits(left.intent_id, right.intent_id));
  return canonicalValue(normalized);
}

export function normalizeProofPackCatalog(value) {
  return canonicalValue({
    ...structuredClone(value),
    packs: [...value.packs].sort((left, right) =>
      compareCodeUnits(packKey(left), packKey(right))
    )
  });
}

export function normalizeProofIntentDiscoveryCatalog(value) {
  const normalized = structuredClone(value);
  normalized.intents = normalized.intents.map((intent) => ({
    ...intent,
    discovery_terms: sortedUnique(intent.discovery_terms),
    capable_packs: [...intent.capable_packs].sort((left, right) =>
      compareCodeUnits(packKey(left), packKey(right))
    ),
    compatibility: canonicalValue(Object.fromEntries(
      Object.entries(intent.compatibility).map(([key, values]) => [
        key, sortedUnique(values)
      ])
    )),
    required_evaluation_inputs: sortedUnique(intent.required_evaluation_inputs),
    distinctions: [...intent.distinctions].sort((left, right) =>
      compareCodeUnits(left.from_intent_id, right.from_intent_id)
    )
  })).sort((left, right) => compareCodeUnits(left.intent_id, right.intent_id));
  return canonicalValue(normalized);
}

export async function deriveProofIntentSelection() {
  const [intentArtifact, proofPackCatalog] = await Promise.all([
    readJson(new URL(INTENT_CATALOG_PATH, packageRoot)), readProofPackCatalog()
  ]);
  if (!validateIntentArtifact(intentArtifact)) throw new ProofIntentSelectionError(
    "proof_intent_artifact_invalid",
    "the shipped controlled proof-intent artifact is schema-invalid",
    { diagnostics: structuredClone(validateIntentArtifact.errors) }
  );

  const intentIds = intentArtifact.intents.map(({ intent_id: id }) => id);
  if (new Set(intentIds).size !== intentIds.length) throw new ProofIntentSelectionError(
    "proof_intent_identity_ambiguous",
    "the shipped proof-intent artifact contains duplicate controlled intent ids"
  );
  const intentIdentitySet = new Set(intentIds);
  for (const intent of intentArtifact.intents) {
    const capableKeys = intent.capable_packs.map(packKey);
    if (new Set(capableKeys).size !== capableKeys.length) {
      throw new ProofIntentSelectionError(
        "proof_intent_pack_mapping_duplicate",
        "one controlled proof intent maps the same pack identity more than once",
        { intent_id: intent.intent_id }
      );
    }
    const distinctionIds = intent.distinctions.map(
      ({ from_intent_id: id }) => id
    );
    if (new Set(distinctionIds).size !== distinctionIds.length ||
        distinctionIds.some((id) => id === intent.intent_id ||
          !intentIdentitySet.has(id))) throw new ProofIntentSelectionError(
      "proof_intent_distinction_invalid",
      "controlled intent distinctions must be unique references to other known intents",
      { intent_id: intent.intent_id, distinction_intent_ids: distinctionIds }
    );
  }

  const catalogIdentitySet = new Set(proofPackCatalog.packs.map(packKey));
  const mappedPackIdentitySet = new Set(intentArtifact.intents.flatMap(
    ({ capable_packs: packs }) => packs.map(packKey)
  ));
  for (const identity of catalogIdentitySet) if (!mappedPackIdentitySet.has(identity)) {
    throw new ProofIntentSelectionError(
      "proof_intent_catalog_pack_unmapped",
      "every admitted catalog pack must be discoverable through a controlled intent",
      { pack_identity: identity }
    );
  }
  for (const intent of intentArtifact.intents) for (const capable of intent.capable_packs) {
    if (!catalogIdentitySet.has(packKey(capable))) throw new ProofIntentSelectionError(
      "proof_intent_pack_not_admitted",
      "a controlled proof intent references a pack identity absent from the admitted catalog",
      { intent_id: intent.intent_id, pack: capable }
    );
  }

  const loadedPacks = await Promise.all(proofPackCatalog.packs.map(
    ({ profile_id: profileId }) => loadAdmittedProofPackMeaning(profileId)
  ));
  const packByIdentity = new Map(loadedPacks.map((pack) => [packKey({
    profile_id: pack.profile.profile_id,
    profile_version: pack.profile.profile_version
  }), pack]));

  for (const intent of intentArtifact.intents) for (const capable of intent.capable_packs) {
    const pack = packByIdentity.get(packKey(capable));
    const compatibleAdmission = intent.compatibility.admission_schema_versions.includes(
      pack.admission.schema_version
    );
    const compatibleProfile =
      intent.compatibility.contract_schema_versions.includes(
        pack.profile.contract_schema_version
      ) && intent.compatibility.vocabulary_versions.includes(
        pack.profile.vocabulary_version
      ) && pack.profile.vocabulary_version === VOCABULARY_VERSION;
    if (!compatibleAdmission || !compatibleProfile) throw new ProofIntentSelectionError(
      "proof_intent_pack_compatibility_invalid",
      "a controlled proof intent is inconsistent with its admitted pack carrier",
      { intent_id: intent.intent_id, pack: capable }
    );
  }

  const artifact = normalizeIntentArtifact(intentArtifact);
  return {
    intent_artifact: artifact,
    digests: {
      algorithm: "sha256-canonical-json-v1",
      catalog: selectionDigest(normalizeProofPackCatalog(proofPackCatalog)),
      vocabulary: VOCABULARY_DIGESTS.complete,
      profiles: selectionDigest(loadedPacks.map((pack) => ({
        profile_id: pack.profile.profile_id,
        profile_version: pack.profile.profile_version,
        profile_digest: pack.profile_digest,
        admission_digest: pack.admission_digest
      })).sort((left, right) => compareCodeUnits(packKey(left), packKey(right)))),
      intent_artifact: selectionDigest(artifact)
    },
    loadedPacks
  };
}

function assertDiscoveryCatalogSemantics(catalog) {
  const ids = catalog.intents.map(({ intent_id: intentId }) => intentId);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) throw new ProofIntentDiscoveryError(
    "proof_intent_discovery_catalog_identity_ambiguous",
    "the shipped proof-intent catalog contains duplicate controlled intent ids"
  );
  for (const intent of catalog.intents) {
    const normalizedTerms = intent.discovery_terms.map(normalizeSearchText);
    if (normalizedTerms.some((term) => term.length === 0) ||
        new Set(normalizedTerms).size !== normalizedTerms.length) {
      throw new ProofIntentDiscoveryError(
        "proof_intent_discovery_terms_invalid",
        "controlled discovery terms must remain unique and nonempty after normalization",
        { intent_id: intent.intent_id }
      );
    }
    const capableKeys = intent.capable_packs.map(packKey);
    if (new Set(capableKeys).size !== capableKeys.length) {
      throw new ProofIntentDiscoveryError(
        "proof_intent_discovery_pack_identity_ambiguous",
        "one controlled intent maps the same pack identity more than once",
        { intent_id: intent.intent_id }
      );
    }
    const distinctionIds = intent.distinctions.map(
      ({ from_intent_id: intentId }) => intentId
    );
    if (new Set(distinctionIds).size !== distinctionIds.length ||
        distinctionIds.some((intentId) => intentId === intent.intent_id ||
          !idSet.has(intentId))) {
      throw new ProofIntentDiscoveryError(
        "proof_intent_discovery_distinction_invalid",
        "controlled intent distinctions must uniquely reference other catalog intents",
        { intent_id: intent.intent_id }
      );
    }
  }
}

export async function deriveProofIntentDiscovery() {
  const rawCatalog = await readJson(new URL(INTENT_CATALOG_PATH, packageRoot));
  if (!validateProofIntentCatalog(rawCatalog)) throw new ProofIntentDiscoveryError(
    "proof_intent_discovery_catalog_invalid",
    "the shipped controlled proof-intent catalog is schema-invalid",
    { diagnostics: structuredClone(validateProofIntentCatalog.errors) }
  );
  assertDiscoveryCatalogSemantics(rawCatalog);
  const catalog = normalizeProofIntentDiscoveryCatalog(rawCatalog);
  const population = await loadProofDiscoveryPopulation(catalog, canonicalDigest(rawCatalog));

  const verificationCapabilities = Object.fromEntries(
    (await Promise.all(population.population.map(async ({ proof_name: proofName }) => [
      proofName,
      (await loadAdmittedProofPackMeaning(proofName)).profile.stable_capabilities
        ?.test_validity ?? null
    ]))).filter(([, capability]) => capability !== null)
  );
  return {
    catalog,
    catalog_digest: canonicalDigest(catalog),
    verification_capabilities: verificationCapabilities,
    population
  };
}

function metadataInputPaths() {
  const packCatalog = JSON.parse(readFileSync(new URL(PACK_CATALOG_PATH, packageRoot), "utf8"));
  const paths = [INTENT_CATALOG_PATH, PACK_CATALOG_PATH, INTENT_CATALOG_SCHEMA_PATH,
    "vocabulary/controlled-contract-vocabulary.v1.mjs"];
  for (const entry of packCatalog.packs ?? []) for (const name of PACK_INPUT_FILES) {
    const candidate = `${entry.path}/${name}`;
    if (existsSync(new URL(candidate, packageRoot))) paths.push(candidate);
  }
  return [...new Set(paths)].sort(compareCodeUnits);
}

function currentMetadataInputs(capturedBytes) {
  return metadataInputPaths().map((path) => {
    const bytes = readFileSync(new URL(path, packageRoot));
    if (capturedBytes) capturedBytes.set(path, bytes);
    return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
}

export function packagedDiscovery(discovery) {
  return {
    catalog: discovery.catalog,
    catalog_digest: discovery.catalog_digest,
    verification_capabilities: discovery.verification_capabilities,
    population: discovery.population.population,
    source_identity: discovery.population.sourceIdentity
  };
}

export async function buildProofIntentMetadata() {
  const inputs = currentMetadataInputs();
  const [selection, discovery] = await Promise.all([
    deriveProofIntentSelection(), deriveProofIntentDiscovery()
  ]);
  if (JSON.stringify(currentMetadataInputs()) !== JSON.stringify(inputs)) {
    throw new ProofIntentMetadataError("proof_intent_metadata_inputs_moved",
      "package inputs changed while proof-intent metadata was being derived");
  }
  const { population, ...discoveryFacts } = packagedDiscovery(discovery);
  const document = canonicalValue({
    schema_version: PROOF_INTENT_METADATA_SCHEMA_VERSION,
    inputs,
    selection: { intent_artifact: selection.intent_artifact, digests: selection.digests },
    discovery: discoveryFacts
  });

  document.discovery.population = population;
  return document;
}

export function proofIntentMetadataJson(document) {
  return `${JSON.stringify(document)}\n`;
}

function staleMetadata(details) {
  return new ProofIntentMetadataError("proof_intent_metadata_stale",
    (details.failure_limb === "mechanical_failure"
      ? `${PROOF_INTENT_METADATA_PATH}: ${details.cause} Identity ${details.profile_id}@${details.profile_version}; ` +
        `a package maintainer rebuilds with ${PROOF_INTENT_METADATA_BUILD_COMMAND} in the writing repository; ` +
        "an installed consumer installs or reinstalls a corrected package."
      : `${PROOF_INTENT_METADATA_PATH} does not match the package inputs it was built from; ` +
        `rebuild it with ${PROOF_INTENT_METADATA_BUILD_COMMAND}`),
    { path: PROOF_INTENT_METADATA_PATH, rebuild_command: PROOF_INTENT_METADATA_BUILD_COMMAND,
      ...details });
}

function unreadableMetadata(error) {
  return new ProofIntentMetadataError(
    error?.code === "ENOENT" ? "proof_intent_metadata_missing" : "proof_intent_metadata_unreadable",
    `${PROOF_INTENT_METADATA_PATH} could not be read; rebuild it with ` +
      PROOF_INTENT_METADATA_BUILD_COMMAND,
    { path: PROOF_INTENT_METADATA_PATH, rebuild_command: PROOF_INTENT_METADATA_BUILD_COMMAND,
      cause: error?.code ?? error?.message ?? String(error) });
}

function readMetadataBytes() {
  try {
    return readFileSync(new URL(PROOF_INTENT_METADATA_PATH, packageRoot));
  } catch (error) { throw unreadableMetadata(error); }
}

export function readProofIntentMetadataFileIdentity() {
  return createHash("sha256").update(readMetadataBytes()).digest("hex");
}

function captureMetadata(selectionMeaning, isolateDefinitions = false) {
  const bytes = readMetadataBytes();
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch (error) { throw unreadableMetadata(error); }
  if (document?.schema_version !== PROOF_INTENT_METADATA_SCHEMA_VERSION ||
      !Array.isArray(document.inputs) || document.selection === null ||
      typeof document.selection !== "object" || document.discovery === null ||
      typeof document.discovery !== "object") {
    throw staleMetadata({ reason: "schema_version_or_shape",
      schema_version: document?.schema_version ?? null });
  }
  const recorded = new Map(document.inputs.map(({ path, sha256 }) => [path, sha256]));

  const capturedBytes = selectionMeaning ? new Map() : undefined;
  const unavailable = new Map();
  const discoveryReads = new Map();
  let discoveryCatalog;
  let current;
  if (isolateDefinitions) {

    const catalogBytes = readFileSync(new URL(PACK_CATALOG_PATH, packageRoot));
    if (createHash('sha256').update(catalogBytes).digest('hex') !== recorded.get(PACK_CATALOG_PATH)) {
      throw staleMetadata({ reason: 'inputs_changed', changed_inputs: [PACK_CATALOG_PATH] });
    }
    discoveryCatalog = JSON.parse(catalogBytes);
    const owners = new Map(discoveryCatalog.packs.flatMap(entry =>
      PACK_INPUT_FILES.map(name => [`${entry.path}/${name}`, entry])));
    current = [...new Set([...metadataInputPaths(), ...recorded.keys()])].sort(compareCodeUnits).map(path => {
      const owner = owners.get(path);
      let failure;
      let sha256;
      try {
        const value = readFileSync(new URL(path, packageRoot));
        discoveryReads.set(path, { value });
        sha256 = createHash('sha256').update(value).digest('hex');
        if (owner && recorded.get(path) !== sha256) failure = {
          code: 'proof_intent_metadata_stale', message: 'Definition input differs from its authenticated metadata.',
          details: { path, reason: 'inputs_changed' } };
      } catch (error) {
        if (!owner) throw error;
        discoveryReads.set(path, { error });
        failure = { code: error.code ?? null, message: error.message, details: { path } };
      }
      if (failure) {
        const key = packKey(owner);
        if (!unavailable.has(key)) unavailable.set(key, { proof_name: owner.profile_id,
          proof_version: owner.profile_version, failures: [] });
        unavailable.get(key).failures.push(failure);

        return { path, sha256: recorded.get(path) };
      }
      return { path, sha256 };
    });
  } else current = currentMetadataInputs(capturedBytes);
  const changed = [
    ...current.filter(({ path, sha256 }) => recorded.get(path) !== sha256).map(({ path }) => path),
    ...[...recorded.keys()].filter((path) => !current.some((entry) => entry.path === path))
  ].sort(compareCodeUnits);
  if (changed.length > 0) {
    throw staleMetadata({ reason: "inputs_changed", changed_input_count: changed.length,
      changed_inputs: changed.slice(0, LISTED_LIMIT),
      changed_inputs_omitted: Math.max(0, changed.length - LISTED_LIMIT) });
  }
  const discoverySource = isolateDefinitions ? discoverySourceIdentity(document.discovery.catalog, discoveryCatalog, {
        isolateDefinitions: true, read: url => {
          const entry = discoveryReads.get(url.href.slice(packageRoot.href.length));
          if (entry === undefined) throw new Error(`Discovery input was not captured: ${url.href}`);
          if (entry.error) throw entry.error;
          return entry.value;
        }
      })() : null;
  if (isolateDefinitions && unavailable.size === 0 &&
      discoverySource.discovery !== document.discovery.source_identity.discovery) {
    throw staleMetadata({ reason: 'discovery_source_identity_mismatch' });
  }
  return { document: deepFreeze(document),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...(selectionMeaning ? { loadedPacks: capturedSelectionMeaning(document, capturedBytes) } : {}),
    ...(isolateDefinitions ? { unavailableDefinitions: deepFreeze([...unavailable.values()]),
      discoverySource } : {}) };
}

export function capturePackagedProofIntentMetadata() {
  return captureMetadata(false);
}

export function capturePackagedProofDiscoveryMetadata() {
  return captureMetadata(false, true);
}

export function capturePackagedProofIntentSelection() {
  return captureMetadata(true);
}

function capturedSelectionMeaning(document, capturedBytes) {
  const catalog = JSON.parse(capturedBytes.get(PACK_CATALOG_PATH).toString("utf8"));
  const identityKey = ({ profile_id, profile_version }) => JSON.stringify([profile_id, profile_version]);
  const admitted = new Set(catalog.packs.map(identityKey));
  const provenance = new Map();
  const duplicates = [];
  const mismatched = [];
  for (const { provenance: row } of document.discovery.population) {
    const key = identityKey(row);
    if (provenance.has(key)) duplicates.push(row);
    else provenance.set(key, row);
    if (!admitted.has(key)) mismatched.push(row);
  }
  const missing = catalog.packs.filter(row => !provenance.has(identityKey(row)));
  for (const [reason, identities, cause] of [
    ["duplicate", duplicates, "Multiple provenance rows identify the same profile id and version."],
    ["mismatched", mismatched, "The provenance identity is outside the captured admitted catalogue."],
    ["missing", missing, "The captured admitted catalogue identity has no provenance row."]
  ]) {
    if (identities.length === 0) continue;
    const { profile_id, profile_version } = identities.sort((left, right) =>
      compareCodeUnits(left.profile_id, right.profile_id) ||
      compareCodeUnits(left.profile_version, right.profile_version))[0];
    throw staleMetadata({
      reason: `selection_provenance_${reason}`,
      profile_id, profile_version, failure_limb: "mechanical_failure", cause,
      recovery: {
        package_maintainer: `Rebuild with ${PROOF_INTENT_METADATA_BUILD_COMMAND} in the writing repository.`,
        installed_consumer: "Install or reinstall a corrected package."
      }
    });
  }
  return deepFreeze(catalog.packs.map(entry => {
    const row = provenance.get(identityKey(entry));
    return {
      profile: JSON.parse(capturedBytes.get(`${entry.path}/profile.json`).toString("utf8")),
      admission: JSON.parse(capturedBytes.get(`${entry.path}/admission.json`).toString("utf8")),
      profile_digest: row.profile_digest,
      admission_digest: row.admission_digest
    };
  }));
}

export function readPackagedProofIntentMetadata() {
  return capturePackagedProofIntentMetadata().document;
}
