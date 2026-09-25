# proof.failure.cleanup-noninterference@4.0.0

<!-- Generated from validated package metadata. -->

After one declared failure, cleanup empties the complete declared residue population. A distinct complete protected-resource population is observed through the same bound population identity before failure and after settlement; both complete state populations have the protected-resource cardinality and the after-state population equals the before-state population. A separately selected authority, distinct from the failed attempt's authority, has equal state before and after settlement, is preserved by cleanup, later authorizes a valid attempt, and that attempt returns the expected successful result.

Profile digest: 8336a9179a31578b836572ccfeebd4d45916d2d504ca9ae2e0b31026a5d66b2f. Parameter digest: 280b6c7e8217727a18c6255039133ad6d18902180afe53237bde15fb604c979b.

Admission digest: 5190d32822d27eb5b1e24810b4174d873343129204305767bf634a97cdbece47.

Roles: 33/33 accounted; 2 owned gaps. Semantic parameters: 29; internal roles: 4.

## Guarantee and exclusions

After one declared failure, cleanup empties the complete declared residue population. A distinct complete protected-resource population is observed through the same bound population identity before failure and after settlement; both complete state populations have the protected-resource cardinality and the after-state population equals the before-state population. A separately selected authority, distinct from the failed attempt's authority, has equal state before and after settlement, is preserved by cleanup, later authorizes a valid attempt, and that attempt returns the expected successful result.

- authored-population-truthfulness
- authority-validity-outside-the-selected-later-attempt
- concurrent-interleavings-outside-the-declared-sequence
- identity-provenance-truthfulness
- mutations-outside-the-declared-protected-population
- requirements-omitted-from-authored-contract
- residue-created-after-the-settlement-observation
- runtime-evidence-truthfulness
- transient-protected-resource-mutation-restored-before-after-observation
- undiscovered-resources-outside-declared-populations

## Parameters

### failed_attempt

Declare failed attempt for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failed_attempt",
        "allowed_type_terms": [
          "cc:operation"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "failed-attempt-uses-failure-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "failed-attempt-has-failure-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "failed_attempt",
          "cleanup_operation",
          "valid_attempt"
        ]
      }
    }
  ]
}
```

### failure_event

Declare failure event for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failure_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "before-observation-records-authority-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "before_failure_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "failure-precedes-cleanup",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cleanup_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "cleanup-deletes-residue",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:deletes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "residue_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "cleanup-preserves-protected-resources",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:preserves",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "cleanup-preserves-unrelated-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:preserves",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "before-observation-records-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "before_failure_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "before-state-complete-for-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_before_population",
          "operator": "reference:complete_against",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "failure_event",
          "settlement_event"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-protected-state-before",
        "comparison": "complete_population",
        "roles": [
          "protected_state_before_population",
          "protected_states_before"
        ],
        "applicability_context": {
          "mode": "before",
          "operand_roles": [
            "failure_event"
          ]
        }
      }
    }
  ]
}
```

### failure_state

Declare failure state for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failure_state",
        "allowed_type_terms": [
          "cc:state",
          "cc:configuration"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "failed-attempt-has-failure-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_state"
            }
          ]
        }
      }
    }
  ]
}
```

### cleanup_operation

Declare cleanup operation for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cleanup_operation",
        "allowed_type_terms": [
          "cc:operation"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "failure-precedes-cleanup",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cleanup_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "cleanup-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cleanup_operation"
            },
            {
              "kind": "reference",
              "role": "residue_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "residue_remaining_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "residue_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "cleanup-precedes-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "cleanup-deletes-residue",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:deletes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "residue_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "cleanup-preserves-protected-resources",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:preserves",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "cleanup-preserves-unrelated-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:preserves",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "failed_attempt",
          "cleanup_operation",
          "valid_attempt"
        ]
      }
    }
  ]
}
```

### settlement_event

Declare settlement event for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "settlement_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "after-state-complete-for-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_after_population",
          "operator": "reference:complete_against",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "residue-empty-after-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "residue_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "protected-state-equal-after-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_after_population",
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
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "after-observation-records-authority-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "after_settlement_observation",
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
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "authority-state-equal-after-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after",
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
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "settlement-precedes-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "unrelated-authority-authorizes-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "unrelated_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "valid-attempt-uses-unrelated-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "valid-attempt-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "valid-result-equals-expected",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result",
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
              "role": "expected_success_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "cleanup-precedes-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "after-observation-records-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "after_settlement_observation",
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
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_after_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "failure_event",
          "settlement_event"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-residue-population",
        "comparison": "complete_population",
        "roles": [
          "residue_population",
          "residues"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "settlement_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-protected-state-after",
        "comparison": "complete_population",
        "roles": [
          "protected_state_after_population",
          "protected_states_after"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "settlement_event"
          ]
        }
      }
    }
  ]
}
```

### residue_population

Declare residue population for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/7",
      "value": {
        "role": "residue_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "residue-empty-after-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "residue_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "cleanup-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cleanup_operation"
            },
            {
              "kind": "reference",
              "role": "residue_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "residue_remaining_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "residue_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "cleanup-deletes-residue",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:deletes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "residue_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "residue_population",
          "protected_resource_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-residue-population",
        "comparison": "complete_population",
        "roles": [
          "residue_population",
          "residues"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "settlement_event"
          ]
        }
      }
    }
  ]
}
```

### residues

Declare residues for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/8",
      "value": {
        "role": "residues",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "zero_or_more",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-residue-population",
        "comparison": "complete_population",
        "roles": [
          "residue_population",
          "residues"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "settlement_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "value": {
        "reference_role": "residues",
        "number_role": "residue_count"
      }
    }
  ]
}
```

### protected_resource_population

Declare protected resource population for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/9",
      "value": {
        "role": "protected_resource_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "after-state-complete-for-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_after_population",
          "operator": "reference:complete_against",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "protected-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_after_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "protected_state_after_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "protected_state_changed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "cleanup-preserves-protected-resources",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:preserves",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "before-observation-records-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "before_failure_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "after-observation-records-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "after_settlement_observation",
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
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_after_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "before-state-complete-for-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_before_population",
          "operator": "reference:complete_against",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "residue_population",
          "protected_resource_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-protected-resource-population",
        "comparison": "complete_population",
        "roles": [
          "protected_resource_population",
          "protected_resources"
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

### protected_resources

Declare protected resources for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/10",
      "value": {
        "role": "protected_resources",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource",
          "cc:runtime_component"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-protected-resource-population",
        "comparison": "complete_population",
        "roles": [
          "protected_resource_population",
          "protected_resources"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "value": {
        "reference_role": "protected_resources",
        "number_role": "protected_resource_count"
      }
    }
  ]
}
```

### protected_state_before_population

Declare protected state before population for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/11",
      "value": {
        "role": "protected_state_before_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "protected-state-equal-after-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_after_population",
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
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "protected-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_after_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "protected_state_after_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "protected_state_changed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "before-observation-records-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "before_failure_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "before-state-complete-for-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_before_population",
          "operator": "reference:complete_against",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-protected-state-before",
        "comparison": "complete_population",
        "roles": [
          "protected_state_before_population",
          "protected_states_before"
        ],
        "applicability_context": {
          "mode": "before",
          "operand_roles": [
            "failure_event"
          ]
        }
      }
    }
  ]
}
```

### protected_states_before

Declare protected states before for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/12",
      "value": {
        "role": "protected_states_before",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence",
          "cc:state"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-protected-state-before",
        "comparison": "complete_population",
        "roles": [
          "protected_state_before_population",
          "protected_states_before"
        ],
        "applicability_context": {
          "mode": "before",
          "operand_roles": [
            "failure_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "value": {
        "reference_role": "protected_states_before",
        "number_role": "protected_resource_count"
      }
    }
  ]
}
```

### protected_state_after_population

Declare protected state after population for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/13",
      "value": {
        "role": "protected_state_after_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "after-state-complete-for-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_after_population",
          "operator": "reference:complete_against",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "protected-state-equal-after-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_after_population",
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
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "protected-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_after_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "protected_state_after_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "protected_state_changed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "after-observation-records-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "after_settlement_observation",
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
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_after_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-protected-state-after",
        "comparison": "complete_population",
        "roles": [
          "protected_state_after_population",
          "protected_states_after"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "settlement_event"
          ]
        }
      }
    }
  ]
}
```

### protected_states_after

Declare protected states after for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/14",
      "value": {
        "role": "protected_states_after",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence",
          "cc:state"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-protected-state-after",
        "comparison": "complete_population",
        "roles": [
          "protected_state_after_population",
          "protected_states_after"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "settlement_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "value": {
        "reference_role": "protected_states_after",
        "number_role": "protected_resource_count"
      }
    }
  ]
}
```

### failure_authority

Declare failure authority for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failure_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "failed-attempt-uses-failure-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "failure_authority",
          "unrelated_authority"
        ]
      }
    }
  ]
}
```

### unrelated_authority

Declare unrelated authority for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "unrelated_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "before-observation-records-authority-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "before_failure_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "after-observation-records-authority-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "after_settlement_observation",
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
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "unrelated-authority-authorizes-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "unrelated_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "valid-attempt-uses-unrelated-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "authority-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_before"
            },
            {
              "kind": "reference",
              "role": "authority_state_after"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "later-authorization-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_authorization_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            },
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_result"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_attempt_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "cleanup-preserves-unrelated-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:preserves",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "failure_authority",
          "unrelated_authority"
        ]
      }
    }
  ]
}
```

### authority_state_before

Declare authority state before for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authority_state_before",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "before-observation-records-authority-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "before_failure_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "authority-state-equal-after-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after",
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
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "authority-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_before"
            },
            {
              "kind": "reference",
              "role": "authority_state_after"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    }
  ]
}
```

### authority_state_after

Declare authority state after for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authority_state_after",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "after-observation-records-authority-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "after_settlement_observation",
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
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "authority-state-equal-after-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after",
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
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "authority-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_before"
            },
            {
              "kind": "reference",
              "role": "authority_state_after"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    }
  ]
}
```

### valid_attempt

Declare valid attempt for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "valid_attempt",
        "allowed_type_terms": [
          "cc:operation"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "settlement-precedes-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "unrelated-authority-authorizes-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "unrelated_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "valid-attempt-uses-unrelated-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "valid-attempt-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "later-authorization-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_authorization_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            },
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_result"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_attempt_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "failed_attempt",
          "cleanup_operation",
          "valid_attempt"
        ]
      }
    }
  ]
}
```

### valid_input

Declare valid input for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "valid_input",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "valid-attempt-uses-unrelated-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_input"
            }
          ]
        }
      }
    }
  ]
}
```

### valid_result

Declare valid result for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/21",
      "value": {
        "role": "valid_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "valid-attempt-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "valid-result-equals-expected",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result",
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
              "role": "expected_success_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "later-authorization-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_authorization_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            },
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_result"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_attempt_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_result"
            }
          ]
        }
      }
    }
  ]
}
```

### expected_success_result

Declare expected success result for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/22",
      "value": {
        "role": "expected_success_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "valid-result-equals-expected",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result",
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
              "role": "expected_success_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "later-authorization-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_authorization_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            },
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_result"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_attempt_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_result"
            }
          ]
        }
      }
    }
  ]
}
```

### cleanup_verification

Declare cleanup verification for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/23",
      "value": {
        "role": "cleanup_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "cleanup-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cleanup_operation"
            },
            {
              "kind": "reference",
              "role": "residue_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "residue_remaining_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "residue_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "cleanup_verification",
          "protected_state_verification",
          "authority_verification",
          "later_authorization_verification"
        ]
      }
    }
  ]
}
```

### protected_state_verification

Declare protected state verification for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/24",
      "value": {
        "role": "protected_state_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "protected-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_after_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "protected_state_after_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "protected_state_changed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "cleanup_verification",
          "protected_state_verification",
          "authority_verification",
          "later_authorization_verification"
        ]
      }
    }
  ]
}
```

### authority_verification

Declare authority verification for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/25",
      "value": {
        "role": "authority_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "authority-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_before"
            },
            {
              "kind": "reference",
              "role": "authority_state_after"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "cleanup_verification",
          "protected_state_verification",
          "authority_verification",
          "later_authorization_verification"
        ]
      }
    }
  ]
}
```

### later_authorization_verification

Declare later authorization verification for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/26",
      "value": {
        "role": "later_authorization_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "later-authorization-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_authorization_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            },
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_result"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_attempt_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "cleanup_verification",
          "protected_state_verification",
          "authority_verification",
          "later_authorization_verification"
        ]
      }
    }
  ]
}
```

### residue_remaining_condition

Declare residue remaining condition for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/27",
      "value": {
        "role": "residue_remaining_condition",
        "allowed_type_terms": [
          "cc:configuration",
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
        "pattern_id": "cleanup-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cleanup_operation"
            },
            {
              "kind": "reference",
              "role": "residue_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "residue_remaining_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "residue_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "residue_remaining_condition",
          "protected_state_changed_condition",
          "authority_consumed_condition",
          "later_attempt_failed_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-residue-empty",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "residue_remaining_condition"
          ]
        }
      }
    }
  ]
}
```

### protected_state_changed_condition

Declare protected state changed condition for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/28",
      "value": {
        "role": "protected_state_changed_condition",
        "allowed_type_terms": [
          "cc:configuration",
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
        "pattern_id": "protected-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_after_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "protected_state_after_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "protected_state_changed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "residue_remaining_condition",
          "protected_state_changed_condition",
          "authority_consumed_condition",
          "later_attempt_failed_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-targets-protected-state",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "protected_state_changed_condition"
          ]
        }
      }
    }
  ]
}
```

### authority_consumed_condition

Declare authority consumed condition for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/29",
      "value": {
        "role": "authority_consumed_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "authority-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_before"
            },
            {
              "kind": "reference",
              "role": "authority_state_after"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "residue_remaining_condition",
          "protected_state_changed_condition",
          "authority_consumed_condition",
          "later_attempt_failed_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "verification-targets-authority-preservation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "authority_consumed_condition"
          ]
        }
      }
    }
  ]
}
```

### later_attempt_failed_condition

Declare later attempt failed condition for proof.failure.cleanup-noninterference. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/30",
      "value": {
        "role": "later_attempt_failed_condition",
        "allowed_type_terms": [
          "cc:configuration",
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
        "pattern_id": "later-authorization-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_authorization_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            },
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_result"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_attempt_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "residue_remaining_condition",
          "protected_state_changed_condition",
          "authority_consumed_condition",
          "later_attempt_failed_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "verification-targets-later-authorization",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "later_attempt_failed_condition"
          ]
        }
      }
    }
  ]
}
```

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |
| failed_attempt | semantic_parameter | failed_attempt |  |
| failure_event | semantic_parameter | failure_event |  |
| failure_state | semantic_parameter | failure_state |  |
| cleanup_operation | semantic_parameter | cleanup_operation |  |
| settlement_event | semantic_parameter | settlement_event |  |
| before_failure_observation | observation_requirement |  | Acquire before_failure_observation for the exact subject, attempt and applicability in this profile. |
| after_settlement_observation | observation_requirement |  | Acquire after_settlement_observation for the exact subject, attempt and applicability in this profile. |
| residue_population | semantic_parameter | residue_population |  |
| residues | semantic_parameter | residues |  |
| protected_resource_population | semantic_parameter | protected_resource_population |  |
| protected_resources | semantic_parameter | protected_resources |  |
| protected_state_before_population | semantic_parameter | protected_state_before_population |  |
| protected_states_before | semantic_parameter | protected_states_before |  |
| protected_state_after_population | semantic_parameter | protected_state_after_population |  |
| protected_states_after | semantic_parameter | protected_states_after |  |
| failure_authority | semantic_parameter | failure_authority |  |
| unrelated_authority | semantic_parameter | unrelated_authority |  |
| authority_state_before | semantic_parameter | authority_state_before |  |
| authority_state_after | semantic_parameter | authority_state_after |  |
| valid_attempt | semantic_parameter | valid_attempt |  |
| valid_input | semantic_parameter | valid_input |  |
| valid_result | semantic_parameter | valid_result |  |
| expected_success_result | semantic_parameter | expected_success_result |  |
| cleanup_verification | semantic_parameter | cleanup_verification |  |
| protected_state_verification | semantic_parameter | protected_state_verification |  |
| authority_verification | semantic_parameter | authority_verification |  |
| later_authorization_verification | semantic_parameter | later_authorization_verification |  |
| residue_remaining_condition | semantic_parameter | residue_remaining_condition |  |
| protected_state_changed_condition | semantic_parameter | protected_state_changed_condition |  |
| authority_consumed_condition | semantic_parameter | authority_consumed_condition |  |
| later_attempt_failed_condition | semantic_parameter | later_attempt_failed_condition |  |
| residue_count | definition_constant |  |  |
| protected_resource_count | complete_population_count | protected_resources, protected_states_before, protected_states_after |  |

```json
{
  "roles": [
    {
      "role": "failed_attempt",
      "kind": "semantic_parameter",
      "parameter": "failed_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failed_attempt",
        "allowed_type_terms": [
          "cc:operation"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "failure_event",
      "kind": "semantic_parameter",
      "parameter": "failure_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/2",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "failure_state",
      "kind": "semantic_parameter",
      "parameter": "failure_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_state",
        "allowed_type_terms": [
          "cc:state",
          "cc:configuration"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "cleanup_operation",
      "kind": "semantic_parameter",
      "parameter": "cleanup_operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/claim_patterns/21",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cleanup_operation",
        "allowed_type_terms": [
          "cc:operation"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "settlement_event",
      "kind": "semantic_parameter",
      "parameter": "settlement_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/claim_patterns/3",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/0",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "settlement_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "before_failure_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire before_failure_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.cleanup-noninterference/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "before_failure_observation",
        "allowed_type_terms": [
          "cc:evidence",
          "cc:artifact"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "after_settlement_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire after_settlement_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.cleanup-noninterference/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "after_settlement_observation",
        "allowed_type_terms": [
          "cc:evidence",
          "cc:artifact"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "residue_population",
      "kind": "semantic_parameter",
      "parameter": "residue_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/21",
        "/claim_patterns/4",
        "/distinct_reference_role_sets/3",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "residue_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "residues",
      "kind": "semantic_parameter",
      "parameter": "residues",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "residues",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "zero_or_more",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "protected_resource_population",
      "kind": "semantic_parameter",
      "parameter": "protected_resource_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/22",
        "/claim_patterns/5",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/3",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_resource_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "protected_resources",
      "kind": "semantic_parameter",
      "parameter": "protected_resources",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_resources",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource",
          "cc:runtime_component"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "protected_state_before_population",
      "kind": "semantic_parameter",
      "parameter": "protected_state_before_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/22",
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_state_before_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "protected_states_before",
      "kind": "semantic_parameter",
      "parameter": "protected_states_before",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_states_before",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence",
          "cc:state"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "protected_state_after_population",
      "kind": "semantic_parameter",
      "parameter": "protected_state_after_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/12",
        "/claim_patterns/22",
        "/claim_patterns/8",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_state_after_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "protected_states_after",
      "kind": "semantic_parameter",
      "parameter": "protected_states_after",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_states_after",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence",
          "cc:state"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "failure_authority",
      "kind": "semantic_parameter",
      "parameter": "failure_authority",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "unrelated_authority",
      "kind": "semantic_parameter",
      "parameter": "unrelated_authority",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "unrelated_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "authority_state_before",
      "kind": "semantic_parameter",
      "parameter": "authority_state_before",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/15",
        "/claim_patterns/23"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_state_before",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "authority_state_after",
      "kind": "semantic_parameter",
      "parameter": "authority_state_after",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/23"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_state_after",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "valid_attempt",
      "kind": "semantic_parameter",
      "parameter": "valid_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/24",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "valid_attempt",
        "allowed_type_terms": [
          "cc:operation"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "valid_input",
      "kind": "semantic_parameter",
      "parameter": "valid_input",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "valid_input",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "valid_result",
      "kind": "semantic_parameter",
      "parameter": "valid_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/claim_patterns/24"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "valid_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "expected_success_result",
      "kind": "semantic_parameter",
      "parameter": "expected_success_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/claim_patterns/24"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "expected_success_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "cleanup_verification",
      "kind": "semantic_parameter",
      "parameter": "cleanup_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/distinct_reference_role_sets/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cleanup_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "protected_state_verification",
      "kind": "semantic_parameter",
      "parameter": "protected_state_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/22",
        "/distinct_reference_role_sets/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_state_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "authority_verification",
      "kind": "semantic_parameter",
      "parameter": "authority_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/23",
        "/distinct_reference_role_sets/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "later_authorization_verification",
      "kind": "semantic_parameter",
      "parameter": "later_authorization_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/24",
        "/distinct_reference_role_sets/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_authorization_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "residue_remaining_condition",
      "kind": "semantic_parameter",
      "parameter": "residue_remaining_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/distinct_reference_role_sets/6",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "residue_remaining_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "protected_state_changed_condition",
      "kind": "semantic_parameter",
      "parameter": "protected_state_changed_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/22",
        "/distinct_reference_role_sets/6",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_state_changed_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority_consumed_condition",
      "kind": "semantic_parameter",
      "parameter": "authority_consumed_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/23",
        "/distinct_reference_role_sets/6",
        "/falsifier_condition_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_consumed_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "later_attempt_failed_condition",
      "kind": "semantic_parameter",
      "parameter": "later_attempt_failed_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/24",
        "/distinct_reference_role_sets/6",
        "/falsifier_condition_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_attempt_failed_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "residue_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/21",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "residue_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0,
        "maximum": 0
      }
    },
    {
      "role": "protected_resource_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "protected_resources",
        "protected_states_before",
        "protected_states_after"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/1",
        "/reference_role_count_bindings/2",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_resource_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "failed_attempt",
          "cleanup_operation",
          "valid_attempt"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "failure_event",
          "settlement_event"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "before_failure_observation",
          "after_settlement_observation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "residue_population",
          "protected_resource_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "constraint": {
        "roles": [
          "failure_authority",
          "unrelated_authority"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "constraint": {
        "roles": [
          "cleanup_verification",
          "protected_state_verification",
          "authority_verification",
          "later_authorization_verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "constraint": {
        "roles": [
          "residue_remaining_condition",
          "protected_state_changed_condition",
          "authority_consumed_condition",
          "later_attempt_failed_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-residue-population",
        "comparison": "complete_population",
        "roles": [
          "residue_population",
          "residues"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "settlement_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "constraint": {
        "pattern_id": "complete-protected-resource-population",
        "comparison": "complete_population",
        "roles": [
          "protected_resource_population",
          "protected_resources"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "constraint": {
        "pattern_id": "complete-protected-state-before",
        "comparison": "complete_population",
        "roles": [
          "protected_state_before_population",
          "protected_states_before"
        ],
        "applicability_context": {
          "mode": "before",
          "operand_roles": [
            "failure_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "constraint": {
        "pattern_id": "complete-protected-state-after",
        "comparison": "complete_population",
        "roles": [
          "protected_state_after_population",
          "protected_states_after"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "settlement_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "constraint": {
        "reference_role": "residues",
        "number_role": "residue_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "protected_resources",
        "number_role": "protected_resource_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "protected_states_before",
        "number_role": "protected_resource_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "protected_states_after",
        "number_role": "protected_resource_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "failed-attempt-uses-failure-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "failed-attempt-has-failure-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "failure-precedes-cleanup",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cleanup_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "cleanup-precedes-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "cleanup-deletes-residue",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:deletes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "residue_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "cleanup-preserves-protected-resources",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:preserves",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "cleanup-preserves-unrelated-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_operation",
          "operator": "reference:preserves",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "before-observation-records-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "before_failure_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "after-observation-records-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "after_settlement_observation",
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
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_after_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "before-state-complete-for-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_before_population",
          "operator": "reference:complete_against",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "after-state-complete-for-protected-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_after_population",
          "operator": "reference:complete_against",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "residue-empty-after-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "residue_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "protected-state-equal-after-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_after_population",
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
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "before-observation-records-authority-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "before_failure_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failure_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "after-observation-records-authority-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "after_settlement_observation",
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
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "authority-state-equal-after-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after",
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
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "settlement-precedes-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settlement_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "unrelated-authority-authorizes-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "unrelated_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "valid-attempt-uses-unrelated-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "valid-attempt-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "valid-result-equals-expected",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result",
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
              "role": "expected_success_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "cleanup-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cleanup_operation"
            },
            {
              "kind": "reference",
              "role": "residue_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "residue_remaining_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "residue_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "protected-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            },
            {
              "kind": "reference",
              "role": "protected_state_after_population"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "protected_state_after_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "protected_state_changed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_state_before_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "authority-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "authority_state_before"
            },
            {
              "kind": "reference",
              "role": "authority_state_after"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "authority_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_consumed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "constraint": {
        "pattern_id": "later-authorization-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_authorization_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_attempt"
            },
            {
              "kind": "reference",
              "role": "unrelated_authority"
            },
            {
              "kind": "reference",
              "role": "valid_result"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "later_attempt_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-residue-empty",
        "role": "verifies",
        "source_claim_pattern_id": "cleanup-verification",
        "target_claim_pattern_id": "residue-empty-after-settlement"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-targets-protected-state",
        "role": "verifies",
        "source_claim_pattern_id": "protected-state-verification",
        "target_claim_pattern_id": "protected-state-equal-after-settlement"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "verification-targets-authority-preservation",
        "role": "verifies",
        "source_claim_pattern_id": "authority-preservation-verification",
        "target_claim_pattern_id": "authority-state-equal-after-settlement"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "verification-targets-later-authorization",
        "role": "verifies",
        "source_claim_pattern_id": "later-authorization-verification",
        "target_claim_pattern_id": "valid-result-equals-expected"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-residue-empty",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "residue_remaining_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-targets-protected-state",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "protected_state_changed_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "verification-targets-authority-preservation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "authority_consumed_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "verification-targets-later-authorization",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "later_attempt_failed_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-residue-population"
          },
          {
            "pattern": "complete-protected-resource-population"
          },
          {
            "pattern": "complete-protected-state-before"
          },
          {
            "pattern": "complete-protected-state-after"
          },
          {
            "pattern": "failed-attempt-uses-failure-authority"
          },
          {
            "pattern": "failed-attempt-has-failure-state"
          },
          {
            "pattern": "failure-precedes-cleanup"
          },
          {
            "pattern": "cleanup-precedes-settlement"
          },
          {
            "pattern": "cleanup-deletes-residue"
          },
          {
            "pattern": "cleanup-preserves-protected-resources"
          },
          {
            "pattern": "cleanup-preserves-unrelated-authority"
          },
          {
            "pattern": "before-observation-records-protected-subject"
          },
          {
            "pattern": "after-observation-records-protected-subject"
          },
          {
            "pattern": "before-state-complete-for-protected-subject"
          },
          {
            "pattern": "after-state-complete-for-protected-subject"
          },
          {
            "pattern": "residue-empty-after-settlement"
          },
          {
            "pattern": "protected-state-equal-after-settlement"
          },
          {
            "pattern": "before-observation-records-authority-state"
          },
          {
            "pattern": "after-observation-records-authority-state"
          },
          {
            "pattern": "authority-state-equal-after-settlement"
          },
          {
            "pattern": "settlement-precedes-valid-attempt"
          },
          {
            "pattern": "unrelated-authority-authorizes-valid-attempt"
          },
          {
            "pattern": "valid-attempt-uses-unrelated-authority"
          },
          {
            "pattern": "valid-attempt-returns-result"
          },
          {
            "pattern": "valid-result-equals-expected"
          },
          {
            "pattern": "cleanup-verification"
          },
          {
            "pattern": "protected-state-verification"
          },
          {
            "pattern": "authority-preservation-verification"
          },
          {
            "pattern": "later-authorization-verification"
          },
          {
            "pattern": "verification-targets-residue-empty"
          },
          {
            "pattern": "verification-targets-protected-state"
          },
          {
            "pattern": "verification-targets-authority-preservation"
          },
          {
            "pattern": "verification-targets-later-authorization"
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
      "failed_attempt",
      "failure_event",
      "failure_state",
      "cleanup_operation",
      "settlement_event",
      "residue_population",
      "residues",
      "protected_resource_population",
      "protected_resources",
      "protected_state_before_population",
      "protected_states_before",
      "protected_state_after_population",
      "protected_states_after",
      "failure_authority",
      "unrelated_authority",
      "authority_state_before",
      "authority_state_after",
      "valid_attempt",
      "valid_input",
      "valid_result",
      "expected_success_result",
      "cleanup_verification",
      "protected_state_verification",
      "authority_verification",
      "later_authorization_verification",
      "residue_remaining_condition",
      "protected_state_changed_condition",
      "authority_consumed_condition",
      "later_attempt_failed_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "before_failure_observation",
      "after_settlement_observation"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.failure.cleanup-noninterference.",
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
        "missing": "No named proof.failure.cleanup-noninterference constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.failure.cleanup-noninterference.",
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
