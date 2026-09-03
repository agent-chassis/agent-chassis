import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  RUNTIME_BLOCKER_DESCRIPTOR,
  assertRuntimeBlockerDescriptorShape,
  getRuntimeBlockerEntry,
  isRuntimeBlockerCode,
  loadRuntimeBlockerTaxonomy
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const readinessCases = [
  ["work_record_readiness_failure", "work_record_readiness", "coordinator"],
  ["backend_unavailable", "backend", "operator"],
  ["operator_recovery_needed", "operator_recovery", "operator"]
];

test("readiness taxonomy keeps recovery limbs distinct", () => {
  for (const [code, category, actorRecovery] of readinessCases) {
    const entry = getRuntimeBlockerEntry(code);
    assert.ok(entry, `${code} must be registered`);
    assert.equal(entry.category, category);
    assert.equal(entry.actor_recovery, actorRecovery);
    assert.equal(entry.blocking, true);
  }

  const readiness = getRuntimeBlockerEntry("work_record_readiness_failure");
  assert.equal(readiness.recovery.kind, "exact_named_contract_defect");
  assert.match(readiness.recovery.target, /exact missing or invalid/i);
  assert.match(readiness.consumer_notes, /exact named contract field|exact named contract/i);
  assert.doesNotMatch(readiness.consumer_notes, /Coordinator must revise the WK/i);
});

test("CCE absence, launcher absence, and invalid decision envelopes do not become readiness failures", () => {
  const backend = getRuntimeBlockerEntry("backend_unavailable");
  const operator = getRuntimeBlockerEntry("operator_recovery_needed");
  const readiness = getRuntimeBlockerEntry("work_record_readiness_failure");

  assert.match(backend.consumer_notes, /configured CCE unavailability/i);
  assert.match(backend.consumer_notes, /absent CCE response/i);
  assert.match(operator.consumer_notes, /missing launcher declaration/i);
  assert.match(operator.consumer_notes, /malformed, unratified, unknown, contradictory, or unauthenticated/i);
  assert.match(readiness.detail, /external capability|backend response|policy envelope/);
  assert.equal(isRuntimeBlockerCode("worker_admission_review_threshold_exceeded"), false);
});

test("taxonomy export preserves the narrowed catalog and validates every active entry", async () => {
  const raw = JSON.parse(
    await readFile(new URL("../../packages/wiki-core/data/runtime-blocker-codes.v1.json", import.meta.url), "utf8")
  );
  assert.deepEqual(loadRuntimeBlockerTaxonomy().codes.map(({ code }) => code), raw.codes.map(({ code }) => code));
  assert.ok(raw.codes.every((entry) => typeof entry.code === "string" && typeof entry.summary === "string"));
  assert.equal(raw.codes.some(({ code }) => code === "worker_admission_review_threshold_exceeded"), false);
});

test("taxonomy schema and parser/export remain mutually consistent", () => {
  assert.equal(RUNTIME_BLOCKER_DESCRIPTOR.schema_version, "runtime-blocker-codes.v1");
  const codes = new Set(RUNTIME_BLOCKER_DESCRIPTOR.codes.map(({ code }) => code));
  assert.equal(codes.size, RUNTIME_BLOCKER_DESCRIPTOR.codes.length);
  for (const entry of RUNTIME_BLOCKER_DESCRIPTOR.codes) {
    assert.ok(RUNTIME_BLOCKER_DESCRIPTOR.code_categories.includes(entry.category));
    assert.ok(RUNTIME_BLOCKER_DESCRIPTOR.actor_recovery_values.includes(entry.actor_recovery));
    assert.equal(typeof entry.blocking, "boolean");
  }
});

function validDescriptorClone() {
  return JSON.parse(JSON.stringify(RUNTIME_BLOCKER_DESCRIPTOR));
}

function entryOf(descriptor, code) {
  return descriptor.codes.find((entry) => entry.code === code);
}

test("the canonical descriptor is accepted by the exported validator", () => {
  assert.equal(assertRuntimeBlockerDescriptorShape(validDescriptorClone()).owner, "IN-0016");
});

const unknownSchemaFieldCases = [
  [
    "top-level descriptor",
    (d) => { d.untrusted_extension = true; },
    /descriptor declares unknown field untrusted_extension/
  ],
  [
    "graph-impact map",
    (d) => { d.graph_impact_state_map.untrusted_extension = true; },
    /graph_impact_state_map declares unknown field untrusted_extension/
  ],
  [
    "graph rule",
    (d) => { d.graph_impact_state_map.rules[0].untrusted_extension = true; },
    /graph_impact_state_map rule declares unknown field untrusted_extension/
  ],
  [
    "entry",
    (d) => { entryOf(d, "backend_unavailable").untrusted_extension = true; },
    /entry: backend_unavailable declares unknown field untrusted_extension/
  ]
];

for (const [level, mutate, expected] of unknownSchemaFieldCases) {
  test(`WK-2376 taxonomy rejects an unknown field at the ${level} level`, () => {
    const descriptor = validDescriptorClone();
    mutate(descriptor);
    assert.throws(() => assertRuntimeBlockerDescriptorShape(descriptor), expected);
  });
}

const malformedOptionalEntryFieldCases = [
  [
    "aliases that is not an array",
    (d) => {
      entryOf(d, "caller_supplied_identity").aliases = "agent_dispatch_identity.caller_supplied_role.v1";
    },
    /aliases must be a unique non-empty string array/
  ],
  [
    "aliases holding a non-string member",
    (d) => {
      entryOf(d, "caller_supplied_identity").aliases = ["ok", 7];
    },
    /aliases must be a unique non-empty string array/
  ],
  [
    "aliases holding a duplicate",
    (d) => {
      entryOf(d, "caller_supplied_identity").aliases = ["dup", "dup"];
    },
    /aliases must be a unique non-empty string array/
  ],
  [
    "a non-boolean wk_0532_subset marker",
    (d) => {
      entryOf(d, "bootstrap_review_missing").wk_0532_subset = "true";
    },
    /wk_0532_subset must be a boolean/
  ],
  [
    "a non-string detail",
    (d) => {
      entryOf(d, "backend_unavailable").detail = { text: "unavailable" };
    },
    /detail must be a non-empty string/
  ],
  [
    "an empty detail",
    (d) => {
      entryOf(d, "backend_unavailable").detail = "";
    },
    /detail must be a non-empty string/
  ],
  [
    "a non-string consumer_notes",
    (d) => {
      entryOf(d, "operator_recovery_needed").consumer_notes = ["note"];
    },
    /consumer_notes must be a non-empty string/
  ],
  [
    "a recovery that is neither prose nor a structured projection",
    (d) => {
      entryOf(d, "managed_lifecycle_required").recovery = 42;
    },
    /recovery must be a non-empty string or object/
  ],
  [
    "a structured recovery missing its success_condition",
    (d) => {
      delete entryOf(d, "managed_lifecycle_required").recovery.success_condition;
    },
    /recovery must name a kind and success_condition/
  ],
  [
    "a structured recovery with an unknown field",
    (d) => {
      entryOf(d, "managed_lifecycle_required").recovery.escalation = "operator";
    },
    /declares unknown recovery field escalation/
  ],
  [
    "a structured recovery whose route is not a string",
    (d) => {
      entryOf(d, "managed_lifecycle_required").recovery.route = ["workspace_coordination_preflight"];
    },
    /recovery route must be a non-empty string/
  ],
  [
    "a structured recovery whose accepted_values is not a unique string array",
    (d) => {
      entryOf(d, "dispatch_readiness_axis_ambiguous").recovery.accepted_values = ["implementation", "implementation"];
    },
    /recovery accepted_values must be a unique non-empty string array/
  ],
  [
    "a structured recovery whose arguments is not an object",
    (d) => {
      entryOf(d, "managed_lifecycle_required").recovery.arguments = "role=coordinator";
    },
    /recovery arguments must be an object/
  ],
  [
    "reasons that is not an array",
    (d) => {
      entryOf(d, "role_policy_violation").reasons = { reason: "x", summary: "y" };
    },
    /reasons must be a non-empty array/
  ],
  [
    "a reasons entry without a summary",
    (d) => {
      delete entryOf(d, "role_policy_violation").reasons[0].summary;
    },
    /reasons entries must name a reason and summary/
  ],
  [
    "a duplicate reason label",
    (d) => {
      const entry = entryOf(d, "role_policy_violation");
      entry.reasons = [entry.reasons[0], JSON.parse(JSON.stringify(entry.reasons[0]))];
    },
    /declares duplicate reason/
  ],
  [
    "an unrecognised entry field",
    (d) => {
      entryOf(d, "backend_unavailable").escalation_hint = "operator";
    },
    /declares unknown field escalation_hint/
  ]
];

for (const [label, mutate, expected] of malformedOptionalEntryFieldCases) {
  test(`taxonomy loading fails closed on ${label}`, () => {
    const descriptor = validDescriptorClone();
    mutate(descriptor);
    assert.throws(() => assertRuntimeBlockerDescriptorShape(descriptor), expected);
  });
}

const malformedDescriptorFieldCases = [
  [
    "an empty descriptor description",
    (d) => {
      d.description = "";
    },
    /description must be a non-empty string/
  ],
  [
    "a duplicated code category",
    (d) => {
      d.code_categories = [...d.code_categories, d.code_categories[0]];
    },
    /categories must be a unique array/
  ],
  [
    "a non-string actor recovery value",
    (d) => {
      d.actor_recovery_values = [...d.actor_recovery_values, 3];
    },
    /actor recovery values must be a unique array/
  ],
  [
    "a non-array wk_0532 bootstrap subset",
    (d) => {
      d.wk_0532_bootstrap_subset = "bootstrap_review_missing";
    },
    /wk_0532_bootstrap_subset must be a unique non-empty string array/
  ],
  [
    "a graph state map rule naming an unregistered code",
    (d) => {
      d.graph_impact_state_map.rules[0].code = "graph_impact_invented_state";
    },
    /names unregistered code graph_impact_invented_state/
  ],
  [
    "a graph state map rule with an unknown when field",
    (d) => {
      d.graph_impact_state_map.rules[0].when.cce_state = "unavailable";
    },
    /unknown when field cce_state/
  ],
  [
    "a graph state map rule with a non-string when value",
    (d) => {
      d.graph_impact_state_map.rules[0].when.graph_state = 1;
    },
    /when field graph_state must be a non-empty string or null/
  ],
  [
    "a graph state map without a default outcome",
    (d) => {
      delete d.graph_impact_state_map.default_outcome;
    },
    /must name a description and default_outcome/
  ],
  [
    "a graph state map with no rules",
    (d) => {
      d.graph_impact_state_map.rules = [];
    },
    /rules must be a non-empty array/
  ]
];

for (const [label, mutate, expected] of malformedDescriptorFieldCases) {
  test(`taxonomy loading fails closed on ${label}`, () => {
    const descriptor = validDescriptorClone();
    mutate(descriptor);
    assert.throws(() => assertRuntimeBlockerDescriptorShape(descriptor), expected);
  });
}

test("a reinstated worker_admission_review_threshold_exceeded entry is refused", () => {
  const descriptor = validDescriptorClone();
  descriptor.codes.push({
    code: "worker_admission_review_threshold_exceeded",
    category: "work_record_readiness",
    actor_recovery: "coordinator",
    blocking: true,
    summary: "Local review threshold."
  });
  assert.throws(
    () => assertRuntimeBlockerDescriptorShape(descriptor),
    /CCE policy, not local taxonomy/
  );
});

test("the exported taxonomy carries the validated optional fields verbatim", () => {
  const exported = loadRuntimeBlockerTaxonomy();
  for (const entry of RUNTIME_BLOCKER_DESCRIPTOR.codes) {
    const projected = exported.codes.find(({ code }) => code === entry.code);
    assert.deepEqual(projected.aliases, Object.hasOwn(entry, "aliases") ? entry.aliases : []);
    assert.equal(projected.detail, Object.hasOwn(entry, "detail") ? entry.detail : null);
    assert.equal(
      projected.consumer_notes,
      Object.hasOwn(entry, "consumer_notes") ? entry.consumer_notes : null
    );
    assert.equal(
      projected.wk_0532_subset,
      Object.hasOwn(entry, "wk_0532_subset") ? entry.wk_0532_subset : false
    );
    assert.deepEqual(projected.recovery, Object.hasOwn(entry, "recovery") ? entry.recovery : null);
  }
});
