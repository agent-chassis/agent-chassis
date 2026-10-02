

import assert from "node:assert/strict";
import test from "node:test";

import {
  describeUnitBindingShape,
  unitsHaveDurableRelationship
} from "../../packages/wiki-core/src/lib/work-record-unit-relationship.mjs";

const RECORD_ID = "WK-9903";
const TARGET_SLICE_ADDRESS = `${RECORD_ID}#SLICE-001`;

function sectionsNaming(address) {
  return {
    summary: "",
    why_it_matters: "",
    scope: { items: [], out_of_scope: [] },
    tasks: [],
    references: [],
    agent_notes: `This review reports on \`${address}\`.`,
    closure: null
  };
}

test("the owner matches a relationship field in either direction and nothing else", () => {
  const reviewUnit = { kind: "work_item", address: "WK-9904", record_id: "WK-9904" };
  const targetUnit = {
    kind: "slice",
    address: TARGET_SLICE_ADDRESS,
    record_id: RECORD_ID,
    slice_id: "SLICE-001"
  };
  const unrelated = { depends_on: [], related: [], blocks: [] };

  assert.equal(
    unitsHaveDurableRelationship(unrelated, reviewUnit, unrelated, targetUnit),
    false
  );

  assert.equal(
    unitsHaveDurableRelationship(
      { depends_on: [], related: [TARGET_SLICE_ADDRESS], blocks: [] },
      reviewUnit,
      unrelated,
      targetUnit
    ),
    true
  );

  assert.equal(
    unitsHaveDurableRelationship(
      unrelated,
      reviewUnit,
      { depends_on: [], related: ["WK-9904"], blocks: [] },
      targetUnit
    ),
    true
  );

  assert.equal(
    unitsHaveDurableRelationship(
      { ...unrelated, sections: sectionsNaming(TARGET_SLICE_ADDRESS) },
      reviewUnit,
      unrelated,
      targetUnit
    ),
    false
  );

  assert.equal(
    unitsHaveDurableRelationship(
      { depends_on: [], related: [RECORD_ID], blocks: [] },
      reviewUnit,
      unrelated,
      targetUnit
    ),
    false
  );
});

const IMPLEMENTATION_SLICE_ADDRESS = "WK-9904#SLICE-011";

function unitAt(address) {
  const [recordId, sliceId] = address.split("#");
  return { kind: "slice", address, record_id: recordId, slice_id: sliceId };
}

const NO_EDGES = Object.freeze({ depends_on: [], related: [], blocks: [] });

test("every relationship field binds in both directions", () => {
  const reviewUnit = unitAt("WK-9904#SLICE-002");
  const targetUnit = unitAt(IMPLEMENTATION_SLICE_ADDRESS);

  for (const field of ["depends_on", "related", "blocks"]) {
    assert.equal(
      unitsHaveDurableRelationship(
        { ...NO_EDGES, [field]: [IMPLEMENTATION_SLICE_ADDRESS] },
        reviewUnit,
        { ...NO_EDGES },
        targetUnit
      ),
      true,
      `${field} must bind forward`
    );
    assert.equal(
      unitsHaveDurableRelationship(
        { ...NO_EDGES },
        reviewUnit,
        { ...NO_EDGES, [field]: [reviewUnit.address] },
        targetUnit
      ),
      true,
      `${field} must bind in reverse`
    );
  }
});

test("the repair guidance names the relationship fields and the exact target", () => {
  assert.equal(
    describeUnitBindingShape(unitAt(IMPLEMENTATION_SLICE_ADDRESS)),
    `a depends_on, related, or blocks entry naming exactly \`${IMPLEMENTATION_SLICE_ADDRESS}\`, ` +
      "on either unit and in either direction"
  );
});
