import {
  canonicalDigest,
  canonicalJsonBytes,
  sha256
} from "../../lib/exact-binding-common.mjs";
import {
  executeDeterministicProjection
} from "../../lib/deterministic-projection.mjs";
import {
  POLICY_VERSION,
  PROHIBITED_FAMILIES,
  TRACE_VERSION,
  TRANSFORMER_ID
} from "../../lib/caller-input-authority-confinement-projection.mjs";
import {
  EVIDENCE_VERSION
} from "../../lib/sound-negative-observation-projection.mjs";
import {
  buildAuthenticationProvenanceSources,
  durableIdentity
} from "./authentication-provenance-v1-fixture.mjs";
import {
  signEnvelope
} from "./sound-negative-observation-v1-fixture.mjs";

const role = (referenceId, typeTerm, groundedIdentity) => ({
  grounded_identity: groundedIdentity,
  reference_id: referenceId,
  type_term: typeTerm
});
const objectKey = (value) => ({ kind: "object_key", value });
const arrayCarrier = () => ({ kind: "array_carrier" });
const arrayIndex = (index) => ({ kind: "array_index", index });
const path = (...tokens) => tokens;

function endpoint(source, boundary) {
  return {
    boundary,
    source: structuredClone(source),
    state: role(`ref-cia-endpoint-state-${source.reference_id.slice(4)}`, "cc:state",
      durableIdentity("caller-input:endpoint-state", source.reference_id)),
    version: role(`ref-cia-endpoint-version-${source.reference_id.slice(4)}`, "cc:state",
      durableIdentity("caller-input:endpoint-version", source.reference_id))
  };
}

function candidate(capture, endpointValue, sequence) {
  return {
    kind: "candidate",
    sequence,
    assigned_source: structuredClone(capture.roles.source),
    observation_attempt: structuredClone(capture.roles.attempt),
    observed_state: structuredClone(endpointValue.state),
    observed_version: structuredClone(endpointValue.version),
    resolved_target: structuredClone(capture.roles.target),
    evidence_content_base64: capture.input.evidenceContentBytes.toString("base64"),
    witnesses: {
      attempt_binding: capture.input.attemptBindingWitnessBytes.toString("base64"),
      authentication: capture.input.authenticationWitnessBytes.toString("base64"),
      source_authentication: capture.input.sourceAuthenticationWitnessBytes.toString("base64"),
      source_of_record: capture.input.sourceOfRecordAssignmentWitnessBytes.toString("base64"),
      target_resolution: capture.input.targetResolutionWitnessBytes.toString("base64")
    }
  };
}

function buildPolicy({ decoding = "none" } = {}) {
  const interfaceRole = role("ref-cia-request-interface", "cc:entity",
    durableIdentity("caller-input:interface", "document-query-v1"));
  const parserRole = role("ref-cia-parser", "cc:runtime_component",
    durableIdentity("caller-input:parser", "document-query-parser-v1"));
  const coordinateModule = role("ref-cia-coordinate-module", "cc:configuration",
    durableIdentity("caller-input:coordinate", "module"));
  const coordinateEnvironment = role("ref-cia-coordinate-environment", "cc:configuration",
    durableIdentity("caller-input:coordinate", "environment"));
  const coordinateServerRoot = role("ref-cia-coordinate-server-root", "cc:configuration",
    durableIdentity("caller-input:coordinate", "server-root"));
  const operationModule = role("ref-cia-operation-module", "cc:operation",
    durableIdentity("caller-input:operation", "module-resolution"));
  const operationEnvironment = role("ref-cia-operation-environment", "cc:operation",
    durableIdentity("caller-input:operation", "environment-selection"));
  const operationServerRoot = role("ref-cia-operation-server-root", "cc:operation",
    durableIdentity("caller-input:operation", "server-root-selection"));
  const effectImport = role("ref-cia-effect-import", "cc:resource",
    durableIdentity("caller-input:effect", "module-import"));
  const effectEnvironment = role("ref-cia-effect-environment", "cc:state",
    durableIdentity("caller-input:effect", "environment-selection"));
  const effectRead = role("ref-cia-effect-read", "cc:resource",
    durableIdentity("caller-input:effect", "filesystem-read"));
  const acceptedRequest = {
    items: [{ label: "quarterly" }],
    opaquePath: "../opaque-but-allowed.txt",
    options: { theme: "dark" },
    query: "status"
  };
  const forbiddenRequest = {
    options: { displayMode: "friendly" },
    query: "status"
  };
  const declarations = [
    [path(objectKey("items")), "allowed", []],
    [path(objectKey("items"), arrayCarrier(), arrayIndex(0)), "allowed", []],
    [path(objectKey("items"), arrayCarrier(), arrayIndex(0), objectKey("label")),
      "allowed", []],
    [path(objectKey("opaquePath")), "allowed", []],
    [path(objectKey("options")), "allowed", []],
    [path(objectKey("options"), objectKey("mode")), "authority_bearing_forbidden",
      [coordinateEnvironment.reference_id]],
    [path(objectKey("options"), objectKey("theme")), "allowed", []],
    [path(objectKey("query")), "allowed", []],
    [path(objectKey("label")), "authority_bearing_forbidden",
      [coordinateModule.reference_id]]
  ].map(([memberPath, classification, coordinateIds]) => ({
    path: memberPath,
    classification,
    resolution_coordinate_reference_ids: coordinateIds
  }));
  const sourceCaptures = [];
  const boundarySources = PROHIBITED_FAMILIES.map((family, index) => {
    const capture = buildAuthenticationProvenanceSources({
      evidenceContentBytes: Buffer.from(`placeholder:${family}\n`, "utf8"),
      occurrenceSuffix: "caller-authority-forbidden",
      targetSuffix: `cia-${index + 1}`,
      sourceSuffix: `cia-${index + 1}`,
      targetType: "cc:event",
      sourceType: "cc:runtime_component",
      attemptType: "cc:event"
    });
    sourceCaptures.push(capture);
    return { family, source: structuredClone(capture.roles.source), trace_carrier: index === 0 };
  });
  return {
    policy: {
      schema_version: POLICY_VERSION,
      interface: interfaceRole,
      parser: parserRole,
      transport_key_decoding: decoding,
      declarations,
      aliases: [{
        alias: path(objectKey("options"), objectKey("displayMode")),
        canonical: path(objectKey("options"), objectKey("mode"))
      }],
      resolution_coordinates: [
        { reference: coordinateEnvironment,
          operation_reference_ids: [operationEnvironment.reference_id] },
        { reference: coordinateModule,
          operation_reference_ids: [operationModule.reference_id] },
        { reference: coordinateServerRoot,
          operation_reference_ids: [operationServerRoot.reference_id] }
      ],
      operations: [
        { reference: operationEnvironment,
          effect_reference_ids: [effectEnvironment.reference_id] },
        { reference: operationModule, effect_reference_ids: [effectImport.reference_id] },
        { reference: operationServerRoot, effect_reference_ids: [effectRead.reference_id] }
      ],
      effects: [effectEnvironment, effectImport, effectRead],
      server_selected_coordinate_reference_ids: [coordinateServerRoot.reference_id],
      boundary_sources: boundarySources,
      path_like_control: {
        canonical_path: path(objectKey("opaquePath")),
        value_sha256: sha256(canonicalJsonBytes(acceptedRequest.opaquePath))
      }
    },
    acceptedRequest,
    forbiddenRequest,
    sourceCaptures,
    roles: {
      interface: interfaceRole,
      parser: parserRole,
      acceptedRequest: role("ref-cia-accepted-request", "cc:event",
        durableIdentity("caller-input:request", "accepted")),
      forbiddenRequest: role("ref-cia-forbidden-request", "cc:event",
        durableIdentity("caller-input:request", "forbidden")),
      acceptedAttempt: role("ref-cia-accepted-attempt", "cc:event",
        durableIdentity("caller-input:attempt", "accepted")),
      forbiddenAttempt: structuredClone(sourceCaptures[0].roles.attempt),
      acceptance: role("ref-cia-acceptance", "cc:event",
        durableIdentity("caller-input:disposition", "accepted")),
      refusal: role("ref-cia-refusal", "cc:event",
        durableIdentity("caller-input:disposition", "refused")),
      cut: role("ref-cia-observation-cut", "cc:event",
        durableIdentity("caller-input:cut", "refusal"))
    }
  };
}

function buildTrace(subject, acceptedBytes, forbiddenBytes, recordsMutator = null) {
  const { roles } = subject;
  const requestRecord = (kind, position, request, attempt, digest, extra = {}) => ({
    kind, position, request: structuredClone(request), attempt: structuredClone(attempt),
    request_sha256: digest, ...extra
  });
  const records = [
    requestRecord("request", 1, roles.acceptedRequest, roles.acceptedAttempt,
      sha256(acceptedBytes)),
    requestRecord("parser_attempt", 2, roles.acceptedRequest, roles.acceptedAttempt,
      sha256(acceptedBytes)),
    requestRecord("parser_disposition", 3, roles.acceptedRequest, roles.acceptedAttempt,
      sha256(acceptedBytes), { disposition: "accepted" }),
    requestRecord("acceptance", 4, roles.acceptedRequest, roles.acceptedAttempt,
      sha256(acceptedBytes), { acceptance: structuredClone(roles.acceptance) }),
    requestRecord("request", 5, roles.forbiddenRequest, roles.forbiddenAttempt,
      sha256(forbiddenBytes)),
    requestRecord("parser_attempt", 6, roles.forbiddenRequest, roles.forbiddenAttempt,
      sha256(forbiddenBytes)),
    requestRecord("parser_disposition", 7, roles.forbiddenRequest, roles.forbiddenAttempt,
      sha256(forbiddenBytes), { disposition: "refused" }),
    requestRecord("refusal", 8, roles.forbiddenRequest, roles.forbiddenAttempt,
      sha256(forbiddenBytes), { refusal: structuredClone(roles.refusal) }),
    requestRecord("observation_cut", 9, roles.forbiddenRequest, roles.forbiddenAttempt,
      sha256(forbiddenBytes), {
        cut: structuredClone(roles.cut), refusal: structuredClone(roles.refusal)
      })
  ];
  recordsMutator?.(records, subject);
  return {
    schema_version: TRACE_VERSION,
    interface: structuredClone(roles.interface),
    parser: structuredClone(roles.parser),
    records
  };
}

function rebuildCaptures(subject, traceBytes) {
  return subject.sourceCaptures.map((capture, index) => buildAuthenticationProvenanceSources({
    evidenceContentBytes: index === 0
      ? traceBytes : Buffer.from(`boundary:${PROHIBITED_FAMILIES[index]}\n`, "utf8"),
    occurrenceSuffix: "caller-authority-forbidden",
    targetSuffix: `cia-${index + 1}`,
    sourceSuffix: `cia-${index + 1}`,
    targetType: "cc:event",
    sourceType: "cc:runtime_component",
    attemptType: "cc:event"
  }));
}

function buildObservationEvidence(subject, captures, mutateEvidence = null) {
  const declaredSources = captures.map(({ roles }) => structuredClone(roles.source))
    .sort((left, right) => {
      const a = canonicalDigest(left.grounded_identity);
      const b = canonicalDigest(right.grounded_identity);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const sourceOutcomes = declaredSources.map((source, index) => {
    const capture = captures.find(({ roles }) =>
      canonicalDigest(roles.source.grounded_identity) === canonicalDigest(source.grounded_identity));
    const start = endpoint(source, "start");
    const end = endpoint(source, "end");
    return {
      kind: "observed",
      source,
      endpoints: [start, end],
      observations: [candidate(capture, end, 10 + index)]
    };
  });
  const evidence = {
    schema_version: EVIDENCE_VERSION,
    target: role("ref-cia-sound-negative-target", "cc:event",
      durableIdentity("caller-input:prohibited-occurrence", "absent")),
    attempt: structuredClone(subject.roles.forbiddenAttempt),
    interval: {
      start: role("ref-cia-observation-start", "cc:event",
        durableIdentity("caller-input:cut", "start")),
      end: structuredClone(subject.roles.cut),
      start_sequence: 10,
      end_sequence: 10 + captures.length - 1
    },
    declared_sources: declaredSources,
    source_outcomes: sourceOutcomes,
    declared_source_total: captures.length,
    declared_observation_total: captures.length
  };
  mutateEvidence?.(evidence, subject);
  return evidence;
}

function buildCallerInputAuthorityConfinementSources({
  mutatePolicy = null,
  mutateAcceptedRequest = null,
  mutateForbiddenRequest = null,
  mutateTraceRecords = null,
  mutateEvidence = null,
  decoding = "none"
} = {}) {
  const subject = buildPolicy({ decoding });
  mutatePolicy?.(subject.policy, subject);
  mutateAcceptedRequest?.(subject.acceptedRequest, subject);
  mutateForbiddenRequest?.(subject.forbiddenRequest, subject);
  const policyBytes = canonicalJsonBytes(subject.policy, { file: true });
  const acceptedRequestBytes = canonicalJsonBytes(subject.acceptedRequest, { file: true });
  const forbiddenRequestBytes = canonicalJsonBytes(subject.forbiddenRequest, { file: true });
  const trace = buildTrace(
    subject, acceptedRequestBytes, forbiddenRequestBytes, mutateTraceRecords
  );
  const traceBytes = canonicalJsonBytes(trace, { file: true });
  const captures = rebuildCaptures(subject, traceBytes);
  subject.roles.forbiddenAttempt = structuredClone(captures[0].roles.attempt);
  const evidence = buildObservationEvidence(subject, captures, mutateEvidence);
  const signed = signEnvelope(evidence, "caller-input-authority-confinement");
  const sourceBytes = [
    policyBytes, acceptedRequestBytes, forbiddenRequestBytes,
    signed.evidenceBytes, signed.captureProofBytes
  ];
  const projectionBytes = executeDeterministicProjection(TRANSFORMER_ID, sourceBytes);
  return {
    ...subject,
    trace,
    traceBytes,
    captures,
    evidence,
    ...signed,
    policyBytes,
    acceptedRequestBytes,
    forbiddenRequestBytes,
    sourceBytes,
    projectionBytes,
    projection: JSON.parse(projectionBytes.toString("utf8"))
  };
}

export {
  arrayCarrier,
  arrayIndex,
  buildCallerInputAuthorityConfinementSources,
  buildObservationEvidence,
  buildPolicy,
  buildTrace,
  candidate,
  objectKey,
  path,
  rebuildCaptures,
  role
};
