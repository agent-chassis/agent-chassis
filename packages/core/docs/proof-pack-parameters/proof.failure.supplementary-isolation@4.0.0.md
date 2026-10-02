# proof.failure.supplementary-isolation@4.0.0

<!-- Generated from validated package metadata. -->

Within one exact captured attempt, one core computation settles one valid core result; one distinct supplementary computation then fails without producing a result; one final result follows, preserves the exact captured core value and complete core-member population, represents the supplementary component in exactly one closed present-unavailable or omitted-disclosed form, and discloses exactly one captured failure reason from the captured closed reason population.

Profile digest: dd846a9ca4c6177b9d1d8620cb7c44a34eb9fffd3ff305edf43fa25c9b87bd5c. Parameter digest: 67070befb75dadbb88da2325bead05d10ab97cfa640e72411fcb25906175c5ab.

Admission digest: c8e86a7a2c7317dfa6334f82126d1d40c4e18608c796c0e71f6c70adf1684b54.

Roles: 69/69 accounted; 13 owned gaps. Semantic parameters: 47; internal roles: 22.

## Guarantee and exclusions

Within one exact captured attempt, one core computation settles one valid core result; one distinct supplementary computation then fails without producing a result; one final result follows, preserves the exact captured core value and complete core-member population, represents the supplementary component in exactly one closed present-unavailable or omitted-disclosed form, and discloses exactly one captured failure reason from the captured closed reason population.

- acquisition-completeness-before-capture
- applicability-evidence-authority-and-cce-consequence
- concurrency-outside-declared-attempt
- core-computation-failure
- retries-or-later-attempts
- runtime-truth-outside-exact-capture
- semantic-reason-quality-beyond-closed-membership
- successful-supplementary-computation
- undeclared-effects-and-components

## Parameters

### operation

Declare operation for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/0",
      "value": {
        "role": "operation",
        "allowed_type_terms": [
          "cc:operation"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    }
  ]
}
```

### attempt

Declare attempt for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/1",
      "value": {
        "role": "attempt",
        "allowed_type_terms": [
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "attempt-record-capture-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt_record_capture",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "core-computation-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_computation",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "core-computation-emits-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_computation",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "core-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "core-state-resolves-to-value",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settled_state",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settled_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "settlement-observation-records",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_result"
            },
            {
              "kind": "reference",
              "role": "core_settled_state"
            },
            {
              "kind": "reference",
              "role": "core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "core-value-is-valid",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settled_value",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_valid_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "supplementary-targets-component",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_computation",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_component"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "supplementary-emits-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_computation",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "failure-has-reason",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_event",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_reason"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "component-is-declared",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_supplementary_component_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "core-settlement-record-capture-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settlement_record_capture",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "failure-reason-is-closed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_reason",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_reason_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "attempt-returns-final",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "final-event-emits-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result_event",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "final-contains-core",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_portion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "final-core-portion-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_portion",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "final-core-state-resolves-to-value",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_state",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "final-observation-records",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_portion"
            },
            {
              "kind": "reference",
              "role": "final_core_state"
            },
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "final-discloses-exact-failure-reason",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_reason"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "failure-reason-is-disclosed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_reason",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosed_reason_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "core-members-forward",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "final-result-record-capture-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result_record_capture",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "core-members-forward-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_member_population"
            },
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "core-members-reverse",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "core-members-in-final",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "each-attempt-occurrence-contained",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempt_occurrences",
          "member_role": "attempt_occurrence",
          "complete_population_pattern_id": "complete-attempt-occurrences",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "attempt_occurrence",
          "operator": "reference:contained_in",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "core-member-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_member_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "core_member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/35",
      "value": {
        "pattern_id": "final-core-member-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_member_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "final_core_member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/36",
      "value": {
        "pattern_id": "final-result-member-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result_member_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "final_result_member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/37",
      "value": {
        "pattern_id": "failure-reason-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_reason_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "failure_reason_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/38",
      "value": {
        "pattern_id": "disclosed-reason-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "disclosed_reason_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "disclosed_reason_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/39",
      "value": {
        "pattern_id": "supplementary-result-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_result_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "supplementary_result_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "supplementary-failure-record-capture-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_record_capture",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/40",
      "value": {
        "pattern_id": "component-present",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/41",
      "value": {
        "pattern_id": "component-unavailable",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_unavailable_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/42",
      "value": {
        "pattern_id": "component-omitted",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/43",
      "value": {
        "pattern_id": "component-omission-disclosed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosed_omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "attempt-starts",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt_start_event",
          "operator": "reference:starts",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "attempt-performs-computations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_computation"
            },
            {
              "kind": "reference",
              "role": "supplementary_computation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "attempt-start-precedes-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt_start_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "settlement-precedes-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settlement_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "failure-precedes-final",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "attempt",
          "core_computation",
          "supplementary_computation"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "core-members-forward-verifies",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-attempt-occurrences",
        "comparison": "complete_population",
        "roles": [
          "attempt_occurrence_population",
          "attempt_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-core-members",
        "comparison": "complete_population",
        "roles": [
          "core_member_population",
          "core_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/10",
      "value": {
        "pattern_id": "complete-final-result-members",
        "comparison": "complete_population",
        "roles": [
          "final_result_member_population",
          "final_result_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/11",
      "value": {
        "pattern_id": "complete-supplementary-failures",
        "comparison": "complete_population",
        "roles": [
          "attempt_supplementary_failure_population",
          "attempt_supplementary_failures"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/12",
      "value": {
        "pattern_id": "complete-supplementary-results",
        "comparison": "complete_population",
        "roles": [
          "supplementary_result_population",
          "supplementary_results"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-core-settlements",
        "comparison": "complete_population",
        "roles": [
          "attempt_core_settlement_population",
          "attempt_core_settlements"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-disclosed-omissions",
        "comparison": "complete_population",
        "roles": [
          "disclosed_omission_population",
          "disclosed_omissions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "complete-disclosed-reasons",
        "comparison": "complete_population",
        "roles": [
          "disclosed_reason_population",
          "disclosed_reasons"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "complete-failure-reasons",
        "comparison": "complete_population",
        "roles": [
          "failure_reason_population",
          "failure_reasons"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/8",
      "value": {
        "pattern_id": "complete-final-core-members",
        "comparison": "complete_population",
        "roles": [
          "final_core_member_population",
          "final_core_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/9",
      "value": {
        "pattern_id": "complete-final-result-events",
        "comparison": "complete_population",
        "roles": [
          "attempt_final_result_population",
          "attempt_final_results"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### attempt_start_event

Declare attempt start event for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/2",
      "value": {
        "role": "attempt_start_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "attempt-starts",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt_start_event",
          "operator": "reference:starts",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "attempt-start-precedes-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt_start_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "attempt_start_event",
          "core_settlement_event",
          "supplementary_failure_event",
          "final_result_event"
        ]
      }
    }
  ]
}
```

### core_computation

Declare core computation for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/3",
      "value": {
        "role": "core_computation",
        "allowed_type_terms": [
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "core-computation-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_computation",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "core-computation-emits-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_computation",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "attempt-performs-computations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_computation"
            },
            {
              "kind": "reference",
              "role": "supplementary_computation"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "attempt",
          "core_computation",
          "supplementary_computation"
        ]
      }
    }
  ]
}
```

### supplementary_computation

Declare supplementary computation for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/4",
      "value": {
        "role": "supplementary_computation",
        "allowed_type_terms": [
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "supplementary-targets-component",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_computation",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_component"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "supplementary-emits-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_computation",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "attempt-performs-computations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_computation"
            },
            {
              "kind": "reference",
              "role": "supplementary_computation"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "attempt",
          "core_computation",
          "supplementary_computation"
        ]
      }
    }
  ]
}
```

### core_result

Declare core result for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/5",
      "value": {
        "role": "core_result",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "core-computation-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_computation",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "core-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "settlement-observation-records",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_result"
            },
            {
              "kind": "reference",
              "role": "core_settled_state"
            },
            {
              "kind": "reference",
              "role": "core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "core_result",
          "final_result",
          "supplementary_component"
        ]
      }
    }
  ]
}
```

### core_settlement_event

Declare core settlement event for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/6",
      "value": {
        "role": "core_settlement_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "core-computation-emits-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_computation",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "attempt-start-precedes-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt_start_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "settlement-precedes-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settlement_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "attempt_start_event",
          "core_settlement_event",
          "supplementary_failure_event",
          "final_result_event"
        ]
      }
    }
  ]
}
```

### core_settled_state

Declare core settled state for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/7",
      "value": {
        "role": "core_settled_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "core-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "core-state-resolves-to-value",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settled_state",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settled_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "settlement-observation-records",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_result"
            },
            {
              "kind": "reference",
              "role": "core_settled_state"
            },
            {
              "kind": "reference",
              "role": "core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "core_settled_state",
          "final_core_state"
        ]
      }
    }
  ]
}
```

### core_settled_value

Declare core settled value for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/8",
      "value": {
        "role": "core_settled_value",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "core-state-resolves-to-value",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settled_state",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settled_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "core-value-is-valid",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settled_value",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_valid_state_population"
            }
          ]
        }
      }
    }
  ]
}
```

### supplementary_component

Declare supplementary component for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/10",
      "value": {
        "role": "supplementary_component",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "supplementary-targets-component",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_computation",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_component"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "component-is-declared",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_supplementary_component_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/40",
      "value": {
        "pattern_id": "component-present",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/41",
      "value": {
        "pattern_id": "component-unavailable",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_unavailable_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/42",
      "value": {
        "pattern_id": "component-omitted",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/43",
      "value": {
        "pattern_id": "component-omission-disclosed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosed_omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "core_result",
          "final_result",
          "supplementary_component"
        ]
      }
    }
  ]
}
```

### supplementary_failure_event

Declare supplementary failure event for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/11",
      "value": {
        "role": "supplementary_failure_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "supplementary-emits-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_computation",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "failure-has-reason",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_event",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_reason"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "settlement-precedes-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settlement_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "failure-precedes-final",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "attempt_start_event",
          "core_settlement_event",
          "supplementary_failure_event",
          "final_result_event"
        ]
      }
    }
  ]
}
```

### supplementary_failure_reason

Declare supplementary failure reason for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/12",
      "value": {
        "role": "supplementary_failure_reason",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "failure-has-reason",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_event",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_reason"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "failure-reason-is-closed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_reason",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_reason_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "final-discloses-exact-failure-reason",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_reason"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "failure-reason-is-disclosed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_reason",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosed_reason_population"
            }
          ]
        }
      }
    }
  ]
}
```

### supplementary_unavailable_state

Declare supplementary unavailable state for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/13",
      "value": {
        "role": "supplementary_unavailable_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/41",
      "value": {
        "pattern_id": "component-unavailable",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_unavailable_state"
            }
          ]
        }
      }
    }
  ]
}
```

### final_result

Declare final result for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/14",
      "value": {
        "role": "final_result",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "attempt-returns-final",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "final-event-emits-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result_event",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "final-contains-core",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_portion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "final-discloses-exact-failure-reason",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_reason"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "core_result",
          "final_result",
          "supplementary_component"
        ]
      }
    }
  ]
}
```

### final_result_event

Declare final result event for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/15",
      "value": {
        "role": "final_result_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "final-event-emits-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result_event",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "failure-precedes-final",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "attempt_start_event",
          "core_settlement_event",
          "supplementary_failure_event",
          "final_result_event"
        ]
      }
    }
  ]
}
```

### final_core_portion

Declare final core portion for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/16",
      "value": {
        "role": "final_core_portion",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "final-contains-core",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_portion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "final-core-portion-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_portion",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "final-observation-records",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_portion"
            },
            {
              "kind": "reference",
              "role": "final_core_state"
            },
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    }
  ]
}
```

### final_core_state

Declare final core state for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/17",
      "value": {
        "role": "final_core_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "final-core-portion-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_portion",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "final-core-state-resolves-to-value",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_state",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "final-observation-records",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_portion"
            },
            {
              "kind": "reference",
              "role": "final_core_state"
            },
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "core_settled_state",
          "final_core_state"
        ]
      }
    }
  ]
}
```

### final_core_value

Declare final core value for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/18",
      "value": {
        "role": "final_core_value",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "final-core-state-resolves-to-value",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_state",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_value"
            }
          ]
        }
      }
    }
  ]
}
```

### verification

Declare verification for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/20",
      "value": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "core-members-forward-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_member_population"
            },
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    }
  ]
}
```

### attempt_occurrence_population

Declare attempt occurrence population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/26",
      "value": {
        "role": "attempt_occurrence_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-attempt-occurrences",
        "comparison": "complete_population",
        "roles": [
          "attempt_occurrence_population",
          "attempt_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### attempt_occurrences

Declare attempt occurrences for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/27",
      "value": {
        "role": "attempt_occurrences",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource",
          "cc:state",
          "cc:event",
          "cc:evidence"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "each-attempt-occurrence-contained",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempt_occurrences",
          "member_role": "attempt_occurrence",
          "complete_population_pattern_id": "complete-attempt-occurrences",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "attempt_occurrence",
          "operator": "reference:contained_in",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-attempt-occurrences",
        "comparison": "complete_population",
        "roles": [
          "attempt_occurrence_population",
          "attempt_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### core_member_population

Declare core member population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/28",
      "value": {
        "role": "core_member_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "settlement-observation-records",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_result"
            },
            {
              "kind": "reference",
              "role": "core_settled_state"
            },
            {
              "kind": "reference",
              "role": "core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "core-members-forward",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "core-members-forward-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_member_population"
            },
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "core-members-reverse",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "core-members-in-final",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-core-members",
        "comparison": "complete_population",
        "roles": [
          "core_member_population",
          "core_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### core_members

Declare core members for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/29",
      "value": {
        "role": "core_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-core-members",
        "comparison": "complete_population",
        "roles": [
          "core_member_population",
          "core_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "value": {
        "reference_role": "core_members",
        "number_role": "core_member_count"
      }
    }
  ]
}
```

### attempt_core_settlement_population

Declare attempt core settlement population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/30",
      "value": {
        "role": "attempt_core_settlement_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-core-settlements",
        "comparison": "complete_population",
        "roles": [
          "attempt_core_settlement_population",
          "attempt_core_settlements"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### attempt_core_settlements

Declare attempt core settlements for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/31",
      "value": {
        "role": "attempt_core_settlements",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-core-settlements",
        "comparison": "complete_population",
        "roles": [
          "attempt_core_settlement_population",
          "attempt_core_settlements"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "value": {
        "reference_role": "attempt_core_settlements",
        "number_role": "attempt_core_settlement_count"
      }
    }
  ]
}
```

### core_valid_state_population

Declare core valid state population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/32",
      "value": {
        "role": "core_valid_state_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "core-value-is-valid",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settled_value",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_valid_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-core-valid-states",
        "comparison": "complete_population",
        "roles": [
          "core_valid_state_population",
          "core_valid_states"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    }
  ]
}
```

### core_valid_states

Declare core valid states for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/33",
      "value": {
        "role": "core_valid_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-core-valid-states",
        "comparison": "complete_population",
        "roles": [
          "core_valid_state_population",
          "core_valid_states"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    }
  ]
}
```

### declared_supplementary_component_population

Declare declared supplementary component population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/34",
      "value": {
        "role": "declared_supplementary_component_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "component-is-declared",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_supplementary_component_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-declared-supplementary-components",
        "comparison": "complete_population",
        "roles": [
          "declared_supplementary_component_population",
          "declared_supplementary_components"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    }
  ]
}
```

### declared_supplementary_components

Declare declared supplementary components for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/35",
      "value": {
        "role": "declared_supplementary_components",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-declared-supplementary-components",
        "comparison": "complete_population",
        "roles": [
          "declared_supplementary_component_population",
          "declared_supplementary_components"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    }
  ]
}
```

### disclosed_omission_population

Declare disclosed omission population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/36",
      "value": {
        "role": "disclosed_omission_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/0",
      "value": {
        "pattern_id": "present-disclosed-omission-population-forbidden",
        "role_kind": "reference",
        "role": "disclosed_omission_population",
        "minimum": 0,
        "maximum": 0
      }
    },
    {
      "ref": "/binding_constraint_patterns/2",
      "value": {
        "pattern_id": "omitted-disclosed-omission-population-required",
        "role_kind": "reference",
        "role": "disclosed_omission_population",
        "minimum": 1,
        "maximum": 1
      }
    },
    {
      "ref": "/claim_patterns/43",
      "value": {
        "pattern_id": "component-omission-disclosed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosed_omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-disclosed-omissions",
        "comparison": "complete_population",
        "roles": [
          "disclosed_omission_population",
          "disclosed_omissions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### disclosed_omissions

Declare disclosed omissions for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/37",
      "value": {
        "role": "disclosed_omissions",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/binding_constraint_patterns/1",
      "value": {
        "pattern_id": "present-disclosed-omissions-forbidden",
        "role_kind": "reference",
        "role": "disclosed_omissions",
        "minimum": 0,
        "maximum": 0
      }
    },
    {
      "ref": "/binding_constraint_patterns/3",
      "value": {
        "pattern_id": "omitted-disclosed-omissions-required",
        "role_kind": "reference",
        "role": "disclosed_omissions",
        "minimum": 1,
        "maximum": 1
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-disclosed-omissions",
        "comparison": "complete_population",
        "roles": [
          "disclosed_omission_population",
          "disclosed_omissions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### disclosed_reason_population

Declare disclosed reason population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/38",
      "value": {
        "role": "disclosed_reason_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "failure-reason-is-disclosed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_reason",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosed_reason_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "complete-disclosed-reasons",
        "comparison": "complete_population",
        "roles": [
          "disclosed_reason_population",
          "disclosed_reasons"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### disclosed_reasons

Declare disclosed reasons for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/39",
      "value": {
        "role": "disclosed_reasons",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "complete-disclosed-reasons",
        "comparison": "complete_population",
        "roles": [
          "disclosed_reason_population",
          "disclosed_reasons"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/7",
      "value": {
        "reference_role": "disclosed_reasons",
        "number_role": "disclosed_reason_count"
      }
    }
  ]
}
```

### failure_reason_population

Declare failure reason population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/40",
      "value": {
        "role": "failure_reason_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "failure-reason-is-closed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_reason",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_reason_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "complete-failure-reasons",
        "comparison": "complete_population",
        "roles": [
          "failure_reason_population",
          "failure_reasons"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### failure_reasons

Declare failure reasons for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/41",
      "value": {
        "role": "failure_reasons",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "complete-failure-reasons",
        "comparison": "complete_population",
        "roles": [
          "failure_reason_population",
          "failure_reasons"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/6",
      "value": {
        "reference_role": "failure_reasons",
        "number_role": "failure_reason_count"
      }
    }
  ]
}
```

### final_core_member_population

Declare final core member population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/42",
      "value": {
        "role": "final_core_member_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "final-observation-records",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_portion"
            },
            {
              "kind": "reference",
              "role": "final_core_state"
            },
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "core-members-forward",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "core-members-forward-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_member_population"
            },
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "core-members-reverse",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/8",
      "value": {
        "pattern_id": "complete-final-core-members",
        "comparison": "complete_population",
        "roles": [
          "final_core_member_population",
          "final_core_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### final_core_members

Declare final core members for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/43",
      "value": {
        "role": "final_core_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/8",
      "value": {
        "pattern_id": "complete-final-core-members",
        "comparison": "complete_population",
        "roles": [
          "final_core_member_population",
          "final_core_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "value": {
        "reference_role": "final_core_members",
        "number_role": "final_core_member_count"
      }
    }
  ]
}
```

### attempt_final_result_population

Declare attempt final result population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/44",
      "value": {
        "role": "attempt_final_result_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/9",
      "value": {
        "pattern_id": "complete-final-result-events",
        "comparison": "complete_population",
        "roles": [
          "attempt_final_result_population",
          "attempt_final_results"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### attempt_final_results

Declare attempt final results for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/45",
      "value": {
        "role": "attempt_final_results",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/9",
      "value": {
        "pattern_id": "complete-final-result-events",
        "comparison": "complete_population",
        "roles": [
          "attempt_final_result_population",
          "attempt_final_results"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "value": {
        "reference_role": "attempt_final_results",
        "number_role": "attempt_final_result_count"
      }
    }
  ]
}
```

### final_result_member_population

Declare final result member population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/46",
      "value": {
        "role": "final_result_member_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "core-members-in-final",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/40",
      "value": {
        "pattern_id": "component-present",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/42",
      "value": {
        "pattern_id": "component-omitted",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/10",
      "value": {
        "pattern_id": "complete-final-result-members",
        "comparison": "complete_population",
        "roles": [
          "final_result_member_population",
          "final_result_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### final_result_members

Declare final result members for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/47",
      "value": {
        "role": "final_result_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/10",
      "value": {
        "pattern_id": "complete-final-result-members",
        "comparison": "complete_population",
        "roles": [
          "final_result_member_population",
          "final_result_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "value": {
        "reference_role": "final_result_members",
        "number_role": "final_result_member_count"
      }
    }
  ]
}
```

### attempt_supplementary_failure_population

Declare attempt supplementary failure population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/48",
      "value": {
        "role": "attempt_supplementary_failure_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/11",
      "value": {
        "pattern_id": "complete-supplementary-failures",
        "comparison": "complete_population",
        "roles": [
          "attempt_supplementary_failure_population",
          "attempt_supplementary_failures"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### attempt_supplementary_failures

Declare attempt supplementary failures for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/49",
      "value": {
        "role": "attempt_supplementary_failures",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/11",
      "value": {
        "pattern_id": "complete-supplementary-failures",
        "comparison": "complete_population",
        "roles": [
          "attempt_supplementary_failure_population",
          "attempt_supplementary_failures"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "value": {
        "reference_role": "attempt_supplementary_failures",
        "number_role": "attempt_supplementary_failure_count"
      }
    }
  ]
}
```

### supplementary_result_population

Declare supplementary result population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/50",
      "value": {
        "role": "supplementary_result_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/12",
      "value": {
        "pattern_id": "complete-supplementary-results",
        "comparison": "complete_population",
        "roles": [
          "supplementary_result_population",
          "supplementary_results"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    }
  ]
}
```

### supplementary_results

Declare supplementary results for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/51",
      "value": {
        "role": "supplementary_results",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/12",
      "value": {
        "pattern_id": "complete-supplementary-results",
        "comparison": "complete_population",
        "roles": [
          "supplementary_result_population",
          "supplementary_results"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/8",
      "value": {
        "reference_role": "supplementary_results",
        "number_role": "supplementary_result_count"
      }
    }
  ]
}
```

### unavailable_state_population

Declare unavailable state population for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/52",
      "value": {
        "role": "unavailable_state_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/13",
      "value": {
        "pattern_id": "complete-unavailable-states",
        "comparison": "complete_population",
        "roles": [
          "unavailable_state_population",
          "unavailable_states"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    }
  ]
}
```

### unavailable_states

Declare unavailable states for proof.failure.supplementary-isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: complete_population.

```json
{
  "source": {
    "policy": "configurable",
    "default": null,
    "mapping": null
  },
  "refinements": [
    {
      "ref": "/reference_roles/53",
      "value": {
        "role": "unavailable_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/13",
      "value": {
        "pattern_id": "complete-unavailable-states",
        "comparison": "complete_population",
        "roles": [
          "unavailable_state_population",
          "unavailable_states"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    }
  ]
}
```

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |
| operation | semantic_parameter | operation |  |
| attempt | semantic_parameter | attempt |  |
| attempt_start_event | semantic_parameter | attempt_start_event |  |
| core_computation | semantic_parameter | core_computation |  |
| supplementary_computation | semantic_parameter | supplementary_computation |  |
| core_result | semantic_parameter | core_result |  |
| core_settlement_event | semantic_parameter | core_settlement_event |  |
| core_settled_state | semantic_parameter | core_settled_state |  |
| core_settled_value | semantic_parameter | core_settled_value |  |
| settlement_observation | observation_requirement |  | Acquire settlement_observation for the exact subject, attempt and applicability in this profile. |
| supplementary_component | semantic_parameter | supplementary_component |  |
| supplementary_failure_event | semantic_parameter | supplementary_failure_event |  |
| supplementary_failure_reason | semantic_parameter | supplementary_failure_reason |  |
| supplementary_unavailable_state | semantic_parameter | supplementary_unavailable_state |  |
| final_result | semantic_parameter | final_result |  |
| final_result_event | semantic_parameter | final_result_event |  |
| final_core_portion | semantic_parameter | final_core_portion |  |
| final_core_state | semantic_parameter | final_core_state |  |
| final_core_value | semantic_parameter | final_core_value |  |
| final_observation | observation_requirement |  | Acquire final_observation for the exact subject, attempt and applicability in this profile. |
| verification | semantic_parameter | verification |  |
| projection_result | capability_gap |  | Required role projection_result has no rule-linked semantic source. |
| attempt_record_capture | observation_requirement |  | Acquire attempt_record_capture for the exact subject, attempt and applicability in this profile. |
| core_settlement_record_capture | observation_requirement |  | Acquire core_settlement_record_capture for the exact subject, attempt and applicability in this profile. |
| final_result_record_capture | observation_requirement |  | Acquire final_result_record_capture for the exact subject, attempt and applicability in this profile. |
| supplementary_failure_record_capture | observation_requirement |  | Acquire supplementary_failure_record_capture for the exact subject, attempt and applicability in this profile. |
| attempt_occurrence_population | semantic_parameter | attempt_occurrence_population |  |
| attempt_occurrences | semantic_parameter | attempt_occurrences |  |
| core_member_population | semantic_parameter | core_member_population |  |
| core_members | semantic_parameter | core_members |  |
| attempt_core_settlement_population | semantic_parameter | attempt_core_settlement_population |  |
| attempt_core_settlements | semantic_parameter | attempt_core_settlements |  |
| core_valid_state_population | semantic_parameter | core_valid_state_population |  |
| core_valid_states | semantic_parameter | core_valid_states |  |
| declared_supplementary_component_population | semantic_parameter | declared_supplementary_component_population |  |
| declared_supplementary_components | semantic_parameter | declared_supplementary_components |  |
| disclosed_omission_population | semantic_parameter | disclosed_omission_population |  |
| disclosed_omissions | semantic_parameter | disclosed_omissions |  |
| disclosed_reason_population | semantic_parameter | disclosed_reason_population |  |
| disclosed_reasons | semantic_parameter | disclosed_reasons |  |
| failure_reason_population | semantic_parameter | failure_reason_population |  |
| failure_reasons | semantic_parameter | failure_reasons |  |
| final_core_member_population | semantic_parameter | final_core_member_population |  |
| final_core_members | semantic_parameter | final_core_members |  |
| attempt_final_result_population | semantic_parameter | attempt_final_result_population |  |
| attempt_final_results | semantic_parameter | attempt_final_results |  |
| final_result_member_population | semantic_parameter | final_result_member_population |  |
| final_result_members | semantic_parameter | final_result_members |  |
| attempt_supplementary_failure_population | semantic_parameter | attempt_supplementary_failure_population |  |
| attempt_supplementary_failures | semantic_parameter | attempt_supplementary_failures |  |
| supplementary_result_population | semantic_parameter | supplementary_result_population |  |
| supplementary_results | semantic_parameter | supplementary_results |  |
| unavailable_state_population | semantic_parameter | unavailable_state_population |  |
| unavailable_states | semantic_parameter | unavailable_states |  |
| core_member_count_signal | observation_requirement |  | Acquire core_member_count_signal for the exact subject, attempt and applicability in this profile. |
| final_core_member_count_signal | observation_requirement |  | Acquire final_core_member_count_signal for the exact subject, attempt and applicability in this profile. |
| final_result_member_count_signal | observation_requirement |  | Acquire final_result_member_count_signal for the exact subject, attempt and applicability in this profile. |
| failure_reason_count_signal | observation_requirement |  | Acquire failure_reason_count_signal for the exact subject, attempt and applicability in this profile. |
| disclosed_reason_count_signal | observation_requirement |  | Acquire disclosed_reason_count_signal for the exact subject, attempt and applicability in this profile. |
| supplementary_result_count_signal | observation_requirement |  | Acquire supplementary_result_count_signal for the exact subject, attempt and applicability in this profile. |
| attempt_core_settlement_count | definition_constant |  |  |
| attempt_supplementary_failure_count | definition_constant |  |  |
| attempt_final_result_count | definition_constant |  |  |
| core_member_count | complete_population_count | core_members |  |
| final_core_member_count | complete_population_count | final_core_members |  |
| final_result_member_count | complete_population_count | final_result_members |  |
| failure_reason_count | complete_population_count | failure_reasons |  |
| disclosed_reason_count | definition_constant |  |  |
| supplementary_result_count | definition_constant |  |  |

```json
{
  "roles": [
    {
      "role": "operation",
      "kind": "semantic_parameter",
      "parameter": "operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "operation",
        "allowed_type_terms": [
          "cc:operation"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "attempt",
      "kind": "semantic_parameter",
      "parameter": "attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/2",
        "/claim_patterns/20",
        "/claim_patterns/21",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/claim_patterns/3",
        "/claim_patterns/30",
        "/claim_patterns/31",
        "/claim_patterns/32",
        "/claim_patterns/33",
        "/claim_patterns/34",
        "/claim_patterns/35",
        "/claim_patterns/36",
        "/claim_patterns/37",
        "/claim_patterns/38",
        "/claim_patterns/39",
        "/claim_patterns/4",
        "/claim_patterns/40",
        "/claim_patterns/41",
        "/claim_patterns/42",
        "/claim_patterns/43",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0",
        "/falsifier_condition_bindings/0",
        "/reference_binding_patterns/0",
        "/reference_binding_patterns/1",
        "/reference_binding_patterns/10",
        "/reference_binding_patterns/11",
        "/reference_binding_patterns/12",
        "/reference_binding_patterns/2",
        "/reference_binding_patterns/5",
        "/reference_binding_patterns/6",
        "/reference_binding_patterns/7",
        "/reference_binding_patterns/8",
        "/reference_binding_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt",
        "allowed_type_terms": [
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "attempt_start_event",
      "kind": "semantic_parameter",
      "parameter": "attempt_start_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_start_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "core_computation",
      "kind": "semantic_parameter",
      "parameter": "core_computation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "core_computation",
        "allowed_type_terms": [
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "supplementary_computation",
      "kind": "semantic_parameter",
      "parameter": "supplementary_computation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "supplementary_computation",
        "allowed_type_terms": [
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "core_result",
      "kind": "semantic_parameter",
      "parameter": "core_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/12",
        "/claim_patterns/14",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "core_result",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "core_settlement_event",
      "kind": "semantic_parameter",
      "parameter": "core_settlement_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "core_settlement_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "core_settled_state",
      "kind": "semantic_parameter",
      "parameter": "core_settled_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "core_settled_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "core_settled_value",
      "kind": "semantic_parameter",
      "parameter": "core_settled_value",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/15"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "core_settled_value",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "settlement_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire settlement_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "settlement_observation",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "supplementary_component",
      "kind": "semantic_parameter",
      "parameter": "supplementary_component",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/claim_patterns/19",
        "/claim_patterns/40",
        "/claim_patterns/41",
        "/claim_patterns/42",
        "/claim_patterns/43",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "supplementary_component",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "supplementary_failure_event",
      "kind": "semantic_parameter",
      "parameter": "supplementary_failure_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "supplementary_failure_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "supplementary_failure_reason",
      "kind": "semantic_parameter",
      "parameter": "supplementary_failure_reason",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/claim_patterns/20",
        "/claim_patterns/27",
        "/claim_patterns/28"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "supplementary_failure_reason",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "supplementary_unavailable_state",
      "kind": "semantic_parameter",
      "parameter": "supplementary_unavailable_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/41"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "supplementary_unavailable_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "final_result",
      "kind": "semantic_parameter",
      "parameter": "final_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/27",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "final_result",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "final_result_event",
      "kind": "semantic_parameter",
      "parameter": "final_result_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/22",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "final_result_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "final_core_portion",
      "kind": "semantic_parameter",
      "parameter": "final_core_portion",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/claim_patterns/26"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "final_core_portion",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "final_core_state",
      "kind": "semantic_parameter",
      "parameter": "final_core_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "final_core_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "final_core_value",
      "kind": "semantic_parameter",
      "parameter": "final_core_value",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/25"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "final_core_value",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "final_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/26"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire final_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "final_observation",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "verification",
      "kind": "semantic_parameter",
      "parameter": "verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/30"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "projection_result",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role projection_result has no rule-linked semantic source.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json#/reference_roles/21",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "projection_result",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "attempt_record_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire attempt_record_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "attempt_record_capture",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "core_settlement_record_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire core_settlement_record_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "core_settlement_record_capture",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "final_result_record_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire final_result_record_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "final_result_record_capture",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "supplementary_failure_record_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire supplementary_failure_record_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "supplementary_failure_record_capture",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "attempt_occurrence_population",
      "kind": "semantic_parameter",
      "parameter": "attempt_occurrence_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_occurrence_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "attempt_occurrences",
      "kind": "semantic_parameter",
      "parameter": "attempt_occurrences",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/33",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_occurrences",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource",
          "cc:state",
          "cc:event",
          "cc:evidence"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "core_member_population",
      "kind": "semantic_parameter",
      "parameter": "core_member_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/29",
        "/claim_patterns/30",
        "/claim_patterns/31",
        "/claim_patterns/32",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "core_member_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "core_members",
      "kind": "semantic_parameter",
      "parameter": "core_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "core_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "attempt_core_settlement_population",
      "kind": "semantic_parameter",
      "parameter": "attempt_core_settlement_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_core_settlement_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "attempt_core_settlements",
      "kind": "semantic_parameter",
      "parameter": "attempt_core_settlements",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_core_settlements",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "core_valid_state_population",
      "kind": "semantic_parameter",
      "parameter": "core_valid_state_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "core_valid_state_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "core_valid_states",
      "kind": "semantic_parameter",
      "parameter": "core_valid_states",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "core_valid_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "declared_supplementary_component_population",
      "kind": "semantic_parameter",
      "parameter": "declared_supplementary_component_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_supplementary_component_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "declared_supplementary_components",
      "kind": "semantic_parameter",
      "parameter": "declared_supplementary_components",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_supplementary_components",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "disclosed_omission_population",
      "kind": "semantic_parameter",
      "parameter": "disclosed_omission_population",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/0",
        "/binding_constraint_patterns/2",
        "/claim_patterns/43",
        "/reference_binding_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "disclosed_omission_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "disclosed_omissions",
      "kind": "semantic_parameter",
      "parameter": "disclosed_omissions",
      "inputs": [],
      "rule_refs": [
        "/binding_constraint_patterns/1",
        "/binding_constraint_patterns/3",
        "/reference_binding_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "disclosed_omissions",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "disclosed_reason_population",
      "kind": "semantic_parameter",
      "parameter": "disclosed_reason_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/28",
        "/reference_binding_patterns/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "disclosed_reason_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "disclosed_reasons",
      "kind": "semantic_parameter",
      "parameter": "disclosed_reasons",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/6",
        "/reference_role_count_bindings/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "disclosed_reasons",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "failure_reason_population",
      "kind": "semantic_parameter",
      "parameter": "failure_reason_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/reference_binding_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_reason_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "failure_reasons",
      "kind": "semantic_parameter",
      "parameter": "failure_reasons",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/7",
        "/reference_role_count_bindings/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_reasons",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "final_core_member_population",
      "kind": "semantic_parameter",
      "parameter": "final_core_member_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/26",
        "/claim_patterns/29",
        "/claim_patterns/30",
        "/claim_patterns/31",
        "/reference_binding_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "final_core_member_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "final_core_members",
      "kind": "semantic_parameter",
      "parameter": "final_core_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/8",
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "final_core_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "attempt_final_result_population",
      "kind": "semantic_parameter",
      "parameter": "attempt_final_result_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_final_result_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "attempt_final_results",
      "kind": "semantic_parameter",
      "parameter": "attempt_final_results",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/9",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_final_results",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "final_result_member_population",
      "kind": "semantic_parameter",
      "parameter": "final_result_member_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/32",
        "/claim_patterns/40",
        "/claim_patterns/42",
        "/reference_binding_patterns/10"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "final_result_member_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "final_result_members",
      "kind": "semantic_parameter",
      "parameter": "final_result_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/10",
        "/reference_role_count_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "final_result_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "attempt_supplementary_failure_population",
      "kind": "semantic_parameter",
      "parameter": "attempt_supplementary_failure_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/11"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_supplementary_failure_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "attempt_supplementary_failures",
      "kind": "semantic_parameter",
      "parameter": "attempt_supplementary_failures",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/11",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_supplementary_failures",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "supplementary_result_population",
      "kind": "semantic_parameter",
      "parameter": "supplementary_result_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/12"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "supplementary_result_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "supplementary_results",
      "kind": "semantic_parameter",
      "parameter": "supplementary_results",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/12",
        "/reference_role_count_bindings/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "supplementary_results",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "unavailable_state_population",
      "kind": "semantic_parameter",
      "parameter": "unavailable_state_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/13"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "unavailable_state_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "unavailable_states",
      "kind": "semantic_parameter",
      "parameter": "unavailable_states",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/13"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "unavailable_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "core_member_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/34"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire core_member_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "core_member_count_signal",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "final_core_member_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/35"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire final_core_member_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "final_core_member_count_signal",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "final_result_member_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/36"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire final_result_member_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "final_result_member_count_signal",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "failure_reason_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/37"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire failure_reason_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "failure_reason_count_signal",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "disclosed_reason_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/38"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire disclosed_reason_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "disclosed_reason_count_signal",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "supplementary_result_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/39"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire supplementary_result_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.supplementary-isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "supplementary_result_count_signal",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "attempt_core_settlement_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_core_settlement_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1,
        "maximum": 1
      }
    },
    {
      "role": "attempt_supplementary_failure_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_supplementary_failure_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1,
        "maximum": 1
      }
    },
    {
      "role": "attempt_final_result_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_final_result_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1,
        "maximum": 1
      }
    },
    {
      "role": "core_member_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "core_members"
      ],
      "rule_refs": [
        "/claim_patterns/34",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "core_member_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "final_core_member_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "final_core_members"
      ],
      "rule_refs": [
        "/claim_patterns/35",
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "final_core_member_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "final_result_member_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "final_result_members"
      ],
      "rule_refs": [
        "/claim_patterns/36",
        "/reference_role_count_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "final_result_member_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "failure_reason_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "failure_reasons"
      ],
      "rule_refs": [
        "/claim_patterns/37",
        "/reference_role_count_bindings/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_reason_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "disclosed_reason_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/38",
        "/reference_role_count_bindings/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "disclosed_reason_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1,
        "maximum": 1
      }
    },
    {
      "role": "supplementary_result_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/39",
        "/reference_role_count_bindings/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "supplementary_result_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0,
        "maximum": 0
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "attempt",
          "core_computation",
          "supplementary_computation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "attempt_start_event",
          "core_settlement_event",
          "supplementary_failure_event",
          "final_result_event"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "core_settled_state",
          "final_core_state"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "core_result",
          "final_result",
          "supplementary_component"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-attempt-occurrences",
        "comparison": "complete_population",
        "roles": [
          "attempt_occurrence_population",
          "attempt_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "constraint": {
        "pattern_id": "complete-core-members",
        "comparison": "complete_population",
        "roles": [
          "core_member_population",
          "core_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "constraint": {
        "pattern_id": "complete-core-settlements",
        "comparison": "complete_population",
        "roles": [
          "attempt_core_settlement_population",
          "attempt_core_settlements"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "constraint": {
        "pattern_id": "complete-core-valid-states",
        "comparison": "complete_population",
        "roles": [
          "core_valid_state_population",
          "core_valid_states"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "constraint": {
        "pattern_id": "complete-declared-supplementary-components",
        "comparison": "complete_population",
        "roles": [
          "declared_supplementary_component_population",
          "declared_supplementary_components"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "constraint": {
        "pattern_id": "complete-disclosed-omissions",
        "comparison": "complete_population",
        "roles": [
          "disclosed_omission_population",
          "disclosed_omissions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "constraint": {
        "pattern_id": "complete-disclosed-reasons",
        "comparison": "complete_population",
        "roles": [
          "disclosed_reason_population",
          "disclosed_reasons"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "constraint": {
        "pattern_id": "complete-failure-reasons",
        "comparison": "complete_population",
        "roles": [
          "failure_reason_population",
          "failure_reasons"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/8",
      "constraint": {
        "pattern_id": "complete-final-core-members",
        "comparison": "complete_population",
        "roles": [
          "final_core_member_population",
          "final_core_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/9",
      "constraint": {
        "pattern_id": "complete-final-result-events",
        "comparison": "complete_population",
        "roles": [
          "attempt_final_result_population",
          "attempt_final_results"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/10",
      "constraint": {
        "pattern_id": "complete-final-result-members",
        "comparison": "complete_population",
        "roles": [
          "final_result_member_population",
          "final_result_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/11",
      "constraint": {
        "pattern_id": "complete-supplementary-failures",
        "comparison": "complete_population",
        "roles": [
          "attempt_supplementary_failure_population",
          "attempt_supplementary_failures"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/12",
      "constraint": {
        "pattern_id": "complete-supplementary-results",
        "comparison": "complete_population",
        "roles": [
          "supplementary_result_population",
          "supplementary_results"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/13",
      "constraint": {
        "pattern_id": "complete-unavailable-states",
        "comparison": "complete_population",
        "roles": [
          "unavailable_state_population",
          "unavailable_states"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "constraint": {
        "reference_role": "attempt_core_settlements",
        "number_role": "attempt_core_settlement_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "attempt_supplementary_failures",
        "number_role": "attempt_supplementary_failure_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "attempt_final_results",
        "number_role": "attempt_final_result_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "core_members",
        "number_role": "core_member_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "constraint": {
        "reference_role": "final_core_members",
        "number_role": "final_core_member_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "constraint": {
        "reference_role": "final_result_members",
        "number_role": "final_result_member_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/6",
      "constraint": {
        "reference_role": "failure_reasons",
        "number_role": "failure_reason_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/7",
      "constraint": {
        "reference_role": "disclosed_reasons",
        "number_role": "disclosed_reason_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/8",
      "constraint": {
        "reference_role": "supplementary_results",
        "number_role": "supplementary_result_count"
      }
    },
    {
      "ref": "/binding_constraint_patterns/0",
      "constraint": {
        "pattern_id": "present-disclosed-omission-population-forbidden",
        "role_kind": "reference",
        "role": "disclosed_omission_population",
        "minimum": 0,
        "maximum": 0
      }
    },
    {
      "ref": "/binding_constraint_patterns/1",
      "constraint": {
        "pattern_id": "present-disclosed-omissions-forbidden",
        "role_kind": "reference",
        "role": "disclosed_omissions",
        "minimum": 0,
        "maximum": 0
      }
    },
    {
      "ref": "/binding_constraint_patterns/2",
      "constraint": {
        "pattern_id": "omitted-disclosed-omission-population-required",
        "role_kind": "reference",
        "role": "disclosed_omission_population",
        "minimum": 1,
        "maximum": 1
      }
    },
    {
      "ref": "/binding_constraint_patterns/3",
      "constraint": {
        "pattern_id": "omitted-disclosed-omissions-required",
        "role_kind": "reference",
        "role": "disclosed_omissions",
        "minimum": 1,
        "maximum": 1
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "attempt-record-capture-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt_record_capture",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "core-settlement-record-capture-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settlement_record_capture",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "final-result-record-capture-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result_record_capture",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "supplementary-failure-record-capture-exists",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_record_capture",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "attempt-starts",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt_start_event",
          "operator": "reference:starts",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "attempt-performs-computations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_computation"
            },
            {
              "kind": "reference",
              "role": "supplementary_computation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "attempt-start-precedes-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt_start_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "settlement-precedes-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settlement_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "failure-precedes-final",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "core-computation-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_computation",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "core-computation-emits-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_computation",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "core-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "core-state-resolves-to-value",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settled_state",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_settled_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "settlement-observation-records",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_result"
            },
            {
              "kind": "reference",
              "role": "core_settled_state"
            },
            {
              "kind": "reference",
              "role": "core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "core-value-is-valid",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_settled_value",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_valid_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "supplementary-targets-component",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_computation",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_component"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "supplementary-emits-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_computation",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "failure-has-reason",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_event",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_reason"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "component-is-declared",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_supplementary_component_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "failure-reason-is-closed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_reason",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_reason_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "attempt-returns-final",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "final-event-emits-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result_event",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "final-contains-core",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_portion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "constraint": {
        "pattern_id": "final-core-portion-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_portion",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "constraint": {
        "pattern_id": "final-core-state-resolves-to-value",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_state",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "constraint": {
        "pattern_id": "final-observation-records",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_portion"
            },
            {
              "kind": "reference",
              "role": "final_core_state"
            },
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "constraint": {
        "pattern_id": "final-discloses-exact-failure-reason",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_failure_reason"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "constraint": {
        "pattern_id": "failure-reason-is-disclosed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_failure_reason",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosed_reason_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "constraint": {
        "pattern_id": "core-members-forward",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "constraint": {
        "pattern_id": "core-members-forward-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_member_population"
            },
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "constraint": {
        "pattern_id": "core-members-reverse",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "core_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "constraint": {
        "pattern_id": "core-members-in-final",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_member_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "constraint": {
        "pattern_id": "each-attempt-occurrence-contained",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempt_occurrences",
          "member_role": "attempt_occurrence",
          "complete_population_pattern_id": "complete-attempt-occurrences",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied"
        },
        "proposition_template": {
          "subject_role": "attempt_occurrence",
          "operator": "reference:contained_in",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "constraint": {
        "pattern_id": "core-member-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "core_member_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "core_member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/35",
      "constraint": {
        "pattern_id": "final-core-member-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_core_member_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "final_core_member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/36",
      "constraint": {
        "pattern_id": "final-result-member-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "final_result_member_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "final_result_member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/37",
      "constraint": {
        "pattern_id": "failure-reason-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_reason_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "failure_reason_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/38",
      "constraint": {
        "pattern_id": "disclosed-reason-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "disclosed_reason_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "disclosed_reason_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/39",
      "constraint": {
        "pattern_id": "supplementary-result-count-is-captured",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_result_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "supplementary_result_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/40",
      "constraint": {
        "pattern_id": "component-present",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/41",
      "constraint": {
        "pattern_id": "component-unavailable",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "supplementary_unavailable_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/42",
      "constraint": {
        "pattern_id": "component-omitted",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "final_result_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/43",
      "constraint": {
        "pattern_id": "component-omission-disclosed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "supplementary_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosed_omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "core-members-forward-verifies",
        "role": "verifies",
        "source_claim_pattern_id": "core-members-forward-verification",
        "target_claim_pattern_id": "core-members-forward"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "core-members-forward-verifies",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "attempt"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-attempt-occurrences"
          },
          {
            "pattern": "complete-core-members"
          },
          {
            "pattern": "complete-core-settlements"
          },
          {
            "pattern": "complete-core-valid-states"
          },
          {
            "pattern": "complete-declared-supplementary-components"
          },
          {
            "pattern": "complete-disclosed-reasons"
          },
          {
            "pattern": "complete-failure-reasons"
          },
          {
            "pattern": "complete-final-core-members"
          },
          {
            "pattern": "complete-final-result-events"
          },
          {
            "pattern": "complete-final-result-members"
          },
          {
            "pattern": "complete-supplementary-failures"
          },
          {
            "pattern": "complete-supplementary-results"
          },
          {
            "pattern": "complete-unavailable-states"
          },
          {
            "pattern": "attempt-performs-operation"
          },
          {
            "pattern": "attempt-record-capture-exists"
          },
          {
            "pattern": "core-settlement-record-capture-exists"
          },
          {
            "pattern": "final-result-record-capture-exists"
          },
          {
            "pattern": "supplementary-failure-record-capture-exists"
          },
          {
            "pattern": "attempt-starts"
          },
          {
            "pattern": "attempt-performs-computations"
          },
          {
            "pattern": "attempt-start-precedes-settlement"
          },
          {
            "pattern": "settlement-precedes-failure"
          },
          {
            "pattern": "failure-precedes-final"
          },
          {
            "pattern": "core-computation-returns-result"
          },
          {
            "pattern": "core-computation-emits-settlement"
          },
          {
            "pattern": "core-result-has-state"
          },
          {
            "pattern": "core-state-resolves-to-value"
          },
          {
            "pattern": "settlement-observation-records"
          },
          {
            "pattern": "core-value-is-valid"
          },
          {
            "pattern": "supplementary-targets-component"
          },
          {
            "pattern": "supplementary-emits-failure"
          },
          {
            "pattern": "failure-has-reason"
          },
          {
            "pattern": "component-is-declared"
          },
          {
            "pattern": "failure-reason-is-closed"
          },
          {
            "pattern": "attempt-returns-final"
          },
          {
            "pattern": "final-event-emits-result"
          },
          {
            "pattern": "final-contains-core"
          },
          {
            "pattern": "final-core-portion-has-state"
          },
          {
            "pattern": "final-core-state-resolves-to-value"
          },
          {
            "pattern": "final-observation-records"
          },
          {
            "pattern": "final-discloses-exact-failure-reason"
          },
          {
            "pattern": "failure-reason-is-disclosed"
          },
          {
            "pattern": "core-members-forward"
          },
          {
            "pattern": "core-members-forward-verification"
          },
          {
            "pattern": "core-members-reverse"
          },
          {
            "pattern": "core-members-in-final"
          },
          {
            "pattern": "each-attempt-occurrence-contained"
          },
          {
            "pattern": "core-member-count-is-captured"
          },
          {
            "pattern": "final-core-member-count-is-captured"
          },
          {
            "pattern": "final-result-member-count-is-captured"
          },
          {
            "pattern": "failure-reason-count-is-captured"
          },
          {
            "pattern": "disclosed-reason-count-is-captured"
          },
          {
            "pattern": "supplementary-result-count-is-captured"
          },
          {
            "pattern": "core-members-forward-verifies"
          },
          {
            "any_of": [
              {
                "all_of": [
                  {
                    "pattern": "component-present"
                  },
                  {
                    "pattern": "component-unavailable"
                  },
                  {
                    "pattern": "present-disclosed-omission-population-forbidden"
                  },
                  {
                    "pattern": "present-disclosed-omissions-forbidden"
                  }
                ]
              },
              {
                "all_of": [
                  {
                    "pattern": "component-omitted"
                  },
                  {
                    "pattern": "component-omission-disclosed"
                  },
                  {
                    "pattern": "omitted-disclosed-omission-population-required"
                  },
                  {
                    "pattern": "omitted-disclosed-omissions-required"
                  },
                  {
                    "pattern": "complete-disclosed-omissions"
                  }
                ]
              }
            ],
            "branch_cardinality": "exactly_one"
          }
        ]
      }
    }
  ]
}
```

## Construction, dependencies and capabilities

```json
{
  "construction": {
    "capability": "construction",
    "semantic_inputs": [
      "operation",
      "attempt",
      "attempt_start_event",
      "core_computation",
      "supplementary_computation",
      "core_result",
      "core_settlement_event",
      "core_settled_state",
      "core_settled_value",
      "supplementary_component",
      "supplementary_failure_event",
      "supplementary_failure_reason",
      "supplementary_unavailable_state",
      "final_result",
      "final_result_event",
      "final_core_portion",
      "final_core_state",
      "final_core_value",
      "verification",
      "attempt_occurrence_population",
      "attempt_occurrences",
      "core_member_population",
      "core_members",
      "attempt_core_settlement_population",
      "attempt_core_settlements",
      "core_valid_state_population",
      "core_valid_states",
      "declared_supplementary_component_population",
      "declared_supplementary_components",
      "disclosed_omission_population",
      "disclosed_omissions",
      "disclosed_reason_population",
      "disclosed_reasons",
      "failure_reason_population",
      "failure_reasons",
      "final_core_member_population",
      "final_core_members",
      "attempt_final_result_population",
      "attempt_final_results",
      "final_result_member_population",
      "final_result_members",
      "attempt_supplementary_failure_population",
      "attempt_supplementary_failures",
      "supplementary_result_population",
      "supplementary_results",
      "unavailable_state_population",
      "unavailable_states"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "settlement_observation",
      "final_observation",
      "attempt_record_capture",
      "core_settlement_record_capture",
      "final_result_record_capture",
      "supplementary_failure_record_capture",
      "core_member_count_signal",
      "final_core_member_count_signal",
      "final_result_member_count_signal",
      "failure_reason_count_signal",
      "disclosed_reason_count_signal",
      "supplementary_result_count_signal"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.failure.supplementary-isolation.",
      "source": "lib/proof-authoring-skeleton.mjs",
      "consequence": "Do not infer independent construction or supporting packs; work record must retain this unresolved construction fact."
    }
  },
  "capabilities": [
    {
      "id": "construction",
      "kind": "constructor",
      "state": "unavailable",
      "identity": null,
      "evidence": "lib/proof-authoring-skeleton.mjs: general binding assistance requires an existing populated native contract.",
      "evidence_kind": "static",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "No named proof.failure.supplementary-isolation constructor maps semantic inputs to the complete native graph.",
        "source": "lib/proof-authoring-skeleton.mjs",
        "consequence": "work record must report unavailable construction; binding by compatible type does not establish a source mapping."
      },
      "implementation_version": null
    },
    {
      "id": "canonical-source",
      "kind": "canonical_resolver",
      "state": "declared_requirement",
      "identity": null,
      "evidence": "work record owns canonical instance source resolution; metadata does not resolve a WK.",
      "evidence_kind": "requirement",
      "gap": null,
      "implementation_version": null
    },
    {
      "id": "observation",
      "kind": "observation_acquisition",
      "state": "unavailable",
      "identity": null,
      "evidence": "lib/verification-profile-runtime.mjs validates bound declarations; it is not a general observation acquisition provider.",
      "evidence_kind": "static",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "No general observation acquisition mapping for proof.failure.supplementary-isolation.",
        "source": "lib/verification-profile-runtime.mjs",
        "consequence": "Required observations remain unavailable until their actual owner supplies acquired evidence."
      },
      "implementation_version": null
    },
    {
      "id": "evaluation",
      "kind": "evaluation",
      "state": "implemented",
      "identity": "@agent-chassis/controlled-contract#evaluateVerificationProfileV1",
      "evidence": "lib/verification-profile-v1.mjs: incumbent exact profile evaluation; certification is distinct from implementation truth.",
      "evidence_kind": "static",
      "gap": null,
      "implementation_version": "1.0.0"
    }
  ]
}
```

Metadata is a declaration. It does not acquire observations or certify implementation truth.
