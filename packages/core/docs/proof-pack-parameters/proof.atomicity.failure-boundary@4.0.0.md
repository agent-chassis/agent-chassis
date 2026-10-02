# proof.atomicity.failure-boundary@4.0.0

<!-- Generated from validated package metadata. -->

When a declared failure is injected at a declared boundary positioned between two distinct ordered constituent effects of one compound-operation attempt, the declared constituent-effect population of at least two members, observed at the declared settlement event that follows the injected failure, has a settled state that is a member of a closed two-member population of allowed settled states whose declared members are the fully-committed state and the fully-uncommitted state, and the declared partial-commit state is not a member of that allowed population.

Profile digest: ab3b0b152fbe27cd65c673f674789cecaf085b86dfe9dbb596b4476f6a054189. Parameter digest: 19510d87460c76011178b0689d5bc10920707e03509e54f384490f8d74a51b85.

Admission digest: cf818165f93745adbde56881a17e09b4f86c3f236b4745ecd8784fad4b254894.

Roles: 21/21 accounted; 2 owned gaps. Semantic parameters: 18; internal roles: 3.

## Guarantee and exclusions

When a declared failure is injected at a declared boundary positioned between two distinct ordered constituent effects of one compound-operation attempt, the declared constituent-effect population of at least two members, observed at the declared settlement event that follows the injected failure, has a settled state that is a member of a closed two-member population of allowed settled states whose declared members are the fully-committed state and the fully-uncommitted state, and the declared partial-commit state is not a member of that allowed population.

- authored-claim-truthfulness
- concurrent-attempt-interference
- injected-failure-need-not-abort-the-operation
- mutation-outside-the-declared-effect-population
- per-effect-obligations-beyond-the-boundary-pair
- transient-partial-state-before-settlement
- verification-exclusivity

## Parameters

### compound_operation

Declare compound operation for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "compound_operation",
        "allowed_type_terms": [
          "cc:operation",
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
        "pattern_id": "attempt-performs-compound-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "operation_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compound_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "compound-operation-writes-constituent-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compound_operation",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "compound_operation",
          "operation_attempt",
          "verification"
        ]
      }
    }
  ]
}
```

### operation_attempt

Declare operation attempt for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "operation_attempt",
        "allowed_type_terms": [
          "cc:event",
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
        "pattern_id": "attempt-performs-compound-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "operation_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compound_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "failure-injected-at-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "injected_failure",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_boundary"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "settlement-follows-injected-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_event",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "injected_failure"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "settlement-follows-later-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_event",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "constituent-effect-order",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_constituent_effect",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "failure-boundary-follows-earlier-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_boundary",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "failure-boundary-precedes-later-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_boundary",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "operation_attempt",
          "failure_boundary",
          "injected_failure",
          "settlement_event"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "compound_operation",
          "operation_attempt",
          "verification"
        ]
      }
    }
  ]
}
```

### constituent_effect_population

Declare constituent effect population for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "constituent_effect_population",
        "allowed_type_terms": [
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "population-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "constituent-effect-population-members",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "partial-commit-condition-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "partial_commit_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_partial_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "atomic-settlement-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "partial_commit_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "earlier-effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_constituent_effect",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "later-effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_constituent_effect",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "constituent-effect-population-cardinality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "number:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "constituent_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "constituent-effect-population-plurality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "range:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "range",
              "minimum": 2
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "constituent_effect_population",
          "allowed_settlement_states"
        ]
      }
    }
  ]
}
```

### constituent_effects

Declare constituent effects for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/3",
      "value": {
        "role": "constituent_effects",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:lifecycle_entity",
          "cc:resource"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "compound-operation-writes-constituent-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compound_operation",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "constituent-effect-population-members",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "value": {
        "reference_role": "constituent_effects",
        "number_role": "constituent_effect_count"
      }
    }
  ]
}
```

### earlier_constituent_effect

Declare earlier constituent effect for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "earlier_constituent_effect",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:lifecycle_entity",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "earlier-effect-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_constituent_effect",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "earlier-effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_constituent_effect",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "constituent-effect-order",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_constituent_effect",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "failure-boundary-follows-earlier-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_boundary",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "earlier_constituent_effect",
          "earlier_effect_observation",
          "later_effect_observation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "earlier_constituent_effect",
          "allowed_settlement_states"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "distinct-constituent-effects",
        "comparison": "distinct_references",
        "roles": [
          "earlier_constituent_effect",
          "later_constituent_effect"
        ]
      }
    }
  ]
}
```

### later_constituent_effect

Declare later constituent effect for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "later_constituent_effect",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:lifecycle_entity",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "settlement-follows-later-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_event",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "later-effect-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_constituent_effect",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "later-effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_constituent_effect",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "constituent-effect-order",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_constituent_effect",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "failure-boundary-precedes-later-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_boundary",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "later_constituent_effect",
          "earlier_effect_observation",
          "later_effect_observation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/7",
      "value": {
        "roles": [
          "later_constituent_effect",
          "allowed_settlement_states"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "distinct-constituent-effects",
        "comparison": "distinct_references",
        "roles": [
          "earlier_constituent_effect",
          "later_constituent_effect"
        ]
      }
    }
  ]
}
```

### failure_boundary

Declare failure boundary for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failure_boundary",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "failure-injected-at-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "injected_failure",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_boundary"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "failure-boundary-follows-earlier-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_boundary",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "failure-boundary-precedes-later-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_boundary",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "operation_attempt",
          "failure_boundary",
          "injected_failure",
          "settlement_event"
        ]
      }
    }
  ]
}
```

### injected_failure

Declare injected failure for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "injected_failure",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "failure-injected-at-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "injected_failure",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_boundary"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "settlement-follows-injected-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_event",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "injected_failure"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "operation_attempt",
          "failure_boundary",
          "injected_failure",
          "settlement_event"
        ]
      }
    }
  ]
}
```

### settlement_event

Declare settlement event for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "settlement_event",
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
        "pattern_id": "settlement-follows-injected-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_event",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "injected_failure"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "settlement-follows-later-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_event",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "earlier-effect-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_constituent_effect",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "later-effect-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_constituent_effect",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "population-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "settled-result-composition",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            },
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "earlier-effect-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_effect_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "later-effect-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_effect_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "earlier-effect-observation-read",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "later-effect-observation-read",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_effect_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "settled-outcome-is-fully-committed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fully_committed_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "settled-outcome-is-fully-uncommitted",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fully_uncommitted_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "settled-outcome-within-allowed-states",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "operation_attempt",
          "failure_boundary",
          "injected_failure",
          "settlement_event"
        ]
      }
    }
  ]
}
```

### earlier_effect_settled_state

Declare earlier effect settled state for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/9",
      "value": {
        "role": "earlier_effect_settled_state",
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
        "pattern_id": "earlier-effect-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_constituent_effect",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "settled-result-composition",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            },
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "earlier-effect-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_effect_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "earlier_effect_settled_state",
          "later_effect_settled_state",
          "fully_committed_state",
          "fully_uncommitted_state",
          "forbidden_partial_state",
          "partial_commit_condition"
        ]
      }
    }
  ]
}
```

### later_effect_settled_state

Declare later effect settled state for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "later_effect_settled_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "later-effect-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_constituent_effect",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "settled-result-composition",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            },
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "later-effect-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_effect_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "earlier_effect_settled_state",
          "later_effect_settled_state",
          "fully_committed_state",
          "fully_uncommitted_state",
          "forbidden_partial_state",
          "partial_commit_condition"
        ]
      }
    }
  ]
}
```

### settled_result

Declare settled result for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "settled_result",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "population-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "settled-result-composition",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            },
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "settled-outcome-is-fully-committed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fully_committed_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "settled-outcome-is-fully-uncommitted",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fully_uncommitted_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "settled-outcome-within-allowed-states",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "atomic-settlement-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "partial_commit_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "distinct-settled-result-and-partial-state",
        "comparison": "distinct_references",
        "roles": [
          "settled_result",
          "forbidden_partial_state"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "distinct-settled-result-and-partial-condition",
        "comparison": "distinct_references",
        "roles": [
          "settled_result",
          "partial_commit_condition"
        ]
      }
    }
  ]
}
```

### allowed_settlement_states

Declare allowed settlement states for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "allowed_settlement_states",
        "allowed_type_terms": [
          "cc:entity"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "fully-committed-state-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "fully_committed_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "fully-uncommitted-state-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "fully_uncommitted_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "allowed-settlement-states-closed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "allowed_settlement_states",
          "operator": "number:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value": 2
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "partial-state-not-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "forbidden_partial_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "settled-outcome-within-allowed-states",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "atomic-settlement-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "partial_commit_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "constituent_effect_population",
          "allowed_settlement_states"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "earlier_constituent_effect",
          "allowed_settlement_states"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/7",
      "value": {
        "roles": [
          "later_constituent_effect",
          "allowed_settlement_states"
        ]
      }
    }
  ]
}
```

### fully_committed_state

Declare fully committed state for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "fully_committed_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "fully-committed-state-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "fully_committed_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "settled-outcome-is-fully-committed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fully_committed_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "earlier_effect_settled_state",
          "later_effect_settled_state",
          "fully_committed_state",
          "fully_uncommitted_state",
          "forbidden_partial_state",
          "partial_commit_condition"
        ]
      }
    }
  ]
}
```

### fully_uncommitted_state

Declare fully uncommitted state for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "fully_uncommitted_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "fully-uncommitted-state-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "fully_uncommitted_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "settled-outcome-is-fully-uncommitted",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fully_uncommitted_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "earlier_effect_settled_state",
          "later_effect_settled_state",
          "fully_committed_state",
          "fully_uncommitted_state",
          "forbidden_partial_state",
          "partial_commit_condition"
        ]
      }
    }
  ]
}
```

### forbidden_partial_state

Declare forbidden partial state for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "forbidden_partial_state",
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
        "pattern_id": "partial-state-not-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "forbidden_partial_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "partial-commit-condition-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "partial_commit_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_partial_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "earlier_effect_settled_state",
          "later_effect_settled_state",
          "fully_committed_state",
          "fully_uncommitted_state",
          "forbidden_partial_state",
          "partial_commit_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "distinct-settled-result-and-partial-state",
        "comparison": "distinct_references",
        "roles": [
          "settled_result",
          "forbidden_partial_state"
        ]
      }
    }
  ]
}
```

### verification

Declare verification for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "earlier-effect-observation-read",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "later-effect-observation-read",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_effect_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "atomic-settlement-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "partial_commit_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "compound_operation",
          "operation_attempt",
          "verification"
        ]
      }
    }
  ]
}
```

### partial_commit_condition

Declare partial commit condition for proof.atomicity.failure-boundary. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/19",
      "value": {
        "role": "partial_commit_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:invariant",
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
        "pattern_id": "partial-commit-condition-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "partial_commit_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_partial_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "atomic-settlement-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "partial_commit_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "earlier_effect_settled_state",
          "later_effect_settled_state",
          "fully_committed_state",
          "fully_uncommitted_state",
          "forbidden_partial_state",
          "partial_commit_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-target-settled-outcome",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "partial_commit_condition"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "distinct-settled-result-and-partial-condition",
        "comparison": "distinct_references",
        "roles": [
          "settled_result",
          "partial_commit_condition"
        ]
      }
    }
  ]
}
```

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |
| compound_operation | semantic_parameter | compound_operation |  |
| operation_attempt | semantic_parameter | operation_attempt |  |
| constituent_effect_population | semantic_parameter | constituent_effect_population |  |
| constituent_effects | semantic_parameter | constituent_effects |  |
| earlier_constituent_effect | semantic_parameter | earlier_constituent_effect |  |
| later_constituent_effect | semantic_parameter | later_constituent_effect |  |
| failure_boundary | semantic_parameter | failure_boundary |  |
| injected_failure | semantic_parameter | injected_failure |  |
| settlement_event | semantic_parameter | settlement_event |  |
| earlier_effect_settled_state | semantic_parameter | earlier_effect_settled_state |  |
| later_effect_settled_state | semantic_parameter | later_effect_settled_state |  |
| settled_result | semantic_parameter | settled_result |  |
| earlier_effect_observation | observation_requirement |  | Acquire earlier_effect_observation for the exact subject, attempt and applicability in this profile. |
| later_effect_observation | observation_requirement |  | Acquire later_effect_observation for the exact subject, attempt and applicability in this profile. |
| allowed_settlement_states | semantic_parameter | allowed_settlement_states |  |
| fully_committed_state | semantic_parameter | fully_committed_state |  |
| fully_uncommitted_state | semantic_parameter | fully_uncommitted_state |  |
| forbidden_partial_state | semantic_parameter | forbidden_partial_state |  |
| verification | semantic_parameter | verification |  |
| partial_commit_condition | semantic_parameter | partial_commit_condition |  |
| constituent_effect_count | complete_population_count | constituent_effects |  |

```json
{
  "roles": [
    {
      "role": "compound_operation",
      "kind": "semantic_parameter",
      "parameter": "compound_operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/distinct_reference_role_sets/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "compound_operation",
        "allowed_type_terms": [
          "cc:operation",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "operation_attempt",
      "kind": "semantic_parameter",
      "parameter": "operation_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/3",
        "/distinct_reference_role_sets/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "operation_attempt",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "constituent_effect_population",
      "kind": "semantic_parameter",
      "parameter": "constituent_effect_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/2",
        "/claim_patterns/25",
        "/claim_patterns/29",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "constituent_effect_population",
        "allowed_type_terms": [
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "constituent_effects",
      "kind": "semantic_parameter",
      "parameter": "constituent_effects",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "constituent_effects",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:lifecycle_entity",
          "cc:resource"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "earlier_constituent_effect",
      "kind": "semantic_parameter",
      "parameter": "earlier_constituent_effect",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/3",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/1",
        "/distinct_reference_role_sets/6",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "earlier_constituent_effect",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:lifecycle_entity",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "later_constituent_effect",
      "kind": "semantic_parameter",
      "parameter": "later_constituent_effect",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/14",
        "/claim_patterns/4",
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/2",
        "/distinct_reference_role_sets/7",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_constituent_effect",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:lifecycle_entity",
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "failure_boundary",
      "kind": "semantic_parameter",
      "parameter": "failure_boundary",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_boundary",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "injected_failure",
      "kind": "semantic_parameter",
      "parameter": "injected_failure",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "injected_failure",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "settlement_event",
      "kind": "semantic_parameter",
      "parameter": "settlement_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "settlement_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "earlier_effect_settled_state",
      "kind": "semantic_parameter",
      "parameter": "earlier_effect_settled_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "earlier_effect_settled_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "later_effect_settled_state",
      "kind": "semantic_parameter",
      "parameter": "later_effect_settled_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/16",
        "/claim_patterns/18",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_effect_settled_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "settled_result",
      "kind": "semantic_parameter",
      "parameter": "settled_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/reference_binding_patterns/1",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "settled_result",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "earlier_effect_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/claim_patterns/19",
        "/distinct_reference_role_sets/1",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire earlier_effect_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.atomicity.failure-boundary/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "earlier_effect_observation",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "later_effect_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/claim_patterns/20",
        "/distinct_reference_role_sets/1",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire later_effect_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.atomicity.failure-boundary/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "later_effect_observation",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "allowed_settlement_states",
      "kind": "semantic_parameter",
      "parameter": "allowed_settlement_states",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/distinct_reference_role_sets/4",
        "/distinct_reference_role_sets/6",
        "/distinct_reference_role_sets/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_settlement_states",
        "allowed_type_terms": [
          "cc:entity"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "fully_committed_state",
      "kind": "semantic_parameter",
      "parameter": "fully_committed_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/claim_patterns/26",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "fully_committed_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "fully_uncommitted_state",
      "kind": "semantic_parameter",
      "parameter": "fully_uncommitted_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/22",
        "/claim_patterns/27",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "fully_uncommitted_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "forbidden_partial_state",
      "kind": "semantic_parameter",
      "parameter": "forbidden_partial_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_partial_state",
        "allowed_type_terms": [
          "cc:state"
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
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/claim_patterns/29",
        "/distinct_reference_role_sets/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "partial_commit_condition",
      "kind": "semantic_parameter",
      "parameter": "partial_commit_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/25",
        "/claim_patterns/29",
        "/distinct_reference_role_sets/0",
        "/falsifier_condition_bindings/0",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "partial_commit_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:invariant",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "constituent_effect_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "constituent_effects"
      ],
      "rule_refs": [
        "/claim_patterns/5",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "constituent_effect_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 2
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "earlier_effect_settled_state",
          "later_effect_settled_state",
          "fully_committed_state",
          "fully_uncommitted_state",
          "forbidden_partial_state",
          "partial_commit_condition"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "earlier_constituent_effect",
          "earlier_effect_observation",
          "later_effect_observation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "later_constituent_effect",
          "earlier_effect_observation",
          "later_effect_observation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "operation_attempt",
          "failure_boundary",
          "injected_failure",
          "settlement_event"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "constraint": {
        "roles": [
          "constituent_effect_population",
          "allowed_settlement_states"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "constraint": {
        "roles": [
          "compound_operation",
          "operation_attempt",
          "verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "constraint": {
        "roles": [
          "earlier_constituent_effect",
          "allowed_settlement_states"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/7",
      "constraint": {
        "roles": [
          "later_constituent_effect",
          "allowed_settlement_states"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "distinct-constituent-effects",
        "comparison": "distinct_references",
        "roles": [
          "earlier_constituent_effect",
          "later_constituent_effect"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "constraint": {
        "pattern_id": "distinct-settled-result-and-partial-state",
        "comparison": "distinct_references",
        "roles": [
          "settled_result",
          "forbidden_partial_state"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "constraint": {
        "pattern_id": "distinct-settled-result-and-partial-condition",
        "comparison": "distinct_references",
        "roles": [
          "settled_result",
          "partial_commit_condition"
        ]
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "constraint": {
        "reference_role": "constituent_effects",
        "number_role": "constituent_effect_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "attempt-performs-compound-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "operation_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compound_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "compound-operation-writes-constituent-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compound_operation",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "constituent-effect-population-members",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "earlier-effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_constituent_effect",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "later-effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_constituent_effect",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "constituent-effect-population-cardinality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "number:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "constituent_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "constituent-effect-population-plurality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "range:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "range",
              "minimum": 2
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "constituent-effect-order",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_constituent_effect",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "failure-boundary-follows-earlier-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_boundary",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "failure-boundary-precedes-later-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_boundary",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "failure-injected-at-boundary",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "injected_failure",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_boundary"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "settlement-follows-injected-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_event",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "injected_failure"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "settlement-follows-later-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_event",
          "operator": "reference:follows",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "operation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_constituent_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "earlier-effect-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_constituent_effect",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "later-effect-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_constituent_effect",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "population-settled-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "settled-result-composition",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            },
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "earlier-effect-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "earlier_effect_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "later-effect-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_effect_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_effect_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "earlier-effect-observation-read",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "earlier_effect_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "later-effect-observation-read",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_effect_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "fully-committed-state-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "fully_committed_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "fully-uncommitted-state-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "fully_uncommitted_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "allowed-settlement-states-closed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "allowed_settlement_states",
          "operator": "number:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value": 2
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "constraint": {
        "pattern_id": "partial-state-not-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "forbidden_partial_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "constraint": {
        "pattern_id": "partial-commit-condition-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "constituent_effect_population",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "partial_commit_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_partial_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "constraint": {
        "pattern_id": "settled-outcome-is-fully-committed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fully_committed_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "constraint": {
        "pattern_id": "settled-outcome-is-fully-uncommitted",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fully_uncommitted_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "constraint": {
        "pattern_id": "settled-outcome-within-allowed-states",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "constraint": {
        "pattern_id": "atomic-settlement-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "constituent_effect_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "settled_result",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "partial_commit_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settlement_states"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-settled-outcome",
        "role": "verifies",
        "source_claim_pattern_id": "atomic-settlement-verification",
        "target_claim_pattern_id": "settled-outcome-within-allowed-states"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-settled-outcome",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "partial_commit_condition"
          ]
        }
      }
    },
    {
      "ref": "/collection_patterns/0",
      "constraint": {
        "pattern_id": "proof-sequence-earlier-effect",
        "collection_kind": "ordered_sequence",
        "match_mode": "subsequence",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "profile_proof_sequence_earlier_effect",
        "member_claim_pattern_ids": [
          "attempt-performs-compound-operation",
          "constituent-effect-order",
          "failure-boundary-follows-earlier-effect",
          "failure-injected-at-boundary",
          "settlement-follows-injected-failure",
          "settlement-follows-later-effect",
          "earlier-effect-settled-state",
          "earlier-effect-observation-record",
          "earlier-effect-observation-read"
        ]
      }
    },
    {
      "ref": "/collection_patterns/1",
      "constraint": {
        "pattern_id": "proof-sequence-later-effect",
        "collection_kind": "ordered_sequence",
        "match_mode": "subsequence",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "profile_proof_sequence_later_effect",
        "member_claim_pattern_ids": [
          "attempt-performs-compound-operation",
          "constituent-effect-order",
          "failure-boundary-precedes-later-effect",
          "failure-injected-at-boundary",
          "settlement-follows-injected-failure",
          "settlement-follows-later-effect",
          "later-effect-settled-state",
          "later-effect-observation-record",
          "later-effect-observation-read"
        ]
      }
    },
    {
      "ref": "/collection_patterns/2",
      "constraint": {
        "pattern_id": "proof-population",
        "collection_kind": "closed_set",
        "match_mode": "exact",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "profile_proof_population",
        "member_claim_pattern_ids": [
          "attempt-performs-compound-operation",
          "constituent-effect-order",
          "failure-boundary-follows-earlier-effect",
          "failure-boundary-precedes-later-effect",
          "failure-injected-at-boundary",
          "settlement-follows-injected-failure",
          "settlement-follows-later-effect",
          "earlier-effect-settled-state",
          "later-effect-settled-state",
          "population-settled-state",
          "settled-result-composition",
          "earlier-effect-observation-record",
          "later-effect-observation-record",
          "earlier-effect-observation-read",
          "later-effect-observation-read"
        ]
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "attempt-performs-compound-operation"
          },
          {
            "pattern": "compound-operation-writes-constituent-effects"
          },
          {
            "pattern": "constituent-effect-population-members"
          },
          {
            "pattern": "distinct-constituent-effects"
          },
          {
            "pattern": "earlier-effect-population-membership"
          },
          {
            "pattern": "later-effect-population-membership"
          },
          {
            "pattern": "constituent-effect-population-cardinality"
          },
          {
            "pattern": "constituent-effect-population-plurality"
          },
          {
            "pattern": "constituent-effect-order"
          },
          {
            "pattern": "failure-boundary-follows-earlier-effect"
          },
          {
            "pattern": "failure-boundary-precedes-later-effect"
          },
          {
            "pattern": "failure-injected-at-boundary"
          },
          {
            "pattern": "settlement-follows-injected-failure"
          },
          {
            "pattern": "settlement-follows-later-effect"
          },
          {
            "pattern": "earlier-effect-settled-state"
          },
          {
            "pattern": "later-effect-settled-state"
          },
          {
            "pattern": "population-settled-state"
          },
          {
            "pattern": "settled-result-composition"
          },
          {
            "pattern": "earlier-effect-observation-record"
          },
          {
            "pattern": "later-effect-observation-record"
          },
          {
            "pattern": "earlier-effect-observation-read"
          },
          {
            "pattern": "later-effect-observation-read"
          },
          {
            "pattern": "proof-sequence-earlier-effect"
          },
          {
            "pattern": "proof-sequence-later-effect"
          },
          {
            "pattern": "proof-population"
          },
          {
            "pattern": "fully-committed-state-allowed"
          },
          {
            "pattern": "fully-uncommitted-state-allowed"
          },
          {
            "pattern": "allowed-settlement-states-closed"
          },
          {
            "pattern": "partial-state-not-allowed"
          },
          {
            "pattern": "partial-commit-condition-state"
          },
          {
            "any_of": [
              {
                "pattern": "settled-outcome-is-fully-committed"
              },
              {
                "pattern": "settled-outcome-is-fully-uncommitted"
              }
            ]
          },
          {
            "pattern": "settled-outcome-within-allowed-states"
          },
          {
            "pattern": "atomic-settlement-verification"
          },
          {
            "pattern": "verification-target-settled-outcome"
          },
          {
            "pattern": "distinct-settled-result-and-partial-state"
          },
          {
            "pattern": "distinct-settled-result-and-partial-condition"
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
      "compound_operation",
      "operation_attempt",
      "constituent_effect_population",
      "constituent_effects",
      "earlier_constituent_effect",
      "later_constituent_effect",
      "failure_boundary",
      "injected_failure",
      "settlement_event",
      "earlier_effect_settled_state",
      "later_effect_settled_state",
      "settled_result",
      "allowed_settlement_states",
      "fully_committed_state",
      "fully_uncommitted_state",
      "forbidden_partial_state",
      "verification",
      "partial_commit_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "earlier_effect_observation",
      "later_effect_observation"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.atomicity.failure-boundary.",
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
        "missing": "No named proof.atomicity.failure-boundary constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.atomicity.failure-boundary.",
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
