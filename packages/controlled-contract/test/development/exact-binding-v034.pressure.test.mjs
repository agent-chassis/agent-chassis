import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BINDING_SET_VERSION,
  evaluateExactBindingsV034,
  sha256
} from "./exact-binding-v034.mjs";
import {
  encodeCompleteReachabilitySnapshot,
  runExactBindingEvaluationV034
} from "./exact-binding-runner-v034.mjs";

const digest = (character) => character.repeat(64);
const inputDigests = {
  contract_sha256: digest("1"),
  profile_sha256: digest("2"),
  evaluation_input_sha256: digest("3")
};
const profile = {
  exact_binding_requirements: [
    {
      requirement_id: "left-artifact",
      binding_kind: "artifact_bytes",
      role_coverage: [{
        role: "left", coverage: "exact", projection: "artifact_subject"
      }]
    },
    {
      requirement_id: "right-artifact",
      binding_kind: "artifact_bytes",
      role_coverage: [{
        role: "right", coverage: "exact", projection: "artifact_subject"
      }]
    }
  ],
  distinct_capture_requirement_sets: [["left-artifact", "right-artifact"]]
};
const evaluationInput = { reference_bindings: [
  { role: "left", reference_ids: ["ref-left"] },
  { role: "right", reference_ids: ["ref-right"] }
] };

function binding(requirement, capture, role, reference, content = digest("a")) {
  return {
    binding_id: `bind-${requirement}`,
    requirement_id: requirement,
    capture_id: capture,
    binding_kind: "artifact_bytes",
    media_type: "application/octet-stream",
    content_sha256: content,
    byte_length: 1,
    role_coverage: [{
      role, projection: "artifact_subject", reference_ids: [reference]
    }]
  };
}

function direct(bindings, profileValue = profile) {
  return evaluateExactBindingsV034({
    profile: profileValue,
    evaluation_input: evaluationInput,
    contract_reference_ids: ["ref-left", "ref-right"],
    input_digests: inputDigests,
    binding_set: {
      binding_set_version: BINDING_SET_VERSION,
      context: inputDigests,
      bindings
    }
  });
}

test("pressure: copied capture IDs cannot fake independent captures", () => {
  const result = direct([
    binding("left-artifact", "cap-shared", "left", "ref-left"),
    binding("right-artifact", "cap-shared", "right", "ref-right")
  ]);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.ok(result.diagnostics.some(
    ({ code }) => code === "distinct_capture_requirement_violated"
  ));
});

test("pressure: an orphan decoy binding is visible and unsatisfied", () => {
  const result = direct([
    binding("left-artifact", "cap-left", "left", "ref-left"),
    binding("right-artifact", "cap-right", "right", "ref-right"),
    binding("decoy-artifact", "cap-decoy", "left", "ref-left", digest("b"))
  ]);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.ok(result.diagnostics.some(({ code }) => code === "binding_orphaned"));
});

test("pressure: equal byte digests are allowed when captures and references differ", () => {
  const result = direct([
    binding("left-artifact", "cap-left", "left", "ref-left"),
    binding("right-artifact", "cap-right", "right", "ref-right")
  ]);
  assert.equal(result.satisfaction, "satisfied");
  assert.equal(result.admission.kind, "unadmitted_direct");
});

test("pressure: a caller can forge a structurally valid direct set but gains no admission", () => {
  const forged = direct([
    binding("left-artifact", "cap-made-up-left", "left", "ref-left"),
    binding("right-artifact", "cap-made-up-right", "right", "ref-right")
  ]);
  assert.equal(forged.satisfaction, "satisfied");
  assert.deepEqual(forged.admission, {
    kind: "unadmitted_direct", capture_verified: false
  });
});

test("pressure: NFC-equivalent graph text yields identical canonical bytes", () => {
  const base = {
    snapshot_id: "graph-é",
    snapshot_reference_id: "ref-graph",
    complete: true,
    nodes: [{
      node_id: "é", node_reference_id: "ref-node", kind: "component"
    }],
    edges: []
  };
  const decomposed = structuredClone(base);
  decomposed.snapshot_id = "graph-e\u0301";
  decomposed.nodes[0].node_id = "e\u0301";
  assert.deepEqual(
    encodeCompleteReachabilitySnapshot(base),
    encodeCompleteReachabilitySnapshot(decomposed)
  );
});

test("pressure: identity prose changes context, never captured content identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "exact-binding-pressure-"));
  const source = path.join(root, "artifact.bin");
  await writeFile(source, "stable bytes");
  const profileValue = {
    exact_binding_requirements: [{
      requirement_id: "left-artifact",
      binding_kind: "artifact_bytes",
      role_coverage: [{
        role: "left", coverage: "exact", projection: "artifact_subject"
      }]
    }]
  };
  const inputValue = {
    reference_bindings: [{ role: "left", reference_ids: ["ref-left"] }]
  };
  const run = (identity) => runExactBindingEvaluationV034({
    contract_bytes: Buffer.from(JSON.stringify({
      references: [{ reference_id: "ref-left", identity }]
    })),
    profile_bytes: Buffer.from(JSON.stringify(profileValue)),
    evaluation_input_bytes: Buffer.from(JSON.stringify(inputValue)),
    capture_requests: [{
      requirement_id: "left-artifact",
      binding_kind: "artifact_bytes",
      role_coverage: [{
        role: "left", projection: "artifact_subject", reference_ids: ["ref-left"]
      }],
      source_path: source,
      capture_root: root
    }]
  });
  const [first, second] = await Promise.all([run("honest-looking"), run("decoy")]);
  assert.equal(first.bindings[0].content_sha256, second.bindings[0].content_sha256);
  assert.notEqual(first.inputs.contract_sha256, second.inputs.contract_sha256);
  assert.notEqual(first.binding_set_sha256, second.binding_set_sha256);
});

test("pressure boundary: complete:true is captured exactly but not independently proven", () => {
  const knowinglyIncomplete = {
    snapshot_id: "claimed-complete",
    snapshot_reference_id: "ref-graph",
    complete: true,
    nodes: [{
      node_id: "entry", node_reference_id: "ref-entry", kind: "entrypoint"
    }],
    edges: []
  };
  const bytes = encodeCompleteReachabilitySnapshot(knowinglyIncomplete);
  assert.equal(typeof sha256(bytes), "string");
  assert.match(bytes.toString("utf8"), /"complete":true/u);
});
