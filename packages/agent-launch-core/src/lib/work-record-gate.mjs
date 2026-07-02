

import { buildLaunchPrompt } from "./work-record-launch-prompt.mjs";

import { evaluateRemoteWorkerAdmissionWrapperGate } from "./worker-admission-remote-gate.mjs";

export const WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION = "work-record-wrapper-gate.v1";

export const WORK_RECORD_WRAPPER_GATE_CODES = Object.freeze([
  "gate_passed",
  "readiness_not_dispatchable",
  "missing_agent_brief",
  "stale_agent_brief",
  "unit_mismatch",
  "invalid_gate_input",

  "worker_admission_refused",
  "unsupported_role"
]);

export const WORK_RECORD_WRAPPER_GATE_ROLES = Object.freeze(["worker"]);

const SLICE_ID_BODY = "(?:SLICE-[0-9]{3}|[a-z0-9][a-z0-9-]*)";
const SLICE_ID_PATTERN = new RegExp(`^${SLICE_ID_BODY}$`);

export const DISPATCH_READINESS_ACCEPTED_ESCALATION_DECISION_CODE =
  "dispatchable_with_accepted_escalation";

export const DISPATCH_READINESS_DEPENDENCY_PROVENANCE_KINDS = Object.freeze([
  "canonical_wk_json",
  "supplied",
  "none"
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function summarizeDispatchReadinessDependencies(readiness) {
  const empty = {
    entries: [],
    preparation_audit: null,
    provenance_summary: {
      count: 0,
      canonical_wk_json: 0,
      supplied: 0,
      none: 0,
      other: 0
    }
  };
  if (!isObject(readiness) || !Array.isArray(readiness.derived_evidence)) {
    return empty;
  }
  let entries = [];
  let preparationAudit = null;
  for (const entry of readiness.derived_evidence) {
    if (!isObject(entry)) {
      continue;
    }
    if (entry.kind === "dispatch_readiness_dependencies" && Array.isArray(entry.dependencies)) {
      entries = cloneJson(entry.dependencies);
    } else if (entry.kind === "dispatch_readiness_preparation_audit") {
      preparationAudit = cloneJson(entry);
    }
  }
  const provenance = {
    count: entries.length,
    canonical_wk_json: 0,
    supplied: 0,
    none: 0,
    other: 0
  };
  for (const entry of entries) {
    const tag = isNonEmptyString(entry?.provenance) ? entry.provenance : "none";
    if (DISPATCH_READINESS_DEPENDENCY_PROVENANCE_KINDS.includes(tag)) {
      provenance[tag] += 1;
    } else {
      provenance.other += 1;
    }
  }
  return {
    entries,
    preparation_audit: preparationAudit,
    provenance_summary: provenance
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isString(value) {
  return typeof value === "string";
}

function createDiagnostic(code, message, extra = {}) {
  return { code, message, ...extra };
}

export function parseWorkRecordUnitAddress(unitAddress) {
  if (!isNonEmptyString(unitAddress)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic("invalid_gate_input", "unit address is required", {
          path: "unit_address"
        })
      ]
    };
  }

  const pieces = String(unitAddress).split("#");
  if (pieces.length > 2 || !/^WK-[0-9]{4}$/.test(pieces[0])) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic("invalid_gate_input", `invalid unit address: ${unitAddress}`, {
          path: "unit_address"
        })
      ]
    };
  }

  if (pieces.length === 1) {
    return {
      ok: true,
      value: {
        kind: "work_item",
        address: pieces[0],
        record_id: pieces[0],
        slice_id: null
      },
      diagnostics: []
    };
  }

  const sliceId = pieces[1];
  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic("invalid_gate_input", `invalid unit slice id: ${sliceId}`, {
          path: "unit_address"
        })
      ]
    };
  }

  return {
    ok: true,
    value: {
      kind: "slice",
      address: unitAddress,
      record_id: pieces[0],
      slice_id: sliceId
    },
    diagnostics: []
  };
}

function expectedProjectionId(unit) {
  return unit.slice_id ? `${unit.record_id}.${unit.slice_id}.agent_brief` : `${unit.record_id}.agent_brief`;
}

function normalizeReadinessEnvelope(readiness) {
  if (!isObject(readiness)) {
    return {
      ok: false,
      diagnostics: [createDiagnostic("invalid_gate_input", "dispatch readiness is required", { path: "readiness" })]
    };
  }

  if (readiness.schema_version !== "dispatch-readiness.v1") {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic(
          "invalid_gate_input",
          "dispatch readiness schema_version must be dispatch-readiness.v1",
          { path: "readiness.schema_version" }
        )
      ]
    };
  }

  if (!isObject(readiness.unit)) {
    return {
      ok: false,
      diagnostics: [createDiagnostic("invalid_gate_input", "dispatch readiness unit is required", { path: "readiness.unit" })]
    };
  }

  if (!isNonEmptyString(readiness.unit.address) || !isNonEmptyString(readiness.unit.record_id)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic("invalid_gate_input", "dispatch readiness unit is malformed", {
          path: "readiness.unit"
        })
      ]
    };
  }

  if (typeof readiness.dispatchable !== "boolean" || !isNonEmptyString(readiness.decision_code)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic(
          "invalid_gate_input",
          "dispatch readiness must include dispatchable and decision_code",
          { path: "readiness" }
        )
      ]
    };
  }

  return { ok: true, value: cloneJson(readiness), diagnostics: [] };
}

function normalizeAgentBrief(agentBrief) {
  if (!isObject(agentBrief)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic("missing_agent_brief", "agent brief projection is required", {
          path: "agent_brief"
        })
      ]
    };
  }

  if (!isString(agentBrief.brief) || agentBrief.brief.trim() === "") {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic("invalid_gate_input", "agent brief text is required", {
          path: "agent_brief.brief"
        })
      ]
    };
  }

  if (!isObject(agentBrief.projection)) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic("invalid_gate_input", "agent brief projection metadata is required", {
          path: "agent_brief.projection"
        })
      ]
    };
  }

  return {
    ok: true,
    value: {
      brief: agentBrief.brief,
      projection: cloneJson(agentBrief.projection)
    },
    diagnostics: []
  };
}

function normalizeCanonicalSummary(canonicalSummary) {
  if (!isObject(canonicalSummary)) {
    return null;
  }

  return {
    record_id: isNonEmptyString(canonicalSummary.record_id) ? canonicalSummary.record_id : null,
    repo: isNonEmptyString(canonicalSummary.repo) ? canonicalSummary.repo : null,
    title: isNonEmptyString(canonicalSummary.title) ? canonicalSummary.title : null,
    docs: Array.isArray(canonicalSummary.docs) ? canonicalSummary.docs.filter(isNonEmptyString) : [],
    repo_paths: Array.isArray(canonicalSummary.repo_paths)
      ? canonicalSummary.repo_paths.filter(isNonEmptyString)
      : [],
    write_scope: Array.isArray(canonicalSummary.write_scope)
      ? canonicalSummary.write_scope.filter(isNonEmptyString)
      : [],

    acceptance_criteria: Array.isArray(canonicalSummary.acceptance_criteria)
      ? canonicalSummary.acceptance_criteria
          .map(normalizeAcceptanceCriterionEntry)
          .filter((entry) => entry !== null)
      : [],
    validation_commands: Array.isArray(canonicalSummary.validation_commands)
      ? canonicalSummary.validation_commands.filter(isNonEmptyString)
      : [],
    dispatch_intent: isObject(canonicalSummary.dispatch_intent)
      ? cloneJson(canonicalSummary.dispatch_intent)
      : null,
    selected_unit: isObject(canonicalSummary.selected_unit) ? cloneJson(canonicalSummary.selected_unit) : null,
    accepted_escalations: Array.isArray(canonicalSummary.accepted_escalations)
      ? cloneJson(canonicalSummary.accepted_escalations)
      : [],
    canonical_refs: Array.isArray(canonicalSummary.canonical_refs)
      ? cloneJson(canonicalSummary.canonical_refs)
      : [],
    derived_evidence: Array.isArray(canonicalSummary.derived_evidence)
      ? cloneJson(canonicalSummary.derived_evidence)
      : [],
    state: isObject(canonicalSummary.state) ? cloneJson(canonicalSummary.state) : null
  };
}

function normalizeAcceptanceCriterionEntry(entry) {
  if (isNonEmptyString(entry)) {
    return entry;
  }
  if (isObject(entry) && isNonEmptyString(entry.text)) {
    return {
      text: entry.text,
      verification_method: isNonEmptyString(entry.verification_method)
        ? entry.verification_method
        : null,
      evidence_target: isNonEmptyString(entry.evidence_target)
        ? entry.evidence_target
        : null
    };
  }
  return null;
}

export function evaluateWorkRecordWrapperGate(args = {}) {
  const result = evaluateWorkRecordWrapperGateInternal(args);
  result.dependency_evidence = summarizeDispatchReadinessDependencies(result.readiness);
  return result;
}

function evaluateWorkRecordWrapperGateInternal({
  role,
  unitAddress,
  readiness,
  sourceDigest,
  canonicalSummary,
  agentBrief,
  workerAdmission = null,
  remoteWorkerAdmission = null,
  launchTimestamp = new Date().toISOString(),
  supplementalInstructions = []
} = {}) {
  const parsedUnit = parseWorkRecordUnitAddress(unitAddress);
  const normalizedReadiness = normalizeReadinessEnvelope(readiness);

  if (!parsedUnit.ok || !normalizedReadiness.ok) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "invalid_gate_input",
      role: isString(role) ? role : "unknown",
      unit_address: isString(unitAddress) ? unitAddress : "",
      diagnostics: [
        ...(parsedUnit.diagnostics || []),
        ...(normalizedReadiness.diagnostics || [])
      ],
      readiness: normalizedReadiness.ok ? normalizedReadiness.value : cloneJson(readiness ?? null),
      agent_brief: null,
      launch_packet: null
    };
  }

  const { value: unit } = parsedUnit;
  if (!isString(sourceDigest) || sourceDigest.trim() === "") {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "invalid_gate_input",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic("invalid_gate_input", "canonical source digest is required", {
          path: "source_digest"
        })
      ],
      readiness: normalizedReadiness.value,
      agent_brief: null,
      launch_packet: null
    };
  }
  const sourceDigestText = sourceDigest.trim();

  if (!WORK_RECORD_WRAPPER_GATE_ROLES.includes(role)) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "unsupported_role",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "unsupported_role",
          `implementation worker gate does not support role ${role}`,
          { path: "role" }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: null,
      launch_packet: null
    };
  }

  if (!normalizedReadiness.value.dispatchable) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "readiness_not_dispatchable",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "readiness_not_dispatchable",
          `dispatch readiness is ${normalizedReadiness.value.decision_code}`,
          { path: "readiness.decision_code" }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: null,
      launch_packet: null
    };
  }

  const normalizedBrief = normalizeAgentBrief(agentBrief);
  const summary = normalizeCanonicalSummary(canonicalSummary);
  if (!normalizedBrief.ok || !summary) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: normalizedBrief.ok ? "invalid_gate_input" : "missing_agent_brief",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: normalizedBrief.ok
        ? [createDiagnostic("invalid_gate_input", "canonical summary is required", { path: "canonical_summary" })]
        : normalizedBrief.diagnostics,
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.ok ? normalizedBrief.value : null,
      launch_packet: null
    };
  }

  const expectedProjectionIdValue = expectedProjectionId(unit);
  const projection = normalizedBrief.value.projection;

  if (projection.schema_version !== "work-record-render.v1" || projection.projection_kind !== "agent_brief") {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "invalid_gate_input",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "invalid_gate_input",
          "agent brief must be a work-record-render.v1 agent_brief projection",
          { path: "agent_brief.projection" }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.value,
      launch_packet: null
    };
  }

  if (projection.authority !== "generated_projection" || !isNonEmptyString(projection.source_record_id)) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "invalid_gate_input",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "invalid_gate_input",
          "agent brief projection authority must be generated_projection and source_record_id must be present",
          { path: "agent_brief.projection" }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.value,
      launch_packet: null
    };
  }

  if (projection.projection_id !== expectedProjectionIdValue || projection.source_record_id !== unit.record_id) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "unit_mismatch",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "unit_mismatch",
          `agent brief projection does not match requested unit ${unit.address}`,
          {
            path: "agent_brief.projection.projection_id",
            expected_projection_id: expectedProjectionIdValue,
            actual_projection_id: projection.projection_id
          }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.value,
      launch_packet: null
    };
  }

  if (!isString(projection.source_digest) || projection.source_digest !== sourceDigestText) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "stale_agent_brief",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "stale_agent_brief",
          "agent brief source_digest does not match the canonical source digest",
          {
            path: "agent_brief.projection.source_digest",
            expected_source_digest: sourceDigestText,
            actual_source_digest: projection.source_digest
          }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.value,
      launch_packet: null
    };
  }

  const nodeEngineAdmissibility = evaluateRemoteWorkerAdmissionWrapperGate({
    localAllowed: true,
    remote: remoteWorkerAdmission,
    unitAddress: unit.address
  });
  if (!nodeEngineAdmissibility.allowed) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "worker_admission_refused",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      decision_code: null,
      diagnostics: [
        createDiagnostic(
          "worker_admission_refused",
          `Node Engine worker-admission admissibility blocks launch for ${unit.address} (${nodeEngineAdmissibility.remote_gate_code})`,
          { path: "remote_worker_admission", remote_gate_code: nodeEngineAdmissibility.remote_gate_code }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.value,
      remote_worker_admission: nodeEngineAdmissibility,
      launch_packet: null
    };
  }

  return {
    schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
    allowed: true,
    wrapper_gate_code: "gate_passed",
    role,
    unit_address: unit.address,
    expected_unit_address: normalizedReadiness.value.unit.address,
    diagnostics: [],
    readiness: normalizedReadiness.value,
    agent_brief: normalizedBrief.value,

    remote_worker_admission: nodeEngineAdmissibility,
    launch_packet: buildWorkRecordLaunchPacket({
      role,
      unitAddress: unit.address,
      readiness: normalizedReadiness.value,
      sourceDigest: sourceDigestText,
      canonicalSummary: summary,
      agentBrief: normalizedBrief.value,
      supplementalInstructions,
      launchTimestamp
    })
  };
}

export function buildWorkRecordLaunchPacket({
  role,
  unitAddress,
  readiness,
  sourceDigest,
  canonicalSummary,
  agentBrief,
  launchTimestamp = new Date().toISOString(),
  supplementalInstructions = []
} = {}) {
  const parsedUnit = parseWorkRecordUnitAddress(unitAddress);
  const normalizedReadiness = normalizeReadinessEnvelope(readiness);
  const normalizedBrief = normalizeAgentBrief(agentBrief);
  const summary = normalizeCanonicalSummary(canonicalSummary);

  if (!parsedUnit.ok || !normalizedReadiness.ok || !normalizedBrief.ok || !summary) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "invalid_gate_input",
      role: isString(role) ? role : "unknown",
      unit_address: isString(unitAddress) ? unitAddress : "",
      diagnostics: [
        ...(parsedUnit.diagnostics || []),
        ...(normalizedReadiness.diagnostics || []),
        ...(normalizedBrief.diagnostics || [])
      ],
      readiness: normalizedReadiness.ok ? normalizedReadiness.value : cloneJson(readiness ?? null),
      agent_brief: normalizedBrief.ok ? normalizedBrief.value : null,
      launch_packet: null
    };
  }

  const { value: unit } = parsedUnit;
  const expectedProjectionIdValue = expectedProjectionId(unit);
  const projection = normalizedBrief.value.projection;
  const launchSupplementalInstructions = Array.isArray(supplementalInstructions)
    ? supplementalInstructions.filter(isNonEmptyString)
    : [];

  if (!isString(sourceDigest) || sourceDigest.trim() === "") {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "invalid_gate_input",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic("invalid_gate_input", "canonical source digest is required", {
          path: "source_digest"
        })
      ],
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.value,
      launch_packet: null
    };
  }
  const sourceDigestText = sourceDigest.trim();

  if (!WORK_RECORD_WRAPPER_GATE_ROLES.includes(role)) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "unsupported_role",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "unsupported_role",
          `implementation worker gate does not support role ${role}`,
          { path: "role" }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.value,
      launch_packet: null
    };
  }

  if (!normalizedReadiness.value.dispatchable) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "readiness_not_dispatchable",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "readiness_not_dispatchable",
          `dispatch readiness is ${normalizedReadiness.value.decision_code}`,
          { path: "readiness.decision_code" }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: null,
      launch_packet: null
    };
  }

  if (projection.schema_version !== "work-record-render.v1" || projection.projection_kind !== "agent_brief") {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "invalid_gate_input",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "invalid_gate_input",
          "agent brief must be a work-record-render.v1 agent_brief projection",
          { path: "agent_brief.projection" }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.value,
      launch_packet: null
    };
  }

  if (projection.authority !== "generated_projection" || !isNonEmptyString(projection.source_record_id)) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "invalid_gate_input",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "invalid_gate_input",
          "agent brief projection authority must be generated_projection and source_record_id must be present",
          { path: "agent_brief.projection" }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.value,
      launch_packet: null
    };
  }

  if (projection.projection_id !== expectedProjectionIdValue || projection.source_record_id !== unit.record_id) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "unit_mismatch",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "unit_mismatch",
          `agent brief projection does not match requested unit ${unit.address}`,
          {
            path: "agent_brief.projection.projection_id",
            expected_projection_id: expectedProjectionIdValue,
            actual_projection_id: projection.projection_id
          }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.value,
      launch_packet: null
    };
  }

  if (!isString(projection.source_digest) || projection.source_digest !== sourceDigestText) {
    return {
      schema_version: WORK_RECORD_WRAPPER_GATE_SCHEMA_VERSION,
      allowed: false,
      wrapper_gate_code: "stale_agent_brief",
      role,
      unit_address: unit.address,
      expected_unit_address: normalizedReadiness.value.unit.address,
      diagnostics: [
        createDiagnostic(
          "stale_agent_brief",
          "agent brief source_digest does not match the canonical source digest",
          {
            path: "agent_brief.projection.source_digest",
            expected_source_digest: sourceDigestText,
            actual_source_digest: projection.source_digest
          }
        )
      ],
      readiness: normalizedReadiness.value,
      agent_brief: normalizedBrief.value,
      launch_packet: null
    };
  }

  return {
    unit_address: unit.address,
    record_id: unit.record_id,
    slice_id: unit.slice_id,
    role,
    source_digest: sourceDigestText,
    launch_timestamp: launchTimestamp,
    canonical_summary: summary,
    readiness: normalizedReadiness.value,
    agent_brief: normalizedBrief.value,
    prompt: buildLaunchPrompt({
      role,
      unit,
      canonicalSummary: summary,
      readiness: normalizedReadiness.value,
      agentBrief: normalizedBrief.value,
      launchTimestamp,
      supplementalInstructions: launchSupplementalInstructions
    })
  };
}
