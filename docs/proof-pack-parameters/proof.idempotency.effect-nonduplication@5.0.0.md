# proof.idempotency.effect-nonduplication@5.0.0

<!-- Generated from validated package metadata. -->

Two completed sequential invocations using the same input leave the elected durable effect resource observed in the same complete controlled state after the first invocation, immediately before the second invocation, and after the second invocation.

Profile digest: 6d7ab2f8910eb58d184da889470c732f462f2997ef85040f09a0ff945283c3e4. Parameter digest: ddbca60830480ee9d642cd4e047fc061060aa2e2f6c99828678e8e4aad4b7d94.

Admission digest: 799dec496122894a0c6191bbbe98dc386edc683842788914f61f1fb65e32feac.

Roles: 15/15 accounted; 3 owned gaps. Semantic parameters: 11; internal roles: 4.

## Guarantee and exclusions

Two completed sequential invocations using the same input leave the elected durable effect resource observed in the same complete controlled state after the first invocation, immediately before the second invocation, and after the second invocation.

- concurrent-replay-safety
- dishonest-reference-grounding
- idempotency-key-principal-scope
- intervening-reset-or-mutation-history
- mutation-of-resources-outside-the-elected-effect-resource
- partial-commit-recovery
- undeclared-runtime-actions

## Parameters

### operation

Declare operation for proof.idempotency.effect-nonduplication. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "pattern_id": "operation-effect-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "operation",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "second-invocation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "second_invocation",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
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
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "idempotency-equivalence-verification",
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
              "role": "operation"
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
          "subject_role": "state_after_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "duplicate_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "first-invocation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_invocation",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
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

### first_invocation

Declare first invocation for proof.idempotency.effect-nonduplication. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "first_invocation",
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
        "pattern_id": "second-invocation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "second_invocation",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "second-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "second_invocation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "second_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "first-invocation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_invocation",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
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
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "first-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_invocation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "first-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "first-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_first",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "first-observation",
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
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "first_invocation",
          "second_invocation"
        ]
      }
    }
  ]
}
```

### second_invocation

Declare second invocation for proof.idempotency.effect-nonduplication. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "second_invocation",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "idempotent-effect",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_after_second",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "pre-second-state-equality",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_before_second",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "second-invocation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "second_invocation",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "second-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "second_invocation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "second_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "second-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "second-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_second",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "second-observation",
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
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "pre-second-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_before_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "pre-second-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_before_second",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_before_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "pre-second-observation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_before_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "first_invocation",
          "second_invocation"
        ]
      }
    }
  ]
}
```

### first_input

Declare first input for proof.idempotency.effect-nonduplication. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "first_input",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "first-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_invocation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "identical-input-binding",
        "comparison": "same_reference",
        "roles": [
          "first_input",
          "second_input"
        ]
      }
    }
  ]
}
```

### effect_subject

Declare effect subject for proof.idempotency.effect-nonduplication. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "effect_subject",
        "allowed_type_terms": [
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "operation-effect-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "operation",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "second-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "pre-second-equality-verification",
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
              "role": "effect_subject"
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
          "subject_role": "state_before_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "intervening_reset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "first-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "pre-second-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_before_second"
            }
          ]
        }
      }
    }
  ]
}
```

### state_after_first

Declare state after first for proof.idempotency.effect-nonduplication. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "state_after_first",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "idempotent-effect",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_after_second",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "pre-second-state-equality",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_before_second",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "idempotency-equivalence-verification",
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
              "role": "operation"
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
          "subject_role": "state_after_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "duplicate_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "pre-second-equality-verification",
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
              "role": "effect_subject"
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
          "subject_role": "state_before_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "intervening_reset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "first-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "first-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_first",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "state_after_first",
          "state_before_second"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "distinct-effect-state-binding",
        "comparison": "distinct_references",
        "roles": [
          "state_after_first",
          "state_after_second"
        ]
      }
    }
  ]
}
```

### state_before_second

Declare state before second for proof.idempotency.effect-nonduplication. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "state_before_second",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "pre-second-state-equality",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_before_second",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "pre-second-equality-verification",
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
              "role": "effect_subject"
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
          "subject_role": "state_before_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "intervening_reset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "pre-second-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_before_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "pre-second-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_before_second",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_before_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "state_after_first",
          "state_before_second"
        ]
      }
    }
  ]
}
```

### state_after_second

Declare state after second for proof.idempotency.effect-nonduplication. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "state_after_second",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "idempotent-effect",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_after_second",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "second-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "second-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_second",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "idempotency-equivalence-verification",
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
              "role": "operation"
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
          "subject_role": "state_after_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "duplicate_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "distinct-effect-state-binding",
        "comparison": "distinct_references",
        "roles": [
          "state_after_first",
          "state_after_second"
        ]
      }
    }
  ]
}
```

### verification

Declare verification for proof.idempotency.effect-nonduplication. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "second-observation",
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
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "idempotency-equivalence-verification",
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
              "role": "operation"
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
          "subject_role": "state_after_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "duplicate_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "pre-second-equality-verification",
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
              "role": "effect_subject"
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
          "subject_role": "state_before_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "intervening_reset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "first-observation",
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
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "pre-second-observation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_before_second"
            }
          ]
        }
      }
    }
  ]
}
```

### intervening_reset_condition

Declare intervening reset condition for proof.idempotency.effect-nonduplication. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "intervening_reset_condition",
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "pre-second-equality-verification",
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
              "role": "effect_subject"
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
          "subject_role": "state_before_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "intervening_reset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "intervening_reset_condition",
          "duplicate_effect_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-target-pre-second-equality",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "intervening_reset_condition"
          ]
        }
      }
    }
  ]
}
```

### duplicate_effect_condition

Declare duplicate effect condition for proof.idempotency.effect-nonduplication. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "duplicate_effect_condition",
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
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "idempotency-equivalence-verification",
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
              "role": "operation"
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
          "subject_role": "state_after_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "duplicate_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "intervening_reset_condition",
          "duplicate_effect_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-target-equivalence",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "duplicate_effect_condition"
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
| operation | semantic_parameter | operation |  |
| first_invocation | semantic_parameter | first_invocation |  |
| second_invocation | semantic_parameter | second_invocation |  |
| first_input | semantic_parameter | first_input |  |
| second_input | same_reference_alias | first_input |  |
| effect_subject | semantic_parameter | effect_subject |  |
| state_after_first | semantic_parameter | state_after_first |  |
| state_before_second | semantic_parameter | state_before_second |  |
| state_after_second | semantic_parameter | state_after_second |  |
| observation_after_first | observation_requirement |  | Acquire observation_after_first for the exact subject, attempt and applicability in this profile. |
| observation_before_second | observation_requirement |  | Acquire observation_before_second for the exact subject, attempt and applicability in this profile. |
| observation_after_second | observation_requirement |  | Acquire observation_after_second for the exact subject, attempt and applicability in this profile. |
| verification | semantic_parameter | verification |  |
| intervening_reset_condition | semantic_parameter | intervening_reset_condition |  |
| duplicate_effect_condition | semantic_parameter | duplicate_effect_condition |  |

```json
{
  "roles": [
    {
      "role": "operation",
      "kind": "semantic_parameter",
      "parameter": "operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/11",
        "/claim_patterns/16",
        "/claim_patterns/2"
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
      "role": "first_invocation",
      "kind": "semantic_parameter",
      "parameter": "first_invocation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "first_invocation",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "second_invocation",
      "kind": "semantic_parameter",
      "parameter": "second_invocation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "second_invocation",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "first_input",
      "kind": "semantic_parameter",
      "parameter": "first_input",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "first_input",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "second_input",
      "kind": "same_reference_alias",
      "parameter": null,
      "inputs": [
        "first_input"
      ],
      "rule_refs": [
        "/claim_patterns/12",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "second_input",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "effect_subject",
      "kind": "semantic_parameter",
      "parameter": "effect_subject",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/13",
        "/claim_patterns/17",
        "/claim_patterns/4",
        "/claim_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "effect_subject",
        "allowed_type_terms": [
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "state_after_first",
      "kind": "semantic_parameter",
      "parameter": "state_after_first",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/10",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/2",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "state_after_first",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "state_before_second",
      "kind": "semantic_parameter",
      "parameter": "state_before_second",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/17",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "state_before_second",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "state_after_second",
      "kind": "semantic_parameter",
      "parameter": "state_after_second",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/16",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "state_after_second",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_after_first",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/1"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_after_first for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.idempotency.effect-nonduplication/5.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_after_first",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_before_second",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/1"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_before_second for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.idempotency.effect-nonduplication/5.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_before_second",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_after_second",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/distinct_reference_role_sets/1"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_after_second for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.idempotency.effect-nonduplication/5.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_after_second",
        "allowed_type_terms": [
          "cc:artifact",
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
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/6",
        "/claim_patterns/9"
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
      "role": "intervening_reset_condition",
      "kind": "semantic_parameter",
      "parameter": "intervening_reset_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/distinct_reference_role_sets/3",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "intervening_reset_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "duplicate_effect_condition",
      "kind": "semantic_parameter",
      "parameter": "duplicate_effect_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/distinct_reference_role_sets/3",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "duplicate_effect_condition",
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
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "first_invocation",
          "second_invocation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "observation_after_first",
          "observation_before_second",
          "observation_after_second"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "state_after_first",
          "state_before_second"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "intervening_reset_condition",
          "duplicate_effect_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "identical-input-binding",
        "comparison": "same_reference",
        "roles": [
          "first_input",
          "second_input"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "constraint": {
        "pattern_id": "distinct-effect-state-binding",
        "comparison": "distinct_references",
        "roles": [
          "state_after_first",
          "state_after_second"
        ]
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "operation-effect-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "operation",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "idempotent-effect",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_after_second",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "first-invocation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_invocation",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
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
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "first-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_invocation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "first-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "first-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_first",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "first-observation",
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
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "pre-second-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_before_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "pre-second-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_before_second",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_before_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "pre-second-observation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_before_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "pre-second-state-equality",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_before_second",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "second-invocation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "second_invocation",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
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
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "second-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "second_invocation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "second_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "second-effect-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "second-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_second",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "second-observation",
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
              "second_invocation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_second"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "idempotency-equivalence-verification",
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
              "role": "operation"
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
          "subject_role": "state_after_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "duplicate_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "pre-second-equality-verification",
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
              "role": "effect_subject"
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
          "subject_role": "state_before_second",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "intervening_reset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-equivalence",
        "role": "verifies",
        "source_claim_pattern_id": "idempotency-equivalence-verification",
        "target_claim_pattern_id": "idempotent-effect"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-target-pre-second-equality",
        "role": "verifies",
        "source_claim_pattern_id": "pre-second-equality-verification",
        "target_claim_pattern_id": "pre-second-state-equality"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-equivalence",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "duplicate_effect_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-target-pre-second-equality",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "intervening_reset_condition"
          ]
        }
      }
    },
    {
      "ref": "/collection_patterns/0",
      "constraint": {
        "pattern_id": "proof-sequence",
        "collection_kind": "ordered_sequence",
        "match_mode": "subsequence",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "profile_proof_sequence",
        "member_claim_pattern_ids": [
          "first-invocation",
          "first-effect-state",
          "first-observation-record",
          "first-observation",
          "pre-second-effect-state",
          "pre-second-observation-record",
          "pre-second-observation",
          "second-invocation",
          "second-effect-state",
          "second-observation-record",
          "second-observation"
        ]
      }
    },
    {
      "ref": "/collection_patterns/1",
      "constraint": {
        "pattern_id": "proof-population",
        "collection_kind": "closed_set",
        "match_mode": "exact",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "profile_proof_population",
        "member_claim_pattern_ids": [
          "first-invocation",
          "first-effect-state",
          "first-observation-record",
          "first-observation",
          "pre-second-effect-state",
          "pre-second-observation-record",
          "pre-second-observation",
          "second-invocation",
          "second-effect-state",
          "second-observation-record",
          "second-observation"
        ]
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "first-invocation"
          },
          {
            "pattern": "first-input"
          },
          {
            "pattern": "operation-effect-resource"
          },
          {
            "pattern": "first-effect-state"
          },
          {
            "pattern": "first-observation-record"
          },
          {
            "pattern": "first-observation"
          },
          {
            "pattern": "pre-second-effect-state"
          },
          {
            "pattern": "pre-second-observation-record"
          },
          {
            "pattern": "pre-second-observation"
          },
          {
            "pattern": "pre-second-state-equality"
          },
          {
            "pattern": "pre-second-equality-verification"
          },
          {
            "pattern": "verification-target-pre-second-equality"
          },
          {
            "pattern": "second-invocation"
          },
          {
            "pattern": "second-input"
          },
          {
            "pattern": "identical-input-binding"
          },
          {
            "pattern": "second-effect-state"
          },
          {
            "pattern": "second-observation-record"
          },
          {
            "pattern": "second-observation"
          },
          {
            "pattern": "proof-sequence"
          },
          {
            "pattern": "proof-population"
          },
          {
            "pattern": "idempotent-effect"
          },
          {
            "pattern": "distinct-effect-state-binding"
          },
          {
            "pattern": "idempotency-equivalence-verification"
          },
          {
            "pattern": "verification-target-equivalence"
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
      "first_invocation",
      "second_invocation",
      "first_input",
      "effect_subject",
      "state_after_first",
      "state_before_second",
      "state_after_second",
      "verification",
      "intervening_reset_condition",
      "duplicate_effect_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "observation_after_first",
      "observation_before_second",
      "observation_after_second"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.idempotency.effect-nonduplication.",
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
        "missing": "No named proof.idempotency.effect-nonduplication constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.idempotency.effect-nonduplication.",
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
