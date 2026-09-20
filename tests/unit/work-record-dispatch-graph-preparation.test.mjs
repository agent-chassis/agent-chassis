

import test from "node:test";
import assert from "node:assert/strict";

import {
  prepareCommittedHeadGraphAdmission
} from "../../packages/wiki-mcp/src/lib/dispatch-tools/graph-admission.mjs";
import { SidecarGraphIndexUnbuildableError } from "../../packages/wiki-core/src/lib/sidecar-graph-impact-artifact.mjs";

const READINESS = Object.freeze({
  dispatchable: true,
  decision_code: "dispatchable",
  recovery: Object.freeze({ graph_impact: "recoverable_stale", admission_metrics: "fresh" })
});

const REVALIDATED_READINESS = Object.freeze({
  dispatchable: true,
  decision_code: "dispatchable",
  recovery: Object.freeze({ graph_impact: "fresh", admission_metrics: "fresh" })
});

const ENVELOPE = Object.freeze({ schema_version: "graph-impact.v1", paths: [] });

function graphDerivationRequiredForDispatch(state) {
  return state === "fresh" || state === "recoverable_stale" || state === "recoverable_missing";
}

async function prepare({ generate, readiness = READINESS } = {}) {
  const validateCalls = [];
  const result = await prepareCommittedHeadGraphAdmission({
    readiness,
    dir: "/dev/null/workspace",
    unitAddress: "WK-2316#SLICE-005",
    readinessDispatchRole: "implementation",
    graphDerivationRequiredForDispatch,
    generateGraphImpactEvidence: generate,
    validateDispatch: async (options) => {
      validateCalls.push(options);
      return REVALIDATED_READINESS;
    }
  });
  return { ...result, validateCalls };
}

const graphFailureFamilies = [
  {
    name: "the preparation throws a typed graph failure",
    generate: async () => {
      throw new SidecarGraphIndexUnbuildableError("graph query failed", {
        code: "base_artifact_corrupt",
        status: { status_reason: "artifact_unreadable" }
      });
    },
    code: "base_artifact_corrupt"
  },
  {
    name: "the current-HEAD artifact is unavailable",
    generate: async () => ({
      written: false,
      graph_available: false,
      outcome: "graph_head_unbuildable",
      diagnostics: [{ code: "base_artifact_unavailable" }]
    }),
    code: "base_artifact_unavailable"
  },
  {
    name: "the graph is reported unavailable without diagnostics",
    generate: async () => ({ written: false, graph_available: false, outcome: "graph_unavailable" }),
    code: "graph_unavailable"
  },
  {
    name: "an available graph yields no trusted envelope",
    generate: async () => ({ written: true, graph_available: true, graph_impact_envelope: null, outcome: "persist_failed" }),
    code: "persist_failed"
  }
];

for (const family of graphFailureFamilies) {
  test(`graph preparation does not refuse when ${family.name}`, async () => {
    const { readiness, graphPreparation, validateCalls, refusal } = await prepare({
      generate: family.generate
    });

    assert.equal(refusal, undefined);
    assert.equal(readiness, REVALIDATED_READINESS);
    assert.equal(validateCalls.length, 1);
    assert.equal(graphPreparation.graph_preparation_failure.code, family.code);
    assert.equal(Object.hasOwn(graphPreparation, "graph_impact"), false,
      "a failed preparation never forwards a fabricated or empty envelope");
    assert.equal(validateCalls[0].graph_preparation_failure, graphPreparation.graph_preparation_failure);
    assert.equal(validateCalls[0].mode, "strict");
    assert.equal(validateCalls[0].dispatch_role, "implementation");
  });
}

test("a failed preparation keeps the producer status reason for core to bound", async () => {
  const { graphPreparation } = await prepare({ generate: graphFailureFamilies[0].generate });
  assert.equal(graphPreparation.graph_preparation_failure.envelope.status_reason, "artifact_unreadable");
});

test("an unrelated preparation exception propagates", async () => {
  await assert.rejects(
    prepare({ generate: async () => { throw new Error("record store read failed"); } }),
    /record store read failed/
  );
});

test("a successful derivation threads its envelope into revalidation", async () => {
  const { readiness, graphPreparation, validateCalls } = await prepare({
    generate: async () => ({ written: true, graph_available: true, graph_impact_envelope: ENVELOPE })
  });

  assert.equal(readiness, REVALIDATED_READINESS);
  assert.deepEqual(graphPreparation, { graph_impact: ENVELOPE });
  assert.equal(validateCalls.length, 1);
  assert.equal(validateCalls[0].graph_impact, ENVELOPE);
  assert.equal(Object.hasOwn(validateCalls[0], "graph_preparation_failure"), false);
});

test("nothing committed to analyze is neither a failure nor an envelope", async () => {
  const { graphPreparation, validateCalls } = await prepare({
    generate: async () => ({ graph_available: false, outcome: "no_graph_bearing_paths" })
  });
  assert.deepEqual(graphPreparation, { graph_impact: null, suppress_live_graph_resolution: true });
  assert.equal(validateCalls[0].graph_impact, null);
  assert.equal(validateCalls[0].suppress_live_graph_resolution, true);
});

test("a nonrecoverable_missing_paths unit is still prepared once", async () => {
  let derivations = 0;
  const { validateCalls } = await prepare({
    readiness: { ...READINESS, recovery: { graph_impact: "nonrecoverable_missing_paths", admission_metrics: "fresh" } },
    generate: async () => {
      derivations += 1;
      return { graph_available: false, outcome: "no_graph_bearing_paths" };
    }
  });
  assert.equal(derivations, 1);
  assert.equal(validateCalls[0].suppress_live_graph_resolution, true);
});

test("a unit that does not require derivation revalidates without deriving", async () => {
  let derivations = 0;
  const { graphPreparation, validateCalls } = await prepare({
    readiness: { ...READINESS, recovery: { graph_impact: "not_required", admission_metrics: "fresh" } },
    generate: async () => {
      derivations += 1;
      return { written: true, graph_available: true, graph_impact_envelope: ENVELOPE };
    }
  });

  assert.equal(derivations, 0, "a not_required unit never enters the graph resolver");
  assert.deepEqual(graphPreparation, { graph_impact: null });
  assert.equal(validateCalls.length, 1);
  assert.equal(validateCalls[0].graph_impact, null);
});

test("graph admission derives at most once per dispatch, on success and on failure", async () => {
  for (const generate of [
    async () => ({ written: true, graph_available: true, graph_impact_envelope: ENVELOPE }),
    graphFailureFamilies[1].generate
  ]) {
    let derivations = 0;
    await prepare({
      generate: async () => {
        derivations += 1;
        return generate();
      }
    });
    assert.equal(derivations, 1);
  }
});
