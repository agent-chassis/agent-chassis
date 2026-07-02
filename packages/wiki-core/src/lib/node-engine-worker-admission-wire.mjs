

import {
  WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS,
  NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
} from "./work-record-admission-derived-evidence.mjs";

export const NODE_ENGINE_WORKER_ADMISSION_PACK_INPUT_SCHEMA_VERSION =
  "worker_admission.pack_input.v1";
const NODE_ENGINE_ACCEPTED_AUTHORITY_CONTROL_NAMES = new Set([
  "write_scope_total_loc",
  "max_write_file_loc",
]);
const NODE_ENGINE_PRECONDITION_ENFORCEMENT_CONTRACT_VERSION = "precondition-graph.v1";

export const NODE_ENGINE_REVIEW_ATTESTATION_SCHEMA_VERSION = "worker_admission.review_attestation.v1";
const NODE_ENGINE_REVIEW_ATTESTATION_ACCEPTED_OUTCOMES = new Set([
  "no_findings",
  "passed_no_blocking_or_medium_findings",
]);
const NODE_ENGINE_REVIEW_ATTESTATION_REVIEWER_ROLE_CLASSES = new Set(["reviewer", "redteam"]);

const NODE_ENGINE_REVIEW_ATTESTATION_CONTROL_GRAMMAR = /^[a-z][a-z0-9_]*$/u;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimToNull(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function cloneNodeEngineWorkerAdmissionSubject(subject) {
  if (!isPlainObject(subject)) {
    return null;
  }

  const unit = isPlainObject(subject.unit)
    ? {
        record_id: typeof subject.unit.record_id === "string" ? subject.unit.record_id : null,
        slice_id: subject.unit.slice_id ?? null,
        address: typeof subject.unit.address === "string" ? subject.unit.address : null,
      }
    : null;

  return {
    kind: typeof subject.kind === "string" ? subject.kind : null,
    repo: typeof subject.repo === "string" ? subject.repo : null,
    unit,
  };
}

function cloneNodeEngineWorkerAdmissionLocalHardRefusal(localHardRefusal) {
  if (!isPlainObject(localHardRefusal) || localHardRefusal.refused !== true) {
    return null;
  }

  const refusal = {
    refused: true,
    reason_code: typeof localHardRefusal.reason_code === "string" ? localHardRefusal.reason_code : null,
    reason: typeof localHardRefusal.reason === "string" ? localHardRefusal.reason : null,
    evidence: isPlainObject(localHardRefusal.evidence) ? { ...localHardRefusal.evidence } : {},
  };

  if (Object.prototype.hasOwnProperty.call(localHardRefusal, "raised_by")) {
    refusal.raised_by = localHardRefusal.raised_by ?? null;
  }

  return refusal;
}

const NODE_ENGINE_WORKER_ADMISSION_WIRE_METRIC_KEYS = Object.freeze([
  "cluster_count",
  "blast_radius_severity",
  "write_scope_count",
  "max_write_file_loc",
  "write_scope_total_loc",
  "expected_changed_line_budget",
  "validation_command_count",
  "acceptance_criteria_count",
  "declared_runtime_mode_count",
  "artifact_kind_count",
]);

function cloneNodeEngineWorkerAdmissionMetrics(metrics) {
  if (!isPlainObject(metrics)) {
    return null;
  }

  const projected = {};
  for (const key of NODE_ENGINE_WORKER_ADMISSION_WIRE_METRIC_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(metrics, key) &&
      metrics[key] !== null &&
      metrics[key] !== undefined
    ) {
      projected[key] = metrics[key];
    }
  }

  return Object.keys(projected).length > 0 ? projected : null;
}

function normalizeNodeEngineBlastRadiusSeverity(value) {
  if (typeof value !== "string") {
    return null;
  }

  return {
    low: "none",
    none: "none",
    medium: "elevated",
    elevated: "elevated",
    critical: "critical",
  }[value.trim().toLowerCase()] ?? null;
}

function projectNodeEngineWorkerAdmissionMetrics(metrics, facts) {
  const projected = cloneNodeEngineWorkerAdmissionMetrics(metrics);
  if (!projected) {
    return null;
  }

  const blastRadius = isPlainObject(facts?.blast_radius) ? facts.blast_radius : null;
  const severity =
    normalizeNodeEngineBlastRadiusSeverity(metrics.blast_radius_severity) ??
    normalizeNodeEngineBlastRadiusSeverity(blastRadius?.level) ??
    normalizeNodeEngineBlastRadiusSeverity(facts?.blast_radius_severity);
  if (severity) {
    projected.blast_radius_severity = severity;
  }

  return projected;
}

function cloneNodeEngineWorkerAdmissionPreconditionEnforcement(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  return {
    enabled: value.enabled === true,
    contract_version:
      typeof value.contract_version === "string" && value.contract_version.trim() !== ""
        ? value.contract_version.trim()
        : NODE_ENGINE_PRECONDITION_ENFORCEMENT_CONTRACT_VERSION,
  };
}

function hasDeclaredPreconditionEngagement(facts, packInput) {
  return (
    cloneNodeEngineWorkerAdmissionPreconditionEnforcement(facts?.precondition_enforcement)?.enabled === true ||
    cloneNodeEngineWorkerAdmissionPreconditionEnforcement(packInput?.precondition_enforcement)?.enabled === true ||
    packInput?.precondition_enforcement?.enabled === true
  );
}

function resolveNodeEnginePreconditionGraphProducer(facts) {
  const candidates = [
    facts?.precondition_graph_producer,
    facts?.preconditionGraphProducer,
  ];

  return candidates.find((candidate) => typeof candidate === "function") ?? null;
}

function resolveNodeEnginePreconditionGraphTarget(facts) {
  const subject = isPlainObject(facts?.subject) ? facts.subject : null;
  const subjectUnit = isPlainObject(subject?.unit) ? subject.unit : null;

  return (
    trimToNull(subjectUnit?.address) ??
    trimToNull(subject?.address) ??
    trimToNull(subjectUnit?.record_id) ??
    trimToNull(subject?.record_id) ??
    trimToNull(facts?.address) ??
    trimToNull(facts?.unit?.address) ??
    trimToNull(facts?.unit?.record_id)
  );
}

function projectNodeEngineWorkerAdmissionPreconditionGraph(facts, packInput) {
  if (!hasDeclaredPreconditionEngagement(facts, packInput)) {
    return undefined;
  }

  if (facts?.precondition_graph !== undefined) {
    return facts.precondition_graph;
  }

  const producer = resolveNodeEnginePreconditionGraphProducer(facts);
  const target = resolveNodeEnginePreconditionGraphTarget(facts);
  if (!producer || !target) {
    return undefined;
  }

  return producer(target);
}

function projectNodeEngineAcceptedAuthorityControls(controls) {
  const recognizedControls = [];
  const seen = new Set();

  const pushControl = (control) => {
    if (
      typeof control === "string" &&
      control.trim() !== "" &&
      NODE_ENGINE_ACCEPTED_AUTHORITY_CONTROL_NAMES.has(control) &&
      !seen.has(control)
    ) {
      seen.add(control);
      recognizedControls.push(control);
    }
  };

  if (Array.isArray(controls)) {
    for (const control of controls) {
      pushControl(typeof control === "string" ? control.trim() : control);
    }
  } else if (isPlainObject(controls)) {
    for (const [control, value] of Object.entries(controls)) {
      if (value !== null && value !== undefined) {
        pushControl(control);
      }
    }
  }

  return recognizedControls.length > 0 ? recognizedControls : null;
}

function projectNodeEngineAcceptedAuthorityUnit(unit) {
  if (!isPlainObject(unit)) {
    return null;
  }

  return {
    record_id:
      typeof unit.record_id === "string" && unit.record_id.trim() !== "" ? unit.record_id.trim() : null,
    slice_id:
      typeof unit.slice_id === "string" && unit.slice_id.trim() !== "" ? unit.slice_id.trim() : null,
    address:
      typeof unit.address === "string" && unit.address.trim() !== "" ? unit.address.trim() : null,
  };
}

function projectNodeEngineAcceptedAuthorityPaths(value) {
  if (!isPlainObject(value) || value.path_scoped !== true || !Array.isArray(value.authorized_paths)) {
    return { path_scoped: false };
  }

  const authorizedPaths = value.authorized_paths
    .filter((entry) => typeof entry === "string" && entry.trim() !== "")
    .map((entry) => entry.trim());

  if (authorizedPaths.length === 0) {
    return { path_scoped: false };
  }

  return {
    path_scoped: true,
    authorized_paths: authorizedPaths,
  };
}

function cloneNodeEngineAcceptedAuthority(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const authorityClass =
    typeof value.authority_class === "string" && value.authority_class.trim() !== ""
      ? value.authority_class.trim()
      : null;
  const projectedAuthorityClass =
    authorityClass === "decision" || authorityClass === "threshold_waiver" ? "decision" : authorityClass;
  const projectedUnit = projectNodeEngineAcceptedAuthorityUnit(value.authorized_unit);
  const projectedPaths = projectNodeEngineAcceptedAuthorityPaths(value);

  const authority = {
    schema_version:
      typeof value.schema_version === "string" && value.schema_version.trim() !== ""
        ? value.schema_version.trim()
        : "worker_admission.accepted_authority.v1",
    authority_id:
      typeof value.authority_id === "string" && value.authority_id.trim() !== ""
        ? value.authority_id.trim()
        : null,
    authority_repo:
      typeof value.authority_repo === "string" && value.authority_repo.trim() !== ""
        ? value.authority_repo.trim()
        : null,
    authority_status:
      typeof value.authority_status === "string" && value.authority_status.trim() !== ""
        ? value.authority_status.trim()
        : null,
    authority_class:
      projectedAuthorityClass,
    authorized_unit: projectedUnit,
    authorized_controls: projectNodeEngineAcceptedAuthorityControls(value.authorized_controls),
    expires_at:
      typeof value.expires_at === "string" && value.expires_at.trim() !== ""
        ? value.expires_at.trim()
        : null,
    source_digest:
      typeof value.source_digest === "string" && value.source_digest.trim() !== ""
        ? value.source_digest.trim()
        : null,
  };

  if (
    authority.schema_version !== "worker_admission.accepted_authority.v1" ||
    !authority.authority_id ||
    !authority.authority_repo ||
    authority.authority_status !== "accepted" ||
    authority.authority_class !== "decision" ||
    !authority.authorized_unit ||
    !authority.authorized_controls ||
    !authority.expires_at ||
    !authority.source_digest
  ) {
    return null;
  }

  authority.path_scoped = projectedPaths.path_scoped;
  if (projectedPaths.authorized_paths) {
    authority.authorized_paths = projectedPaths.authorized_paths;
  }

  return authority;
}

function cloneNodeEngineAcceptedAuthorities(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(cloneNodeEngineAcceptedAuthority).filter(Boolean);
}

function projectNodeEngineReviewAttestationUnit(unit) {
  if (!isPlainObject(unit)) {
    return null;
  }
  const recordId = trimToNull(unit.record_id);
  const address = trimToNull(unit.address);
  if (!recordId || !address) {
    return null;
  }
  return {
    record_id: recordId,
    slice_id: trimToNull(unit.slice_id),
    address,
  };
}

function projectNodeEngineReviewAttestationControls(controls) {
  if (!Array.isArray(controls)) {
    return null;
  }
  const recognized = [];
  const seen = new Set();
  for (const control of controls) {
    const trimmed = trimToNull(control);
    if (
      trimmed &&
      NODE_ENGINE_REVIEW_ATTESTATION_CONTROL_GRAMMAR.test(trimmed) &&
      !seen.has(trimmed)
    ) {
      seen.add(trimmed);
      recognized.push(trimmed);
    }
  }
  return recognized.length > 0 ? recognized : null;
}

function projectNodeEngineReviewAttestationRunRef(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const ref = {
    run_id: trimToNull(value.run_id),
    role_class: trimToNull(value.role_class),
    terminal_status: trimToNull(value.terminal_status),
    subject_address: trimToNull(value.subject_address),
    provenance_kind: trimToNull(value.provenance_kind),
  };
  return Object.values(ref).every(Boolean) ? ref : null;
}

function cloneNodeEngineReviewAttestation(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const attestation = {
    schema_version: trimToNull(value.schema_version) ?? NODE_ENGINE_REVIEW_ATTESTATION_SCHEMA_VERSION,
    attestation_id: trimToNull(value.attestation_id),
    attestation_digest: trimToNull(value.attestation_digest),
    repo: trimToNull(value.repo),
    unit: projectNodeEngineReviewAttestationUnit(value.unit),
    reviewed_controls: projectNodeEngineReviewAttestationControls(value.reviewed_controls),
    status: trimToNull(value.status),
    review_outcome: trimToNull(value.review_outcome),
    source_digest: trimToNull(value.source_digest),
    reviewed_at: trimToNull(value.reviewed_at),
    expires_at: trimToNull(value.expires_at),
    reviewer_role_class: trimToNull(value.reviewer_role_class),
  };

  if (
    attestation.schema_version !== NODE_ENGINE_REVIEW_ATTESTATION_SCHEMA_VERSION ||
    !attestation.attestation_id ||
    !attestation.attestation_digest ||
    !attestation.repo ||
    !attestation.unit ||
    !attestation.reviewed_controls ||
    attestation.status !== "accepted" ||
    !NODE_ENGINE_REVIEW_ATTESTATION_ACCEPTED_OUTCOMES.has(attestation.review_outcome) ||
    !attestation.source_digest ||
    !attestation.reviewed_at ||
    !attestation.expires_at ||
    !NODE_ENGINE_REVIEW_ATTESTATION_REVIEWER_ROLE_CLASSES.has(attestation.reviewer_role_class)
  ) {
    return null;
  }

  const runRef = projectNodeEngineReviewAttestationRunRef(value.review_run_ref);
  if (runRef) {
    attestation.review_run_ref = runRef;
  }

  return attestation;
}

function cloneNodeEngineReviewAttestations(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(cloneNodeEngineReviewAttestation).filter(Boolean);
}

function resolveNodeEngineWorkerAdmissionSourceDigest(facts, assembled) {
  return (
    trimToNull(facts?.source_digest) ??
    trimToNull(assembled?.source_record_digest) ??
    trimToNull(facts?.metric_source_provenance?.source_record_digest)
  );
}

function projectNodeEngineWorkerAdmissionValidateData(
  facts,
  { sourceDigest = null, packInput = null } = {},
) {
  const normalizedFacts = isPlainObject(facts?.data) ? facts.data : isPlainObject(facts) ? facts : {};
  const directDataShape =
    isPlainObject(facts?.data) ||
    (isPlainObject(facts) &&
      Object.prototype.hasOwnProperty.call(normalizedFacts, "metrics") &&
      !Object.prototype.hasOwnProperty.call(normalizedFacts, "work_unit_metrics"));
  const engagementDeclared = hasDeclaredPreconditionEngagement(normalizedFacts, packInput);
  const projected = directDataShape
    ? { ...normalizedFacts }
    : {
        schema_version:
          typeof normalizedFacts.schema_version === "string" && normalizedFacts.schema_version.trim() !== ""
            ? normalizedFacts.schema_version.trim()
            : "worker-admission-request.v1",
        decision_kind:
          typeof normalizedFacts.decision_kind === "string" && normalizedFacts.decision_kind.trim() !== ""
            ? normalizedFacts.decision_kind.trim()
            : WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS.decision_kind,
        subject: cloneNodeEngineWorkerAdmissionSubject(normalizedFacts.subject),
        claim: null,
      };

  if (!directDataShape) {

    const selectedSourceDigest = trimToNull(sourceDigest);
    if (selectedSourceDigest) {
      projected.source_digest = selectedSourceDigest;
    }

    const workUnitMetrics = projectNodeEngineWorkerAdmissionMetrics(
      normalizedFacts.work_unit_metrics,
      normalizedFacts,
    );
    if (workUnitMetrics) {
      projected.work_unit_metrics = workUnitMetrics;
    }

    const localHardRefusal = cloneNodeEngineWorkerAdmissionLocalHardRefusal(normalizedFacts.local_hard_refusal);
    if (localHardRefusal) {
      projected.local_hard_refusal = localHardRefusal;
    }
  } else if (trimToNull(sourceDigest) && !Object.prototype.hasOwnProperty.call(projected, "source_digest")) {
    projected.source_digest = trimToNull(sourceDigest);
  }

  if (directDataShape && Object.prototype.hasOwnProperty.call(projected, "work_unit_metrics")) {
    const workUnitMetrics = projectNodeEngineWorkerAdmissionMetrics(
      projected.work_unit_metrics,
      normalizedFacts,
    );
    if (workUnitMetrics) {
      projected.work_unit_metrics = workUnitMetrics;
    } else {
      delete projected.work_unit_metrics;
    }
  }

  if (!engagementDeclared && directDataShape) {
    delete projected.precondition_graph;
  }

  const preconditionGraph = engagementDeclared
    ? projectNodeEngineWorkerAdmissionPreconditionGraph(normalizedFacts, packInput)
    : undefined;
  if (preconditionGraph !== undefined) {
    projected.precondition_graph = preconditionGraph;
  }

  return projected;
}

function projectNodeEngineWorkerAdmissionPackInput(
  packInputV1,
  { authorityMode, requestContractDigest } = {},
) {
  const input = isPlainObject(packInputV1?.pack_input)
    ? packInputV1.pack_input
    : isPlainObject(packInputV1)
      ? packInputV1
      : {};
  const projected = {
    schema_version:
      typeof input.schema_version === "string" && input.schema_version.trim() !== ""
        ? input.schema_version.trim()
        : NODE_ENGINE_WORKER_ADMISSION_PACK_INPUT_SCHEMA_VERSION,
    policy_profile_id: input.policy_profile_id ?? null,
    policy_profile_version: input.policy_profile_version ?? null,
    threshold_profile_id: input.threshold_profile_id ?? null,
    threshold_profile_version: input.threshold_profile_version ?? null,
    effect_vocabulary_version:
      typeof input.effect_vocabulary_version === "string" && input.effect_vocabulary_version.trim() !== ""
        ? input.effect_vocabulary_version.trim()
        : `worker-admission.${WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS.decision_kind}.effects.v1`,
  };
  const acceptedAuthorities = cloneNodeEngineAcceptedAuthorities(input.accepted_authorities);
  if (acceptedAuthorities.length > 0) {
    projected.accepted_authorities = acceptedAuthorities;
  }
  const reviewAttestations = cloneNodeEngineReviewAttestations(input.review_attestations);
  if (reviewAttestations.length > 0) {
    projected.review_attestations = reviewAttestations;
  }
  const preconditionEnforcement = cloneNodeEngineWorkerAdmissionPreconditionEnforcement(
    input.precondition_enforcement,
  );
  if (preconditionEnforcement?.enabled === true) {
    projected.precondition_enforcement = {
      enabled: true,
      contract_version: NODE_ENGINE_PRECONDITION_ENFORCEMENT_CONTRACT_VERSION,
    };
  }
  projected.authority_mode =
    typeof authorityMode === "string" && authorityMode.trim() !== ""
      ? authorityMode.trim()
      : typeof input.authority_mode === "string" && input.authority_mode.trim() !== ""
        ? input.authority_mode.trim()
        : "pack_contract_bound";
  projected.request_contract_digest =
    typeof requestContractDigest === "string" && requestContractDigest.trim() !== ""
      ? requestContractDigest.trim()
      : typeof input.request_contract_digest === "string" && input.request_contract_digest.trim() !== ""
        ? input.request_contract_digest.trim()
        : NODE_ENGINE_UNRATIFIED_PLACEHOLDER;
  return projected;
}

function projectNodeEngineOrgPolicyProfileCarrier(facts, requestContractDigest) {
  const orgPolicyProfile = isPlainObject(facts?.org_policy_profile) ? facts.org_policy_profile : null;
  if (!orgPolicyProfile) {
    return null;
  }

  const status = typeof orgPolicyProfile.status === "string" ? orgPolicyProfile.status.trim() : null;
  const hasDeclaredAuthority = requestContractDigest !== NODE_ENGINE_UNRATIFIED_PLACEHOLDER;

  if (status === "profile") {
    return hasDeclaredAuthority ? orgPolicyProfile : null;
  }

  if (status === "fail_closed" && hasDeclaredAuthority) {
    throw new Error(
      "Node Engine worker-admission org policy profile is declared but fail-closed on the paid path",
    );
  }

  return null;
}

export function buildNodeEngineWorkerAdmissionPackInput(
  packInput,
  { authorityMode = "pack_contract_bound", requestContractDigest = NODE_ENGINE_UNRATIFIED_PLACEHOLDER } = {},
) {
  const assembled = isPlainObject(packInput) ? packInput : {};
  const facts = isPlainObject(assembled.normalized_portfolio_facts)
    ? assembled.normalized_portfolio_facts
    : isPlainObject(assembled.data)
      ? assembled.data
      : isPlainObject(assembled.pack_input)
        ? assembled.pack_input
        : assembled;
  const packInputSource = isPlainObject(assembled.pack_input) ? assembled.pack_input : assembled;
  const policyProfile = isPlainObject(facts.policy_profile) ? facts.policy_profile : {};
  const orgPolicyProfile = projectNodeEngineOrgPolicyProfileCarrier(facts, requestContractDigest);
  const decisionKind =
    typeof facts.decision_kind === "string" && facts.decision_kind.trim() !== ""
      ? facts.decision_kind
      : WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS.decision_kind;
  const profileId = typeof policyProfile.profile_id === "string" ? policyProfile.profile_id : null;
  const profileVersion = typeof policyProfile.profile_version === "string" ? policyProfile.profile_version : null;
  const projected = {
    schema_version: NODE_ENGINE_WORKER_ADMISSION_PACK_INPUT_SCHEMA_VERSION,
    policy_profile_id: profileId,
    policy_profile_version: profileVersion,
    threshold_profile_id: profileId,
    threshold_profile_version: profileVersion,
    effect_vocabulary_version: `worker-admission.${decisionKind}.effects.v1`,
    authority_mode: authorityMode,
    request_contract_digest: requestContractDigest,
  };
  if (orgPolicyProfile) {
    projected.policy_profile = orgPolicyProfile.profile;
    projected.policy_profile_digest = orgPolicyProfile.digest;
    projected.policy_profile_authority_mode = "entitlement";
  }
  const acceptedAuthorities = cloneNodeEngineAcceptedAuthorities(
    packInputSource.accepted_authorities ?? assembled.accepted_authorities,
  );
  if (acceptedAuthorities.length > 0) {
    projected.accepted_authorities = acceptedAuthorities;
  }
  const reviewAttestations = cloneNodeEngineReviewAttestations(
    packInputSource.review_attestations ?? assembled.review_attestations,
  );
  if (reviewAttestations.length > 0) {
    projected.review_attestations = reviewAttestations;
  }
  const preconditionEnforcement = cloneNodeEngineWorkerAdmissionPreconditionEnforcement(
    packInputSource.precondition_enforcement ?? assembled.precondition_enforcement,
  );
  if (preconditionEnforcement?.enabled === true) {
    projected.precondition_enforcement = {
      enabled: true,
      contract_version: NODE_ENGINE_PRECONDITION_ENFORCEMENT_CONTRACT_VERSION,
    };
  }
  return projected;
}

export function buildNodeEngineWorkerAdmissionValidateBody(
  packInput,
  {
    authorityMode = "pack_contract_bound",
    requestContractDigest = NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
    packInputOverride = null,
  } = {},
) {
  const assembled = isPlainObject(packInput) ? packInput : {};
  const facts = isPlainObject(assembled.normalized_portfolio_facts)
    ? assembled.normalized_portfolio_facts
    : isPlainObject(assembled.data)
      ? assembled.data
      : assembled;
  const packInputSource = isPlainObject(assembled.pack_input) ? assembled.pack_input : assembled;
  const data = projectNodeEngineWorkerAdmissionValidateData(
    facts,
    {
      sourceDigest: resolveNodeEngineWorkerAdmissionSourceDigest(facts, assembled),
      packInput: packInputSource,
    },
  );
  const boundPackId =
    isPlainObject(assembled.node_engine_binding) && typeof assembled.node_engine_binding.pack_id === "string"
      ? assembled.node_engine_binding.pack_id
      : WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS.pack_id;
  const packInputV1 = isPlainObject(packInputOverride)
    ? projectNodeEngineWorkerAdmissionPackInput(packInputOverride, {
        authorityMode,
        requestContractDigest,
      })
    : buildNodeEngineWorkerAdmissionPackInput(assembled, { authorityMode, requestContractDigest });
  return { data, pack: boundPackId, pack_input: packInputV1 };
}
