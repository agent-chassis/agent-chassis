import {
  ExactBindingError,
  canonicalDigest,
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  parseCanonicalDocument,
  sha256,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";
import {
  deriveSoundNegativeObservationCapture
} from "./sound-negative-observation-projection.mjs";
import { validateProjectedContractWithStableCore } from
  "./projected-contract-validation.mjs";
import { GRAPH_VERSION } from "./projected-contract-graph.mjs";

const TRANSFORMER_ID = "caller-input-surface-capture.v1";
const POLICY_VERSION = "controlled-contract.caller-input-policy.v1";
const TRACE_VERSION = "controlled-contract.caller-boundary-trace.v1";
const RESULT_VERSION = "controlled-contract.caller-input-authority-confinement.v1";
const CONTRACT_VERSION = "controlled-acceptance-contract.experimental.v0.2";
const SOUND_NEGATIVE_EVIDENCE_VERSION =
  "controlled-contract.sound-negative-observation-evidence.v1";
const SOUND_NEGATIVE_PROOF_VERSION =
  "controlled-contract.sound-negative-observation-capture-proof.v1";
const REFERENCE_ID = /^ref-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REQUEST_TYPES = new Set(["cc:artifact", "cc:event", "cc:resource"]);
const ATTEMPT_TYPES = new Set(["cc:event", "cc:process"]);
const SOURCE_TYPES = new Set([
  "cc:actor", "cc:entity", "cc:process", "cc:resource", "cc:runtime_component"
]);
const COORDINATE_TYPES = new Set([
  "cc:configuration", "cc:entity", "cc:resource", "cc:state"
]);
const OPERATION_TYPES = new Set(["cc:operation", "cc:process", "cc:runtime_component"]);
const EFFECT_TYPES = new Set([
  "cc:artifact", "cc:configuration", "cc:entity", "cc:event", "cc:resource", "cc:state"
]);
const PROHIBITED_FAMILIES = Object.freeze([
  "catalog", "environment", "filesystem", "loader", "module", "resolver", "return",
  "subprocess", "success"
]);
const TRACE_KINDS = new Set([
  "acceptance", "observation_cut", "occurrence", "parser_attempt", "parser_disposition",
  "refusal", "request"
]);

const POPULATION_IDS = Object.freeze({
  "accepted-supplied-members": "ref-cia-accepted-supplied-member-population",
  "allowed-members": "ref-cia-allowed-member-population",
  "authority-classifications": "ref-cia-authority-classification-population",
  "coordinate-classifications": "ref-cia-coordinate-classification-population",
  "declared-members": "ref-cia-declared-member-population",
  "forbidden-supplied-members": "ref-cia-forbidden-supplied-member-population",
  "forbidden-members": "ref-cia-forbidden-member-population",
  "family-classifications": "ref-cia-family-classification-population",
  "mandatory-sources": "ref-cia-mandatory-source-population",
  "observed-sources": "ref-cia-observed-source-population",
  "pre-refusal-occurrences": "ref-cia-pre-refusal-occurrence-population",
  "prohibited-families": "ref-cia-prohibited-family-population",
  "protected-effects": "ref-cia-protected-effect-population",
  "resolution-coordinates": "ref-cia-resolution-coordinate-population",
  "resolver-operations": "ref-cia-resolver-operation-population",
  "selected-forbidden-members": "ref-cia-selected-forbidden-member-population",
  "server-selected-coordinates": "ref-cia-server-selected-coordinate-population"
});

const SINGLETON_IDS = Object.freeze({
  acceptance: "ref-cia-acceptance",
  "accepted-attempt": "ref-cia-accepted-attempt",
  "accepted-request": "ref-cia-accepted-request",
  "accepted-request-source": "ref-cia-accepted-request-source",
  "capture-proof": "ref-cia-observation-capture-proof",
  "forbidden-attempt": "ref-cia-forbidden-attempt",
  "forbidden-request": "ref-cia-forbidden-request",
  "forbidden-request-source": "ref-cia-forbidden-request-source",
  interface: "ref-cia-request-interface",
  "observation-cut": "ref-cia-observation-cut",
  "observation-evidence": "ref-cia-observation-evidence",
  parser: "ref-cia-parser",
  "path-like-control": "ref-cia-path-like-opaque-control",
  "policy-source": "ref-cia-input-policy-source",
  "projection-result": "ref-cia-projection-result",
  refusal: "ref-cia-refusal",
  verification: "ref-cia-verification"
});

function fail(code, message, details = {}) {
  throw new ExactBindingError(code, message, details);
}

function exactKeys(value, required, optional = []) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

function nfc(value, field, { empty = false } = {}) {
  if (typeof value !== "string" || (!empty && value.length === 0) || value.includes("\0") ||
      value !== value.normalize("NFC")) fail(
    "caller_input_text_invalid",
    "caller-input capture text must be canonical NFC without NUL",
    { field }
  );
  return value;
}

function safeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail(
    "caller_input_integer_invalid", "positions and counts must be nonnegative safe integers",
    { field }
  );
  return value;
}

function identity(value, field) {
  const shapes = {
    repository_path: ["kind", "path", "repository"],
    code_symbol: Object.hasOwn(value ?? {}, "scip_symbol")
      ? ["kind", "path", "repository", "scip_symbol", "symbol"]
      : ["kind", "path", "repository", "symbol"],
    durable_id: ["domain", "kind", "value"],
    runtime_parameter: ["kind", "name"],
    profile_term: ["kind", "term"]
  };
  const keys = shapes[value?.kind];
  if (!keys || !exactKeys(value, keys)) fail(
    "caller_input_identity_invalid", "grounded identity has an unknown or open shape", { field }
  );
  for (const key of keys.filter((key) => key !== "kind")) nfc(value[key], `${field}.${key}`);
  return structuredClone(value);
}

function role(value, field, allowedTypes) {
  if (!exactKeys(value, ["grounded_identity", "reference_id", "type_term"]) ||
      !REFERENCE_ID.test(value.reference_id ?? "") || !allowedTypes.has(value.type_term)) fail(
    "caller_input_role_invalid", "captured role has an invalid closed shape or type", { field }
  );
  return {
    grounded_identity: identity(value.grounded_identity, `${field}.grounded_identity`),
    reference_id: value.reference_id,
    type_term: value.type_term
  };
}

function roleKey(value) {
  return canonicalDigest({
    grounded_identity: value.grounded_identity,
    reference_id: value.reference_id,
    type_term: value.type_term
  });
}

function sameRole(left, right) {
  return left.type_term === right.type_term && roleKey(left) === roleKey(right);
}

function groundedRoleKey(value) {
  return canonicalDigest(value.grounded_identity);
}

function capturedReference(captured, referenceId = captured.reference_id) {
  return {
    reference_id: referenceId,
    type_term: captured.type_term,
    identity: structuredClone(captured.grounded_identity)
  };
}

function durableReference(referenceId, typeTerm, domain, value = referenceId) {
  return {
    reference_id: referenceId,
    type_term: typeTerm,
    identity: { kind: "durable_id", domain, value }
  };
}

function ref(referenceId) { return { kind: "reference", reference_id: referenceId }; }
function num(value) { return { kind: "number", value }; }
function bool(value) { return { kind: "boolean", value }; }
function context(mode = "unconditional", ids = []) {
  return { mode, operand_reference_ids: [...ids].sort(compareCodeUnits) };
}
function identifierPart(value) { return sha256(Buffer.from(value, "utf8")); }

function addReference(state, reference) {
  const existing = state.references.get(reference.reference_id);
  if (existing && canonicalDigest(existing) !== canonicalDigest(reference)) fail(
    "caller_input_reference_collision", "derived references collide",
    { reference_id: reference.reference_id }
  );
  state.references.set(reference.reference_id, structuredClone(reference));
}

function addClaim(state, id, subject, operator, applicability, operands, options = {}) {
  const propositionId = `prop-cia-${id}`;
  if (state.propositionIds.has(propositionId)) fail(
    "caller_input_graph_identifier_collision", "derived proposition identifiers collide",
    { proposition_id: propositionId }
  );
  state.propositionIds.add(propositionId);
  state.propositions.push({
    proposition_id: propositionId,
    subject_reference_id: subject,
    operator,
    applicability_context: structuredClone(applicability),
    operands: structuredClone(operands)
  });
  const claim = {
    claim_id: `claim-cia-${id}`,
    kind: options.kind ?? "evidence",
    modality: options.modality ?? "MUST",
    proposition_id: propositionId,
    ...(options.verificationMethod ? { verification_method: options.verificationMethod } : {}),
    ...(options.falsifierId ? { falsifying_proposition_id: options.falsifierId } : {})
  };
  state.claims.push(claim);
  return claim.claim_id;
}

function addVerifiedClaim(state, {
  id, subject, operator, applicability, operands, complement = operator,
  modality = "MUST", verifierOperands = [subject, ...operands.filter(({ kind }) =>
    kind === "reference").map(({ reference_id: referenceId }) => referenceId)]
}) {
  const targetClaimId = addClaim(
    state, id, subject, operator, applicability, operands, { kind: "behavior", modality }
  );
  const falsifierId = `prop-cia-falsifier-${id}`;
  state.propositionIds.add(falsifierId);
  state.propositions.push({
    proposition_id: falsifierId,
    subject_reference_id: subject,
    operator: complement,
    applicability_context: structuredClone(applicability),
    operands: structuredClone(operands)
  });
  const verificationId = `verify-${id}`;
  const verificationClaimId = addClaim(
    state, verificationId, SINGLETON_IDS.verification, "reference:reads", applicability,
    [ref(SINGLETON_IDS["projection-result"]), ...verifierOperands.map(ref)],
    { kind: "verification", verificationMethod: "test_execution", falsifierId }
  );
  state.relations.push({
    relation_id: `rel-cia-verifies-${id}`,
    role: "verifies",
    source_claim_id: verificationClaimId,
    target_claim_id: targetClaimId
  });
}

function addPopulation(state, name, memberIds, scopeId) {
  const populationId = POPULATION_IDS[name];
  const members = [...new Set(memberIds)].sort(compareCodeUnits);
  addReference(state, durableReference(
    populationId, "cc:population", "controlled-contract:caller-input-population:v1", name
  ));
  if (members.length > 0) addClaim(
    state, `${name}-members`, populationId, "reference:contains", context("during", [scopeId]),
    members.map(ref)
  );
  addClaim(state, `${name}-cardinality`, populationId, "number:has_cardinality",
    context("during", [scopeId]), [num(members.length)]);
  return members;
}

function percentDecodeOnce(value, field) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail("caller_input_transport_decode_invalid", "percent-encoded key is not valid UTF-8", {
      field
    });
  }
}

function normalizeTextToken(value, field, decoding) {
  if (typeof value !== "string" || value.includes("\0")) fail(
    "caller_input_token_invalid", "object-key tokens must be strings without NUL", { field }
  );
  const decoded = decoding === "percent_utf8_once" ? percentDecodeOnce(value, field) : value;
  const normalized = decoded.normalize("NFC");
  if (normalized.length === 0 || normalized.includes("\0")) fail(
    "caller_input_token_invalid", "normalized object-key tokens must be nonempty", { field }
  );
  return normalized;
}

function parseToken(value, field, decoding) {
  if (!exactKeys(value, value?.kind === "object_key" ? ["kind", "value"] : ["kind"]) &&
      !exactKeys(value, ["index", "kind"])) fail(
    "caller_input_token_invalid", "member token has an open or unknown shape", { field }
  );
  if (value.kind === "object_key" && exactKeys(value, ["kind", "value"])) return {
    kind: "object_key", value: normalizeTextToken(value.value, `${field}.value`, decoding)
  };
  if (value.kind === "array_carrier" && exactKeys(value, ["kind"])) return {
    kind: "array_carrier"
  };
  if (value.kind === "array_index" && exactKeys(value, ["index", "kind"])) return {
    kind: "array_index", index: safeInteger(value.index, `${field}.index`)
  };
  fail("caller_input_token_invalid", "member token kind is not package-owned", { field });
}

function parsePath(value, field, decoding) {
  if (!Array.isArray(value) || value.length === 0) fail(
    "caller_input_member_path_invalid", "member paths must be nonempty token vectors", { field }
  );
  const tokens = value.map((token, index) => parseToken(token, `${field}[${index}]`, decoding));
  if (tokens[0].kind !== "object_key") fail(
    "caller_input_member_path_invalid", "request member paths must begin at an object key", {
      field
    }
  );
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === "array_carrier" && tokens[index + 1]?.kind !== "array_index") fail(
      "caller_input_member_path_invalid", "array carriers must be followed by array indices",
      { field, index }
    );
    if (token.kind === "array_index" && tokens[index - 1]?.kind !== "array_carrier") fail(
      "caller_input_member_path_invalid", "array indices must follow array carriers",
      { field, index }
    );
  }
  return tokens;
}

function pathKey(tokens) { return canonicalDigest(tokens); }

function isPathPrefix(prefix, value) {
  return prefix.length <= value.length && prefix.every((token, index) =>
    canonicalDigest(token) === canonicalDigest(value[index]));
}

function parsePolicy(value) {
  if (!exactKeys(value, [
    "aliases", "boundary_sources", "declarations", "effects", "interface", "operations",
    "parser", "path_like_control", "resolution_coordinates", "schema_version",
    "server_selected_coordinate_reference_ids", "transport_key_decoding"
  ]) || value.schema_version !== POLICY_VERSION ||
      !["none", "percent_utf8_once"].includes(value.transport_key_decoding) ||
      !Array.isArray(value.aliases) || !Array.isArray(value.boundary_sources) ||
      !Array.isArray(value.declarations) || !Array.isArray(value.effects) ||
      !Array.isArray(value.operations) || !Array.isArray(value.resolution_coordinates) ||
      !Array.isArray(value.server_selected_coordinate_reference_ids)) fail(
    "caller_input_policy_invalid", "canonical input policy has an invalid closed outer shape"
  );
  const decoding = value.transport_key_decoding;
  const interfaceRole = role(value.interface, "interface", new Set(["cc:entity"]));
  const parserRole = role(value.parser, "parser", new Set(["cc:process", "cc:runtime_component"]));
  const declarations = value.declarations.map((entry, index) => {
    if (!exactKeys(entry, ["classification", "path", "resolution_coordinate_reference_ids"]) ||
        !["allowed", "authority_bearing_forbidden"].includes(entry.classification) ||
        !Array.isArray(entry.resolution_coordinate_reference_ids)) fail(
      "caller_input_declaration_invalid", "member declaration has an invalid closed shape",
      { index }
    );
    const path = parsePath(entry.path, `declarations[${index}].path`, decoding);
    const coordinateIds = entry.resolution_coordinate_reference_ids.map((id, coordinateIndex) => {
      if (!REFERENCE_ID.test(id ?? "")) fail(
        "caller_input_coordinate_reference_invalid", "coordinate reference ID is invalid",
        { index, coordinate_index: coordinateIndex }
      );
      return id;
    });
    if (new Set(coordinateIds).size !== coordinateIds.length ||
        (entry.classification === "allowed" && coordinateIds.length !== 0) ||
        (entry.classification === "authority_bearing_forbidden" && coordinateIds.length === 0)) {
      fail("caller_input_member_classification_invalid",
        "allowed members select no coordinate and forbidden members select one or more", { index });
    }
    return {
      classification: entry.classification,
      path,
      coordinateIds: coordinateIds.sort(compareCodeUnits)
    };
  }).sort((left, right) => compareCodeUnits(pathKey(left.path), pathKey(right.path)));
  const declarationKeys = declarations.map(({ path }) => pathKey(path));
  if (declarations.length === 0 || !sortedUnique([...declarationKeys].sort(compareCodeUnits)) ||
      new Set(declarationKeys).size !== declarationKeys.length) fail(
    "caller_input_declared_population_invalid",
    "declared member paths must form a nonempty exact unique population"
  );

  const aliases = value.aliases.map((entry, index) => {
    if (!exactKeys(entry, ["alias", "canonical"])) fail(
      "caller_input_alias_invalid", "alias record has an invalid closed shape", { index }
    );
    return {
      alias: parsePath(entry.alias, `aliases[${index}].alias`, decoding),
      canonical: parsePath(entry.canonical, `aliases[${index}].canonical`, decoding)
    };
  }).sort((left, right) => compareCodeUnits(pathKey(left.alias), pathKey(right.alias)));
  const aliasKeys = aliases.map(({ alias }) => pathKey(alias));
  if (new Set(aliasKeys).size !== aliasKeys.length ||
      aliasKeys.some((key) => declarationKeys.includes(key))) fail(
    "caller_input_alias_collision", "aliases must be unique and disjoint from canonical members"
  );
  const aliasByKey = new Map(aliases.map((entry) => [pathKey(entry.alias), entry]));
  const resolveAliasPath = (path, field) => {
    let current = structuredClone(path);
    const seen = new Set();
    for (;;) {
      const candidates = aliases.filter(({ alias }) => isPathPrefix(alias, current))
        .sort((left, right) => right.alias.length - left.alias.length ||
          compareCodeUnits(pathKey(left.alias), pathKey(right.alias)));
      if (candidates.length === 0) return current;
      const selected = candidates[0];
      const selectedKey = pathKey(selected.alias);
      if (seen.has(selectedKey)) fail(
        "caller_input_alias_cycle", "alias resolution contains a cycle", { field }
      );
      seen.add(selectedKey);
      current = [...structuredClone(selected.canonical), ...current.slice(selected.alias.length)];
      if (seen.size > aliases.length) fail(
        "caller_input_alias_cycle", "alias resolution did not terminate", { field }
      );
    }
  };
  for (const [index, entry] of aliases.entries()) {
    const resolved = resolveAliasPath(entry.canonical, `aliases[${index}].canonical`);
    if (!declarationKeys.includes(pathKey(resolved))) fail(
      "caller_input_alias_target_invalid", "every alias must resolve to a declared canonical member",
      { index }
    );
  }

  const coordinates = value.resolution_coordinates.map((entry, index) => {
    if (!exactKeys(entry, ["operation_reference_ids", "reference"]) ||
        !Array.isArray(entry.operation_reference_ids)) fail(
      "caller_input_coordinate_invalid", "resolution coordinate has an invalid closed shape",
      { index }
    );
    const reference = role(entry.reference, `resolution_coordinates[${index}].reference`,
      COORDINATE_TYPES);
    const operationIds = entry.operation_reference_ids.map((id, operationIndex) => {
      if (!REFERENCE_ID.test(id ?? "")) fail(
        "caller_input_operation_reference_invalid", "operation reference ID is invalid",
        { index, operation_index: operationIndex }
      );
      return id;
    });
    if (operationIds.length === 0 || new Set(operationIds).size !== operationIds.length) fail(
      "caller_input_coordinate_association_invalid",
      "each resolution coordinate must select exact one-or-more resolver operations", { index }
    );
    return { reference, operationIds: operationIds.sort(compareCodeUnits) };
  }).sort((left, right) => compareCodeUnits(
    left.reference.reference_id, right.reference.reference_id
  ));
  const coordinateIds = coordinates.map(({ reference }) => reference.reference_id);
  if (coordinateIds.length === 0 || !sortedUnique(coordinateIds)) fail(
    "caller_input_coordinate_population_invalid", "coordinate population must be sorted and unique"
  );
  const effects = value.effects.map((entry, index) =>
    role(entry, `effects[${index}]`, EFFECT_TYPES)).sort((left, right) =>
    compareCodeUnits(left.reference_id, right.reference_id));
  const effectIds = effects.map(({ reference_id: referenceId }) => referenceId);
  if (effectIds.length === 0 || new Set(effectIds).size !== effectIds.length) fail(
    "caller_input_effect_population_invalid", "protected effects must be sorted and unique"
  );
  const operations = value.operations.map((entry, index) => {
    if (!exactKeys(entry, ["effect_reference_ids", "reference"]) ||
        !Array.isArray(entry.effect_reference_ids)) fail(
      "caller_input_operation_invalid", "resolver operation has an invalid closed shape", { index }
    );
    const reference = role(entry.reference, `operations[${index}].reference`, OPERATION_TYPES);
    const effectReferenceIds = entry.effect_reference_ids.map((id, effectIndex) => {
      if (!REFERENCE_ID.test(id ?? "")) fail(
        "caller_input_effect_reference_invalid", "effect reference ID is invalid",
        { index, effect_index: effectIndex }
      );
      return id;
    });
    if (effectReferenceIds.length === 0 ||
        new Set(effectReferenceIds).size !== effectReferenceIds.length ||
        effectReferenceIds.some((id) => !effectIds.includes(id))) fail(
      "caller_input_operation_association_invalid",
      "each resolver operation must target exact one-or-more declared protected effects", { index }
    );
    return { reference, effectReferenceIds: effectReferenceIds.sort(compareCodeUnits) };
  }).sort((left, right) => compareCodeUnits(
    left.reference.reference_id, right.reference.reference_id
  ));
  const operationIds = operations.map(({ reference }) => reference.reference_id);
  if (operationIds.length === 0 || !sortedUnique(operationIds) ||
      coordinates.some(({ operationIds: ids }) => ids.some((id) => !operationIds.includes(id))) ||
      declarations.some(({ coordinateIds: ids }) => ids.some((id) => !coordinateIds.includes(id)))) {
    fail("caller_input_association_closure_invalid",
      "member, coordinate, operation, and effect associations must be closed over declared populations");
  }
  const serverSelected = [...value.server_selected_coordinate_reference_ids]
    .sort(compareCodeUnits);
  const callerSelectedCoordinates = new Set(declarations.flatMap(({ coordinateIds: ids }) => ids));
  if (serverSelected.length === 0 ||
      new Set(serverSelected).size !== serverSelected.length ||
      serverSelected.some((id) => !coordinateIds.includes(id) || callerSelectedCoordinates.has(id))) {
    fail("caller_input_server_coordinate_invalid",
      "server-selected coordinates must be nonempty, declared, unique, and absent from caller associations");
  }

  const boundarySources = value.boundary_sources.map((entry, index) => {
    if (!exactKeys(entry, ["family", "source", "trace_carrier"]) ||
        !PROHIBITED_FAMILIES.includes(entry.family) || typeof entry.trace_carrier !== "boolean") {
      fail("caller_input_boundary_source_invalid",
        "boundary source has an invalid closed shape or family", { index });
    }
    return {
      family: entry.family,
      source: role(entry.source, `boundary_sources[${index}].source`, SOURCE_TYPES),
      traceCarrier: entry.trace_carrier
    };
  }).sort((left, right) => compareCodeUnits(left.family, right.family));
  if (boundarySources.length !== PROHIBITED_FAMILIES.length ||
      new Set(boundarySources.map(({ family }) => family)).size !==
        boundarySources.length ||
      boundarySources.map(({ source }) => roleKey(source)).some((key, index, keys) =>
        keys.indexOf(key) !== index) ||
      boundarySources.filter(({ traceCarrier }) => traceCarrier).length !== 1) fail(
    "caller_input_source_census_invalid",
    "policy must declare every prohibited family exactly once, unique sources, and one trace carrier"
  );

  if (!exactKeys(value.path_like_control, ["canonical_path", "value_sha256"]) ||
      !SHA256.test(value.path_like_control.value_sha256 ?? "")) fail(
    "caller_input_path_like_control_invalid", "path-like control has an invalid closed shape"
  );
  const pathLikeControl = {
    path: parsePath(value.path_like_control.canonical_path,
      "path_like_control.canonical_path", decoding),
    valueSha256: value.path_like_control.value_sha256
  };
  const controlDeclaration = declarations.find(({ path }) =>
    pathKey(path) === pathKey(pathLikeControl.path));
  if (!controlDeclaration || controlDeclaration.classification !== "allowed") fail(
    "caller_input_path_like_control_invalid",
    "the mandatory path-like opaque control must be a declared allowed member"
  );

  return {
    aliases,
    aliasByKey,
    boundarySources,
    coordinates,
    declarations,
    decoding,
    effects,
    interfaceRole,
    operations,
    parserRole,
    pathLikeControl,
    resolveAliasPath,
    serverSelected
  };
}

function traverseRequest(value, decoding) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(
    "caller_input_request_invalid", "captured request root must be a JSON object"
  );
  const members = [];
  const visit = (current, prefix, rawPrefix) => {
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        const path = [...prefix, { kind: "array_carrier" }, { kind: "array_index", index }];
        const rawPath = [
          ...rawPrefix, { kind: "array_carrier" }, { kind: "array_index", index }
        ];
        members.push({ path, rawPath, value: current[index] });
        if (current[index] !== null && typeof current[index] === "object") {
          visit(current[index], path, rawPath);
        }
      }
      return;
    }
    if (current !== null && typeof current === "object") {
      const normalizedAtLevel = new Set();
      for (const [rawKey, child] of Object.entries(current)) {
        const normalizedKey = normalizeTextToken(rawKey, "request.object_key", decoding);
        if (normalizedAtLevel.has(normalizedKey)) fail(
          "caller_input_request_key_collision",
          "request object keys collide after transport decoding and NFC normalization",
          { raw_key: rawKey }
        );
        normalizedAtLevel.add(normalizedKey);
        const path = [...prefix, { kind: "object_key", value: normalizedKey }];
        const rawPath = [...rawPrefix, { kind: "object_key", value: rawKey }];
        members.push({ path, rawPath, value: child });
        if (child !== null && typeof child === "object") visit(child, path, rawPath);
      }
    }
  };
  visit(value, [], []);
  return members;
}

function normalizeSuppliedMembers(requestValue, policy, requestName) {
  const traversed = traverseRequest(requestValue, policy.decoding);
  const normalized = traversed.map((member, index) => {
    const canonicalPath = policy.resolveAliasPath(member.path, `${requestName}[${index}]`);
    return { ...member, canonicalPath, canonicalKey: pathKey(canonicalPath) };
  });
  const collisions = new Map();
  for (const member of normalized) {
    const prior = collisions.get(member.canonicalKey);
    if (prior) fail(
      "caller_input_alias_supply_collision",
      "canonical and alias supply, or two aliases for one member, are forbidden",
      { request: requestName, canonical_member_sha256: member.canonicalKey }
    );
    collisions.set(member.canonicalKey, member);
  }
  return normalized;
}

function parseTrace(value) {
  if (!exactKeys(value, ["interface", "parser", "records", "schema_version"]) ||
      value.schema_version !== TRACE_VERSION || !Array.isArray(value.records) ||
      value.records.length === 0) fail(
    "caller_input_trace_invalid", "caller-boundary trace has an invalid closed outer shape"
  );
  const interfaceRole = role(value.interface, "trace.interface", new Set(["cc:entity"]));
  const parserRole = role(value.parser, "trace.parser", new Set([
    "cc:process", "cc:runtime_component"
  ]));
  const records = value.records.map((entry, index) => {
    if (!TRACE_KINDS.has(entry?.kind)) fail(
      "caller_input_trace_kind_unknown", "caller-boundary trace kind is not package-owned",
      { index, kind: entry?.kind ?? null }
    );
    const common = ["attempt", "kind", "position", "request", "request_sha256"];
    const optionalByKind = {
      request: [],
      parser_attempt: [],
      parser_disposition: ["disposition"],
      acceptance: ["acceptance"],
      refusal: ["refusal"],
      observation_cut: ["cut", "refusal"],
      occurrence: ["effect", "family", "operation"]
    };
    const required = [...common, ...optionalByKind[entry.kind]];
    if (!exactKeys(entry, required) || !SHA256.test(entry.request_sha256 ?? "")) fail(
      "caller_input_trace_record_invalid", "caller-boundary trace record is not closed",
      { index, kind: entry.kind }
    );
    const parsed = {
      kind: entry.kind,
      position: safeInteger(entry.position, `records[${index}].position`),
      request: role(entry.request, `records[${index}].request`, REQUEST_TYPES),
      attempt: role(entry.attempt, `records[${index}].attempt`, ATTEMPT_TYPES),
      requestSha256: entry.request_sha256
    };
    if (entry.kind === "parser_disposition") {
      if (!["accepted", "refused"].includes(entry.disposition)) fail(
        "caller_input_trace_disposition_invalid", "parser disposition is not closed", { index }
      );
      parsed.disposition = entry.disposition;
    }
    if (entry.kind === "acceptance") parsed.acceptance = role(
      entry.acceptance, `records[${index}].acceptance`, new Set(["cc:event", "cc:state"])
    );
    if (entry.kind === "refusal") parsed.refusal = role(
      entry.refusal, `records[${index}].refusal`, new Set(["cc:event", "cc:state"])
    );
    if (entry.kind === "observation_cut") {
      parsed.cut = role(entry.cut, `records[${index}].cut`, new Set(["cc:event", "cc:state"]));
      parsed.refusal = role(
        entry.refusal, `records[${index}].refusal`, new Set(["cc:event", "cc:state"])
      );
    }
    if (entry.kind === "occurrence") {
      if (!PROHIBITED_FAMILIES.includes(entry.family)) fail(
        "caller_input_trace_family_unknown", "occurrence family is not package-owned", { index }
      );
      parsed.family = entry.family;
      parsed.operation = role(
        entry.operation, `records[${index}].operation`, OPERATION_TYPES
      );
      parsed.effect = role(entry.effect, `records[${index}].effect`, EFFECT_TYPES);
    }
    return parsed;
  });
  const positions = records.map(({ position }) => position);
  if (new Set(positions).size !== positions.length || positions.some((position, index) =>
    index > 0 && position <= positions[index - 1])) fail(
    "caller_input_trace_position_invalid",
    "trace positions must be unique and strictly increasing in captured order"
  );
  return { interfaceRole, parserRole, records };
}

function soundNegativePopulationMembers(contract, name) {
  const populationId = `ref-sno-${name}-population`;
  return contract.propositions.find(({ subject_reference_id: subject, operator }) =>
    subject === populationId && operator === "reference:contains"
  )?.operands.map(({ reference_id: referenceId }) => referenceId) ?? [];
}

function findCapturedCandidate(evidence, traceSource) {
  const outcome = evidence.source_outcomes.find(({ source }) => sameRole(source, traceSource));
  if (!outcome || outcome.kind !== "observed" || outcome.observations.length !== 1) fail(
    "caller_input_trace_carrier_invalid",
    "the policy-selected trace source must have exactly one observed candidate"
  );
  const candidate = outcome.observations[0];
  if (candidate?.kind !== "candidate" || typeof candidate.evidence_content_base64 !== "string") {
    fail("caller_input_trace_carrier_invalid", "trace carrier observation is malformed");
  }
  const bytes = Buffer.from(candidate.evidence_content_base64, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== candidate.evidence_content_base64) fail(
    "caller_input_trace_carrier_invalid", "embedded trace bytes are not canonical base64"
  );
  return parseCanonicalDocument(bytes, "authenticated caller-boundary trace");
}

function validateSoundNegative(evidenceBytes, proofBytes, policy) {
  const projected = JSON.parse(deriveSoundNegativeObservationCapture({
    evidenceBytes, captureProofBytes: proofBytes
  }).toString("utf8"));
  if (soundNegativePopulationMembers(projected, "absent-conclusion").length !== 1 ||
      soundNegativePopulationMembers(projected, "invalidating-conditions").length !== 0) fail(
    "caller_input_sound_negative_not_absent",
    "matching sound-negative evidence must derive stable complete absence"
  );
  const expectedSources = policy.boundarySources.map(({ source }) => source);
  const evidence = parseCanonicalDocument(evidenceBytes, "sound-negative observation evidence");
  const declared = evidence.declared_sources ?? [];
  const outcomes = evidence.source_outcomes ?? [];
  const expectedKeys = expectedSources.map(roleKey).sort(compareCodeUnits);
  const declaredKeys = declared.map(roleKey).sort(compareCodeUnits);
  const observedKeys = outcomes.map(({ source }) => roleKey(source)).sort(compareCodeUnits);
  if (canonicalDigest(expectedKeys) !== canonicalDigest(declaredKeys) ||
      canonicalDigest(expectedKeys) !== canonicalDigest(observedKeys) ||
      evidence.declared_source_total !== expectedKeys.length) fail(
    "caller_input_source_census_mismatch",
    "policy-derived mandatory sources must exactly match declared and observed sources"
  );
  const traceSource = policy.boundarySources.find(({ traceCarrier }) => traceCarrier).source;
  return { evidence, projected, traceValue: findCapturedCandidate(evidence, traceSource) };
}

function exactlyOne(records, predicate, code, message) {
  const matches = records.filter(predicate);
  if (matches.length !== 1) fail(code, message, { observed_count: matches.length });
  return matches[0];
}

function validateTrace(trace, policy, acceptedDigest, forbiddenDigest, soundNegativeEvidence) {
  if (!sameRole(trace.interfaceRole, policy.interfaceRole) ||
      !sameRole(trace.parserRole, policy.parserRole)) fail(
    "caller_input_trace_policy_splice",
    "trace interface and parser must exactly match the canonical policy"
  );
  const records = trace.records;
  const requestRecords = records.filter(({ kind }) => kind === "request");
  if (requestRecords.length !== 2) fail(
    "caller_input_trace_request_population_invalid",
    "trace must contain exactly the accepted and forbidden request occurrences"
  );
  const acceptedRequestRecord = exactlyOne(records, (entry) =>
    entry.kind === "request" && entry.requestSha256 === acceptedDigest,
  "caller_input_accepted_request_missing", "accepted request digest is absent or duplicated");
  const forbiddenRequestRecord = exactlyOne(records, (entry) =>
    entry.kind === "request" && entry.requestSha256 === forbiddenDigest,
  "caller_input_forbidden_request_missing", "forbidden request digest is absent or duplicated");
  if (sameRole(acceptedRequestRecord.request, forbiddenRequestRecord.request) ||
      sameRole(acceptedRequestRecord.attempt, forbiddenRequestRecord.attempt)) fail(
    "caller_input_request_identity_collision", "accepted and forbidden request identities must differ"
  );
  const requestPairs = [acceptedRequestRecord, forbiddenRequestRecord];
  for (const record of records) {
    const owner = requestPairs.find((requestRecord) =>
      sameRole(record.request, requestRecord.request));
    if (!owner || !sameRole(record.attempt, owner.attempt) ||
        record.requestSha256 !== owner.requestSha256) fail(
      "caller_input_trace_request_attempt_crossing",
      "every record must retain its exact request digest and request-attempt pair",
      { kind: record.kind, position: record.position }
    );
  }
  for (const requestRecord of requestPairs) exactlyOne(records, (entry) =>
    entry.kind === "parser_attempt" && sameRole(entry.request, requestRecord.request) &&
    sameRole(entry.attempt, requestRecord.attempt),
  "caller_input_parser_attempt_population_invalid",
  "each exact request must have exactly one parser-attempt occurrence");
  const acceptedDisposition = exactlyOne(records, (entry) =>
    entry.kind === "parser_disposition" &&
    sameRole(entry.request, acceptedRequestRecord.request),
  "caller_input_accepted_disposition_invalid", "accepted request disposition is missing or duplicated");
  const forbiddenDisposition = exactlyOne(records, (entry) =>
    entry.kind === "parser_disposition" &&
    sameRole(entry.request, forbiddenRequestRecord.request),
  "caller_input_forbidden_disposition_invalid", "forbidden request disposition is missing or duplicated");
  if (acceptedDisposition.disposition !== "accepted" ||
      forbiddenDisposition.disposition !== "refused") fail(
    "caller_input_parser_disposition_invalid",
    "accepted control must be accepted and authority-bearing request must be refused"
  );
  const acceptance = exactlyOne(records, (entry) =>
    entry.kind === "acceptance" && sameRole(entry.request, acceptedRequestRecord.request),
  "caller_input_acceptance_invalid", "accepted request must own exactly one acceptance occurrence");
  const refusal = exactlyOne(records, (entry) =>
    entry.kind === "refusal" && sameRole(entry.request, forbiddenRequestRecord.request),
  "caller_input_refusal_invalid", "forbidden request must own exactly one refusal occurrence");
  const cut = exactlyOne(records, (entry) =>
    entry.kind === "observation_cut" && sameRole(entry.request, forbiddenRequestRecord.request),
  "caller_input_observation_cut_invalid", "forbidden request must own exactly one observation cut");
  if (!sameRole(cut.refusal, refusal.refusal) || records.at(-1) !== cut) fail(
    "caller_input_refusal_cut_invalid",
    "observation cut must end the trace and bind the exact forbidden refusal"
  );
  if (!sameRole(soundNegativeEvidence.attempt, forbiddenRequestRecord.attempt) ||
      !sameRole(soundNegativeEvidence.interval.end, cut.cut)) fail(
    "caller_input_sound_negative_boundary_splice",
    "sound-negative attempt and interval end must be the exact forbidden attempt and cut"
  );
  const distinctOccurrenceRoles = [
    acceptedRequestRecord.request,
    forbiddenRequestRecord.request,
    acceptedRequestRecord.attempt,
    forbiddenRequestRecord.attempt,
    acceptance.acceptance,
    refusal.refusal,
    cut.cut
  ];
  if (new Set(distinctOccurrenceRoles.map(({ reference_id: referenceId }) => referenceId)).size !==
      distinctOccurrenceRoles.length ||
      new Set(distinctOccurrenceRoles.map(roleKey)).size !== distinctOccurrenceRoles.length ||
      new Set(distinctOccurrenceRoles.map(groundedRoleKey)).size !==
        distinctOccurrenceRoles.length) fail(
    "caller_input_occurrence_identity_collision",
    "accepted and forbidden request, attempt, acceptance, refusal, and cut roles must be exact and distinct"
  );
  const occurrenceRecords = records.filter(({ kind }) => kind === "occurrence");
  const coordinateByOperation = new Map();
  for (const coordinate of policy.coordinates) for (const operationId of coordinate.operationIds) {
    const values = coordinateByOperation.get(operationId) ?? [];
    values.push(coordinate.reference.reference_id);
    coordinateByOperation.set(operationId, values);
  }
  const operationById = new Map(policy.operations.map(({ reference }) =>
    [reference.reference_id, reference]));
  const effectById = new Map(policy.effects.map((effect) =>
    [effect.reference_id, effect]));
  const effectByOperation = new Map(policy.operations.map(({ reference, effectReferenceIds }) =>
    [reference.reference_id, new Set(effectReferenceIds)]));
  for (const occurrence of occurrenceRecords) {
    if (!coordinateByOperation.has(occurrence.operation.reference_id) ||
        !sameRole(occurrence.operation, operationById.get(occurrence.operation.reference_id)) ||
        !effectByOperation.get(occurrence.operation.reference_id)?.has(
          occurrence.effect.reference_id) ||
        !sameRole(occurrence.effect, effectById.get(occurrence.effect.reference_id))) fail(
      "caller_input_occurrence_association_invalid",
      "occurrence operation and effect must match exact policy associations",
      { position: occurrence.position }
    );
    if (sameRole(occurrence.attempt, forbiddenRequestRecord.attempt) &&
        occurrence.position < cut.position) fail(
      "caller_input_prohibited_occurrence_before_refusal",
      "forbidden attempt contains a prohibited occurrence before its refusal cut",
      { family: occurrence.family, position: occurrence.position }
    );
  }
  return {
    acceptance: acceptance.acceptance,
    acceptedAttempt: acceptedRequestRecord.attempt,
    acceptedRequest: acceptedRequestRecord.request,
    cut: cut.cut,
    forbiddenAttempt: forbiddenRequestRecord.attempt,
    forbiddenRequest: forbiddenRequestRecord.request,
    occurrenceRecords,
    refusal: refusal.refusal
  };
}

function memberReference(path) {
  const digest = pathKey(path);
  return durableReference(
    `ref-cia-member-${digest}`, "cc:configuration",
    "controlled-contract:caller-member-token-vector:v1",
    canonicalJsonBytes(path).toString("utf8")
  );
}

function sourceArtifact(referenceId, domain, digest) {
  return durableReference(referenceId, "cc:artifact", domain, digest);
}

function deriveResult(sourceValues, sourceDigests) {
  const [policyValue, acceptedValue, forbiddenValue, evidenceValue] = sourceValues;
  const policy = parsePolicy(policyValue);
  const acceptedMembers = normalizeSuppliedMembers(acceptedValue, policy, "accepted-request");
  const forbiddenMembers = normalizeSuppliedMembers(forbiddenValue, policy, "forbidden-request");
  const declarationByKey = new Map(policy.declarations.map((entry) => [pathKey(entry.path), entry]));
  const unknownAccepted = acceptedMembers.filter(({ canonicalKey }) =>
    !declarationByKey.has(canonicalKey));
  const acceptedForbidden = acceptedMembers.filter(({ canonicalKey }) =>
    declarationByKey.get(canonicalKey)?.classification !== "allowed");
  if (unknownAccepted.length > 0 || acceptedForbidden.length > 0) fail(
    "caller_input_accepted_surface_invalid",
    "accepted request must contain only declared allowed members and no parser-ignored unknowns",
    { unknown_count: unknownAccepted.length, forbidden_count: acceptedForbidden.length }
  );
  const unknownForbidden = forbiddenMembers.filter(({ canonicalKey }) =>
    !declarationByKey.has(canonicalKey));
  if (unknownForbidden.length > 0) fail(
    "caller_input_forbidden_surface_invalid",
    "forbidden request may not hide unknown or parser-ignored supplied members",
    { unknown_count: unknownForbidden.length }
  );
  const forbiddenSelections = forbiddenMembers.filter(({ canonicalKey }) =>
    declarationByKey.get(canonicalKey)?.classification === "authority_bearing_forbidden");
  if (forbiddenSelections.length === 0) fail(
    "caller_input_forbidden_member_missing",
    "forbidden request must contain an exact authority-bearing forbidden member"
  );
  const control = acceptedMembers.find(({ canonicalKey }) =>
    canonicalKey === pathKey(policy.pathLikeControl.path));
  if (!control || typeof control.value !== "string" ||
      sha256(canonicalJsonBytes(control.value)) !== policy.pathLikeControl.valueSha256 ||
      !/(?:[/\\]|:\/\/|^\.{1,2}$)/u.test(control.value)) fail(
    "caller_input_path_like_control_missing",
    "accepted request must contain the exact policy-declared path-like opaque negative control"
  );

  const soundNegative = validateSoundNegative(
    canonicalJsonBytes(evidenceValue, { file: true }),
    canonicalJsonBytes(sourceValues[4], { file: true }), policy
  );
  const trace = parseTrace(soundNegative.traceValue);
  const traceResult = validateTrace(
    trace, policy, sourceDigests[1], sourceDigests[2], soundNegative.evidence
  );

  const state = {
    references: new Map(), propositionIds: new Set(), propositions: [], claims: [], relations: []
  };
  const memberRefs = new Map(policy.declarations.map(({ path }) => {
    const reference = memberReference(path);
    addReference(state, reference);
    return [pathKey(path), reference];
  }));
  for (const captured of [
    policy.interfaceRole, policy.parserRole, traceResult.acceptedRequest,
    traceResult.forbiddenRequest, traceResult.acceptedAttempt, traceResult.forbiddenAttempt,
    traceResult.acceptance, traceResult.refusal, traceResult.cut,
    ...policy.boundarySources.map(({ source }) => source),
    ...policy.coordinates.map(({ reference }) => reference),
    ...policy.operations.map(({ reference }) => reference), ...policy.effects
  ]) addReference(state, capturedReference(captured));
  const sourceReferences = [
    sourceArtifact(SINGLETON_IDS["policy-source"],
      "controlled-contract:caller-input-policy-source:v1", sourceDigests[0]),
    sourceArtifact(SINGLETON_IDS["accepted-request-source"],
      "controlled-contract:accepted-request-source:v1", sourceDigests[1]),
    sourceArtifact(SINGLETON_IDS["forbidden-request-source"],
      "controlled-contract:forbidden-request-source:v1", sourceDigests[2]),
    sourceArtifact(SINGLETON_IDS["observation-evidence"],
      "controlled-contract:caller-observation-evidence-source:v1", sourceDigests[3]),
    sourceArtifact(SINGLETON_IDS["capture-proof"],
      "controlled-contract:caller-observation-proof-source:v1", sourceDigests[4]),
    durableReference(SINGLETON_IDS.verification, "cc:test",
      "controlled-contract:caller-input-verifier:v1", TRANSFORMER_ID),
    durableReference(SINGLETON_IDS["projection-result"], "cc:artifact",
      "controlled-contract:caller-input-projection:v1", canonicalDigest({
        transformer_id: TRANSFORMER_ID, source_content_sha256: sourceDigests
      })),
    durableReference(SINGLETON_IDS["path-like-control"], "cc:evidence",
      "controlled-contract:path-like-opaque-control:v1", policy.pathLikeControl.valueSha256)
  ];
  for (const reference of sourceReferences) addReference(state, reference);

  const declaredIds = policy.declarations.map(({ path }) => memberRefs.get(pathKey(path)).reference_id);
  const allowedIds = policy.declarations.filter(({ classification }) => classification === "allowed")
    .map(({ path }) => memberRefs.get(pathKey(path)).reference_id);
  const forbiddenIds = policy.declarations.filter(({ classification }) =>
    classification === "authority_bearing_forbidden")
    .map(({ path }) => memberRefs.get(pathKey(path)).reference_id);
  const acceptedSuppliedIds = acceptedMembers.map(({ canonicalKey }) =>
    memberRefs.get(canonicalKey).reference_id);
  const forbiddenSuppliedIds = forbiddenMembers.map(({ canonicalKey }) =>
    memberRefs.get(canonicalKey).reference_id);
  const coordinateIds = policy.coordinates.map(({ reference }) => reference.reference_id);
  const operationIds = policy.operations.map(({ reference }) => reference.reference_id);
  const effectIds = policy.effects.map(({ reference_id: referenceId }) => referenceId);
  const mandatorySourceIds = policy.boundarySources.map(({ source }) => source.reference_id);
  const observedSourceIds = soundNegative.evidence.source_outcomes.map(({ source }) =>
    source.reference_id);
  const familyIds = PROHIBITED_FAMILIES.map((family) => {
    const reference = durableReference(
      `ref-cia-family-${family}`, "cc:criterion",
      "controlled-contract:caller-input-prohibited-family:v1", family
    );
    addReference(state, reference);
    return reference.reference_id;
  });
  const classificationIds = {
    authority: "ref-cia-classification-authority-bearing-forbidden",
    coordinate: "ref-cia-classification-resolution-coordinate",
    family: "ref-cia-classification-prohibited-family"
  };
  for (const [name, referenceId] of Object.entries(classificationIds)) addReference(
    state, durableReference(referenceId, "cc:criterion",
      "controlled-contract:caller-input-classification:v1", name)
  );
  const populationMembers = {
    "accepted-supplied-members": acceptedSuppliedIds,
    "allowed-members": allowedIds,
    "authority-classifications": [classificationIds.authority],
    "coordinate-classifications": [classificationIds.coordinate],
    "declared-members": declaredIds,
    "forbidden-supplied-members": forbiddenSuppliedIds,
    "forbidden-members": forbiddenIds,
    "family-classifications": [classificationIds.family],
    "mandatory-sources": mandatorySourceIds,
    "observed-sources": observedSourceIds,
    "pre-refusal-occurrences": [],
    "prohibited-families": familyIds,
    "protected-effects": effectIds,
    "resolution-coordinates": coordinateIds,
    "resolver-operations": operationIds,
    "selected-forbidden-members": forbiddenSelections.map(({ canonicalKey }) =>
      memberRefs.get(canonicalKey).reference_id),
    "server-selected-coordinates": policy.serverSelected
  };
  for (const [name, ids] of Object.entries(populationMembers)) {
    populationMembers[name] = addPopulation(
      state, name, ids, traceResult.forbiddenAttempt.reference_id
    );
  }
  for (const memberId of acceptedSuppliedIds) addClaim(
    state, `accepted-supplied-${identifierPart(memberId)}-allowed`, memberId,
    "reference:member_of", context("during", [traceResult.acceptedRequest.reference_id]),
    [ref(POPULATION_IDS["allowed-members"])]
  );
  for (const memberId of allowedIds) addClaim(
    state, `allowed-${identifierPart(memberId)}-declared`, memberId,
    "reference:member_of", context(), [ref(POPULATION_IDS["declared-members"])]
  );
  for (const memberId of forbiddenIds) addClaim(
    state, `forbidden-${identifierPart(memberId)}-declared`, memberId,
    "reference:member_of", context(), [ref(POPULATION_IDS["declared-members"])]
  );
  for (const memberId of populationMembers["selected-forbidden-members"]) {
    addClaim(state, `selected-${identifierPart(memberId)}-forbidden`, memberId,
      "reference:member_of", context("during", [traceResult.forbiddenAttempt.reference_id]),
      [ref(POPULATION_IDS["forbidden-members"])]);
    addClaim(state, `selected-${identifierPart(memberId)}-supplied`, memberId,
      "reference:member_of", context("during", [traceResult.forbiddenAttempt.reference_id]),
      [ref(POPULATION_IDS["forbidden-supplied-members"])]);
  }

  addClaim(state, "policy-authoritative-for-declared-members", SINGLETON_IDS["policy-source"],
    "reference:authoritative_for", context(), [ref(POPULATION_IDS["declared-members"])]);
  addClaim(state, "policy-authoritative-for-allowed-members", SINGLETON_IDS["policy-source"],
    "reference:authoritative_for", context(), [ref(POPULATION_IDS["allowed-members"])]);
  addClaim(state, "policy-authoritative-for-forbidden-members", SINGLETON_IDS["policy-source"],
    "reference:authoritative_for", context(), [ref(POPULATION_IDS["forbidden-members"])]);
  addClaim(state, "accepted-request-source-targets-request", SINGLETON_IDS["accepted-request-source"],
    "reference:resolves_to", context(), [ref(traceResult.acceptedRequest.reference_id)]);
  addClaim(state, "forbidden-request-source-targets-request",
    SINGLETON_IDS["forbidden-request-source"], "reference:resolves_to", context(),
    [ref(traceResult.forbiddenRequest.reference_id)]);
  addClaim(state, "accepted-request-targets-interface", traceResult.acceptedRequest.reference_id,
    "reference:targets", context(), [ref(policy.interfaceRole.reference_id)]);
  addClaim(state, "forbidden-request-targets-interface", traceResult.forbiddenRequest.reference_id,
    "reference:targets", context(), [ref(policy.interfaceRole.reference_id)]);
  addClaim(state, "accepted-request-depends-on-attempt", traceResult.acceptedRequest.reference_id,
    "reference:depends_on", context(), [ref(traceResult.acceptedAttempt.reference_id)]);
  addClaim(state, "forbidden-request-depends-on-attempt", traceResult.forbiddenRequest.reference_id,
    "reference:depends_on", context(), [ref(traceResult.forbiddenAttempt.reference_id)]);
  addClaim(state, "acceptance-accepts-request", policy.parserRole.reference_id,
    "reference:accepts", context("during", [traceResult.acceptedAttempt.reference_id]),
    [ref(traceResult.acceptedRequest.reference_id)]);
  addClaim(state, "refusal-rejects-request", traceResult.refusal.reference_id,
    "reference:rejects", context("during", [traceResult.forbiddenAttempt.reference_id]),
    [ref(traceResult.forbiddenRequest.reference_id)]);
  addClaim(state, "cut-follows-refusal", traceResult.cut.reference_id,
    "reference:follows", context("during", [traceResult.forbiddenAttempt.reference_id]),
    [ref(traceResult.refusal.reference_id)]);
  addClaim(state, "path-like-control-is-accepted-member", SINGLETON_IDS["path-like-control"],
    "reference:depends_on", context("during", [traceResult.acceptedRequest.reference_id]),
    [ref(memberRefs.get(pathKey(policy.pathLikeControl.path)).reference_id)]);
  addClaim(state, "path-like-control-exists", SINGLETON_IDS["path-like-control"],
    "boolean:exists", context("during", [traceResult.acceptedRequest.reference_id]), [bool(true)]);

  for (const declaration of policy.declarations) {
    const memberId = memberRefs.get(pathKey(declaration.path)).reference_id;
    const classificationPopulation = declaration.classification === "allowed"
      ? POPULATION_IDS["allowed-members"] : POPULATION_IDS["forbidden-members"];
    addClaim(state, `member-${memberId.slice("ref-cia-member-".length)}-classification`, memberId,
      "reference:member_of", context(), [ref(classificationPopulation)]);
    if (declaration.classification === "authority_bearing_forbidden") {
      addClaim(state, `member-${identifierPart(memberId)}-authority-classification`, memberId,
        "reference:classifies_as", context(), [ref(classificationIds.authority)]);
      for (const coordinateId of declaration.coordinateIds) addClaim(
        state, `member-${identifierPart(memberId)}-targets-${identifierPart(coordinateId)}`, memberId,
        "reference:targets", context(), [ref(coordinateId)]
      );
    }
  }
  for (const coordinate of policy.coordinates) {
    addClaim(state, `coordinate-${identifierPart(coordinate.reference.reference_id)}-classification`,
      coordinate.reference.reference_id, "reference:classifies_as", context(),
      [ref(classificationIds.coordinate)]);
    for (const operationId of coordinate.operationIds) {
    addClaim(state,
      `coordinate-${identifierPart(coordinate.reference.reference_id)}-uses-${identifierPart(operationId)}`,
      coordinate.reference.reference_id, "reference:uses", context(), [ref(operationId)]);
    }
  }
  for (const operation of policy.operations) for (const effectId of operation.effectReferenceIds) {
    addClaim(state,
      `operation-${identifierPart(operation.reference.reference_id)}-targets-${identifierPart(effectId)}`,
      operation.reference.reference_id, "reference:targets", context(), [ref(effectId)]);
  }
  for (const source of policy.boundarySources) {
    addClaim(state, `source-${source.family}-covers-family`, source.source.reference_id,
      "reference:covers", context("during", [traceResult.forbiddenAttempt.reference_id]),
      [ref(`ref-cia-family-${source.family}`)]);
    addClaim(state, `family-${source.family}-classification`, `ref-cia-family-${source.family}`,
      "reference:classifies_as", context(), [ref(classificationIds.family)]);
  }
  for (const sourceId of mandatorySourceIds) addClaim(
    state, `mandatory-source-${sourceId}-observed`, sourceId, "reference:member_of",
    context("during", [traceResult.forbiddenAttempt.reference_id]),
    [ref(POPULATION_IDS["observed-sources"])]
  );
  for (const sourceId of observedSourceIds) addClaim(
    state, `observed-source-${sourceId}-mandatory`, sourceId, "reference:member_of",
    context("during", [traceResult.forbiddenAttempt.reference_id]),
    [ref(POPULATION_IDS["mandatory-sources"])]
  );

  for (const memberId of forbiddenIds) addVerifiedClaim(state, {
    id: `forbidden-member-${identifierPart(memberId)}-absent-from-accepted-request`,
    subject: memberId,
    operator: "reference:not_member_of",
    complement: "reference:member_of",
    applicability: context("during", [
      traceResult.acceptedRequest.reference_id, classificationIds.authority
    ]),
    operands: [ref(POPULATION_IDS["accepted-supplied-members"])]
  });
  for (const coordinateId of coordinateIds) addVerifiedClaim(state, {
    id: `coordinate-${identifierPart(coordinateId)}-absent-from-accepted-request`,
    subject: coordinateId,
    operator: "reference:not_member_of",
    complement: "reference:member_of",
    applicability: context("during", [
      traceResult.acceptedRequest.reference_id, classificationIds.coordinate
    ]),
    operands: [ref(POPULATION_IDS["accepted-supplied-members"])]
  });
  for (const family of PROHIBITED_FAMILIES) addVerifiedClaim(state, {
    id: `no-${family}-occurrence-before-refusal`,
    subject: traceResult.forbiddenAttempt.reference_id,
    operator: "reference:performs",
    modality: "MUST_NOT",
    complement: "reference:performs",
    applicability: context("before", [traceResult.refusal.reference_id, classificationIds.family]),
    operands: [ref(`ref-cia-family-${family}`)]
  });
  addClaim(state, "projection-exists", SINGLETON_IDS["projection-result"], "boolean:exists",
    context(), [bool(true)]);

  const contract = {
    schema_version: CONTRACT_VERSION,
    vocabulary_version: "cv.experimental.0.34",
    profile_id: "acceptance-contract.standard.experimental.v0.2",
    references: [...state.references.values()].sort((left, right) =>
      compareCodeUnits(left.reference_id, right.reference_id)),
    propositions: state.propositions.sort((left, right) =>
      compareCodeUnits(left.proposition_id, right.proposition_id)),
    claims: state.claims.sort((left, right) => compareCodeUnits(left.claim_id, right.claim_id)),
    relations: state.relations.sort((left, right) =>
      compareCodeUnits(left.relation_id, right.relation_id)),
    collections: [], residue: [], annotations: []
  };
  return {
    schema_version: RESULT_VERSION,
    transformer_id: TRANSFORMER_ID,
    source_content_sha256: [...sourceDigests],
    populations: Object.fromEntries(Object.entries(populationMembers).sort(([left], [right]) =>
      compareCodeUnits(left, right))),
    singletons: {
      acceptance: traceResult.acceptance.reference_id,
      "accepted-attempt": traceResult.acceptedAttempt.reference_id,
      "accepted-request": traceResult.acceptedRequest.reference_id,
      "accepted-request-source": SINGLETON_IDS["accepted-request-source"],
      "capture-proof": SINGLETON_IDS["capture-proof"],
      "forbidden-attempt": traceResult.forbiddenAttempt.reference_id,
      "forbidden-request": traceResult.forbiddenRequest.reference_id,
      "forbidden-request-source": SINGLETON_IDS["forbidden-request-source"],
      interface: policy.interfaceRole.reference_id,
      "observation-cut": traceResult.cut.reference_id,
      "observation-evidence": SINGLETON_IDS["observation-evidence"],
      parser: policy.parserRole.reference_id,
      "path-like-control": SINGLETON_IDS["path-like-control"],
      "policy-source": SINGLETON_IDS["policy-source"],
      "projection-result": SINGLETON_IDS["projection-result"],
      refusal: traceResult.refusal.reference_id,
      verification: SINGLETON_IDS.verification
    },
    contract
  };
}

function parseSources(sourceBytes) {
  if (!Array.isArray(sourceBytes) || sourceBytes.length !== 5) fail(
    "projection_source_set_invalid",
    "caller-input projection requires five positionally bound exact sources"
  );
  const values = sourceBytes.map((bytes, index) =>
    parseCanonicalDocument(bytes, `caller-input source[${index}]`));
  const [policy, acceptedRequest, forbiddenRequest, evidence, proof] = values;
  if (policy?.schema_version !== POLICY_VERSION ||
      acceptedRequest === null || typeof acceptedRequest !== "object" ||
      Array.isArray(acceptedRequest) ||
      forbiddenRequest === null || typeof forbiddenRequest !== "object" ||
      Array.isArray(forbiddenRequest) ||
      evidence?.schema_version !== SOUND_NEGATIVE_EVIDENCE_VERSION ||
      proof?.schema_version !== SOUND_NEGATIVE_PROOF_VERSION) fail(
    "projection_source_set_invalid",
    "caller-input sources do not match the closed positional policy, request, request, evidence, proof shape"
  );
  const evidenceDigest = sha256(sourceBytes[3]);
  if (proof.evidence_sha256 !== evidenceDigest) fail(
    "caller_input_capture_proof_mismatch", "capture proof does not name the exact evidence source"
  );
  return values;
}

function transform(sourceValues, sourceDigests) {
  return deriveResult(sourceValues, sourceDigests);
}

function fixedReference(result, referenceId) {
  const reference = result.contract.references.find(({ reference_id: id }) => id === referenceId);
  if (!reference) fail(
    "caller_input_projection_reference_missing", "projected reference is missing", { referenceId }
  );
  return {
    grounded_identity_sha256: canonicalDigest(reference.identity),
    reference_id: reference.reference_id,
    type_term: reference.type_term
  };
}

function assertResult(value) {
  if (!exactKeys(value, [
    "contract", "populations", "schema_version", "singletons", "source_content_sha256",
    "transformer_id"
  ]) || value.schema_version !== RESULT_VERSION || value.transformer_id !== TRANSFORMER_ID ||
      !Array.isArray(value.source_content_sha256) || value.source_content_sha256.length !== 5 ||
      value.source_content_sha256.some((digest) => !SHA256.test(digest)) ||
      !exactKeys(value.populations, Object.keys(POPULATION_IDS)) ||
      !exactKeys(value.singletons, Object.keys(SINGLETON_IDS))) fail(
    "caller_input_projection_result_invalid", "combined projection result has an invalid shape"
  );
  const graph = validateProjectedContractWithStableCore(value.contract);
  if (!graph.schema_valid || graph.diagnostics.length !== 0) fail(
    "caller_input_projection_result_invalid",
    "combined projected contract graph is not a valid closed graph",
    { diagnostics: graph.diagnostics, schema_errors: graph.schema_errors }
  );
  for (const [name, members] of Object.entries(value.populations)) {
    if (!Array.isArray(members) || !sortedUnique(members) || members.some((id) =>
      !value.contract.references.some(({ reference_id: referenceId }) => referenceId === id))) fail(
      "caller_input_projection_population_invalid", "projection population is not exact",
      { population: name }
    );
  }
  for (const [name, referenceId] of Object.entries(value.singletons)) {
    if (typeof referenceId !== "string" || !value.contract.references.some(
      ({ reference_id: id }) => id === referenceId)) fail(
      "caller_input_projection_singleton_invalid", "projection singleton is unavailable", { name }
    );
  }
  return deepFreeze(value);
}

const projections = {};
for (const [name, populationReferenceId] of Object.entries(POPULATION_IDS)) {
  projections[name] = Object.freeze({
    cardinality: "set", project: (result) => [...result.populations[name]]
  });
  projections[`${name}-population`] = Object.freeze({
    cardinality: "singleton_reference",
    project: (result) => fixedReference(result, populationReferenceId)
  });
}
for (const name of Object.keys(SINGLETON_IDS)) projections[name] = Object.freeze({
  cardinality: "singleton_reference",
  project: (result) => fixedReference(result, result.singletons[name])
});

function projectGraph(result) {
  return {
    schema_version: GRAPH_VERSION,
    references: structuredClone(result.contract.references),
    propositions: structuredClone(result.contract.propositions),
    claims: structuredClone(result.contract.claims),
    relations: structuredClone(result.contract.relations),
    collections: structuredClone(result.contract.collections)
  };
}

const CALLER_INPUT_AUTHORITY_CONFINEMENT_TRANSFORMER = Object.freeze({
  transformer_id: TRANSFORMER_ID,
  source_count: 5,
  parse_sources: parseSources,
  transform,
  validate_result: assertResult,
  projections: Object.freeze(projections),
  graph_projections: Object.freeze({
    "caller-input-authority-contract": Object.freeze({ project: projectGraph })
  })
});

function deriveCallerInputAuthorityConfinementCapture({
  policyBytes,
  acceptedRequestBytes,
  forbiddenRequestBytes,
  observationEvidenceBytes,
  observationCaptureProofBytes
}) {
  const sources = [
    policyBytes,
    acceptedRequestBytes,
    forbiddenRequestBytes,
    observationEvidenceBytes,
    observationCaptureProofBytes
  ];
  if (sources.some((source) => !Buffer.isBuffer(source))) fail(
    "projection_source_set_incomplete",
    "caller-input authority confinement requires five exact Buffer sources"
  );
  const values = parseSources(sources);
  const digests = sources.map((source) => sha256(source));
  const first = canonicalJsonBytes(assertResult(transform(structuredClone(values), digests)), {
    file: true
  });
  const second = canonicalJsonBytes(assertResult(transform(structuredClone(values), digests)), {
    file: true
  });
  if (!first.equals(second)) fail(
    "projection_transformer_nondeterministic",
    "caller-input authority-confinement projection is nondeterministic"
  );
  return Buffer.from(first);
}

export {
  CALLER_INPUT_AUTHORITY_CONFINEMENT_TRANSFORMER,
  POLICY_VERSION,
  POPULATION_IDS,
  PROHIBITED_FAMILIES,
  RESULT_VERSION,
  SINGLETON_IDS,
  TRACE_VERSION,
  TRANSFORMER_ID,
  assertResult as assertCallerInputAuthorityConfinementCapture,
  deriveCallerInputAuthorityConfinementCapture
};
