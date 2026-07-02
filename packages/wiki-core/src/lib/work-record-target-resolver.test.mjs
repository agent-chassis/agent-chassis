import test from "node:test";
import assert from "node:assert/strict";

import {
  createProviderUnavailableTargetResolutionEvidence,
  resolveStructuralTargetResolverEvidenceFromExpectedEditTarget,
  normalizeStructuralTargetResolverEvidence
} from "./work-record-target-resolver.mjs";

test("normalizeStructuralTargetResolverEvidence preserves resolved modify target evidence from supplied provider inputs", () => {
  const input = {
    target: {
      path: "./packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "module",
      name: "work-record-target-resolver",
      operation: "modify"
    },
    provider: {
      id: "symbol-provider",
      version: "1.0.0",
      mode: "code_index"
    },
    resolution_status: "resolved",
    target_resolution_evidence_status: "present",
    span: {
      start_line: 10,
      end_line: 20,
      line_count: 11
    },
    fanout: {
      direct_reference_count: 2,
      affected_symbol_count: 1
    },
    candidates: [
      {
        path: "./candidate.mjs",
        kind: "module",
        name: "work-record-target-resolver",
        span: {
          start_line: 5,
          end_line: 8,
          line_count: 4
        }
      }
    ],
    prose: {
      summary: "ignored",
      acceptance_criteria_count: 99
    }
  };

  const normalized = normalizeStructuralTargetResolverEvidence(input, {
    hasExpectedEditTargets: true
  });

  assert.deepEqual(normalized, {
    target_resolution_evidence_status: "present",
    target_resolution_provider: {
      id: "symbol-provider",
      version: "1.0.0",
      mode: "code_index"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "module",
      name: "work-record-target-resolver",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "resolved",
    target_resolution_status_reason: "exactly one target span or structural target was identified",
    target_resolution_span: {
      start_line: 10,
      end_line: 20,
      line_count: 11
    },
    target_resolution_fanout: {
      direct_reference_count: 2,
      affected_symbol_count: 1
    },
    target_resolution_candidates: []
  });
});

test("normalizeStructuralTargetResolverEvidence preserves create targets without requiring a pre-existing symbol", () => {
  const normalized = normalizeStructuralTargetResolverEvidence({
    target: {
      path: "wiki/work-records/WK-0253.json",
      kind: "test_case",
      name: "resolver-helper-tests",
      operation: "create",
      optional: true
    },
    prose: "ignored"
  });

  assert.deepEqual(normalized, {
    target_resolution_evidence_status: "present",
    target_resolution_provider: null,
    target_resolution_target: {
      path: "wiki/work-records/WK-0253.json",
      kind: "test_case",
      name: "resolver-helper-tests",
      operation: "create",
      optional: true
    },
    target_resolution_status: "not_applicable",
    target_resolution_status_reason: "create target; no pre-existing symbol expected",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: []
  });
});

test("normalizeStructuralTargetResolverEvidence keeps unresolved and ambiguous provider evidence deterministic", () => {
  const unresolved = normalizeStructuralTargetResolverEvidence(
    {
      target: {
        path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
        kind: "module",
        name: "work-record-target-resolver",
        operation: "modify"
      },
      resolution_status: "unresolved",
      evidence_status: "partial",
      candidates: [
        {
          path: "candidate-a.mjs",
          kind: "module",
          name: "candidate-a"
        },
        {
          path: "candidate-b.mjs",
          kind: "module",
          name: "candidate-b",
          span: {
            start_line: 2,
            end_line: 3,
            line_count: 2
          }
        }
      ]
    },
    {
      hasExpectedEditTargets: true
    }
  );

  assert.deepEqual(unresolved, {
    target_resolution_evidence_status: "partial",
    target_resolution_provider: null,
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "module",
      name: "work-record-target-resolver",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "unresolved",
    target_resolution_status_reason: "no supported target matched the declared target",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: [
      {
        path: "candidate-a.mjs",
        kind: "module",
        name: "candidate-a",
        span: null
      },
      {
        path: "candidate-b.mjs",
        kind: "module",
        name: "candidate-b",
        span: {
          start_line: 2,
          end_line: 3,
          line_count: 2
        }
      }
    ]
  });

  const ambiguous = normalizeStructuralTargetResolverEvidence({
    target: {
      path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "module",
      name: "work-record-target-resolver",
      operation: "modify"
    },
    resolution_status: "ambiguous",
    span: {
      start_line: 1,
      end_line: 2,
      line_count: 2
    },
    fanout: {
      direct_reference_count: 1,
      affected_symbol_count: 1
    },
    candidates: [
      {
        path: "candidate-a.mjs",
        kind: "module",
        name: "candidate-a"
      },
      {
        path: "candidate-b.mjs",
        kind: "module",
        name: "candidate-b"
      }
    ]
  });

  assert.deepEqual(ambiguous, {
    target_resolution_evidence_status: "partial",
    target_resolution_provider: null,
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "module",
      name: "work-record-target-resolver",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "ambiguous",
    target_resolution_status_reason: "multiple candidates matched and no deterministic winner was selected",
    target_resolution_span: {
      start_line: 1,
      end_line: 2,
      line_count: 2
    },
    target_resolution_fanout: {
      direct_reference_count: 1,
      affected_symbol_count: 1
    },
    target_resolution_candidates: [
      {
        path: "candidate-a.mjs",
        kind: "module",
        name: "candidate-a",
        span: null
      },
      {
        path: "candidate-b.mjs",
        kind: "module",
        name: "candidate-b",
        span: null
      }
    ]
  });
});

test("normalizeStructuralTargetResolverEvidence handles unsupported kind, missing path, and provider-unavailable mode deterministically", () => {
  const unsupportedKind = normalizeStructuralTargetResolverEvidence({
    target: {
      path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "helper",
      name: "work-record-target-resolver",
      operation: "modify"
    },
    resolution_status: "unsupported_kind"
  });

  assert.deepEqual(unsupportedKind, {
    target_resolution_evidence_status: "degraded",
    target_resolution_provider: null,
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "helper",
      name: "work-record-target-resolver",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "unsupported_kind",
    target_resolution_status_reason: "provider does not support the declared target kind",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: []
  });

  const missingPath = normalizeStructuralTargetResolverEvidence({
    target: {
      kind: "module",
      name: "work-record-target-resolver",
      operation: "inspect"
    },
    resolution_status: "missing_path"
  });

  assert.deepEqual(missingPath, {
    target_resolution_evidence_status: "degraded",
    target_resolution_provider: null,
    target_resolution_target: {
      path: null,
      kind: "module",
      name: "work-record-target-resolver",
      operation: "inspect",
      optional: false
    },
    target_resolution_status: "missing_path",
    target_resolution_status_reason: "declared target path was unavailable to the provider",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: []
  });

  const providerUnavailable = normalizeStructuralTargetResolverEvidence({
    target: {
      path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "module",
      name: "work-record-target-resolver",
      operation: "inspect"
    },
    resolution_status: "provider_unavailable",
    target_resolution_evidence_status: "absent"
  });

  assert.deepEqual(providerUnavailable, {
    target_resolution_evidence_status: "degraded",
    target_resolution_provider: {
      id: null,
      version: null,
      mode: "unavailable"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "module",
      name: "work-record-target-resolver",
      operation: "inspect",
      optional: false
    },
    target_resolution_status: "provider_unavailable",
    target_resolution_status_reason: "no structural resolver configured",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: []
  });
});

test("createProviderUnavailableTargetResolutionEvidence produces explicit degraded evidence without repo crawl inputs", () => {
  const first = createProviderUnavailableTargetResolutionEvidence(
    {
      path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "module",
      name: "work-record-target-resolver",
      operation: "modify"
    },
    "no structural resolver configured"
  );
  const second = createProviderUnavailableTargetResolutionEvidence(
    {
      path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "module",
      name: "work-record-target-resolver",
      operation: "modify"
    },
    "no structural resolver configured"
  );

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    target_resolution_evidence_status: "degraded",
    target_resolution_provider: {
      id: null,
      version: null,
      mode: "unavailable"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/work-record-target-resolver.mjs",
      kind: "module",
      name: "work-record-target-resolver",
      operation: "modify"
    },
    target_resolution_status: "provider_unavailable",
    target_resolution_status_reason: "no structural resolver configured",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: []
  });
});

test("resolveStructuralTargetResolverEvidenceFromExpectedEditTarget resolves bounded function targets and preserves create targets without source text", () => {
  const resolved = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
    {
      target: {
        path: "packages/wiki-core/src/lib/sample-target.mjs",
        kind: "function",
        name: "alpha",
        operation: "modify"
      },
      source_text: `function alpha() {
  return 1;
}
`
    },
    {
      hasExpectedEditTargets: true
    }
  );

  assert.deepEqual(resolved, {
    target_resolution_evidence_status: "present",
    target_resolution_provider: {
      id: "portfolio-local.target-function-resolver",
      version: "0.1.0",
      mode: "local"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "function",
      name: "alpha",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "resolved",
    target_resolution_status_reason: "exactly one target span or structural target was identified",
    target_resolution_span: {
      start_line: 1,
      end_line: 3,
      line_count: 3
    },
    target_resolution_fanout: {
      direct_reference_count: 1,
      affected_symbol_count: 1
    },
    target_resolution_candidates: []
  });

  const createTarget = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
    {
      target: {
        path: "wiki/work-records/WK-0253.json",
        kind: "test_case",
        name: "resolver-helper-tests",
        operation: "create",
        optional: true
      }
    },
    {
      hasExpectedEditTargets: true
    }
  );

  assert.deepEqual(createTarget, {
    target_resolution_evidence_status: "present",
    target_resolution_provider: null,
    target_resolution_target: {
      path: "wiki/work-records/WK-0253.json",
      kind: "test_case",
      name: "resolver-helper-tests",
      operation: "create",
      optional: true
    },
    target_resolution_status: "not_applicable",
    target_resolution_status_reason: "create target; no pre-existing symbol expected",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: []
  });
});

test("resolveStructuralTargetResolverEvidenceFromExpectedEditTarget preserves provider-unavailable diagnostics for unreadable and unsupported target cases", () => {
  const unreadableFunction = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
    {
      target: {
        path: "packages/wiki-core/src/lib/sample-target.mjs",
        kind: "function",
        name: "alpha",
        operation: "modify"
      }
    },
    {
      hasExpectedEditTargets: true
    }
  );

  assert.deepEqual(unreadableFunction, {
    target_resolution_evidence_status: "degraded",
    target_resolution_provider: {
      id: null,
      version: null,
      mode: "unavailable"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "function",
      name: "alpha",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "provider_unavailable",
    target_resolution_status_reason: "no bounded source text supplied for expected_edit_targets entry",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: []
  });

  const unsupportedKind = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
    {
      target: {
        path: "packages/wiki-core/src/lib/sample-target.mjs",
        kind: "module",
        name: "alpha",
        operation: "modify"
      }
    },
    {
      hasExpectedEditTargets: true
    }
  );

  assert.deepEqual(unsupportedKind, {
    target_resolution_evidence_status: "degraded",
    target_resolution_provider: {
      id: null,
      version: null,
      mode: "unavailable"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "module",
      name: "alpha",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "provider_unavailable",
    target_resolution_status_reason: "no structural resolver configured",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: []
  });
});
