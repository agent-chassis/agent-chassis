export const SIDECAR_GRAPH_SCHEMA_VERSION = "repo-code-graph.v1";
export const SIDECAR_GRAPH_SCHEMA_FIELD = "graph_schema_version";
export const SIDECAR_GRAPH_SECTION_FIELD = "graph";
export const SIDECAR_GRAPH_GENERATOR_IDENTITY_FIELD = "generator_identity";

const SIDECAR_GRAPH_GENERATOR_IDENTITY_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const SIDECAR_GRAPH_NODE_KIND_VALUES = Object.freeze([
  "file",
  "module",
  "export",
  "import",
  "function",
  "cli_command",
  "mcp_tool",
  "schema_field",
  "docs_contract",
  "test",
  "work_item",
  "symbol"
]);

export const SIDECAR_GRAPH_EDGE_KIND_VALUES = Object.freeze([
  "contains",
  "defines_export",
  "imports_module",
  "registers_cli_command",
  "registers_mcp_tool",
  "mentions_schema_field",
  "covers_test",
  "documents_contract",
  "owns_write_scope",
  "defines_symbol",
  "references_symbol",
  "calls_symbol"
]);

export const SIDECAR_GRAPH_EDGE_SOURCE_VALUES = Object.freeze([
  "base_index",
  "dirty_overlay",
  "unavailable"
]);

export const SIDECAR_GRAPH_PROVENANCE_SOURCE_KIND_VALUES = Object.freeze([
  "code_index",
  "parser_symbol",
  "scip"
]);

export const SIDECAR_GRAPH_PROVENANCE_CANONICALITY_VALUES = Object.freeze(["derived"]);

export const SIDECAR_GRAPH_PROVENANCE_EVIDENCE_BASIS_VALUES = Object.freeze([
  "explicit_metadata",
  "path_match",
  "docs_backlink",
  "git_blob",
  "git_tree",
  "parser_extract",
  "parser_symbol",
  "scip"
]);

export const SIDECAR_GRAPH_PARSER_SYMBOL_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS = Object.freeze([
  "name",
  "runtime",
  "runtime_version",
  "grammar",
  "grammar_version"
]);

export const SIDECAR_GRAPH_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS =
  SIDECAR_GRAPH_PARSER_SYMBOL_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS;

export const SIDECAR_GRAPH_SCIP_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS = Object.freeze([
  "name",
  "version",
  "scip_protocol_version"
]);

export const SIDECAR_GRAPH_PROVIDER_DESCRIPTOR_STRING_FIELDS = Object.freeze([
  ...new Set([
    ...SIDECAR_GRAPH_PARSER_SYMBOL_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS,
    ...SIDECAR_GRAPH_SCIP_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS,
    "cache_key"
  ])
]);

export const SIDECAR_GRAPH_RESOLUTION_STATE_VALUES = Object.freeze([
  "resolved",
  "unresolved",
  "dynamic",
  "unsupported_language"
]);

export const SIDECAR_DIRTY_GRAPH_MODE_VALUES = Object.freeze([
  "overlay_parsed",
  "base_index_only",
  "unavailable"
]);

export const SIDECAR_GRAPH_STATE_REQUIRED_FIELDS = Object.freeze([
  SIDECAR_GRAPH_SCHEMA_FIELD,
  "graph_available",
  "edge_source",
  "dirty_graph_mode",
  "unavailable_paths"
]);

export const SIDECAR_GRAPH_NODE_REQUIRED_FIELDS = Object.freeze([
  "id",
  "kind",
  "provenance"
]);

export const SIDECAR_GRAPH_EDGE_REQUIRED_FIELDS = Object.freeze([
  "id",
  "kind",
  "from_node_id",
  "to_node_id",
  "provenance"
]);

export const SIDECAR_STRUCTURAL_IMPACT_REQUIRED_FIELDS = Object.freeze([
  "kind",
  "input_path",
  "node_ids",
  "edge_ids",
  "severity",
  "reason",
  "provenance"
]);

export const SIDECAR_MISSING_UPDATE_HINT_REQUIRED_FIELDS = Object.freeze([
  "kind",
  "input_path",
  "missing_surface",
  "reason",
  "suggested_paths",
  "provenance"
]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateRequiredFields(errors, object, fields, path) {
  for (const field of fields) {
    if (!hasOwn(object, field)) {
      errors.push(`${path}.${field} is required`);
    }
  }
}

function validateEnumValue(errors, object, field, values, path) {
  if (hasOwn(object, field) && !values.includes(object[field])) {
    errors.push(`${path}.${field} must be one of: ${values.join(", ")}`);
  }
}

function validateStringField(errors, object, field, path) {
  if (hasOwn(object, field) && typeof object[field] !== "string") {
    errors.push(`${path}.${field} must be a string`);
  }
}

function validateBooleanField(errors, object, field, path) {
  if (hasOwn(object, field) && typeof object[field] !== "boolean") {
    errors.push(`${path}.${field} must be a boolean`);
  }
}

function providerDescriptorRequiredFieldsForEvidenceBasis(evidenceBasis) {
  if (evidenceBasis === "scip") {
    return SIDECAR_GRAPH_SCIP_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS;
  }
  return SIDECAR_GRAPH_PARSER_SYMBOL_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS;
}

function validateProviderDescriptor(errors, descriptor, path, evidenceBasis) {
  if (!isPlainObject(descriptor)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const requiredFields = providerDescriptorRequiredFieldsForEvidenceBasis(evidenceBasis);
  validateRequiredFields(
    errors,
    descriptor,
    requiredFields,
    path
  );
  for (const field of SIDECAR_GRAPH_PROVIDER_DESCRIPTOR_STRING_FIELDS) {
    validateStringField(errors, descriptor, field, path);
  }
}

function validateGraphProvenance(errors, provenance, path) {
  if (!isPlainObject(provenance)) {
    errors.push(`${path} must be an object`);
    return;
  }

  validateEnumValue(
    errors,
    provenance,
    "source_kind",
    SIDECAR_GRAPH_PROVENANCE_SOURCE_KIND_VALUES,
    path
  );
  validateEnumValue(
    errors,
    provenance,
    "canonicality",
    SIDECAR_GRAPH_PROVENANCE_CANONICALITY_VALUES,
    path
  );
  validateEnumValue(
    errors,
    provenance,
    "evidence_basis",
    SIDECAR_GRAPH_PROVENANCE_EVIDENCE_BASIS_VALUES,
    path
  );
}

function validateConfidence(errors, confidence, path) {
  if (!isPlainObject(confidence)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (
    hasOwn(confidence, "value") &&
    (typeof confidence.value !== "number" || confidence.value < 0 || confidence.value > 1)
  ) {
    errors.push(`${path}.value must be a number between 0 and 1`);
  }
  validateStringField(errors, confidence, "basis", path);
}

function validateUncertainty(errors, uncertainty, path) {
  if (!isPlainObject(uncertainty)) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateStringField(errors, uncertainty, "level", path);
  if (hasOwn(uncertainty, "reasons") && !Array.isArray(uncertainty.reasons)) {
    errors.push(`${path}.reasons must be an array`);
  }
}

function validateCoverage(errors, coverage, path) {
  if (!isPlainObject(coverage)) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateStringField(errors, coverage, "language", path);
  validateStringField(errors, coverage, "status", path);
  if (hasOwn(coverage, "constructs") && !Array.isArray(coverage.constructs)) {
    errors.push(`${path}.constructs must be an array`);
  }
}

function validateResolution(errors, resolution, path) {
  if (!isPlainObject(resolution)) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateEnumValue(errors, resolution, "state", SIDECAR_GRAPH_RESOLUTION_STATE_VALUES, path);
  validateBooleanField(errors, resolution, "dynamic_boundary", path);
  validateStringField(errors, resolution, "unresolved_reason", path);
}

function validateProviderAwareGraphItem(errors, item, path) {
  if (hasOwn(item, "provenance")) {
    validateGraphProvenance(errors, item.provenance, `${path}.provenance`);
  }
  if (hasOwn(item, "provider_descriptor")) {
    validateProviderDescriptor(
      errors,
      item.provider_descriptor,
      `${path}.provider_descriptor`,
      item.provenance?.evidence_basis
    );
  }
  if (hasOwn(item, "coverage")) {
    validateCoverage(errors, item.coverage, `${path}.coverage`);
  }
  if (hasOwn(item, "confidence")) {
    validateConfidence(errors, item.confidence, `${path}.confidence`);
  }
  if (hasOwn(item, "uncertainty")) {
    validateUncertainty(errors, item.uncertainty, `${path}.uncertainty`);
  }
  if (hasOwn(item, "resolution")) {
    validateResolution(errors, item.resolution, `${path}.resolution`);
  }

  if (item.provenance?.evidence_basis === "parser_symbol" && !hasOwn(item, "provider_descriptor")) {
    errors.push(`${path}.provider_descriptor is required for parser_symbol evidence`);
  }
  if (item.provenance?.evidence_basis === "scip" && !hasOwn(item, "provider_descriptor")) {
    errors.push(`${path}.provider_descriptor is required for scip evidence`);
  }
}

function validateGraphItems(errors, items, { fieldName, requiredFields, kindValues }) {
  if (!Array.isArray(items)) {
    errors.push(`${fieldName} must be an array`);
    return;
  }

  items.forEach((item, index) => {
    const path = `${fieldName}[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }

    validateRequiredFields(errors, item, requiredFields, path);
    validateEnumValue(errors, item, "kind", kindValues, path);
    validateProviderAwareGraphItem(errors, item, path);
  });
}

export function isSupportedSidecarGraphSchemaVersion(schemaVersion) {
  return schemaVersion === SIDECAR_GRAPH_SCHEMA_VERSION;
}

export function createSidecarGraphState(overrides = {}) {
  return {
    [SIDECAR_GRAPH_SCHEMA_FIELD]: null,
    graph_available: false,
    edge_source: "unavailable",
    dirty_graph_mode: "unavailable",
    unavailable_paths: [],
    status_reason: "graph_absent",
    ...overrides
  };
}

export function validateSidecarGraphState(graphState) {
  const errors = [];
  if (!isPlainObject(graphState)) {
    return ["graph_state must be an object"];
  }

  validateRequiredFields(
    errors,
    graphState,
    SIDECAR_GRAPH_STATE_REQUIRED_FIELDS,
    "graph_state"
  );
  validateEnumValue(
    errors,
    graphState,
    "edge_source",
    SIDECAR_GRAPH_EDGE_SOURCE_VALUES,
    "graph_state"
  );
  validateEnumValue(
    errors,
    graphState,
    "dirty_graph_mode",
    SIDECAR_DIRTY_GRAPH_MODE_VALUES,
    "graph_state"
  );

  if (
    hasOwn(graphState, "graph_available") &&
    typeof graphState.graph_available !== "boolean"
  ) {
    errors.push("graph_state.graph_available must be a boolean");
  }
  if (hasOwn(graphState, "unavailable_paths") && !Array.isArray(graphState.unavailable_paths)) {
    errors.push("graph_state.unavailable_paths must be an array");
  }
  if (
    graphState[SIDECAR_GRAPH_SCHEMA_FIELD] != null &&
    !isSupportedSidecarGraphSchemaVersion(graphState[SIDECAR_GRAPH_SCHEMA_FIELD])
  ) {
    errors.push(
      `graph_state.${SIDECAR_GRAPH_SCHEMA_FIELD} must be ${SIDECAR_GRAPH_SCHEMA_VERSION}`
    );
  }

  return errors;
}

export function validateSidecarGraphSection(graph, { expectedGeneratorIdentity } = {}) {
  const errors = [];
  if (!isPlainObject(graph)) {
    return [`${SIDECAR_GRAPH_SECTION_FIELD} must be an object`];
  }

  if (!hasOwn(graph, SIDECAR_GRAPH_SCHEMA_FIELD)) {
    errors.push(`${SIDECAR_GRAPH_SECTION_FIELD}.${SIDECAR_GRAPH_SCHEMA_FIELD} is required`);
  } else if (!isSupportedSidecarGraphSchemaVersion(graph[SIDECAR_GRAPH_SCHEMA_FIELD])) {
    errors.push(
      `${SIDECAR_GRAPH_SECTION_FIELD}.${SIDECAR_GRAPH_SCHEMA_FIELD} must be ${SIDECAR_GRAPH_SCHEMA_VERSION}`
    );
  }

  const generatorIdentity = graph[SIDECAR_GRAPH_GENERATOR_IDENTITY_FIELD];
  if (generatorIdentity === undefined && expectedGeneratorIdentity !== undefined) {
    errors.push(
      `${SIDECAR_GRAPH_SECTION_FIELD}.${SIDECAR_GRAPH_GENERATOR_IDENTITY_FIELD} is required`
    );
  } else if (generatorIdentity !== undefined && (
    typeof generatorIdentity !== "string" ||
    !SIDECAR_GRAPH_GENERATOR_IDENTITY_PATTERN.test(generatorIdentity)
  )) {
    errors.push(
      `${SIDECAR_GRAPH_SECTION_FIELD}.${SIDECAR_GRAPH_GENERATOR_IDENTITY_FIELD} must be a sha256 identity`
    );
  } else if (
    expectedGeneratorIdentity !== undefined &&
    generatorIdentity !== expectedGeneratorIdentity
  ) {
    errors.push(
      `${SIDECAR_GRAPH_SECTION_FIELD}.${SIDECAR_GRAPH_GENERATOR_IDENTITY_FIELD} must match the committed generator identity`
    );
  }

  if (hasOwn(graph, "graph_nodes")) {
    validateGraphItems(errors, graph.graph_nodes, {
      fieldName: `${SIDECAR_GRAPH_SECTION_FIELD}.graph_nodes`,
      requiredFields: SIDECAR_GRAPH_NODE_REQUIRED_FIELDS,
      kindValues: SIDECAR_GRAPH_NODE_KIND_VALUES
    });
  }
  if (hasOwn(graph, "graph_edges")) {
    validateGraphItems(errors, graph.graph_edges, {
      fieldName: `${SIDECAR_GRAPH_SECTION_FIELD}.graph_edges`,
      requiredFields: SIDECAR_GRAPH_EDGE_REQUIRED_FIELDS,
      kindValues: SIDECAR_GRAPH_EDGE_KIND_VALUES
    });
  }

  return errors;
}

export function inspectSidecarGraphStructure(artifact) {
  const artifactObject = isPlainObject(artifact);
  const graphPresent = artifactObject && hasOwn(artifact, SIDECAR_GRAPH_SECTION_FIELD);
  const graph = graphPresent ? artifact[SIDECAR_GRAPH_SECTION_FIELD] : null;
  const errors = !artifactObject
    ? ["artifact must be an object"]
    : graphPresent ? validateSidecarGraphSection(graph) : [];
  return {
    structurally_valid: artifactObject && errors.length === 0,
    graph_present: graphPresent,
    graph_schema_version: isPlainObject(graph) ? graph[SIDECAR_GRAPH_SCHEMA_FIELD] ?? null : null,
    errors
  };
}

export function classifySidecarGraphArtifactSchema(artifact, options = {}) {
  if (!isPlainObject(artifact)) {
    return {
      compatible: false,
      graph_state: createSidecarGraphState({ status_reason: "artifact_unavailable" }),
      errors: ["artifact must be an object"]
    };
  }

  const expectedGeneratorIdentity = options.expectedGeneratorIdentity;
  const expectedIdentityValid =
    typeof expectedGeneratorIdentity === "string" &&
    SIDECAR_GRAPH_GENERATOR_IDENTITY_PATTERN.test(expectedGeneratorIdentity);
  const graph = artifact[SIDECAR_GRAPH_SECTION_FIELD];
  const errors = [];
  if (!expectedIdentityValid) {
    errors.push("expectedGeneratorIdentity must be an explicit sha256 committed identity");
  }
  if (!hasOwn(artifact, SIDECAR_GRAPH_SECTION_FIELD)) {
    errors.push(`${SIDECAR_GRAPH_SECTION_FIELD} is required for authoritative compatibility`);
  } else {
    errors.push(...validateSidecarGraphSection(
      graph,
      expectedIdentityValid ? { expectedGeneratorIdentity } : {}
    ));
  }
  const graphSchemaVersion = isPlainObject(graph)
    ? graph[SIDECAR_GRAPH_SCHEMA_FIELD] ?? null
    : null;

  if (errors.length > 0) {
    return {
      compatible: false,
      graph_state: createSidecarGraphState({
        observed_graph_schema_version: graphSchemaVersion,
        graph_available: false,
        edge_source: "unavailable",
        dirty_graph_mode: "unavailable",
        status_reason: "graph_schema_incompatible"
      }),
      errors
    };
  }

  return {
    compatible: true,
    graph_state: createSidecarGraphState({
      [SIDECAR_GRAPH_SCHEMA_FIELD]: graph[SIDECAR_GRAPH_SCHEMA_FIELD],
      graph_available: true,
      edge_source: "base_index",
      dirty_graph_mode: "base_index_only",
      status_reason: "graph_schema_compatible"
    }),
    errors: []
  };
}
