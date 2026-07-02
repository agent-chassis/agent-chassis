const { default: wk1163Assert } = await import('node:assert/strict');
const { test: wk1163Test } = await import('node:test');

const wk1163PolicyProfile = {
  profile_id: 'worker-admission.work_unit_atomicity.default',
  profile_version: 'v1',
  thresholds: {
    review_when_write_scope_count_above: 1,
    review_when_declared_runtime_mode_count_above: 1,
    review_when_artifact_kind_count_above: 1,
    review_when_max_write_file_loc_above: 600,
    deny_when_max_write_file_loc_above: 1200,
    review_when_expected_changed_line_budget_above: 200,
  },
};

function wk1163Clone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function wk1163IsAllow(decision) {
  return /allow/i.test(String(decision));
}

function wk1163IsReview(decision) {
  return /review/i.test(String(decision));
}

function wk1163DecisionLabel(result) {
  if (typeof result === 'string') {
    return result;
  }

  if (!result || typeof result !== 'object') {
    return String(result);
  }

  if (typeof result.admission_summary?.result === 'string') {
    return result.admission_summary.result;
  }

  if (typeof result.admission_summary?.decision === 'string') {
    return result.admission_summary.decision;
  }

  if (typeof result.result === 'string') {
    return result.result;
  }

  if (typeof result.decision === 'string') {
    return result.decision;
  }

  if (typeof result.effect === 'string') {
    return result.effect;
  }

  if (typeof result.outcome === 'string') {
    return result.outcome;
  }

  if (typeof result.allow === 'boolean') {
    return result.allow ? 'allow' : 'review';
  }

  if (typeof result.dispatchable === 'boolean') {
    return result.dispatchable ? 'allow' : 'review';
  }

  return JSON.stringify(result);
}

function wk1163PickFunction(modules, names) {
  for (const moduleNamespace of modules) {
    if (!moduleNamespace) {
      continue;
    }

    for (const name of names) {
      const value = moduleNamespace[name];
      if (typeof value === 'function') {
        return value.bind(moduleNamespace);
      }
    }

    for (const [name, value] of Object.entries(moduleNamespace)) {
      if (typeof value !== 'function') {
        continue;
      }

      if (names.some((pattern) => pattern instanceof RegExp && pattern.test(name))) {
        return value.bind(moduleNamespace);
      }
    }
  }

  throw new Error(`Unable to resolve evaluator export from: ${names.map(String).join(', ')}`);
}

function wk1163MetricSummary({
  explicitTargets,
  targetResolutionStatus,
  resolvedTargetCount,
  unresolvedTargetCount,
  ambiguousTargetCount,
  writeScopeWithoutResolvedTargets,
}) {
  return {
    cluster_count: 1,
    declared_file_count: 1,
    direct_write_scope_count: 1,
    graph_derived_file_count: 1,
    downstream_surface_count: 0,
    missing_update_hint_count: 0,
    critical_surface_count: 0,
    open_write_scope_overlap_count: 0,
    max_fanout: 0,
    test_to_impl_ratio: 0,
    write_scope_count: 1,
    write_scope_existing_file_count: 1,
    write_scope_directory_count: 0,
    write_scope_total_loc: 1180,
    max_write_file_loc: 1180,
    acceptance_criteria_count: 3,
    validation_command_count: 1,
    declared_runtime_mode_count: 1,
    artifact_kind_count: 1,
    expected_changed_line_budget: 40,
    unknown_metric_count: 0,
    expected_edit_target_count: explicitTargets ? 1 : 0,
    resolved_edit_target_count: resolvedTargetCount,
    unresolved_edit_target_count: unresolvedTargetCount,
    ambiguous_edit_target_count: ambiguousTargetCount,
    target_span_line_count: explicitTargets ? 12 : 0,
    max_target_span_line_count: explicitTargets ? 12 : 0,
    target_span_to_file_ratio: explicitTargets ? 12 / 1180 : 0,
    target_dependency_fanout_count: 0,
    write_scope_without_resolved_targets: writeScopeWithoutResolvedTargets,
    target_resolution_evidence_status: targetResolutionStatus,
    missing_metrics: {},
    missing_evidence: {},
    missing_supporting_evidence: {},
    evidence_issues: null,
  };
}

function wk1163TargetEntry() {
  return {
    path: 'packages/wiki-core/src/lib/work-record-admission-work-unit.mjs',
    kind: 'function',
    name: 'normalizeWorkUnitFeatureVector',
    activity_kind: 'implementation_modify',
    artifact_kind: 'code',
    operation: 'modify',
    granularity: 'function',
    optional: false,
    resolution_status: 'resolved',
    resolution_reason: 'one bounded function span',
    provider: {
      id: 'portfolio-local.target-resolver',
      version: 'v1',
      mode: 'local',
    },
    span: {
      start_line: 410,
      end_line: 421,
      line_count: 12,
    },
    facet_provenance: {
      activity_kind: 'authored_record',
      artifact_kind: 'authored_record',
      operation: 'authored_record',
      granularity: 'authored_record',
      resolution_status: 'derived_code_graph',
      span: 'derived_code_graph',
    },
  };
}

function wk1163NormalizedRequest({ explicitTargets }) {
  return {
    schema_version: 'worker-admission-request.v1',
    decision_kind: 'work_unit_atomicity',
    subject: {
      kind: 'work_unit',
      repo: 'agent-chassis/agent-chassis',
      unit: {
        record_id: 'WK-1163',
        slice_id: 'bounded-single-file-replay',
        address: 'WK-1163#bounded-single-file-replay',
      },
    },
    work_unit_metrics: {
      write_scope_count: 1,
      write_scope_existing_file_count: 1,
      write_scope_directory_count: 0,
      write_scope_total_loc: 1180,
      max_write_file_loc: 1180,
      acceptance_criteria_count: 3,
      validation_command_count: 1,
      declared_runtime_mode_count: 1,
      artifact_kind_count: 1,
      expected_changed_line_budget: 40,
      unknown_metric_count: 0,
    },
    context: {
      source_path: 'wiki/work-records/WK-1163.json',
      field_path: 'slices[0].write_scope',
      mode: 'local',
      policy_version: 'worker-admission-policy.v1',
    },
    structural_target_metrics: {
      target_resolution_evidence_status: explicitTargets ? 'present' : 'absent',
      target_resolution_provider: explicitTargets ? 'portfolio-local.target-resolver' : null,
      target_resolution_provider_version: explicitTargets ? 'v1' : null,
      target_resolution_status_reason: explicitTargets
        ? 'one bounded function span'
        : 'no explicit target evidence supplied',
      expected_edit_target_count: explicitTargets ? 1 : 0,
      planned_create_target_count: 0,
      planned_modify_target_count: explicitTargets ? 1 : 0,
      planned_delete_target_count: 0,
      planned_inspect_target_count: 0,
      target_kind_count: explicitTargets ? 1 : 0,
      resolved_edit_target_count: explicitTargets ? 1 : 0,
      unresolved_edit_target_count: 0,
      ambiguous_edit_target_count: 0,
      target_span_line_count: explicitTargets ? 12 : 0,
      max_target_span_line_count: explicitTargets ? 12 : 0,
      target_span_to_file_ratio: explicitTargets ? 12 / 1180 : 0,
      target_dependency_fanout_count: 0,
      write_scope_without_resolved_targets: explicitTargets ? 0 : 1,
      targets: explicitTargets ? [wk1163TargetEntry()] : [],
    },
    evidence: {
      metric_source_provenance: {
        source_kind: 'canonical_work_record',
        canonicality: 'canonical',
        evidence_basis: 'normalized_record_projection',
        normalized_input_digest: 'sha256:' + '2'.repeat(64),
        policy_backend: 'portfolio-local',
        policy_version: 'worker-admission-policy.v1',
      },
    },
    policy_profile: wk1163PolicyProfile,
  };
}

function wk1163DerivedEvidence({ explicitTargets }) {
  return {
    schema_version: 'worker-admission-derived-evidence.v1',
    record_id: 'WK-1163',
    unit: {
      kind: 'slice',
      address: 'WK-1163#bounded-single-file-replay',
      record_id: 'WK-1163',
      slice_id: 'bounded-single-file-replay',
    },
    source_record_digest: 'sha256:' + '1'.repeat(64),
    generator: {
      name: 'agent-chassis',
      version: '0.2.0',
    },
    generated_at: '2026-06-19T00:00:00Z',
    decision_kind: 'work_unit_atomicity',
    metric_summary: wk1163MetricSummary({
      explicitTargets,
      targetResolutionStatus: explicitTargets ? 'present' : 'absent',
      resolvedTargetCount: explicitTargets ? 1 : 0,
      unresolvedTargetCount: 0,
      ambiguousTargetCount: 0,
      writeScopeWithoutResolvedTargets: explicitTargets ? 0 : 1,
    }),
    provenance: {
      source_kind: 'canonical_work_record',
      canonicality: 'canonical',
      evidence_basis: 'normalized_record_projection',
      policy_backend: 'portfolio-local',
      policy_version: 'worker-admission-policy.v1',
    },
    normalized_request: wk1163NormalizedRequest({ explicitTargets }),
    sidecar_path:
      'wiki/work-records/evidence/WK-1163.bounded-single-file-replay.admission.json',
    sidecar_digest: 'sha256:' + '3'.repeat(64),
  };
}

function wk1163FeatureVector({ explicitTargets }) {
  return {
    schema_version: 'work-unit-feature-vector.v1',
    vocabulary_version: 'wk-ontology.v1',
    work_unit_address: {
      repo: 'agent-chassis/agent-chassis',
      record_id: 'WK-1163',
      slice_id: 'bounded-single-file-replay',
      address: 'WK-1163#bounded-single-file-replay',
    },
    activity_artifact_targets: explicitTargets ? [wk1163TargetEntry()] : [],
    scenarios: [],
    acceptance_methods: [],
    graph_evidence: null,
    diff_evidence: null,
    derived_metrics: wk1163MetricSummary({
      explicitTargets,
      targetResolutionStatus: explicitTargets ? 'present' : 'absent',
      resolvedTargetCount: explicitTargets ? 1 : 0,
      unresolvedTargetCount: 0,
      ambiguousTargetCount: 0,
      writeScopeWithoutResolvedTargets: explicitTargets ? 0 : 1,
    }),
    escalations: [],
    degradations: explicitTargets
      ? []
      : [
          {
            id: 'wk1163-target-resolution-missing',
            field_path: 'activity_artifact_targets',
            reason_code:
              'worker_admission.work_unit_atomicity.target_resolution_missing_requires_review.v1',
            reason: 'raw metrics alone do not explain a bounded-single-file allow',
            facet: 'targets',
            provenance: 'unavailable',
            effect: 'requires_review',
          },
        ],
  };
}

async function wk1163Invoke(fn, candidates) {
  let lastError = null;

  for (const candidate of candidates) {
    try {
      if (Array.isArray(candidate)) {
        return await Promise.resolve(fn(...candidate));
      }

      return await Promise.resolve(fn(candidate));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('No candidate invocation succeeded');
}

const wk1163DerivedEvidenceModule = await import(
  '../packages/wiki-core/src/lib/work-record-admission-derived-evidence.mjs'
);
const wk1163PolicyModule = await import(
  '../packages/wiki-core/src/lib/work-record-admission-policy.mjs'
);
const wk1163WorkUnitModule = await import(
  '../packages/wiki-core/src/lib/work-record-admission-work-unit.mjs'
);

const wk1163EvaluateAtomicity = wk1163PickFunction(
  [wk1163DerivedEvidenceModule, wk1163PolicyModule, wk1163WorkUnitModule],
  [
    'evaluateWorkRecordAdmissionDerivedEvidence',
    'evaluateWorkUnitAtomicityDecisionCore',
    'createWorkerAdmissionDecisionFromFeatureVector',
    'evaluate_work_unit_dispatch',
    /evaluate.*work.*atomicity/i,
    /create.*worker.*decision.*feature/i,
  ],
);

wk1163Test('WK-1163 bounded single-file replay needs explicit policy-effective facts', async () => {
  const allowVector = wk1163FeatureVector({ explicitTargets: true });
  const allowSnapshot = wk1163Clone(allowVector);
  const allowResult = await wk1163Invoke(wk1163EvaluateAtomicity, [
    wk1163DerivedEvidence({ explicitTargets: true }),
    wk1163NormalizedRequest({ explicitTargets: true }),
    {
      schema_version: 'worker-admission-domain-pack-input.v1',
      decision_kind: 'work_unit_atomicity',
      feature_vector: allowVector,
      policy_pack_reference: 'worker-admission.work_unit_atomicity.default',
      policy_profile: wk1163PolicyProfile,
    },
    {
      feature_vector: allowVector,
      policy_profile: wk1163PolicyProfile,
    },
    [allowVector, wk1163PolicyProfile],
    allowVector,
  ]);

  wk1163Assert.deepStrictEqual(
    allowVector,
    allowSnapshot,
    'bounded-single-file allow evidence must not be mutated',
  );
  wk1163Assert.ok(
    wk1163IsAllow(wk1163DecisionLabel(allowResult)),
    `expected explicit bounded-single-file evidence to allow, got ${wk1163DecisionLabel(allowResult)}`,
  );

  const rawVector = wk1163FeatureVector({ explicitTargets: false });
  const rawSnapshot = wk1163Clone(rawVector);
  const rawResult = await wk1163Invoke(wk1163EvaluateAtomicity, [
    wk1163DerivedEvidence({ explicitTargets: false }),
    wk1163NormalizedRequest({ explicitTargets: false }),
    {
      schema_version: 'worker-admission-domain-pack-input.v1',
      decision_kind: 'work_unit_atomicity',
      feature_vector: rawVector,
      policy_pack_reference: 'worker-admission.work_unit_atomicity.default',
      policy_profile: wk1163PolicyProfile,
    },
    {
      feature_vector: rawVector,
      policy_profile: wk1163PolicyProfile,
    },
    [rawVector, wk1163PolicyProfile],
    rawVector,
  ]);

  wk1163Assert.deepStrictEqual(
    rawVector,
    rawSnapshot,
    'raw replay evidence must not be mutated by evaluation',
  );
  wk1163Assert.ok(
    wk1163IsReview(wk1163DecisionLabel(rawResult)),
    `expected raw metrics without explicit target evidence to require review, got ${wk1163DecisionLabel(rawResult)}`,
  );
});
