export const SIDECAR_SCHEMA_VERSION = "repo-code-index.v1";
export const SIDECAR_ARTIFACT_SCHEMA_VERSION = SIDECAR_SCHEMA_VERSION;
export const SIDECAR_RESULT_SCHEMA_FIELD = "schema_version";
export const SIDECAR_ARTIFACT_SCHEMA_FIELD = "artifact_schema_version";

export const SIDECAR_DIRTY_STATE_VALUES = Object.freeze([
  "clean",
  "dirty_worktree",
  "non_git",
  "unsupported",
  "unknown"
]);

export const SIDECAR_STALENESS_VALUES = Object.freeze([
  "missing",
  "fresh",
  "stale",
  "rebuild_required",
  "unknown"
]);

export const SIDECAR_SOURCE_KIND_VALUES = Object.freeze([
  "canonical_docs",
  "canonical_wiki",
  "issue",
  "decision",
  "area",
  "code_index",
  "git_history",
  "parser_symbol",
  "scip",
  "test_adjacency"
]);

export const SIDECAR_CANONICALITY_VALUES = Object.freeze([
  "canonical",
  "derived",
  "generated",
  "external",
  "unknown"
]);

export const SIDECAR_EVIDENCE_BASIS_VALUES = Object.freeze([
  "explicit_metadata",
  "path_match",
  "docs_backlink",
  "git_blob",
  "git_tree",
  "cochange",
  "lexical_match",
  "parser_extract",
  "parser_symbol",
  "scip",
  "inferred_test_adjacency",
  "unknown"
]);

export const SIDECAR_DIRTY_DETAIL_FIELDS = Object.freeze([
  "staged",
  "unstaged",
  "deleted_tracked",
  "untracked",
  "submodule_changes",
  "detached_head"
]);

export const SIDECAR_ENVELOPE_REQUIRED_FIELDS = Object.freeze([
  SIDECAR_RESULT_SCHEMA_FIELD,
  "source_kind",
  "canonicality",
  "evidence_basis",
  "index_head",
  "index_tree",
  "dirty_state",
  "dirty_details",
  "staleness",
  "canonical_refs",
  "derived_evidence"
]);

export const SIDECAR_RESULT_ITEM_REQUIRED_FIELDS = Object.freeze(["provenance"]);
export const SIDECAR_PROVENANCE_REQUIRED_FIELDS = Object.freeze([
  "source_kind",
  "canonicality",
  "evidence_basis"
]);

const enumFields = Object.freeze({
  source_kind: SIDECAR_SOURCE_KIND_VALUES,
  canonicality: SIDECAR_CANONICALITY_VALUES,
  evidence_basis: SIDECAR_EVIDENCE_BASIS_VALUES,
  dirty_state: SIDECAR_DIRTY_STATE_VALUES,
  staleness: SIDECAR_STALENESS_VALUES
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validateEnumValue(errors, object, field, values, path) {
  if (!values.includes(object[field])) {
    errors.push(`${path}.${field} must be one of: ${values.join(", ")}`);
  }
}

function validateProvenance(errors, provenance, path) {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    errors.push(`${path} must be an object`);
    return;
  }

  for (const field of SIDECAR_PROVENANCE_REQUIRED_FIELDS) {
    if (!hasOwn(provenance, field)) {
      errors.push(`${path}.${field} is required`);
    }
  }

  for (const [field, values] of Object.entries(enumFields)) {
    if (hasOwn(provenance, field)) {
      validateEnumValue(errors, provenance, field, values, path);
    }
  }
}

function validateResultItems(errors, items, fieldName) {
  if (!Array.isArray(items)) {
    errors.push(`${fieldName} must be an array`);
    return;
  }

  items.forEach((item, index) => {
    const path = `${fieldName}[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${path} must be an object`);
      return;
    }

    for (const field of SIDECAR_RESULT_ITEM_REQUIRED_FIELDS) {
      if (!hasOwn(item, field)) {
        errors.push(`${path}.${field} is required`);
      }
    }

    if (hasOwn(item, "provenance")) {
      validateProvenance(errors, item.provenance, `${path}.provenance`);
    }
  });
}

export function createSidecarDirtyDetails(overrides = {}) {
  return {
    staged: 0,
    unstaged: 0,
    deleted_tracked: 0,
    untracked: 0,
    submodule_changes: 0,
    detached_head: false,
    ...overrides
  };
}

export function isSupportedSidecarSchemaVersion(schemaVersion) {
  return schemaVersion === SIDECAR_SCHEMA_VERSION;
}

export function isSupportedSidecarArtifactSchema(metadata) {
  return metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] === SIDECAR_ARTIFACT_SCHEMA_VERSION;
}

export function classifySidecarArtifactSchema(metadata) {
  if (metadata == null) {
    return {
      compatible: false,
      staleness: "missing",
      reason: "artifact_missing"
    };
  }

  if (isSupportedSidecarArtifactSchema(metadata)) {
    return {
      compatible: true,
      staleness: "unknown",
      reason: "schema_compatible"
    };
  }

  return {
    compatible: false,
    staleness: "rebuild_required",
    reason: "schema_incompatible"
  };
}

export function createSidecarResultEnvelope(overrides = {}) {
  const dirtyDetails = createSidecarDirtyDetails(overrides.dirty_details);
  return {
    [SIDECAR_RESULT_SCHEMA_FIELD]: SIDECAR_SCHEMA_VERSION,
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "unknown",
    index_head: null,
    index_tree: null,
    dirty_state: "unknown",
    dirty_details: dirtyDetails,
    staleness: "unknown",
    canonical_refs: [],
    derived_evidence: [],
    ...overrides,
    dirty_details: dirtyDetails
  };
}

export function validateSidecarResultEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return ["envelope must be an object"];
  }

  for (const field of SIDECAR_ENVELOPE_REQUIRED_FIELDS) {
    if (!hasOwn(envelope, field)) {
      errors.push(`${field} is required`);
    }
  }

  if (
    hasOwn(envelope, SIDECAR_RESULT_SCHEMA_FIELD) &&
    !isSupportedSidecarSchemaVersion(envelope[SIDECAR_RESULT_SCHEMA_FIELD])
  ) {
    errors.push(`${SIDECAR_RESULT_SCHEMA_FIELD} must be ${SIDECAR_SCHEMA_VERSION}`);
  }

  for (const [field, values] of Object.entries(enumFields)) {
    if (hasOwn(envelope, field)) {
      validateEnumValue(errors, envelope, field, values, "envelope");
    }
  }

  if (hasOwn(envelope, "dirty_details")) {
    const details = envelope.dirty_details;
    if (!details || typeof details !== "object" || Array.isArray(details)) {
      errors.push("dirty_details must be an object");
    } else {
      for (const field of SIDECAR_DIRTY_DETAIL_FIELDS) {
        if (!hasOwn(details, field)) {
          errors.push(`dirty_details.${field} is required`);
        }
      }
    }
  }

  if (hasOwn(envelope, "canonical_refs")) {
    validateResultItems(errors, envelope.canonical_refs, "canonical_refs");
  }
  if (hasOwn(envelope, "derived_evidence")) {
    validateResultItems(errors, envelope.derived_evidence, "derived_evidence");
  }

  return errors;
}

export function assertValidSidecarResultEnvelope(envelope) {
  const errors = validateSidecarResultEnvelope(envelope);
  if (errors.length > 0) {
    throw new Error(`Invalid sidecar result envelope:\n- ${errors.join("\n- ")}`);
  }
  return envelope;
}

function makeFixture({
  dirtyState,
  staleness,
  dirtyDetails = {},
  artifactSchemaVersion = SIDECAR_ARTIFACT_SCHEMA_VERSION
}) {
  return createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "git_tree",
    index_head: "0000000000000000000000000000000000000000",
    index_tree: "1111111111111111111111111111111111111111",
    dirty_state: dirtyState,
    dirty_details: createSidecarDirtyDetails(dirtyDetails),
    staleness,
    artifact_schema_version: artifactSchemaVersion,
    canonical_refs: [
      {
        id: "WK-0034",
        path: "wiki/issues/WK-0034.md",
        provenance: {
          source_kind: "issue",
          canonicality: "canonical",
          evidence_basis: "explicit_metadata"
        }
      }
    ],
    derived_evidence: [
      {
        kind: "index_state",
        path: ".cache/repo-code-index/index.json",
        provenance: {
          source_kind: "code_index",
          canonicality: "derived",
          evidence_basis: "git_tree"
        }
      }
    ]
  });
}

const cleanDetails = createSidecarDirtyDetails();
const dirtyDetails = createSidecarDirtyDetails({ staged: 1, untracked: 1 });

export const SIDECAR_TRUST_ENVELOPE_FIXTURES = deepFreeze({
  missing: makeFixture({
    dirtyState: "clean",
    staleness: "missing",
    dirtyDetails: cleanDetails
  }),
  fresh: makeFixture({
    dirtyState: "clean",
    staleness: "fresh",
    dirtyDetails: cleanDetails
  }),
  stale: makeFixture({
    dirtyState: "clean",
    staleness: "stale",
    dirtyDetails: cleanDetails
  }),
  dirty: makeFixture({
    dirtyState: "dirty_worktree",
    staleness: "unknown",
    dirtyDetails
  }),
  unknown: makeFixture({
    dirtyState: "unknown",
    staleness: "unknown",
    dirtyDetails: cleanDetails
  }),
  schema_incompatible: makeFixture({
    dirtyState: "clean",
    staleness: "rebuild_required",
    dirtyDetails: cleanDetails,
    artifactSchemaVersion: "repo-code-index.v0"
  }),
  dirty_missing: makeFixture({
    dirtyState: "dirty_worktree",
    staleness: "missing",
    dirtyDetails
  }),
  dirty_fresh: makeFixture({
    dirtyState: "dirty_worktree",
    staleness: "fresh",
    dirtyDetails
  }),
  dirty_stale: makeFixture({
    dirtyState: "dirty_worktree",
    staleness: "stale",
    dirtyDetails
  }),
  dirty_schema_incompatible: makeFixture({
    dirtyState: "dirty_worktree",
    staleness: "rebuild_required",
    dirtyDetails,
    artifactSchemaVersion: "repo-code-index.v0"
  })
});

export function cloneSidecarTrustEnvelopeFixture(name) {
  const fixture = SIDECAR_TRUST_ENVELOPE_FIXTURES[name];
  if (!fixture) {
    throw new Error(`Unknown sidecar trust envelope fixture: ${name}`);
  }
  return cloneJson(fixture);
}
