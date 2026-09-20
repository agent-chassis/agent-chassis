# proof.authorization.failed-attempt-nonconsumption@4.0.0

<!-- Generated from validated package metadata. -->

A declared failed attempt using one legitimate authority is refused; that authority complete declared state observed after refusal equals its complete declared state observed before the attempt; and a later distinct authorized attempt using the same authority reaches a declared expected successful result state.

Profile digest: d949ae751ce8612a2d2aa0d9166aeb23bf95b821fd97761c365e52925e82cbc4. Parameter digest: 52da26a460c268920729d35a9604933d4594c6e97925c03fdfe488eaffd3ad79.

Admission digest: b5b8aad67a45e777c6b57c6c4baee27d820c186c654ef66ad13cd380a6d6e228.

Roles: 20/20 accounted; 3 owned gaps. Semantic parameters: 17; internal roles: 3.

## Guarantee and exclusions

A declared failed attempt using one legitimate authority is refused; that authority complete declared state observed after refusal equals its complete declared state observed before the attempt; and a later distinct authorized attempt using the same authority reaches a declared expected successful result state.

- concurrent-authority-use
- pack-applicability
- refusal-before-protected-effects
- resources-outside-legitimate-authority
- single-use-semantics-after-valid-success
- transient-consume-and-restore
- truthful-reference-grounding

## Parameters

### operation

Declare operation for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
          "cc:capability",
          "cc:command"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "valid-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
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
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "valid-input-authorized",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "failed-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
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
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "failed-input-unauthorized",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failed_input"
            }
          ]
        }
      }
    }
  ]
}
```

### legitimate_authority

Declare legitimate authority for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "legitimate_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability",
          "cc:configuration"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "authority-state-before-failed-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failed_attempt"
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
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
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
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "failed_attempt_consumption_condition"
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
        "pattern_id": "valid-attempt-uses-authority",
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
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "valid-input-authorized",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "failed-attempt-uses-authority",
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
              "role": "legitimate_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "failed-input-unauthorized",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failed_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "authority-state-after-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    }
  ]
}
```

### failed_attempt

Declare failed attempt for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failed_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "authority-state-before-failed-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failed_attempt"
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "authority-state-before-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_before_failed_attempt",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failed_attempt"
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
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "failed-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
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
        "pattern_id": "failed-attempt-uses-authority",
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
              "role": "legitimate_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "failed-attempt-uses-input",
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
              "role": "failed_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "refusal-rejects-failed-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failed_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failed_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "failed-attempt-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refusal"
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
          "refusal",
          "valid_attempt",
          "valid_result"
        ]
      }
    }
  ]
}
```

### valid_attempt

Declare valid attempt for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "valid_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "refusal-precedes-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "valid-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
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
        "pattern_id": "valid-attempt-uses-authority",
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
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "valid-attempt-uses-input",
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
              "refusal"
            ]
          },
          "operands": [
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
        "pattern_id": "valid-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "valid-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "valid-result-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "later-use-verification-reads-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_use_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "valid-result-matches-expected-success",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
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
          "refusal",
          "valid_attempt",
          "valid_result"
        ]
      }
    }
  ]
}
```

### failed_input

Declare failed input for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failed_input",
        "allowed_type_terms": [
          "cc:actor",
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
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "failed-attempt-uses-input",
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
              "role": "failed_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "failed-input-unauthorized",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failed_input"
            }
          ]
        }
      }
    }
  ]
}
```

### valid_input

Declare valid input for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "valid_input",
        "allowed_type_terms": [
          "cc:actor",
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "valid-attempt-uses-input",
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
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "valid-input-authorized",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
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

### refusal

Declare refusal for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "refusal",
        "allowed_type_terms": [
          "cc:event",
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
        "pattern_id": "nonconsumption-verification-reads-before",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_before_failed_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "nonconsumption-verification-reads-after",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "authority-state-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
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
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "refusal-precedes-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "valid-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
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
        "pattern_id": "valid-attempt-uses-authority",
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
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "valid-attempt-uses-input",
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
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "refusal-rejects-failed-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failed_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failed_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "failed-attempt-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "authority-state-after-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "authority-state-after-refusal-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_refusal",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
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
          "refusal",
          "valid_attempt",
          "valid_result"
        ]
      }
    }
  ]
}
```

### valid_result

Declare valid result for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "valid_result",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "valid-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "valid-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "later-use-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_use_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result"
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
          "subject_role": "valid_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "valid_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
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
          "refusal",
          "valid_attempt",
          "valid_result"
        ]
      }
    }
  ]
}
```

### authority_state_before

Declare authority state before for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authority_state_before",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "authority-state-before-failed-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failed_attempt"
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "authority-state-before-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_before_failed_attempt",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failed_attempt"
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "authority-state-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
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
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
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
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "failed_attempt_consumption_condition"
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

### authority_state_after_refusal

Declare authority state after refusal for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authority_state_after_refusal",
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
        "pattern_id": "authority-state-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
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
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
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
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "failed_attempt_consumption_condition"
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
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "authority-state-after-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "authority-state-after-refusal-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_refusal",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    }
  ]
}
```

### expected_success_state

Declare expected success state for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "expected_success_state",
        "allowed_type_terms": [
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
        "pattern_id": "expected-success-state-classification",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_success_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "success_criterion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "valid-result-matches-expected-success",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "later-use-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_use_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result"
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
          "subject_role": "valid_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "valid_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    }
  ]
}
```

### valid_result_state

Declare valid result state for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "valid_result_state",
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
        "pattern_id": "valid-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "valid-result-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "valid-result-matches-expected-success",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "later-use-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_use_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result"
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
          "subject_role": "valid_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "valid_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    }
  ]
}
```

### nonconsumption_verification

Declare nonconsumption verification for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "nonconsumption_verification",
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "nonconsumption-verification-reads-before",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_before_failed_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "nonconsumption-verification-reads-after",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
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
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "failed_attempt_consumption_condition"
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
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "nonconsumption_verification",
          "later_use_verification"
        ]
      }
    }
  ]
}
```

### later_use_verification

Declare later use verification for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "later_use_verification",
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
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "later-use-verification-reads-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_use_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "later-use-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_use_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result"
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
          "subject_role": "valid_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "valid_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "nonconsumption_verification",
          "later_use_verification"
        ]
      }
    }
  ]
}
```

### success_criterion

Declare success criterion for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "success_criterion",
        "allowed_type_terms": [
          "cc:criterion",
          "cc:invariant"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "expected-success-state-classification",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_success_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "success_criterion"
            }
          ]
        }
      }
    }
  ]
}
```

### failed_attempt_consumption_condition

Declare failed attempt consumption condition for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failed_attempt_consumption_condition",
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
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
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
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "failed_attempt_consumption_condition"
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
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "failed_attempt_consumption_condition",
          "valid_use_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-target-nonconsumption",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "failed_attempt_consumption_condition"
          ]
        }
      }
    }
  ]
}
```

### valid_use_failure_condition

Declare valid use failure condition for proof.authorization.failed-attempt-nonconsumption. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "valid_use_failure_condition",
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
        "pattern_id": "later-use-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_use_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result"
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
          "subject_role": "valid_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "valid_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "failed_attempt_consumption_condition",
          "valid_use_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-target-later-use",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "valid_use_failure_condition"
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
| legitimate_authority | semantic_parameter | legitimate_authority |  |
| failed_attempt | semantic_parameter | failed_attempt |  |
| valid_attempt | semantic_parameter | valid_attempt |  |
| failed_input | semantic_parameter | failed_input |  |
| valid_input | semantic_parameter | valid_input |  |
| refusal | semantic_parameter | refusal |  |
| valid_result | semantic_parameter | valid_result |  |
| authority_state_before | semantic_parameter | authority_state_before |  |
| authority_state_after_refusal | semantic_parameter | authority_state_after_refusal |  |
| expected_success_state | semantic_parameter | expected_success_state |  |
| valid_result_state | semantic_parameter | valid_result_state |  |
| observation_before_failed_attempt | observation_requirement |  | Acquire observation_before_failed_attempt for the exact subject, attempt and applicability in this profile. |
| observation_after_refusal | observation_requirement |  | Acquire observation_after_refusal for the exact subject, attempt and applicability in this profile. |
| valid_result_observation | observation_requirement |  | Acquire valid_result_observation for the exact subject, attempt and applicability in this profile. |
| nonconsumption_verification | semantic_parameter | nonconsumption_verification |  |
| later_use_verification | semantic_parameter | later_use_verification |  |
| success_criterion | semantic_parameter | success_criterion |  |
| failed_attempt_consumption_condition | semantic_parameter | failed_attempt_consumption_condition |  |
| valid_use_failure_condition | semantic_parameter | valid_use_failure_condition |  |

```json
{
  "roles": [
    {
      "role": "operation",
      "kind": "semantic_parameter",
      "parameter": "operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/18",
        "/claim_patterns/2",
        "/claim_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "operation",
        "allowed_type_terms": [
          "cc:operation",
          "cc:capability",
          "cc:command"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "legitimate_authority",
      "kind": "semantic_parameter",
      "parameter": "legitimate_authority",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/13",
        "/claim_patterns/16",
        "/claim_patterns/18",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "legitimate_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability",
          "cc:configuration"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "failed_attempt",
      "kind": "semantic_parameter",
      "parameter": "failed_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failed_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "valid_attempt",
      "kind": "semantic_parameter",
      "parameter": "valid_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/19",
        "/claim_patterns/21",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "valid_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "failed_input",
      "kind": "semantic_parameter",
      "parameter": "failed_input",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/claim_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failed_input",
        "allowed_type_terms": [
          "cc:actor",
          "cc:artifact",
          "cc:configuration",
          "cc:entity"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "valid_input",
      "kind": "semantic_parameter",
      "parameter": "valid_input",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/claim_patterns/18"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "valid_input",
        "allowed_type_terms": [
          "cc:actor",
          "cc:artifact",
          "cc:configuration",
          "cc:entity"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "refusal",
      "kind": "semantic_parameter",
      "parameter": "refusal",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "refusal",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "valid_result",
      "kind": "semantic_parameter",
      "parameter": "valid_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/claim_patterns/21",
        "/claim_patterns/25",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "valid_result",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority_state_before",
      "kind": "semantic_parameter",
      "parameter": "authority_state_before",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/12",
        "/claim_patterns/13"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_state_before",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority_state_after_refusal",
      "kind": "semantic_parameter",
      "parameter": "authority_state_after_refusal",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/8",
        "/claim_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_state_after_refusal",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "expected_success_state",
      "kind": "semantic_parameter",
      "parameter": "expected_success_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/claim_patterns/24",
        "/claim_patterns/25"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "expected_success_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "valid_result_state",
      "kind": "semantic_parameter",
      "parameter": "valid_result_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/claim_patterns/22",
        "/claim_patterns/24",
        "/claim_patterns/25"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "valid_result_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_before_failed_attempt",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/10"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_before_failed_attempt for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authorization.failed-attempt-nonconsumption/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_before_failed_attempt",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_after_refusal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/9"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_after_refusal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authorization.failed-attempt-nonconsumption/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_after_refusal",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "valid_result_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/22",
        "/claim_patterns/23"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire valid_result_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authorization.failed-attempt-nonconsumption/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "valid_result_observation",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "nonconsumption_verification",
      "kind": "semantic_parameter",
      "parameter": "nonconsumption_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/13",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "nonconsumption_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "later_use_verification",
      "kind": "semantic_parameter",
      "parameter": "later_use_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/23",
        "/claim_patterns/25",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_use_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "success_criterion",
      "kind": "semantic_parameter",
      "parameter": "success_criterion",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "success_criterion",
        "allowed_type_terms": [
          "cc:criterion",
          "cc:invariant"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "failed_attempt_consumption_condition",
      "kind": "semantic_parameter",
      "parameter": "failed_attempt_consumption_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failed_attempt_consumption_condition",
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
      "role": "valid_use_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "valid_use_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/25",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "valid_use_failure_condition",
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
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "failed_attempt",
          "refusal",
          "valid_attempt",
          "valid_result"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "nonconsumption_verification",
          "later_use_verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "failed_attempt_consumption_condition",
          "valid_use_failure_condition"
        ]
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "authority-state-before-failed-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failed_attempt"
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
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "authority-state-before-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_before_failed_attempt",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "failed_attempt"
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
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "failed-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
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
        "pattern_id": "failed-attempt-uses-authority",
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
              "role": "legitimate_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "failed-attempt-uses-input",
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
              "role": "failed_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "failed-input-unauthorized",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failed_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "refusal-rejects-failed-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "failed_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failed_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "failed-attempt-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failed_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "authority-state-after-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "authority-state-after-refusal-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_refusal",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority_state_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "nonconsumption-verification-reads-before",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_before_failed_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "nonconsumption-verification-reads-after",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "authority-state-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
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
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "nonconsumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "nonconsumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
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
          "subject_role": "authority_state_after_refusal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "failed_attempt_consumption_condition"
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
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "refusal-precedes-valid-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
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
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "valid-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "refusal"
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
      "constraint": {
        "pattern_id": "valid-attempt-uses-authority",
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
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "legitimate_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "valid-attempt-uses-input",
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
              "refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "valid-input-authorized",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "legitimate_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "operation"
            ]
          },
          "operands": [
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
        "pattern_id": "valid-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
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
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "expected-success-state-classification",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_success_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "success_criterion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "valid-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "valid-result-observation-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "later-use-verification-reads-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_use_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "constraint": {
        "pattern_id": "valid-result-matches-expected-success",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "valid_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "valid_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "constraint": {
        "pattern_id": "later-use-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "later_use_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "valid_result"
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
          "subject_role": "valid_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "valid_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-nonconsumption",
        "role": "verifies",
        "source_claim_pattern_id": "nonconsumption-verification",
        "target_claim_pattern_id": "authority-state-preserved"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-target-later-use",
        "role": "verifies",
        "source_claim_pattern_id": "later-use-verification",
        "target_claim_pattern_id": "valid-result-matches-expected-success"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-nonconsumption",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "failed_attempt_consumption_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-target-later-use",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "valid_use_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/collection_patterns/0",
      "constraint": {
        "pattern_id": "proof-population",
        "collection_kind": "closed_set",
        "match_mode": "exact",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "proof_authorization_failed_attempt_nonconsumption_population",
        "member_claim_pattern_ids": [
          "authority-state-before-failed-attempt",
          "authority-state-before-observation-record",
          "failed-attempt-performs-operation",
          "failed-attempt-uses-authority",
          "failed-attempt-uses-input",
          "failed-input-unauthorized",
          "refusal-rejects-failed-attempt",
          "failed-attempt-precedes-refusal",
          "authority-state-after-refusal",
          "authority-state-after-refusal-observation-record",
          "nonconsumption-verification-reads-before",
          "nonconsumption-verification-reads-after",
          "authority-state-preserved",
          "nonconsumption-verification",
          "refusal-precedes-valid-attempt",
          "valid-attempt-performs-operation",
          "valid-attempt-uses-authority",
          "valid-attempt-uses-input",
          "valid-input-authorized",
          "valid-result-accepts-attempt",
          "expected-success-state-classification",
          "valid-result-state",
          "valid-result-observation-record",
          "later-use-verification-reads-result",
          "valid-result-matches-expected-success",
          "later-use-verification"
        ]
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "authority-state-before-failed-attempt"
          },
          {
            "pattern": "authority-state-before-observation-record"
          },
          {
            "pattern": "failed-attempt-performs-operation"
          },
          {
            "pattern": "failed-attempt-uses-authority"
          },
          {
            "pattern": "failed-attempt-uses-input"
          },
          {
            "pattern": "failed-input-unauthorized"
          },
          {
            "pattern": "refusal-rejects-failed-attempt"
          },
          {
            "pattern": "failed-attempt-precedes-refusal"
          },
          {
            "pattern": "authority-state-after-refusal"
          },
          {
            "pattern": "authority-state-after-refusal-observation-record"
          },
          {
            "pattern": "nonconsumption-verification-reads-before"
          },
          {
            "pattern": "nonconsumption-verification-reads-after"
          },
          {
            "pattern": "authority-state-preserved"
          },
          {
            "pattern": "nonconsumption-verification"
          },
          {
            "pattern": "refusal-precedes-valid-attempt"
          },
          {
            "pattern": "valid-attempt-performs-operation"
          },
          {
            "pattern": "valid-attempt-uses-authority"
          },
          {
            "pattern": "valid-attempt-uses-input"
          },
          {
            "pattern": "valid-input-authorized"
          },
          {
            "pattern": "valid-result-accepts-attempt"
          },
          {
            "pattern": "expected-success-state-classification"
          },
          {
            "pattern": "valid-result-state"
          },
          {
            "pattern": "valid-result-observation-record"
          },
          {
            "pattern": "later-use-verification-reads-result"
          },
          {
            "pattern": "valid-result-matches-expected-success"
          },
          {
            "pattern": "later-use-verification"
          },
          {
            "pattern": "verification-target-nonconsumption"
          },
          {
            "pattern": "verification-target-later-use"
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
      "legitimate_authority",
      "failed_attempt",
      "valid_attempt",
      "failed_input",
      "valid_input",
      "refusal",
      "valid_result",
      "authority_state_before",
      "authority_state_after_refusal",
      "expected_success_state",
      "valid_result_state",
      "nonconsumption_verification",
      "later_use_verification",
      "success_criterion",
      "failed_attempt_consumption_condition",
      "valid_use_failure_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "observation_before_failed_attempt",
      "observation_after_refusal",
      "valid_result_observation"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.authorization.failed-attempt-nonconsumption.",
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
        "missing": "No named proof.authorization.failed-attempt-nonconsumption constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.authorization.failed-attempt-nonconsumption.",
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
