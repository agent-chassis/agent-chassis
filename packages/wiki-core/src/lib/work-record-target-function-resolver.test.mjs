import test from "node:test";
import assert from "node:assert/strict";

import { resolveBoundedJavaScriptFunctionTargetFromSourceText } from "./work-record-target-function-resolver.mjs";

function resolveTarget(name, sourceText) {
  return resolveBoundedJavaScriptFunctionTargetFromSourceText({
    sourceText,
    target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "function",
      name,
      operation: "modify"
    }
  });
}

test("resolves JavaScript and ESM function targets to bounded line spans", () => {
  const sourceText = `function plain() {
  return 0;
}

export function exported() {
  return 1;
}

async function awaited() {
  return 2;
}

const gamma = () => {
  return 3;
};

const delta = async () => 4;
`;

  assert.deepEqual(resolveTarget("plain", sourceText), {
    target_resolution_evidence_status: "present",
    target_resolution_provider: {
      id: "portfolio-local.target-function-resolver",
      version: "0.1.0",
      mode: "local"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "function",
      name: "plain",
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
    target_resolution_candidates: [],
    source_record_digest: null,
    selected_unit: null,
    payload_bound_input_digest: null
  });

  assert.deepEqual(resolveTarget("exported", sourceText), {
    target_resolution_evidence_status: "present",
    target_resolution_provider: {
      id: "portfolio-local.target-function-resolver",
      version: "0.1.0",
      mode: "local"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "function",
      name: "exported",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "resolved",
    target_resolution_status_reason: "exactly one target span or structural target was identified",
    target_resolution_span: {
      start_line: 5,
      end_line: 7,
      line_count: 3
    },
    target_resolution_fanout: {
      direct_reference_count: 1,
      affected_symbol_count: 1
    },
    target_resolution_candidates: [],
    source_record_digest: null,
    selected_unit: null,
    payload_bound_input_digest: null
  });

  assert.deepEqual(resolveTarget("awaited", sourceText), {
    target_resolution_evidence_status: "present",
    target_resolution_provider: {
      id: "portfolio-local.target-function-resolver",
      version: "0.1.0",
      mode: "local"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "function",
      name: "awaited",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "resolved",
    target_resolution_status_reason: "exactly one target span or structural target was identified",
    target_resolution_span: {
      start_line: 9,
      end_line: 11,
      line_count: 3
    },
    target_resolution_fanout: {
      direct_reference_count: 1,
      affected_symbol_count: 1
    },
    target_resolution_candidates: [],
    source_record_digest: null,
    selected_unit: null,
    payload_bound_input_digest: null
  });

  assert.deepEqual(resolveTarget("gamma", sourceText), {
    target_resolution_evidence_status: "present",
    target_resolution_provider: {
      id: "portfolio-local.target-function-resolver",
      version: "0.1.0",
      mode: "local"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "function",
      name: "gamma",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "resolved",
    target_resolution_status_reason: "exactly one target span or structural target was identified",
    target_resolution_span: {
      start_line: 13,
      end_line: 15,
      line_count: 3
    },
    target_resolution_fanout: {
      direct_reference_count: 1,
      affected_symbol_count: 1
    },
    target_resolution_candidates: [],
    source_record_digest: null,
    selected_unit: null,
    payload_bound_input_digest: null
  });

  assert.deepEqual(resolveTarget("delta", sourceText), {
    target_resolution_evidence_status: "present",
    target_resolution_provider: {
      id: "portfolio-local.target-function-resolver",
      version: "0.1.0",
      mode: "local"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "function",
      name: "delta",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "resolved",
    target_resolution_status_reason: "exactly one target span or structural target was identified",
    target_resolution_span: {
      start_line: 17,
      end_line: 17,
      line_count: 1
    },
    target_resolution_fanout: {
      direct_reference_count: 1,
      affected_symbol_count: 1
    },
    target_resolution_candidates: [],
    source_record_digest: null,
    selected_unit: null,
    payload_bound_input_digest: null
  });
});

test("returns explicit deterministic diagnostics for unresolved and ambiguous function names", () => {
  const sourceText = `const ambiguous = () => 1;
const ambiguous = () => 2;
`;

  const unresolved = resolveTarget("missing", sourceText);
  const unresolvedAgain = resolveTarget("missing", sourceText);

  assert.deepEqual(unresolved, unresolvedAgain);
  assert.deepEqual(unresolved, {
    target_resolution_evidence_status: "degraded",
    target_resolution_provider: {
      id: "portfolio-local.target-function-resolver",
      version: "0.1.0",
      mode: "local"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "function",
      name: "missing",
      operation: "modify",
      optional: false
    },
    target_resolution_status: "unresolved",
    target_resolution_status_reason: "no supported target matched the declared target",
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: [],
    source_record_digest: null,
    selected_unit: null,
    payload_bound_input_digest: null
  });

  const ambiguous = resolveTarget("ambiguous", sourceText);
  const ambiguousAgain = resolveTarget("ambiguous", sourceText);

  assert.deepEqual(ambiguous, ambiguousAgain);
  assert.deepEqual(ambiguous, {
    target_resolution_evidence_status: "partial",
    target_resolution_provider: {
      id: "portfolio-local.target-function-resolver",
      version: "0.1.0",
      mode: "local"
    },
    target_resolution_target: {
      path: "packages/wiki-core/src/lib/sample-target.mjs",
      kind: "function",
      name: "ambiguous",
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
      direct_reference_count: 2,
      affected_symbol_count: 2
    },
    target_resolution_candidates: [
      {
        path: "packages/wiki-core/src/lib/sample-target.mjs",
        kind: "function",
        name: "ambiguous",
        span: {
          start_line: 1,
          end_line: 1,
          line_count: 1
        }
      },
      {
        path: "packages/wiki-core/src/lib/sample-target.mjs",
        kind: "function",
        name: "ambiguous",
        span: {
          start_line: 2,
          end_line: 2,
          line_count: 1
        }
      }
    ],
    source_record_digest: null,
    selected_unit: null,
    payload_bound_input_digest: null
  });
});
