# proof.failure.settlement-and-cleanup@4.0.0

<!-- Generated from validated package metadata. -->

Given one grounded operation attempt, one declared failure injection and injected failure carrying one grounded original cause, one cleanup event, one settlement event after both failure and cleanup, one complete declared residue population whose integer cardinality may be zero or greater, complete cause-state observations at failure and after settlement, and a settled failure record: satisfaction establishes that the injected failure targets the operation during the attempt, cleanup targets the residue population after failure, settlement follows cleanup and failure, the complete residue population has cardinality zero after settlement, the settled failure record retains the same cause, and the cause state after settlement equals its state at failure.

Profile digest: fe733bcbc83de3f5519b133b5a87abf20b65481e3013dcbdd6fb0edcdf181051. Parameter digest: 897a438015e3a2b356cf96afdab8bfe629c02d831b913f6e318bbd40f16dd87b.

Admission digest: bb449b3a1badc41523c6cc8bbf216e072bda367d93a6b07dbd36379b9eb3b841.

Roles: 19/19 accounted; 5 owned gaps. Semantic parameters: 14; internal roles: 5.

## Guarantee and exclusions

Given one grounded operation attempt, one declared failure injection and injected failure carrying one grounded original cause, one cleanup event, one settlement event after both failure and cleanup, one complete declared residue population whose integer cardinality may be zero or greater, complete cause-state observations at failure and after settlement, and a settled failure record: satisfaction establishes that the injected failure targets the operation during the attempt, cleanup targets the residue population after failure, settlement follows cleanup and failure, the complete residue population has cardinality zero after settlement, the settled failure record retains the same cause, and the cause state after settlement equals its state at failure.

- cause-truthfulness-beyond-declared-observations
- cleanup-side-effects-outside-population
- concurrent-or-distributed-settlement
- delivered-evidence-authenticity
- failure-prevention-or-retry-semantics
- pack-applicability
- residue-reappearance-after-observation
- resources-outside-declared-population
- transient-residue-before-settlement

## Parameters

### operation

Declare operation for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
          "cc:operation",
          "cc:process",
          "cc:command"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
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
          "subject_role": "operation_attempt",
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
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "injected-failure-targets-operation",
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
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "operation",
          "residue_population",
          "failure_cause"
        ]
      }
    }
  ]
}
```

### operation_attempt

Declare operation attempt for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
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
          "subject_role": "operation_attempt",
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "failure-injection-precedes-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_injection",
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
              "role": "injected_failure"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "injected-failure-targets-operation",
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
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "cleanup-follows-injected-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_event",
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
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "settlement-follows-cleanup",
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
              "role": "cleanup_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
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
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation_attempt",
          "failure_injection",
          "injected_failure",
          "cleanup_event",
          "settlement_event"
        ]
      }
    }
  ]
}
```

### failure_injection

Declare failure injection for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failure_injection",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "failure-injection-precedes-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_injection",
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
              "role": "injected_failure"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation_attempt",
          "failure_injection",
          "injected_failure",
          "cleanup_event",
          "settlement_event"
        ]
      }
    }
  ]
}
```

### injected_failure

Declare injected failure for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "injected_failure",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "failure-injection-precedes-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_injection",
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
              "role": "injected_failure"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "injected-failure-targets-operation",
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
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "injected-failure-carries-cause",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "injected_failure",
          "operator": "reference:has_property",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_cause"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "original-failure-cause-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_cause",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "injected_failure"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "failure-cause-observation-records-original",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_observation_at_failure",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "injected_failure"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "cleanup-follows-injected-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_event",
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
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "cleanup-targets-residue-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_event",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "injected_failure"
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
      "ref": "/claim_patterns/9",
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
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation_attempt",
          "failure_injection",
          "injected_failure",
          "cleanup_event",
          "settlement_event"
        ]
      }
    }
  ]
}
```

### failure_cause

Declare failure cause for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failure_cause",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "settled-failure-record-preserves-cause",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_failure_record",
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
              "role": "failure_cause"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "settled-failure-cause-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_cause",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "cause-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_cause"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "settled_cause_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cause_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "injected-failure-carries-cause",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "injected_failure",
          "operator": "reference:has_property",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_cause"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "original-failure-cause-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_cause",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "injected_failure"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "operation",
          "residue_population",
          "failure_cause"
        ]
      }
    }
  ]
}
```

### original_cause_state

Declare original cause state for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "original_cause_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "original-failure-cause-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_cause_state",
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
              "role": "original_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "cause-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_cause"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "settled_cause_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cause_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "original-failure-cause-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_cause",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "injected_failure"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "failure-cause-observation-records-original",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_observation_at_failure",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "injected_failure"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "original_cause_state",
          "settled_cause_state",
          "cleanup_failure_condition",
          "cause_loss_condition"
        ]
      }
    }
  ]
}
```

### settled_cause_state

Declare settled cause state for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "settled_cause_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "settled-failure-cause-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_cause",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "settled-cause-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_observation_at_settlement",
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
              "role": "settled_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "original-failure-cause-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_cause_state",
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
              "role": "original_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "cause-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_cause"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "settled_cause_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cause_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "original_cause_state",
          "settled_cause_state",
          "cleanup_failure_condition",
          "cause_loss_condition"
        ]
      }
    }
  ]
}
```

### cleanup_event

Declare cleanup event for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cleanup_event",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "cleanup-follows-injected-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_event",
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
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "cleanup-targets-residue-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_event",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "injected_failure"
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
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "settlement-follows-cleanup",
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
              "role": "cleanup_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation_attempt",
          "failure_injection",
          "injected_failure",
          "cleanup_event",
          "settlement_event"
        ]
      }
    }
  ]
}
```

### settlement_event

Declare settlement event for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "settlement_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "settled-residue-population-cardinality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:has_cardinality",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "residue-observation-records-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "residue_observation",
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
              "role": "residue_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "settled-failure-record-preserves-cause",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_failure_record",
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
              "role": "failure_cause"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "settled-failure-cause-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_cause",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "settled-cause-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_observation_at_settlement",
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
              "role": "settled_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "cleanup-verification-reads-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_verification",
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
              "role": "residue_observation"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "residue-population-empty-after-settlement",
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
              "value": 0
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "cause-verification-reads-observations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_verification",
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
              "role": "cause_observation_at_failure"
            },
            {
              "kind": "reference",
              "role": "cause_observation_at_settlement"
            },
            {
              "kind": "reference",
              "role": "settled_failure_record"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "original-failure-cause-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_cause_state",
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
              "role": "original_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "settlement-follows-cleanup",
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
              "role": "cleanup_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
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
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation_attempt",
          "failure_injection",
          "injected_failure",
          "cleanup_event",
          "settlement_event"
        ]
      }
    }
  ]
}
```

### residue_population

Declare residue population for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "residue_population",
        "allowed_type_terms": [
          "cc:population",
          "cc:resource",
          "cc:scope"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "settled-residue-population-cardinality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:has_cardinality",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "residue-observation-records-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "residue_observation",
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
              "role": "residue_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "residue-population-empty-after-settlement",
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
              "value": 0
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
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
              "role": "residue_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cleanup_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value": 0
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "cleanup-targets-residue-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_event",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "injected_failure"
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
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "operation",
          "residue_population",
          "failure_cause"
        ]
      }
    }
  ]
}
```

### cleanup_verification

Declare cleanup verification for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cleanup_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "cleanup-verification-reads-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_verification",
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
              "role": "residue_observation"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
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
              "role": "residue_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cleanup_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value": 0
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "cleanup_verification",
          "cause_verification"
        ]
      }
    }
  ]
}
```

### cause_verification

Declare cause verification for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cause_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "cause-verification-reads-observations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_verification",
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
              "role": "cause_observation_at_failure"
            },
            {
              "kind": "reference",
              "role": "cause_observation_at_settlement"
            },
            {
              "kind": "reference",
              "role": "settled_failure_record"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "cause-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_cause"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "settled_cause_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cause_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "cleanup_verification",
          "cause_verification"
        ]
      }
    }
  ]
}
```

### cleanup_failure_condition

Declare cleanup failure condition for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cleanup_failure_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
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
              "role": "residue_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cleanup_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value": 0
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "original_cause_state",
          "settled_cause_state",
          "cleanup_failure_condition",
          "cause_loss_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "cleanup-verifies-empty-residue",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "cleanup_failure_condition"
          ]
        }
      }
    }
  ]
}
```

### cause_loss_condition

Declare cause loss condition for proof.failure.settlement-and-cleanup. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cause_loss_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "cause-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_cause"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "settled_cause_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cause_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "original_cause_state",
          "settled_cause_state",
          "cleanup_failure_condition",
          "cause_loss_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "cause-verifies-preservation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "cause_loss_condition"
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
| operation_attempt | semantic_parameter | operation_attempt |  |
| failure_injection | semantic_parameter | failure_injection |  |
| injected_failure | semantic_parameter | injected_failure |  |
| failure_cause | semantic_parameter | failure_cause |  |
| original_cause_state | semantic_parameter | original_cause_state |  |
| settled_cause_state | semantic_parameter | settled_cause_state |  |
| cause_observation_at_failure | observation_requirement |  | Acquire cause_observation_at_failure for the exact subject, attempt and applicability in this profile. |
| cause_observation_at_settlement | observation_requirement |  | Acquire cause_observation_at_settlement for the exact subject, attempt and applicability in this profile. |
| cleanup_event | semantic_parameter | cleanup_event |  |
| settlement_event | semantic_parameter | settlement_event |  |
| residue_population | semantic_parameter | residue_population |  |
| residue_observation | observation_requirement |  | Acquire residue_observation for the exact subject, attempt and applicability in this profile. |
| settled_failure_record | observation_requirement |  | Acquire settled_failure_record for the exact subject, attempt and applicability in this profile. |
| cleanup_verification | semantic_parameter | cleanup_verification |  |
| cause_verification | semantic_parameter | cause_verification |  |
| cleanup_failure_condition | semantic_parameter | cleanup_failure_condition |  |
| cause_loss_condition | semantic_parameter | cause_loss_condition |  |
| residue_count | observation_requirement |  | Acquire residue_count for the exact subject, attempt and applicability in this profile. |

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
        "/claim_patterns/2",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "operation",
        "allowed_type_terms": [
          "cc:operation",
          "cc:process",
          "cc:command"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
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
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/claim_patterns/6",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "operation_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "failure_injection",
      "kind": "semantic_parameter",
      "parameter": "failure_injection",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_injection",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
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
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "injected_failure",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "failure_cause",
      "kind": "semantic_parameter",
      "parameter": "failure_cause",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/20",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_cause",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "original_cause_state",
      "kind": "semantic_parameter",
      "parameter": "original_cause_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "original_cause_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "settled_cause_state",
      "kind": "semantic_parameter",
      "parameter": "settled_cause_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "settled_cause_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cause_observation_at_failure",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire cause_observation_at_failure for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.settlement-and-cleanup/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "cause_observation_at_failure",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cause_observation_at_settlement",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/18",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire cause_observation_at_settlement for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.settlement-and-cleanup/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "cause_observation_at_settlement",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cleanup_event",
      "kind": "semantic_parameter",
      "parameter": "cleanup_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cleanup_event",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
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
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "settlement_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "residue_population",
      "kind": "semantic_parameter",
      "parameter": "residue_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "residue_population",
        "allowed_type_terms": [
          "cc:population",
          "cc:resource",
          "cc:scope"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "residue_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/15"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire residue_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.settlement-and-cleanup/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "residue_observation",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "settled_failure_record",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/18",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire settled_failure_record for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.settlement-and-cleanup/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "settled_failure_record",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cleanup_verification",
      "kind": "semantic_parameter",
      "parameter": "cleanup_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/17",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cleanup_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cause_verification",
      "kind": "semantic_parameter",
      "parameter": "cause_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/claim_patterns/20",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cause_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cleanup_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "cleanup_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/distinct_reference_role_sets/1",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cleanup_failure_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cause_loss_condition",
      "kind": "semantic_parameter",
      "parameter": "cause_loss_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/distinct_reference_role_sets/1",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cause_loss_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "residue_count",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire residue_count for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.failure.settlement-and-cleanup/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "residue_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "operation_attempt",
          "failure_injection",
          "injected_failure",
          "cleanup_event",
          "settlement_event"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "original_cause_state",
          "settled_cause_state",
          "cleanup_failure_condition",
          "cause_loss_condition"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "cause_observation_at_failure",
          "cause_observation_at_settlement",
          "settled_failure_record"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "cleanup_verification",
          "cause_verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "constraint": {
        "roles": [
          "operation",
          "residue_population",
          "failure_cause"
        ]
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
          "subject_role": "operation_attempt",
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
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "failure-injection-precedes-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_injection",
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
              "role": "injected_failure"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "injected-failure-targets-operation",
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
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "injected-failure-carries-cause",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "injected_failure",
          "operator": "reference:has_property",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_cause"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "original-failure-cause-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_cause",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "injected_failure"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "failure-cause-observation-records-original",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_observation_at_failure",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "injected_failure"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "cleanup-follows-injected-failure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_event",
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
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "cleanup-targets-residue-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_event",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "injected_failure"
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
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "settlement-follows-cleanup",
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
              "role": "cleanup_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
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
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "settled-residue-population-cardinality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:has_cardinality",
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
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "residue-observation-records-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "residue_observation",
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
              "role": "residue_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "settled-failure-record-preserves-cause",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_failure_record",
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
              "role": "failure_cause"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "settled-failure-cause-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_cause",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "settlement_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "settled-cause-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_observation_at_settlement",
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
              "role": "settled_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "cleanup-verification-reads-settlement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cleanup_verification",
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
              "role": "residue_observation"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "residue-population-empty-after-settlement",
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
              "value": 0
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
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
              "role": "residue_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "residue_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cleanup_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value": 0
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "cause-verification-reads-observations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_verification",
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
              "role": "cause_observation_at_failure"
            },
            {
              "kind": "reference",
              "role": "cause_observation_at_settlement"
            },
            {
              "kind": "reference",
              "role": "settled_failure_record"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "original-failure-cause-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_cause_state",
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
              "role": "original_cause_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "cause-preservation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cause_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_cause"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "settled_cause_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cause_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "original_cause_state"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ]
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "cleanup-verifies-empty-residue",
        "role": "verifies",
        "source_claim_pattern_id": "cleanup-verification",
        "target_claim_pattern_id": "residue-population-empty-after-settlement"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "cause-verifies-preservation",
        "role": "verifies",
        "source_claim_pattern_id": "cause-preservation-verification",
        "target_claim_pattern_id": "original-failure-cause-preserved"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "cleanup-verifies-empty-residue",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "cleanup_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "cause-verifies-preservation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "cause_loss_condition"
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
        "collection_purpose": "proof_failure_settlement_cleanup_sequence",
        "member_claim_pattern_ids": [
          "attempt-performs-operation",
          "failure-injection-precedes-failure",
          "injected-failure-carries-cause",
          "original-failure-cause-state",
          "cleanup-follows-injected-failure",
          "cleanup-targets-residue-population",
          "settlement-follows-cleanup",
          "settled-residue-population-cardinality",
          "residue-population-empty-after-settlement",
          "settled-failure-record-preserves-cause",
          "settled-failure-cause-state",
          "original-failure-cause-preserved"
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
        "collection_purpose": "proof_failure_settlement_cleanup_population",
        "member_claim_pattern_ids": [
          "attempt-performs-operation",
          "failure-injection-precedes-failure",
          "injected-failure-targets-operation",
          "injected-failure-carries-cause",
          "original-failure-cause-state",
          "failure-cause-observation-records-original",
          "cleanup-follows-injected-failure",
          "cleanup-targets-residue-population",
          "settlement-follows-cleanup",
          "settlement-follows-injected-failure",
          "settled-residue-population-cardinality",
          "residue-observation-records-population",
          "settled-failure-record-preserves-cause",
          "settled-failure-cause-state",
          "settled-cause-observation-records-state",
          "cleanup-verification-reads-settlement",
          "residue-population-empty-after-settlement",
          "cleanup-verification",
          "cause-verification-reads-observations",
          "original-failure-cause-preserved",
          "cause-preservation-verification"
        ]
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "attempt-performs-operation"
          },
          {
            "pattern": "failure-injection-precedes-failure"
          },
          {
            "pattern": "injected-failure-targets-operation"
          },
          {
            "pattern": "injected-failure-carries-cause"
          },
          {
            "pattern": "original-failure-cause-state"
          },
          {
            "pattern": "failure-cause-observation-records-original"
          },
          {
            "pattern": "cleanup-follows-injected-failure"
          },
          {
            "pattern": "cleanup-targets-residue-population"
          },
          {
            "pattern": "settlement-follows-cleanup"
          },
          {
            "pattern": "settlement-follows-injected-failure"
          },
          {
            "pattern": "settled-residue-population-cardinality"
          },
          {
            "pattern": "residue-observation-records-population"
          },
          {
            "pattern": "settled-failure-record-preserves-cause"
          },
          {
            "pattern": "settled-failure-cause-state"
          },
          {
            "pattern": "settled-cause-observation-records-state"
          },
          {
            "pattern": "cleanup-verification-reads-settlement"
          },
          {
            "pattern": "residue-population-empty-after-settlement"
          },
          {
            "pattern": "cleanup-verification"
          },
          {
            "pattern": "cause-verification-reads-observations"
          },
          {
            "pattern": "original-failure-cause-preserved"
          },
          {
            "pattern": "cause-preservation-verification"
          },
          {
            "pattern": "cleanup-verifies-empty-residue"
          },
          {
            "pattern": "cause-verifies-preservation"
          },
          {
            "pattern": "proof-sequence"
          },
          {
            "pattern": "proof-population"
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
      "operation_attempt",
      "failure_injection",
      "injected_failure",
      "failure_cause",
      "original_cause_state",
      "settled_cause_state",
      "cleanup_event",
      "settlement_event",
      "residue_population",
      "cleanup_verification",
      "cause_verification",
      "cleanup_failure_condition",
      "cause_loss_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "cause_observation_at_failure",
      "cause_observation_at_settlement",
      "residue_observation",
      "settled_failure_record",
      "residue_count"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.failure.settlement-and-cleanup.",
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
        "missing": "No named proof.failure.settlement-and-cleanup constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.failure.settlement-and-cleanup.",
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
