import test from "node:test";
import assert from "node:assert/strict";

import {
  createProviderUnavailableTargetResolutionEvidence,
  resolveStructuralTargetResolverEvidenceFromExpectedEditTarget,
  normalizeStructuralTargetResolverEvidence
} from "./work-record-target-resolver.mjs";
import { resolveBoundedJavaScriptTestCaseTargetFromSourceText } from "./work-record-target-function-resolver.mjs";

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
    reason: "attacker reason alias",
    resolution_reason: "attacker resolution reason",
    status_reason: "attacker status reason",
    target_resolution_status_reason: "attacker reason",
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
  assert.equal(JSON.stringify(normalized).includes("attacker"), false);
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
    status: "absent",
    evidence_status: "degraded",
    target_resolution_evidence_status: "partial",
    provider: {
      id: "attacker-provider",
      version: "9.9.9",
      mode: "node_engine"
    },
    resolution_status: "resolved",
    target_resolution_status: "ambiguous",
    span: {
      start_line: 99,
      end_line: 100,
      line_count: 2
    },
    reason: "attacker reason alias",
    resolution_reason: "attacker resolution reason",
    status_reason: "attacker status reason",
    target_resolution_status_reason: "attacker reason",
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
  assert.equal(JSON.stringify(normalized).includes("attacker"), false);
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
    resolution_status: "unsupported_kind",
    reason: "attacker reason alias",
    resolution_reason: "attacker resolution reason",
    status_reason: "attacker status reason",
    target_resolution_status_reason: "attacker reason"
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
  assert.equal(JSON.stringify(unsupportedKind).includes("attacker"), false);

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
        path: "packages/wiki-core/src/lib/resolver-helper.test.mjs",
        kind: "test_case",
        name: "resolver-helper-tests",
        operation: "create",
        optional: true
      },
      status: "absent",
      evidence_status: "degraded",
      target_resolution_evidence_status: "partial",
      provider: {
        id: "attacker-provider",
        version: "9.9.9",
        mode: "node_engine"
      },
      resolution_status: "resolved",
      target_resolution_status: "ambiguous",
      span: {
        start_line: 99,
        end_line: 100,
        line_count: 2
      },
      reason: "attacker reason alias",
      resolution_reason: "attacker resolution reason",
      status_reason: "attacker status reason",
      target_resolution_status_reason: "attacker reason"
    },
    {
      hasExpectedEditTargets: true
    }
  );

  assert.deepEqual(createTarget, {
    target_resolution_evidence_status: "present",
    target_resolution_provider: null,
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/resolver-helper.test.mjs",
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
  assert.equal(JSON.stringify(createTarget).includes("attacker"), false);
});

test("resolveStructuralTargetResolverEvidenceFromExpectedEditTarget delegates test cases through the compatibility parser boundary", () => {
  const target = { path: "packages/wiki-core/src/lib/sample-target.test.mjs", kind: "test_case", name: "binds parser evidence", operation: "modify" };
  const source_text = `import test from "node:test";\n\ntest("binds parser evidence", () => {\n  assert.equal(1, 1);\n});\n`;
  const bindings = {
    source_record_digest: "sha256:source-record",
    selected_unit: { kind: "slice", address: "WK-1313#SLICE-006", record_id: "WK-1313", slice_id: "SLICE-006" },
    normalized_input_digest: "sha256:normalized-input", payload_bound_input_digest: "sha256:payload-bound"
  };
  const direct = resolveBoundedJavaScriptTestCaseTargetFromSourceText({ target, source_text, ...bindings });
  const resolved = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget({
    target,
    source_text,
    ...bindings,
    provider: { id: "caller-spoof", version: "9.9.9", mode: "node_engine" },
    target_resolution_provider: { id: "caller-target-spoof", version: "8.8.8", mode: "code_index" },
    resolution_status: "ambiguous",
    target_resolution_status: "provider_unavailable",
    target_resolution_status_reason: "attacker reason",
    reason: "attacker reason alias",
    resolution_reason: "attacker resolution reason",
    status_reason: "attacker status reason",
    span: { start_line: 99, end_line: 100, line_count: 2 },
    fanout: { direct_reference_count: 99, affected_symbol_count: 99 },
    candidates: [{ path: "attacker.mjs", kind: "test_case", name: "attacker" }]
  }, { hasExpectedEditTargets: true });
  assert.deepEqual(resolved, { ...direct, normalized_input_digest: bindings.normalized_input_digest });
  assert.deepEqual(resolved.target_resolution_span, { start_line: 3, end_line: 5, line_count: 3 });
  assert.equal(resolved.target_resolution_status_reason, direct.target_resolution_status_reason);
  assert.notEqual(resolved.target_resolution_provider.id, "caller-spoof");
  assert.equal(JSON.stringify(resolved).includes("attacker"), false);
});

test("resolveStructuralTargetResolverEvidenceFromExpectedEditTarget preserves degraded test-case parser outcomes", () => {
  const target = (path = "packages/wiki-core/src/lib/sample-target.test.mjs") => ({ path, kind: "test_case", name: "bounded target", operation: "modify" });
  const supported = `import test from "node:test";\ntest("bounded target", () => {});`;
  const cases = [
    ["ambiguous", target(), `import test from "node:test";\ntest("bounded target", () => {});\ntest("bounded target", () => {});`],
    ["unsupported", target("packages/wiki-core/src/lib/sample-target.mjs"), supported],
    ["malformed", target(), `import test from "node:test";\ntest("bounded target", () => {`],
    ["dynamic", target(), `import test from "node:test";\nconst title = "bounded target";\ntest(title, () => {});`],
    ["source-missing", target(), undefined],
    ["path-invalid", target("../sample-target.test.mjs"), supported]
  ];

  for (const [name, testTarget, sourceText] of cases) {
    const direct = resolveBoundedJavaScriptTestCaseTargetFromSourceText({ target: testTarget, source_text: sourceText });
    const resolved = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget({
      target: testTarget,
      source_text: sourceText,
      provider: { id: "attacker-provider", version: "9.9.9", mode: "node_engine" },
      target_resolution_provider: { id: "attacker-target-provider", version: "8.8.8", mode: "code_index" },
      resolution_status: "resolved",
      target_resolution_status: "resolved",
      target_resolution_status_reason: `attacker reason ${name}`,
      reason: `attacker reason alias ${name}`,
      resolution_reason: `attacker resolution reason ${name}`,
      status_reason: `attacker status reason ${name}`,
      span: { start_line: 99, end_line: 100, line_count: 2 },
      fanout: { direct_reference_count: 99, affected_symbol_count: 99 },
      candidates: [{ path: "attacker.mjs", kind: "test_case", name: "attacker" }]
    }, { hasExpectedEditTargets: true });
    assert.deepEqual(resolved, direct, name);
    assert.equal(resolved.target_resolution_status_reason, direct.target_resolution_status_reason, name);
    assert.notEqual(resolved.target_resolution_status, "resolved", name);
    assert.ok(["degraded", "partial"].includes(resolved.target_resolution_evidence_status), name);
    assert.equal(JSON.stringify(resolved).includes("attacker"), false, name);
  }
});

test("resolveStructuralTargetResolverEvidenceFromExpectedEditTarget emits unsupported_kind for non-function/test_case kinds and preserves provider-unavailable diagnostics for unreadable and malformed targets", () => {
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

  for (const unsupportedKindValue of ["module", "class"]) {
    const unsupportedKind = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
      {
        target: {
          path: "packages/wiki-core/src/lib/sample-target.mjs",
          kind: unsupportedKindValue,
          name: "alpha",
          operation: "modify"
        }
      },
      {
        hasExpectedEditTargets: true
      }
    );

    assert.deepEqual(
      unsupportedKind,
      {
        target_resolution_evidence_status: "degraded",
        target_resolution_provider: null,
        target_resolution_target: {
          path: "packages/wiki-core/src/lib/sample-target.mjs",
          kind: unsupportedKindValue,
          name: "alpha",
          operation: "modify",
          optional: false
        },
        target_resolution_status: "unsupported_kind",
        target_resolution_status_reason: "provider does not support the declared target kind",
        target_resolution_span: null,
        target_resolution_fanout: null,
        target_resolution_candidates: []
      },
      unsupportedKindValue
    );
  }

  for (const missingKindValue of [undefined, "   "]) {
    const missingKind = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
      {
        target: {
          path: "packages/wiki-core/src/lib/sample-target.mjs",
          kind: missingKindValue,
          name: "alpha",
          operation: "modify"
        }
      },
      {
        hasExpectedEditTargets: true
      }
    );

    assert.deepEqual(
      missingKind,
      {
        target_resolution_evidence_status: "degraded",
        target_resolution_provider: {
          id: null,
          version: null,
          mode: "unavailable"
        },
        target_resolution_target: {
          path: "packages/wiki-core/src/lib/sample-target.mjs",
          kind: null,
          name: "alpha",
          operation: "modify",
          optional: false
        },
        target_resolution_status: "provider_unavailable",
        target_resolution_status_reason: "no structural resolver configured",
        target_resolution_span: null,
        target_resolution_fanout: null,
        target_resolution_candidates: []
      },
      String(missingKindValue)
    );
  }

  const malformedTestCaseCreate = (overrides) =>
    resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
      {
        target: {
          path: "packages/wiki-core/src/lib/sample-target.test.mjs",
          kind: "test_case",
          name: "bounded create target",
          operation: "create",
          ...overrides
        }
      },
      { hasExpectedEditTargets: true }
    );

  for (const [label, overrides, expectedReason] of [
    ["missing name", { name: undefined }, "declared target name was missing or unsupported"],
    ["blank name", { name: "   " }, "declared target name was missing or unsupported"],
    ["non-string name", { name: 42 }, "declared target name was missing or unsupported"],
    ["missing operation", { operation: undefined }, "declared target operation was missing or unsupported"],
    ["blank operation", { operation: "   " }, "declared target operation was missing or unsupported"],
    ["non-string operation", { operation: 7 }, "declared target operation was missing or unsupported"],
    ["unknown operation", { operation: "frobnicate" }, "declared target operation was missing or unsupported"]
  ]) {
    const evidence = malformedTestCaseCreate(overrides);
    assert.equal(evidence.target_resolution_status, "provider_unavailable", label);
    assert.equal(evidence.target_resolution_evidence_status, "degraded", label);
    assert.equal(evidence.target_resolution_provider.mode, "unavailable", label);
    assert.equal(evidence.target_resolution_status_reason, expectedReason, label);
    assert.equal(evidence.target_resolution_span, null, label);
    assert.deepEqual(evidence.target_resolution_candidates, [], label);
    if (expectedReason.includes("operation")) {

      assert.equal(evidence.target_resolution_target.operation, null, label);
      assert.equal(JSON.stringify(evidence).includes("frobnicate"), false, label);
    }
  }

  for (const [label, badPath] of [
    ["absolute path", "/etc/passwd.test.mjs"],
    ["windows drive-letter slash", "C:/repo/sample-target.test.mjs"],
    ["windows drive-letter backslash", "C:\\repo\\sample-target.test.mjs"],
    ["unc network path", "\\\\server\\share\\sample-target.test.mjs"],
    ["backslash separator", "packages\\wiki-core\\sample-target.test.mjs"],
    ["parent traversal", "../sample-target.test.mjs"],
    ["nested traversal", "packages/../../sample-target.test.mjs"],
    ["current-directory segment", "packages/./sample-target.test.mjs"],
    ["doubled separator", "packages//sample-target.test.mjs"],
    ["leading whitespace", " packages/wiki-core/sample-target.test.mjs"],
    ["trailing whitespace", "packages/wiki-core/sample-target.test.mjs "],
    ["ordinary non-test mjs", "packages/wiki-core/src/lib/sample-target.mjs"],
    ["ordinary non-test js", "packages/wiki-core/src/lib/sample-target.js"],
    ["unsupported extension", "packages/wiki-core/src/lib/sample-target.test.ts"],
    ["blank path", "   "]
  ]) {
    const evidence = malformedTestCaseCreate({ path: badPath });
    assert.equal(evidence.target_resolution_status, "provider_unavailable", label);
    assert.equal(evidence.target_resolution_evidence_status, "degraded", label);
    assert.equal(evidence.target_resolution_provider.mode, "unavailable", label);
    assert.equal(
      evidence.target_resolution_status_reason,
      "target path is not a supported repository JavaScript test file",
      label
    );
    assert.equal(evidence.target_resolution_span, null, label);
    assert.deepEqual(evidence.target_resolution_candidates, [], label);
  }

  for (const validPath of [
    "packages/wiki-core/src/lib/sample-target.test.js",
    "packages/wiki-core/src/lib/sample-target.test.mjs"
  ]) {
    const evidence = malformedTestCaseCreate({ path: validPath });
    assert.equal(evidence.target_resolution_status, "not_applicable", validPath);
    assert.equal(evidence.target_resolution_evidence_status, "present", validPath);
    assert.equal(evidence.target_resolution_provider, null, validPath);
    assert.equal(
      evidence.target_resolution_status_reason,
      "create target; no pre-existing symbol expected",
      validPath
    );
    assert.equal(evidence.target_resolution_target.path, validPath, validPath);
  }

  const validTestCaseCreate = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
    {
      target: {
        path: "packages/wiki-core/src/lib/sample-target.test.mjs",
        kind: "test_case",
        name: "bounded create target",
        operation: "create",
        optional: false
      },
      provider: { id: "attacker-provider", version: "9.9.9", mode: "node_engine" },
      target_resolution_provider: { id: "attacker-target-provider", version: "8.8.8", mode: "code_index" },
      resolution_status: "resolved",
      target_resolution_status: "ambiguous",
      target_resolution_status_reason: "attacker reason",
      reason: "attacker reason alias",
      span: { start_line: 99, end_line: 100, line_count: 2 },
      fanout: { direct_reference_count: 99, affected_symbol_count: 99 },
      candidates: [{ path: "attacker.mjs", kind: "test_case", name: "attacker" }],
      source_record_digest: "sha256:attacker-digest",
      selected_unit: { kind: "slice", address: "attacker-address" }
    },
    { hasExpectedEditTargets: true }
  );

  assert.deepEqual(validTestCaseCreate, {
    target_resolution_evidence_status: "present",
    target_resolution_provider: null,
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.test.mjs",
      kind: "test_case",
      name: "bounded create target",
      operation: "create",
      optional: false
    },
    target_resolution_status: "not_applicable",
    target_resolution_status_reason: "create target; no pre-existing symbol expected",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: []
  });
  assert.equal(JSON.stringify(validTestCaseCreate).includes("attacker"), false);

  const validFunctionCreate = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
    {
      target: {
        path: "packages/wiki-core/src/lib/sample-target.mjs",
        kind: "function",
        name: "createdHelper",
        operation: "create"
      },
      provider: { id: "attacker-provider", version: "9.9.9", mode: "node_engine" },
      target_resolution_status: "resolved",
      target_resolution_status_reason: "attacker reason"
    },
    { hasExpectedEditTargets: true }
  );

  assert.deepEqual(validFunctionCreate, {
    target_resolution_evidence_status: "present",
    target_resolution_provider: null,
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "function",
      name: "createdHelper",
      operation: "create",
      optional: false
    },
    target_resolution_status: "not_applicable",
    target_resolution_status_reason: "create target; no pre-existing symbol expected",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: []
  });
  assert.equal(JSON.stringify(validFunctionCreate).includes("attacker"), false);

  const spoofedMalformedCreate = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
    {
      target: {
        path: "packages/wiki-core/src/lib/sample-target.test.mjs",
        kind: "test_case",
        name: "   ",
        operation: "create"
      },
      provider: { id: "attacker-provider", version: "9.9.9", mode: "node_engine" },
      target_resolution_provider: { id: "attacker-target-provider", version: "8.8.8", mode: "code_index" },
      resolution_status: "resolved",
      target_resolution_status: "resolved",
      target_resolution_status_reason: "attacker reason",
      target_resolution_evidence_status: "present",
      reason: "attacker reason alias",
      span: { start_line: 99, end_line: 100, line_count: 2 },
      fanout: { direct_reference_count: 99, affected_symbol_count: 99 },
      source_record_digest: "sha256:attacker-digest",
      selected_unit: { kind: "slice", address: "attacker-address" }
    },
    { hasExpectedEditTargets: true }
  );

  assert.equal(spoofedMalformedCreate.target_resolution_status, "provider_unavailable");
  assert.equal(spoofedMalformedCreate.target_resolution_evidence_status, "degraded");
  assert.equal(spoofedMalformedCreate.target_resolution_provider.mode, "unavailable");
  assert.equal(
    spoofedMalformedCreate.target_resolution_status_reason,
    "declared target name was missing or unsupported"
  );
  assert.equal(spoofedMalformedCreate.target_resolution_span, null);
  assert.equal(JSON.stringify(spoofedMalformedCreate).includes("attacker"), false);

  const spoofedInvalidPathCreate = resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
    {
      target: {
        path: "packages/wiki-core/src/lib/sample-target.mjs",
        kind: "test_case",
        name: "bounded create target",
        operation: "create"
      },
      provider: { id: "attacker-provider", version: "9.9.9", mode: "node_engine" },
      target_resolution_provider: { id: "attacker-target-provider", version: "8.8.8", mode: "code_index" },
      resolution_status: "resolved",
      target_resolution_status: "resolved",
      target_resolution_status_reason: "attacker reason",
      target_resolution_evidence_status: "present",
      reason: "attacker reason alias",
      span: { start_line: 99, end_line: 100, line_count: 2 },
      fanout: { direct_reference_count: 99, affected_symbol_count: 99 },
      source_record_digest: "sha256:attacker-digest",
      selected_unit: { kind: "slice", address: "attacker-address" }
    },
    { hasExpectedEditTargets: true }
  );

  assert.equal(spoofedInvalidPathCreate.target_resolution_status, "provider_unavailable");
  assert.equal(spoofedInvalidPathCreate.target_resolution_evidence_status, "degraded");
  assert.equal(spoofedInvalidPathCreate.target_resolution_provider.mode, "unavailable");
  assert.equal(
    spoofedInvalidPathCreate.target_resolution_status_reason,
    "target path is not a supported repository JavaScript test file"
  );
  assert.equal(spoofedInvalidPathCreate.target_resolution_span, null);
  assert.deepEqual(spoofedInvalidPathCreate.target_resolution_candidates, []);
  assert.equal(JSON.stringify(spoofedInvalidPathCreate).includes("attacker"), false);
});
