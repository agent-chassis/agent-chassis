

import { GAUGE_REFERENTS, gaugeDraftPolicy } from "./required-policy-assessment.mjs";

const identity = (type_term, term) => ({ type_term, identity: { kind: "profile_term", term } });

export const INPUT_INVENTORY = Object.freeze([
  Object.freeze({ input_id: "gauge-level", interface: "gauge.set-level", requirement_prefix: "gauge",
    referents: GAUGE_REFERENTS }),
  Object.freeze({ input_id: "valve-opening", interface: "valve.set-opening", requirement_prefix: "valve",
    referents: Object.freeze({
      operation: identity("cc:operation", "valve.set-opening"),
      level: identity("cc:entity", "valve.opening-input"),
      inside_range: identity("cc:population", "valve.opening-inside-declared-range"),
      outside_range: identity("cc:population", "valve.opening-outside-declared-range"),
      accepted_effect: identity("cc:state", "valve.stored-opening"),
      refusal_result: identity("cc:artifact", "valve.range-error"),
      accepted_check: identity("cc:test", "valve.accepted-opening-check"),
      refusal_check: identity("cc:test", "valve.out-of-range-opening-check"),
      range_check: identity("cc:test", "valve.range-declaration-check")
    }) })
]);

export const policyIdFor = (entry) => `draft.constrained-input.${entry.input_id}`;

export function policiesFromInventory(inventory, { unit, focus = null }) {
  const template = gaugeDraftPolicy({ unit, focus });
  return inventory.map((entry) => ({
    ...structuredClone(template),
    policy_id: policyIdFor(entry),
    provenance: { ...structuredClone(template.provenance), rule_source: template.policy_id,
      rule_profile_id: template.profile.profile_id,
      inventory_entry: { input_id: entry.input_id, interface: entry.interface },
      applicability: "explicit experimental inventory; not discovered" },
    bindings: structuredClone(entry.referents)
  }));
}
