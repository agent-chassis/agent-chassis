import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BINDING_SET_VERSION,
  bindingSetDigest,
  evaluateExactBindingsV034,
  sha256
} from "./exact-binding-v034.mjs";
import {
  captureArtifactBytes,
  captureCanonicalSnapshot,
  encodeCompleteReachabilitySnapshot,
  encodeObservedExecutionMutationSnapshot,
  runExactBindingEvaluationV034,
  validateExactBindingRunnerEnvelopeV034
} from "./exact-binding-runner-v034.mjs";

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const artifactProfile = {
  schema_version: "controlled-contract-verification-profile.experimental.v0.2",
  exact_binding_requirements: [
    {
      requirement_id: "baseline-artifact",
      binding_kind: "artifact_bytes",
      role_coverage: [{
        role: "baseline", coverage: "exact", projection: "artifact_subject"
      }]
    },
    {
      requirement_id: "candidate-artifact",
      binding_kind: "artifact_bytes",
      role_coverage: [{
        role: "candidate", coverage: "exact", projection: "artifact_subject"
      }]
    }
  ],
  distinct_capture_requirement_sets: [["baseline-artifact", "candidate-artifact"]]
};

const artifactContract = {
  references: [
    { reference_id: "ref-baseline", identity: "authored-name-is-not-authority" },
    { reference_id: "ref-candidate", identity: "authored-name-is-not-authority" }
  ]
};

const artifactInput = {
  reference_bindings: [
    { role: "baseline", reference_ids: ["ref-baseline"] },
    { role: "candidate", reference_ids: ["ref-candidate"] }
  ]
};

async function setupArtifactCase(baseline = "same bytes", candidate = "same bytes") {
  const root = await mkdtemp(path.join(os.tmpdir(), "exact-binding-artifacts-"));
  const baselinePath = path.join(root, "baseline.bin");
  const candidatePath = path.join(root, "candidate.bin");
  await Promise.all([
    writeFile(baselinePath, baseline),
    writeFile(candidatePath, candidate)
  ]);
  return { root, baselinePath, candidatePath };
}

function artifactRunArgs(paths) {
  return {
    contract_bytes: jsonBytes(artifactContract),
    profile_bytes: jsonBytes(artifactProfile),
    evaluation_input_bytes: jsonBytes(artifactInput),
    capture_requests: [
      {
        requirement_id: "candidate-artifact",
        binding_kind: "artifact_bytes",
        role_coverage: [{
          role: "candidate", projection: "artifact_subject",
          reference_ids: ["ref-candidate"]
        }],
        source_path: paths.candidatePath,
        capture_root: paths.root
      },
      {
        requirement_id: "baseline-artifact",
        binding_kind: "artifact_bytes",
        role_coverage: [{
          role: "baseline", projection: "artifact_subject",
          reference_ids: ["ref-baseline"]
        }],
        source_path: paths.baselinePath,
        capture_root: paths.root
      }
    ],
    captured_byte_checks: [{
      check_id: "p8-byte-equivalence",
      requirement_ids: ["baseline-artifact", "candidate-artifact"],
      expected_result: true,
      run: (baseline, candidate) => baseline.equals(candidate)
    }]
  };
}

test("P8 compares independently captured baseline and candidate bytes", async () => {
  const paths = await setupArtifactCase();
  const result = await runExactBindingEvaluationV034(artifactRunArgs(paths));
  assert.equal(result.satisfaction, "satisfied");
  assert.deepEqual(result.captured_byte_checks, [{
    check_id: "p8-byte-equivalence",
    requirement_ids: ["baseline-artifact", "candidate-artifact"],
    mode: "required",
    result: true,
    expected_result: true,
    passed: true
  }]);
  assert.equal(result.admission.kind, "local_exact_byte_capture");
  assert.equal(result.evaluation.admission.kind, "unadmitted_direct");
  assert.deepEqual(result.bindings, result.evaluation.bindings);
  assert.equal(result.binding_set_sha256, result.evaluation.binding_set_sha256);
  assert.notEqual(result.bindings[0].capture_id, result.bindings[1].capture_id);
});

test("a real candidate byte change changes identity and fails P8 comparison", async () => {
  const paths = await setupArtifactCase();
  const before = await runExactBindingEvaluationV034(artifactRunArgs(paths));
  await writeFile(paths.candidatePath, "different bytes");
  const after = await runExactBindingEvaluationV034(artifactRunArgs(paths));
  assert.equal(after.satisfaction, "unsatisfied");
  assert.equal(after.captured_byte_checks[0].passed, false);
  const digest = (result, requirementId) => result.bindings.find(
    ({ requirement_id: id }) => id === requirementId
  ).content_sha256;
  assert.notEqual(digest(before, "candidate-artifact"), digest(after, "candidate-artifact"));
  assert.equal(digest(before, "baseline-artifact"), digest(after, "baseline-artifact"));
});

test("P11 complete reachability snapshots have order-independent canonical bytes", () => {
  const left = {
    snapshot_id: "production-graph-7",
    snapshot_reference_id: "ref-graph",
    complete: true,
    nodes: [
      { node_id: "component", node_reference_id: "ref-component", kind: "component" },
      { node_id: "entry", node_reference_id: "ref-entry", kind: "entrypoint" }
    ],
    edges: [{ from: "entry", to: "component", kind: "calls" }]
  };
  const reordered = {
    ...left,
    nodes: [...left.nodes].reverse(),
    edges: [...left.edges].reverse()
  };
  assert.deepEqual(
    encodeCompleteReachabilitySnapshot(left),
    encodeCompleteReachabilitySnapshot(reordered)
  );
  assert.throws(
    () => encodeCompleteReachabilitySnapshot({ ...left, complete: false }),
    /not_complete/
  );
});

test("P11 real graph mutants change the complete snapshot digest", () => {
  const base = {
    snapshot_id: "production-graph-7",
    snapshot_reference_id: "ref-graph",
    complete: true,
    nodes: [
      { node_id: "entry", node_reference_id: "ref-entry", kind: "entrypoint" },
      { node_id: "component", node_reference_id: "ref-component", kind: "component" }
    ],
    edges: []
  };
  const reachableMutant = {
    ...base,
    edges: [{ from: "entry", to: "component", kind: "calls" }]
  };
  const first = captureCanonicalSnapshot({
    binding_kind: "complete_reachability_snapshot", snapshot: base
  });
  const second = captureCanonicalSnapshot({
    binding_kind: "complete_reachability_snapshot", snapshot: reachableMutant
  });
  assert.notEqual(first.content_sha256, second.content_sha256);
});

test("P13 mutation population snapshots are closed, canonical, and mutation-sensitive", () => {
  const original = {
    execution_id: "run-42",
    execution_reference_id: "ref-run",
    complete: true,
    mutations: [{
      mutation_reference_id: "ref-mutation-a",
      target_id: "file:a",
      operation: "update",
      before_sha256: "1".repeat(64),
      after_sha256: "2".repeat(64)
    }]
  };
  const mutant = {
    ...original,
    mutations: [...original.mutations, {
      mutation_reference_id: "ref-mutation-b",
      target_id: "file:b",
      operation: "create",
      before_sha256: null,
      after_sha256: "3".repeat(64)
    }]
  };
  assert.notEqual(
    sha256(encodeObservedExecutionMutationSnapshot(original)),
    sha256(encodeObservedExecutionMutationSnapshot(mutant))
  );
  assert.throws(
    () => encodeObservedExecutionMutationSnapshot({ ...original, complete: false }),
    /not_complete/
  );
});

test("P11 and P13 profiles bind exact subject and population role coverage", async () => {
  const profile = {
    exact_binding_requirements: [
      {
        requirement_id: "production-graph",
        binding_kind: "complete_reachability_snapshot",
        role_coverage: [
          { role: "production_graph", coverage: "exact", projection: "snapshot_subject" },
          { role: "graph_nodes", coverage: "exact", projection: "snapshot_population" }
        ]
      },
      {
        requirement_id: "observed-mutations",
        binding_kind: "observed_execution_mutation_snapshot",
        role_coverage: [
          { role: "observed_execution", coverage: "exact", projection: "snapshot_subject" },
          { role: "observed_mutations", coverage: "exact", projection: "snapshot_population" }
        ]
      }
    ]
  };
  const contract = {
    references: [
      { reference_id: "ref-graph" },
      { reference_id: "ref-entry" },
      { reference_id: "ref-component" },
      { reference_id: "ref-run" },
      { reference_id: "ref-mutation-a" }
    ]
  };
  const input = {
    reference_bindings: [
      { role: "production_graph", reference_ids: ["ref-graph"] },
      { role: "graph_nodes", reference_ids: ["ref-entry", "ref-component"] },
      { role: "observed_execution", reference_ids: ["ref-run"] },
      { role: "observed_mutations", reference_ids: ["ref-mutation-a"] }
    ]
  };
  const result = await runExactBindingEvaluationV034({
    contract_bytes: jsonBytes(contract),
    profile_bytes: jsonBytes(profile),
    evaluation_input_bytes: jsonBytes(input),
    capture_requests: [
      {
        requirement_id: "production-graph",
        binding_kind: "complete_reachability_snapshot",
        role_projections: [
          { role: "production_graph", projection: "snapshot_subject" },
          { role: "graph_nodes", projection: "snapshot_population" }
        ],
        snapshot: {
          snapshot_id: "graph-1", snapshot_reference_id: "ref-graph", complete: true,
          nodes: [
            { node_id: "entry", node_reference_id: "ref-entry", kind: "entrypoint" },
            { node_id: "component", node_reference_id: "ref-component", kind: "component" }
          ],
          edges: []
        }
      },
      {
        requirement_id: "observed-mutations",
        binding_kind: "observed_execution_mutation_snapshot",
        role_projections: [
          { role: "observed_execution", projection: "snapshot_subject" },
          { role: "observed_mutations", projection: "snapshot_population" }
        ],
        snapshot: {
          execution_id: "run-42", execution_reference_id: "ref-run", complete: true,
          mutations: [{
            mutation_reference_id: "ref-mutation-a", target_id: "file:a",
            operation: "create", before_sha256: null, after_sha256: "4".repeat(64)
          }]
        }
      }
    ]
  });
  assert.equal(result.satisfaction, "satisfied");
  assert.deepEqual(result.bindings.map(({ binding_kind: kind }) => kind), [
    "observed_execution_mutation_snapshot", "complete_reachability_snapshot"
  ]);
});

test("P11 carries a complete empty reachability population and detects its expansion", async () => {
  const profile = {
    exact_binding_requirements: [{
      requirement_id: "production-graph",
      binding_kind: "complete_reachability_snapshot",
      role_coverage: [
        { role: "production_graph", coverage: "exact", projection: "snapshot_subject" },
        { role: "graph_nodes", coverage: "exact", projection: "snapshot_population" }
      ]
    }]
  };
  const contract = { references: [{ reference_id: "ref-graph" }] };
  const input = { reference_bindings: [
    { role: "production_graph", reference_ids: ["ref-graph"] },
    { role: "graph_nodes", reference_ids: [] }
  ] };
  const request = {
    requirement_id: "production-graph",
    binding_kind: "complete_reachability_snapshot",
    role_projections: [
      { role: "production_graph", projection: "snapshot_subject" },
      { role: "graph_nodes", projection: "snapshot_population" }
    ],
    snapshot: {
      snapshot_id: "empty-graph", snapshot_reference_id: "ref-graph",
      complete: true, nodes: [], edges: []
    }
  };
  const empty = await runExactBindingEvaluationV034({
    contract_bytes: jsonBytes(contract), profile_bytes: jsonBytes(profile),
    evaluation_input_bytes: jsonBytes(input), capture_requests: [request]
  });
  assert.equal(empty.satisfaction, "satisfied");
  assert.deepEqual(empty.bindings[0].role_coverage.find(
    ({ role }) => role === "graph_nodes"
  ).reference_ids, []);
  assert.deepEqual(validateExactBindingRunnerEnvelopeV034(empty), []);

  const expanded = await runExactBindingEvaluationV034({
    contract_bytes: jsonBytes({ references: [
      ...contract.references, { reference_id: "ref-entry" }
    ] }),
    profile_bytes: jsonBytes(profile),
    evaluation_input_bytes: jsonBytes(input),
    capture_requests: [{
      ...request,
      snapshot: {
        ...request.snapshot,
        nodes: [{
          node_id: "entry", node_reference_id: "ref-entry", kind: "entrypoint"
        }]
      }
    }]
  });
  assert.equal(expanded.satisfaction, "unsatisfied");
  assert.notEqual(expanded.bindings[0].content_sha256, empty.bindings[0].content_sha256);
  assert.ok(expanded.evaluation.diagnostics.some(
    ({ code }) => code === "binding_role_coverage_mismatch"
  ));
});

test("P13 carries a complete empty mutation population and detects its expansion", async () => {
  const profile = {
    exact_binding_requirements: [{
      requirement_id: "observed-mutations",
      binding_kind: "observed_execution_mutation_snapshot",
      role_coverage: [
        { role: "observed_execution", coverage: "exact", projection: "snapshot_subject" },
        { role: "observed_mutations", coverage: "exact", projection: "snapshot_population" }
      ]
    }]
  };
  const contract = { references: [{ reference_id: "ref-run" }] };
  const input = { reference_bindings: [
    { role: "observed_execution", reference_ids: ["ref-run"] },
    { role: "observed_mutations", reference_ids: [] }
  ] };
  const request = {
    requirement_id: "observed-mutations",
    binding_kind: "observed_execution_mutation_snapshot",
    role_projections: [
      { role: "observed_execution", projection: "snapshot_subject" },
      { role: "observed_mutations", projection: "snapshot_population" }
    ],
    snapshot: {
      execution_id: "empty-run", execution_reference_id: "ref-run",
      complete: true, mutations: []
    }
  };
  const empty = await runExactBindingEvaluationV034({
    contract_bytes: jsonBytes(contract), profile_bytes: jsonBytes(profile),
    evaluation_input_bytes: jsonBytes(input), capture_requests: [request]
  });
  assert.equal(empty.satisfaction, "satisfied");
  assert.deepEqual(empty.bindings[0].role_coverage.find(
    ({ role }) => role === "observed_mutations"
  ).reference_ids, []);
  assert.deepEqual(validateExactBindingRunnerEnvelopeV034(empty), []);

  const expanded = await runExactBindingEvaluationV034({
    contract_bytes: jsonBytes({ references: [
      ...contract.references, { reference_id: "ref-mutation-a" }
    ] }),
    profile_bytes: jsonBytes(profile),
    evaluation_input_bytes: jsonBytes(input),
    capture_requests: [{
      ...request,
      snapshot: {
        ...request.snapshot,
        mutations: [{
          mutation_reference_id: "ref-mutation-a", target_id: "file:a",
          operation: "create", before_sha256: null, after_sha256: "7".repeat(64)
        }]
      }
    }]
  });
  assert.equal(expanded.satisfaction, "unsatisfied");
  assert.notEqual(expanded.bindings[0].content_sha256, empty.bindings[0].content_sha256);
  assert.ok(expanded.evaluation.diagnostics.some(
    ({ code }) => code === "binding_role_coverage_mismatch"
  ));
});

test("missing binding is indeterminate and direct evaluation remains unadmitted", async () => {
  const paths = await setupArtifactCase();
  const complete = await runExactBindingEvaluationV034(artifactRunArgs(paths));
  const bindingSet = {
    binding_set_version: BINDING_SET_VERSION,
    context: complete.inputs,
    bindings: complete.bindings.filter(
      ({ requirement_id: id }) => id !== "candidate-artifact"
    )
  };
  const result = evaluateExactBindingsV034({
    profile: artifactProfile,
    evaluation_input: artifactInput,
    contract_reference_ids: artifactContract.references.map(({ reference_id: id }) => id),
    input_digests: complete.inputs,
    binding_set: bindingSet
  });
  assert.equal(result.satisfaction, "indeterminate");
  assert.equal(result.admission.kind, "unadmitted_direct");
  assert.ok(result.diagnostics.some(({ code }) => code === "required_binding_missing"));
});

test("stale context detects binding-set splicing", async () => {
  const paths = await setupArtifactCase();
  const complete = await runExactBindingEvaluationV034(artifactRunArgs(paths));
  const splicedInputDigests = {
    ...complete.inputs,
    evaluation_input_sha256: "f".repeat(64)
  };
  const result = evaluateExactBindingsV034({
    profile: artifactProfile,
    evaluation_input: artifactInput,
    contract_reference_ids: artifactContract.references.map(({ reference_id: id }) => id),
    input_digests: splicedInputDigests,
    binding_set: {
      binding_set_version: BINDING_SET_VERSION,
      context: complete.inputs,
      bindings: complete.bindings
    }
  });
  assert.equal(result.satisfaction, "invalid");
  assert.ok(result.diagnostics.some(
    ({ code }) => code === "binding_context_stale_or_spliced"
  ));
});

test("role/reference alias mismatch cannot satisfy exact coverage", async () => {
  const paths = await setupArtifactCase();
  const complete = await runExactBindingEvaluationV034(artifactRunArgs(paths));
  const bindings = structuredClone(complete.bindings);
  bindings.find(({ requirement_id: id }) => id === "candidate-artifact")
    .role_coverage[0].reference_ids = ["ref-baseline"];
  const result = evaluateExactBindingsV034({
    profile: artifactProfile,
    evaluation_input: artifactInput,
    contract_reference_ids: artifactContract.references.map(({ reference_id: id }) => id),
    input_digests: complete.inputs,
    binding_set: {
      binding_set_version: BINDING_SET_VERSION,
      context: complete.inputs,
      bindings
    }
  });
  assert.equal(result.satisfaction, "unsatisfied");
  assert.ok(result.diagnostics.some(
    ({ code }) => code === "binding_role_coverage_mismatch"
  ));
});

test("binding kind mismatch cannot satisfy a profile requirement", async () => {
  const paths = await setupArtifactCase();
  const complete = await runExactBindingEvaluationV034(artifactRunArgs(paths));
  const bindings = structuredClone(complete.bindings);
  bindings[0].binding_kind = "complete_reachability_snapshot";
  bindings[0].role_coverage[0].projection = "snapshot_subject";
  const result = evaluateExactBindingsV034({
    profile: artifactProfile,
    evaluation_input: artifactInput,
    contract_reference_ids: artifactContract.references.map(({ reference_id: id }) => id),
    input_digests: complete.inputs,
    binding_set: {
      binding_set_version: BINDING_SET_VERSION,
      context: complete.inputs,
      bindings
    }
  });
  assert.equal(result.satisfaction, "unsatisfied");
  assert.ok(result.diagnostics.some(
    ({ code }) => code === "required_binding_kind_mismatch"
  ));
});

test("expected digest is a constraint, not evidence, and stale bytes fail", async () => {
  const paths = await setupArtifactCase();
  await assert.rejects(
    captureArtifactBytes({
      source_path: paths.baselinePath,
      capture_root: paths.root,
      expected_sha256: "0".repeat(64)
    }),
    /stale_expected_digest/
  );
  const badArgs = artifactRunArgs(paths);
  badArgs.capture_requests[0].content_sha256 = "0".repeat(64);
  await assert.rejects(
    runExactBindingEvaluationV034(badArgs),
    /unknown_fields:content_sha256/
  );
});

test("a profile-pinned digest detects a semantically swapped or stale artifact", async () => {
  const paths = await setupArtifactCase("trusted baseline", "candidate bytes");
  const args = artifactRunArgs(paths);
  const pinnedProfile = structuredClone(artifactProfile);
  pinnedProfile.exact_binding_requirements.find(
    ({ requirement_id: id }) => id === "baseline-artifact"
  ).expected_content_sha256 = sha256(Buffer.from("trusted baseline"));
  args.profile_bytes = jsonBytes(pinnedProfile);
  assert.equal((await runExactBindingEvaluationV034(args)).evaluation.satisfaction,
    "satisfied");
  args.capture_requests.find(
    ({ requirement_id: id }) => id === "baseline-artifact"
  ).source_path = paths.candidatePath;
  const swapped = await runExactBindingEvaluationV034(args);
  assert.equal(swapped.evaluation.satisfaction, "unsatisfied");
  assert.ok(swapped.evaluation.diagnostics.some(
    ({ code }) => code === "required_binding_content_digest_mismatch"
  ));
});

test("snapshot population coverage is derived from snapshot bytes", async () => {
  const snapshot = {
    snapshot_id: "graph-1",
    snapshot_reference_id: "ref-graph",
    complete: true,
    nodes: [{
      node_id: "entry", node_reference_id: "ref-entry", kind: "entrypoint"
    }],
    edges: []
  };
  assert.throws(
    () => captureCanonicalSnapshot({
      binding_kind: "complete_reachability_snapshot",
      snapshot,
      expected_sha256: "0".repeat(64)
    }),
    /stale_expected_digest/
  );
  const profile = {
    exact_binding_requirements: [{
      requirement_id: "production-graph",
      binding_kind: "complete_reachability_snapshot",
      role_coverage: [
        { role: "production_graph", coverage: "exact", projection: "snapshot_subject" },
        { role: "graph_nodes", coverage: "exact", projection: "snapshot_population" }
      ]
    }]
  };
  const contract = { references: [
    { reference_id: "ref-graph" }, { reference_id: "ref-entry" }
  ] };
  const input = { reference_bindings: [
    { role: "production_graph", reference_ids: ["ref-graph"] },
    { role: "graph_nodes", reference_ids: ["ref-entry"] }
  ] };
  const request = {
    requirement_id: "production-graph",
    binding_kind: "complete_reachability_snapshot",
    role_projections: [
      { role: "production_graph", projection: "snapshot_subject" },
      { role: "graph_nodes", projection: "snapshot_population" }
    ],
    snapshot
  };
  const valid = await runExactBindingEvaluationV034({
    contract_bytes: jsonBytes(contract), profile_bytes: jsonBytes(profile),
    evaluation_input_bytes: jsonBytes(input), capture_requests: [request]
  });
  assert.deepEqual(valid.bindings[0].role_coverage.find(
    ({ role }) => role === "graph_nodes"
  ).reference_ids, ["ref-entry"]);
  await assert.rejects(
    runExactBindingEvaluationV034({
      contract_bytes: jsonBytes(contract), profile_bytes: jsonBytes(profile),
      evaluation_input_bytes: jsonBytes(input),
      capture_requests: [{
        ...request,
        role_coverage: [{
          role: "graph_nodes", projection: "snapshot_population",
          reference_ids: ["ref-decoy"]
        }]
      }]
    }),
    /snapshot_capture_role_projections_required/
  );
});

test("malformed direct binding input fails closed without throwing", () => {
  const result = evaluateExactBindingsV034({
    profile: artifactProfile,
    evaluation_input: artifactInput,
    contract_reference_ids: ["ref-baseline", "ref-candidate"],
    input_digests: {
      contract_sha256: "1".repeat(64),
      profile_sha256: "2".repeat(64),
      evaluation_input_sha256: "3".repeat(64)
    },
    binding_set: {
      binding_set_version: BINDING_SET_VERSION,
      context: {
        contract_sha256: "1".repeat(64),
        profile_sha256: "2".repeat(64),
        evaluation_input_sha256: "3".repeat(64)
      },
      bindings: [{ binding_id: "broken" }]
    }
  });
  assert.equal(result.satisfaction, "invalid");
  assert.equal(result.binding_set_sha256, null);
  assert.deepEqual(result.bindings, []);
});

test("profile and evaluation-input extension validation is total and strict", async () => {
  const paths = await setupArtifactCase();
  const complete = await runExactBindingEvaluationV034(artifactRunArgs(paths));
  const directArgs = {
    profile: artifactProfile,
    evaluation_input: artifactInput,
    contract_reference_ids: ["ref-baseline", "ref-candidate"],
    input_digests: complete.inputs,
    binding_set: {
      binding_set_version: BINDING_SET_VERSION,
      context: complete.inputs,
      bindings: complete.bindings
    }
  };
  for (const malformed of [
    null,
    { role: "candidate", reference_ids: null },
    { role: "candidate", reference_ids: ["ref-candidate"], invented: true }
  ]) {
    const result = evaluateExactBindingsV034({
      ...directArgs,
      evaluation_input: { reference_bindings: [malformed] }
    });
    assert.equal(result.satisfaction, "invalid");
  }
  const extraProfileField = structuredClone(artifactProfile);
  extraProfileField.exact_binding_requirements[0].caller_digest_is_evidence = true;
  assert.equal(evaluateExactBindingsV034({
    ...directArgs,
    profile: extraProfileField
  }).satisfaction, "invalid");
  const runnerArgs = artifactRunArgs(paths);
  runnerArgs.profile_bytes = jsonBytes(extraProfileField);
  assert.equal(
    (await runExactBindingEvaluationV034(runnerArgs)).satisfaction,
    "invalid"
  );
});

test("captured-byte checks are explicit, canonical, isolated JSON values", async () => {
  const paths = await setupArtifactCase();
  const missingExpectation = artifactRunArgs(paths);
  missingExpectation.captured_byte_checks = [{
    check_id: "missing-expectation",
    requirement_ids: ["candidate-artifact"],
    run: () => false
  }];
  await assert.rejects(
    runExactBindingEvaluationV034(missingExpectation),
    /expected_result_required/
  );

  const informational = artifactRunArgs(paths);
  informational.captured_byte_checks = [{
    check_id: "observed-only",
    requirement_ids: ["candidate-artifact"],
    mode: "informational",
    run: () => false
  }];
  const informationalResult = await runExactBindingEvaluationV034(informational);
  assert.equal(informationalResult.satisfaction, "satisfied");
  assert.deepEqual(informationalResult.captured_byte_checks, [{
    check_id: "observed-only",
    requirement_ids: ["candidate-artifact"],
    mode: "informational",
    result: false,
    passed: null
  }]);

  const nonJson = artifactRunArgs(paths);
  nonJson.captured_byte_checks = [{
    check_id: "non-json-result",
    requirement_ids: ["candidate-artifact"],
    expected_result: {},
    run: () => new Date(0)
  }];
  await assert.rejects(runExactBindingEvaluationV034(nonJson), /canonical_json_object_invalid/);

  const originalResult = { b: 2, a: { value: 1 } };
  const originalExpectation = { a: { value: 1 }, b: 2 };
  const canonical = artifactRunArgs(paths);
  canonical.captured_byte_checks = [{
    check_id: "canonical-object",
    requirement_ids: ["candidate-artifact"],
    expected_result: originalExpectation,
    run: () => {
      originalExpectation.a.value = 9;
      return originalResult;
    }
  }];
  const canonicalResult = await runExactBindingEvaluationV034(canonical);
  assert.equal(canonicalResult.captured_byte_checks[0].passed, true);
  originalResult.a.value = 9;
  originalExpectation.a.value = 8;
  assert.deepEqual(canonicalResult.captured_byte_checks[0].result, {
    a: { value: 1 }, b: 2
  });
  assert.ok(Object.isFrozen(canonicalResult.captured_byte_checks[0].result.a));
});

test("canonical role coverage has order-independent capture and binding-set identity", async () => {
  const paths = await setupArtifactCase();
  const profile = structuredClone(artifactProfile);
  profile.exact_binding_requirements.find(
    ({ requirement_id: id }) => id === "candidate-artifact"
  ).role_coverage.push({
    role: "candidate_alias", coverage: "exact", projection: "artifact_subject"
  });
  const firstArgs = artifactRunArgs(paths);
  firstArgs.profile_bytes = jsonBytes(profile);
  firstArgs.capture_requests[0].role_coverage.push({
    role: "candidate_alias", projection: "artifact_subject",
    reference_ids: ["ref-baseline"]
  });
  firstArgs.evaluation_input_bytes = jsonBytes({ reference_bindings: [
    { role: "baseline", reference_ids: ["ref-baseline"] },
    { role: "candidate", reference_ids: ["ref-candidate"] },
    { role: "candidate_alias", reference_ids: ["ref-baseline"] }
  ] });
  const secondArgs = artifactRunArgs(paths);
  secondArgs.profile_bytes = firstArgs.profile_bytes;
  secondArgs.evaluation_input_bytes = firstArgs.evaluation_input_bytes;
  secondArgs.capture_requests[0].role_coverage = [
    ...firstArgs.capture_requests[0].role_coverage
  ].reverse();
  const [first, second] = await Promise.all([
    runExactBindingEvaluationV034(firstArgs),
    runExactBindingEvaluationV034(secondArgs)
  ]);
  assert.equal(first.satisfaction, "satisfied");
  assert.equal(second.satisfaction, "satisfied");
  const candidateCaptureId = (result) => result.bindings.find(
    ({ requirement_id: id }) => id === "candidate-artifact"
  ).capture_id;
  assert.equal(candidateCaptureId(first), candidateCaptureId(second));
  assert.equal(first.binding_set_sha256, second.binding_set_sha256);
});

test("semantic runner validation rejects a structurally valid cross-run splice", async () => {
  const paths = await setupArtifactCase();
  const first = await runExactBindingEvaluationV034(artifactRunArgs(paths));
  const changed = artifactRunArgs(paths);
  changed.contract_bytes = jsonBytes({
    ...artifactContract,
    unrelated_context_change: true
  });
  const second = await runExactBindingEvaluationV034(changed);
  const spliced = structuredClone(first);
  spliced.evaluation = structuredClone(second.evaluation);
  assert.ok(validateExactBindingRunnerEnvelopeV034(spliced).some(
    ({ code }) => code === "runner_evaluation_binding_set_digest_mismatch"
  ));
  assert.deepEqual(validateExactBindingRunnerEnvelopeV034(first), []);
});

test("final symlinks and opened objects outside capture root fail closed", async () => {
  const paths = await setupArtifactCase();
  const linkPath = path.join(paths.root, "link.bin");
  await symlink(paths.baselinePath, linkPath);
  await assert.rejects(
    captureArtifactBytes({ source_path: linkPath, capture_root: paths.root }),
    /final_symlink_refused/
  );
  const otherRoot = await mkdtemp(path.join(os.tmpdir(), "exact-binding-other-"));
  await assert.rejects(
    captureArtifactBytes({ source_path: paths.baselinePath, capture_root: otherRoot }),
    /outside_root/
  );
});

test("concurrent pathname replacement cannot change already-open captured bytes", async () => {
  const paths = await setupArtifactCase("old inode bytes", "unused");
  const parked = path.join(paths.root, "parked.bin");
  const capture = await captureArtifactBytes({
    source_path: paths.baselinePath,
    capture_root: paths.root
  }, {
    after_open: async () => {
      await rename(paths.baselinePath, parked);
      await writeFile(paths.baselinePath, "replacement bytes");
    }
  });
  assert.equal(capture.copy_bytes().toString("utf8"), "old inode bytes");
  assert.equal(await readFile(paths.baselinePath, "utf8"), "replacement bytes");
});

test("same-inode mutation during capture is rejected", async () => {
  const paths = await setupArtifactCase("old bytes", "unused");
  await assert.rejects(
    captureArtifactBytes({
      source_path: paths.baselinePath,
      capture_root: paths.root
    }, {
      after_open: () => writeFile(paths.baselinePath, "new longer bytes")
    }),
    /inode_changed_during_read/
  );
});

test("multiple artifacts and direct results are deterministic and frozen", async () => {
  const paths = await setupArtifactCase();
  const first = await runExactBindingEvaluationV034(artifactRunArgs(paths));
  const second = await runExactBindingEvaluationV034(artifactRunArgs(paths));
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.bindings));
  assert.equal(bindingSetDigest({
    binding_set_version: BINDING_SET_VERSION,
    context: first.inputs,
    bindings: [...first.bindings].reverse()
  }), first.binding_set_sha256);
});

test("pure evaluator module has no filesystem access", async () => {
  const source = await readFile(new URL(
    "./exact-binding-v034.mjs", import.meta.url
  ), "utf8");
  assert.doesNotMatch(source, /node:fs|readFile|open\(/u);
});
