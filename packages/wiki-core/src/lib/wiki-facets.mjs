

import path from "node:path";
import { GENERATED_VIEW_NAMES, normalizeStringList } from "./wiki-shared.mjs";

export function getSharedTopics(manifest) {
  return normalizeStringList(manifest.retrieval?.sharedTopics || []);
}

export function defaultDocsInferencePaths(profile, manifest) {
  const durablePath = String(manifest.profiles[profile]?.durableKnowledgeLayer?.path || "");
  if (durablePath.replace(/\/$/, "") !== "docs") {
    return [];
  }

  if (!manifest.profiles[profile]?.durableKnowledgeLayer?.required) {
    return [];
  }

  return [
    {
      glob: "docs/**/*.md",
      defaults: {
        canonicality: "canonical",
        maintenance_mode: "curated"
      }
    }
  ];
}

export function normalizeTopicVocabulary(vocab, manifest) {
  const shared = getSharedTopics(manifest);
  const local = normalizeStringList(vocab?.topics?.local || [], { slug: true }).filter(
    (topic) => !shared.includes(topic)
  );

  return {
    topics: {
      shared,
      local
    }
  };
}

export function normalizeInferenceConfig(inference, profile, manifest) {
  const supportedGlobs = new Set(manifest.retrieval?.supportedInferencePathGlobs || []);
  const normalizedPaths = [];
  const paths = Array.isArray(inference?.paths) ? inference.paths : [];

  for (const entry of paths) {
    const glob = String(entry?.glob || "").trim();
    if (!supportedGlobs.has(glob)) {
      continue;
    }

    const defaults = entry?.defaults && typeof entry.defaults === "object" ? entry.defaults : {};
    const normalizedEntry = {
      glob,
      defaults: {}
    };

    for (const key of ["canonicality", "maintenance_mode", "knowledge_role"]) {
      if (defaults[key]) {
        normalizedEntry.defaults[key] = String(defaults[key]).toLowerCase();
      }
    }

    if (defaults.retrieval_role) {
      normalizedEntry.defaults.retrieval_role = normalizeFacetList(
        defaults.retrieval_role,
        { slug: false }
      );
    }

    normalizedPaths.push(normalizedEntry);
  }

  for (const defaultEntry of defaultDocsInferencePaths(profile, manifest)) {
    if (!normalizedPaths.some((entry) => entry.glob === defaultEntry.glob)) {
      normalizedPaths.push(defaultEntry);
    }
  }

  return {
    paths: normalizedPaths.sort((left, right) => left.glob.localeCompare(right.glob))
  };
}

export function normalizeFacetList(values, { slug = false } = {}) {
  return normalizeStringList(values, { slug, sort: false });
}

export function validateRetrievalRoleValues(values, manifest) {
  const roles = normalizeFacetList(values);
  const facet = manifest.retrieval?.facets?.retrieval_role || {};
  const allowedValues = new Set(facet.values || []);
  const maxValues = Number(facet.maxValues || 1);
  const allowedCombinations = new Set(
    (facet.allowedCombinations || []).map((entry) =>
      normalizeFacetList(entry).sort((left, right) => left.localeCompare(right)).join("+")
    )
  );

  if (roles.length === 0) {
    return "no roles provided";
  }
  if (roles.length > maxValues) {
    return `expected at most ${maxValues} roles, received ${roles.length}`;
  }
  for (const role of roles) {
    if (!allowedValues.has(role)) {
      return `unsupported role '${role}'`;
    }
  }
  if (roles.length > 1 && !allowedCombinations.has([...roles].sort().join("+"))) {
    return `unsupported role combination '${roles.join("+")}'`;
  }
  return null;
}

export function inferPageFacets(page, { manifest, metadata }) {
  const relativePath = String(page.relativePath || "");
  const defaults = {
    retrieval_visibility: manifest.retrieval?.facets?.retrieval_visibility?.default || "default",
    lifecycle: manifest.retrieval?.facets?.lifecycle?.default || "active",
    sensitivity: manifest.retrieval?.facets?.sensitivity?.default || "normal"
  };

  if (relativePath === "wiki/catalog.md") {
    return {
      ...defaults,
      retrieval_role: ["entrypoint", "inventory"],
      canonicality: "noncanonical",
      maintenance_mode: "generated"
    };
  }

  if (GENERATED_VIEW_NAMES.has(path.basename(relativePath))) {
    return {
      ...defaults,
      retrieval_role: ["inventory"],
      canonicality: "noncanonical",
      maintenance_mode: "generated",
      knowledge_role: "work"
    };
  }

  if (relativePath.startsWith("wiki/sources/")) {
    return {
      ...defaults,
      retrieval_role: ["record"],
      canonicality: "canonical",
      knowledge_role: "evidence"
    };
  }

  if (relativePath.startsWith("wiki/decisions/")) {
    return {
      ...defaults,
      retrieval_role: ["record"],
      canonicality: "canonical",
      knowledge_role: "decision"
    };
  }

  if (relativePath.startsWith("wiki/issues/")) {
    return {
      ...defaults,
      retrieval_role: ["record"],
      canonicality: "canonical",
      maintenance_mode: "operational",
      knowledge_role: "work"
    };
  }

  if (relativePath.startsWith("wiki/initiatives/")) {
    return {
      ...defaults,
      retrieval_role: ["record"],
      canonicality: "canonical",
      maintenance_mode: "operational",
      knowledge_role: "work"
    };
  }

  if (relativePath.startsWith("wiki/areas/")) {
    return {
      ...defaults,
      retrieval_role: ["hub"],
      canonicality: "canonical",
      knowledge_role: "synthesis"
    };
  }

  for (const entry of metadata?.inference?.paths || []) {
    if (matchesSupportedInferencePath(relativePath, entry.glob)) {
      return {
        ...defaults,
        ...entry.defaults
      };
    }
  }

  return defaults;
}

export function extractExplicitRetrievalFacets(frontmatter = {}) {
  const facets = {};
  if (frontmatter.retrieval_role != null) {
    facets.retrieval_role = normalizeFacetList(frontmatter.retrieval_role);
  }
  for (const key of [
    "canonicality",
    "maintenance_mode",
    "knowledge_role",
    "evidence_stage",
    "retrieval_visibility",
    "lifecycle",
    "sensitivity"
  ]) {
    if (frontmatter[key] != null && frontmatter[key] !== "") {
      facets[key] = String(frontmatter[key]).toLowerCase();
    }
  }
  if (frontmatter.topics != null) {
    facets.topics = normalizeFacetList(frontmatter.topics, { slug: true });
  }
  return facets;
}

export function resolvePageFacets(page, context) {
  const inferred = inferPageFacets(page, context);
  const explicit = extractExplicitRetrievalFacets(page.frontmatter || {});
  return {
    inferred,
    explicit,
    effective: {
      ...inferred,
      ...explicit
    }
  };
}

export function matchesSupportedInferencePath(relativePath, glob) {
  if (glob === "docs/**/*.md") {
    return relativePath.startsWith("docs/") && relativePath.endsWith(".md");
  }
  return false;
}
