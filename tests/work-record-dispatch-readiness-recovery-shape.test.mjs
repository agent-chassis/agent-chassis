import test from "node:test";

import assert from "node:assert/strict";

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createReadinessEnvelope
} from "../packages/wiki-core/src/lib/work-record-dispatch-readiness-shape.mjs";
import {
  validateWorkRecordDispatchById
} from "../packages/wiki-core/src/lib/work-record-dispatch.mjs";
import {
  classifyWorkRecordAdmissionCompactRecovery
} from "../packages/wiki-core/src/operations/work-records-admission-evidence.mjs";

const VALID_RECOVERY = Object.freeze({
  graph_impact: "recoverable_stale",
  admission_metrics: "fresh",
  target_resolution: "not_required"
});

function freshGraphState() {
  return {
    dirty_state: "clean",
    staleness: "fresh",
    graph_available: true,
    edge_source: "base_index",
    dirty_graph_mode: "base_index_only",
    graph_schema_version: "repo-code-graph.v1",
    unavailable_paths: []
  };
}

function readinessInput(overrides = {}) {
  return {
    recordId: "WK-9660",
    unit: {
      kind: "work_item",
      address: "WK-9660",
      record_id: "WK-9660",
      slice_id: null
    },
    policy: null,
    state: freshGraphState(),
    reasons: [],
    decisionCode: "dispatchable",
    dispatchable: true,
    acceptedEscalations: [],
    validationHints: [],
    derivedEvidence: [],
    canonicalRefs: [],
    ...overrides
  };
}

test("WK-1660 readiness construction rejects omitted and non-object recovery", () => {
  let returned;
  assert.throws(
    () => {
      returned = createReadinessEnvelope(readinessInput());
    },
    /recovery must be an object/
  );
  assert.equal(returned, undefined);

  for (const recovery of [null, "fresh", []]) {
    returned = undefined;
    assert.throws(
      () => {
        returned = createReadinessEnvelope(readinessInput({ recovery }));
      },
      /recovery must be an object/
    );
    assert.equal(returned, undefined);
  }
});

for (const axis of ["graph_impact", "admission_metrics", "target_resolution"]) {
  test(`WK-1660 readiness construction rejects omitted recovery.${axis}`, () => {
    const recovery = { ...VALID_RECOVERY };
    delete recovery[axis];
    let returned;
    assert.throws(
      () => {
        returned = createReadinessEnvelope(readinessInput({ recovery }));
      },
      new RegExp(`recovery\\.${axis} is required`)
    );
    assert.equal(returned, undefined);
  });

  test(`WK-1660 readiness construction rejects invalid recovery.${axis}`, () => {
    const recovery = { ...VALID_RECOVERY, [axis]: "nonrecoverable_internal_default" };
    let returned;
    assert.throws(
      () => {
        returned = createReadinessEnvelope(readinessInput({ recovery }));
      },
      new RegExp(`recovery\\.${axis} must be one of`)
    );
    assert.equal(returned, undefined);
  });
}

test("WK-1660 fully explicit valid recovery is preserved exactly", () => {
  const envelope = createReadinessEnvelope(readinessInput({ recovery: VALID_RECOVERY }));
  assert.deepEqual(envelope.recovery, VALID_RECOVERY);
});

test("WK-1660 terminal parse and load readiness deliberately classify recovery", async () => {
  const expectedTerminalRecovery = {
    graph_impact: "not_required",
    admission_metrics: "not_required",
    target_resolution: "not_required"
  };
  const parseFailure = await validateWorkRecordDispatchById({
    unitAddress: "not-a-work-record",
    graph_state: freshGraphState()
  });
  assert.equal(parseFailure.decision_code, "invalid_record");
  assert.deepEqual(parseFailure.recovery, expectedTerminalRecovery);

  const tempDir = await mkdtemp(path.join(tmpdir(), "wk-1660-readiness-recovery-"));
  try {
    const recordsDir = path.join(tempDir, "wiki", "work-records");
    await mkdir(recordsDir, { recursive: true });
    await writeFile(path.join(recordsDir, "WK-9660.json"), "{", "utf8");
    const loadFailure = await validateWorkRecordDispatchById({
      dir: tempDir,
      unitAddress: "WK-9660",
      graph_state: freshGraphState()
    });
    assert.equal(loadFailure.decision_code, "invalid_record");
    assert.deepEqual(loadFailure.recovery, expectedTerminalRecovery);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("WK-1660 genuinely malformed canonical admission evidence remains nonrecoverable_malformed", () => {
  const unit = {
    kind: "work_item",
    address: "WK-9660",
    record_id: "WK-9660",
    slice_id: null
  };
  const classified = classifyWorkRecordAdmissionCompactRecovery({
    record: {
      id: "WK-9660",
      derived_evidence: [
        {
          decision_kind: "work_unit_atomicity",
          record_id: "WK-9660",
          unit
        }
      ]
    },
    unit
  });

  assert.deepEqual(classified.recovery, {
    admission_metrics: "nonrecoverable_malformed",
    target_resolution: "nonrecoverable_malformed"
  });
});
