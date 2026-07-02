

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { loadManifest } from "./contract.mjs";
import {
  DEFAULT_PROFILE,
  normalizeExtensionNamespaces,
  normalizeStringList,
  pathExists,
  resolveProfileName
} from "./wiki-shared.mjs";
import {
  defaultDocsInferencePaths,
  getSharedTopics,
  normalizeFacetList,
  normalizeInferenceConfig,
  normalizeTopicVocabulary,
  validateRetrievalRoleValues
} from "./wiki-facets.mjs";

export async function writeContractMetadata(
  targetDir,
  manifest,
  {
    repo,
    profile = DEFAULT_PROFILE,
    extensionNamespaces = []
  } = {}
) {
  const resolvedProfile = resolveProfileName(profile, manifest);
  const metadataPath = path.join(targetDir, "wiki", ".wiki-contract.json");
  const existing = await readContractMetadata(targetDir);
  const metadata = {
    repo: repo || null,
    profile: resolvedProfile,
    extensionNamespaces: normalizeExtensionNamespaces(extensionNamespaces),
    contractVersion: manifest.contractVersion,
    syncedAt: new Date().toISOString(),
    sourceRepo: "agent-chassis/agent-chassis",
    retrievalEntrypoint: manifest.retrievalEntrypoint,
    vocab: normalizeTopicVocabulary(existing?.vocab, manifest),
    inference: normalizeInferenceConfig(existing?.inference, resolvedProfile, manifest)
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return { metadataPath, metadata };
}

export async function readContractMetadata(targetDir) {
  const metadataPath = path.join(targetDir, "wiki", ".wiki-contract.json");
  if (!(await pathExists(metadataPath))) {
    return null;
  }
  const raw = await readFile(metadataPath, "utf8");
  return JSON.parse(raw);
}

export function validateContractMetadataShape(metadata, manifest, profile) {
  const problems = [];
  if (!metadata) {
    return problems;
  }

  const expectedSharedTopics = getSharedTopics(manifest);
  const actualSharedTopics = normalizeStringList(metadata?.vocab?.topics?.shared || []);
  const actualLocalTopics = normalizeStringList(metadata?.vocab?.topics?.local || [], {
    slug: true
  });

  if (JSON.stringify(actualSharedTopics) !== JSON.stringify(expectedSharedTopics)) {
    problems.push(
      `Contract metadata mismatch for 'vocab.topics.shared': local=${JSON.stringify(actualSharedTopics)} expected=${JSON.stringify(expectedSharedTopics)}`
    );
  }

  for (const topic of actualLocalTopics) {
    if (expectedSharedTopics.includes(topic)) {
      problems.push(`Local topic duplicates shared topic: ${topic}`);
    }
  }

  const supportedGlobs = new Set(manifest.retrieval?.supportedInferencePathGlobs || []);
  const paths = Array.isArray(metadata?.inference?.paths) ? metadata.inference.paths : [];
  for (const entry of paths) {
    const glob = String(entry?.glob || "").trim();
    if (!supportedGlobs.has(glob)) {
      problems.push(`Unsupported inference path glob in contract metadata: ${glob || "(empty)"}`);
      continue;
    }

    const defaults = entry?.defaults;
    if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
      problems.push(`Inference path '${glob}' must define an object 'defaults'`);
      continue;
    }

    for (const [key, value] of Object.entries(defaults)) {
      if (key === "retrieval_role") {
        const roles = normalizeFacetList(value);
        if (roles.length === 0) {
          problems.push(`Inference path '${glob}' has empty retrieval_role default`);
          continue;
        }
        const comboError = validateRetrievalRoleValues(roles, manifest);
        if (comboError) {
          problems.push(`Inference path '${glob}' has invalid retrieval_role default: ${comboError}`);
        }
        continue;
      }

      const allowedValues = manifest.retrieval?.facets?.[key]?.values;
      if (!allowedValues) {
        problems.push(`Inference path '${glob}' uses unsupported default field '${key}'`);
        continue;
      }
      if (!allowedValues.includes(String(value).toLowerCase())) {
        problems.push(
          `Inference path '${glob}' has unsupported value for '${key}': ${JSON.stringify(value)}`
        );
      }
    }
  }

  const requiredDocsDefaults = defaultDocsInferencePaths(profile, manifest);
  for (const entry of requiredDocsDefaults) {
    if (!paths.some((candidate) => String(candidate?.glob || "") === entry.glob)) {
      problems.push(`Missing required inference path default in contract metadata: ${entry.glob}`);
    }
  }

  return problems;
}

export async function resolveContractContext(
  targetDir,
  { profile = null, extensionNamespaces = null, repo = null } = {}
) {
  const manifest = await loadManifest();
  const rawMetadata = await readContractMetadata(targetDir);
  const resolvedProfile = resolveProfileName(
    profile || rawMetadata?.profile || DEFAULT_PROFILE,
    manifest
  );
  const resolvedExtensions = normalizeExtensionNamespaces(
    extensionNamespaces ?? rawMetadata?.extensionNamespaces ?? []
  );
  const metadata = rawMetadata
    ? {
        ...rawMetadata,
        vocab: normalizeTopicVocabulary(rawMetadata?.vocab, manifest),
        inference: normalizeInferenceConfig(rawMetadata?.inference, resolvedProfile, manifest)
      }
    : null;

  return {
    manifest,
    rawMetadata,
    metadata,
    profile: resolvedProfile,
    extensionNamespaces: resolvedExtensions,
    repo: repo || metadata?.repo || null
  };
}

export function buildExpectedMetadata(
  manifest,
  {
    repo = null,
    profile = DEFAULT_PROFILE,
    extensionNamespaces = []
  } = {}
) {
  return {
    repo: repo || null,
    profile: resolveProfileName(profile, manifest),
    extensionNamespaces: normalizeExtensionNamespaces(extensionNamespaces),
    contractVersion: manifest.contractVersion,
    sourceRepo: "agent-chassis/agent-chassis",
    retrievalEntrypoint: manifest.retrievalEntrypoint
  };
}

export function compareContractMetadata(actual, expected) {
  const problems = [];
  if (!actual) {
    problems.push("Missing local contract metadata: wiki/.wiki-contract.json");
    return problems;
  }

  for (const key of Object.keys(expected)) {
    const actualValue = Array.isArray(actual[key])
      ? [...actual[key]].sort()
      : actual[key];
    const expectedValue = Array.isArray(expected[key])
      ? [...expected[key]].sort()
      : expected[key];
    if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
      problems.push(
        `Contract metadata mismatch for '${key}': local=${JSON.stringify(actualValue)} expected=${JSON.stringify(expectedValue)}`
      );
    }
  }

  return problems;
}
