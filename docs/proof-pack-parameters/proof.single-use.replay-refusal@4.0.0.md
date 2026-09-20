# proof.single-use.replay-refusal@4.0.0

<!-- Generated from validated package metadata. -->

Given one declared single-use authority and authorized input, two distinct ordered attempts of the same operation using that authority and input, one closed one-member effect-occurrence population, one elected durable effect resource with complete observations before first use, after first success, and after replay refusal, and one expected success state: the first attempt is accepted, reaches the expected state, creates the sole declared effect occurrence, and changes the elected resource state; after that success the authority no longer authorizes the input; the replay is rejected and not accepted, creates no member of the declared effect population, and leaves the elected resource state equal to its post-first-use state.

Profile digest: d35e3c226ad539a7cbcaa539e6daa638878c4849680f5af468513666a697f3ef. Parameter digest: 5dcb30fe04702ce8edb961fcbb7604af8af13a69532def3e8d5b453af150e025.

Admission digest: dc1f8a4d0429e79485bd343d7693b20be350ff5e9efba72cdd3947d1b34d7a3a.

Roles: 31/31 accounted; 3 owned gaps. Semantic parameters: 27; internal roles: 4.

## Guarantee and exclusions

Given one declared single-use authority and authorized input, two distinct ordered attempts of the same operation using that authority and input, one closed one-member effect-occurrence population, one elected durable effect resource with complete observations before first use, after first success, and after replay refusal, and one expected success state: the first attempt is accepted, reaches the expected state, creates the sole declared effect occurrence, and changes the elected resource state; after that success the authority no longer authorizes the input; the replay is rejected and not accepted, creates no member of the declared effect population, and leaves the elected resource state equal to its post-first-use state.

- additional-replay-attempts
- concurrent-or-linearizable-use
- delivered-evidence-authenticity
- effects-outside-elected-population
- failure-settlement-and-cleanup
- pack-applicability
- purely-transient-effect
- refusal-before-effects
- transient-duplicate-and-restore
- truthful-identity-and-population-grounding

## Parameters

### operation

Declare operation for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "pattern_id": "authority-authorizes-first-use",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "single_use_authority",
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
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "replay-performs-same-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
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
        "pattern_id": "operation-writes-effect-subject",
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
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "first-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
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

### single_use_authority

Declare single use authority for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "single_use_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability",
          "cc:configuration"
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
        "pattern_id": "authority-authorizes-first-use",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "single_use_authority",
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
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "replay-uses-same-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "authority-consumed-after-first-use",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "single_use_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "consumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "consumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "single_use_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_still_live_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
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
        "pattern_id": "first-attempt-uses-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        }
      }
    }
  ]
}
```

### input

Declare input for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "input",
        "allowed_type_terms": [
          "cc:actor",
          "cc:artifact",
          "cc:configuration",
          "cc:entity"
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
        "pattern_id": "authority-authorizes-first-use",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "single_use_authority",
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
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "replay-uses-same-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "authority-consumed-after-first-use",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "single_use_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "consumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "consumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "single_use_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_still_live_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
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
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "first-attempt-uses-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
            }
          ]
        }
      }
    }
  ]
}
```

### first_attempt

Declare first attempt for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "first_attempt",
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
        "pattern_id": "first-attempt-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "first-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "first-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "effect-state-before-first-use",
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
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "observation-before-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_before",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "first-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
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
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "first-attempt-uses-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "first-attempt-uses-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "first-attempt-creates-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "first_attempt",
          "first_result",
          "replay_attempt",
          "replay_refusal"
        ]
      }
    }
  ]
}
```

### first_result

Declare first result for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "first_result",
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "first-attempt-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "first-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "first-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "first-result-observation-records-state",
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
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result_state"
            },
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "first-result-matches-expected-success",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
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
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "success-verification-reads-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "first_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "first_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
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
      "value": {
        "pattern_id": "effect-state-after-first-use",
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
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "first-use-changes-effect-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_state_after_first",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "first-effect-verification-reads-states",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_effect_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_before"
            },
            {
              "kind": "reference",
              "role": "observation_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "first-result-precedes-replay",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "replay-performs-same-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
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
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "replay-uses-same-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "replay-uses-same-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "authority-consumed-after-first-use",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "single_use_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "consumption-verification-reads-replay",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "consumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            },
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "replay-does-not-create-effect",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "first_attempt",
          "first_result",
          "replay_attempt",
          "replay_refusal"
        ]
      }
    }
  ]
}
```

### replay_attempt

Declare replay attempt for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "replay_attempt",
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
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "first-result-precedes-replay",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "replay-performs-same-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
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
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "replay-uses-same-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "replay-uses-same-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "consumption-verification-reads-replay",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "consumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            },
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "replay-attempt-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "replay-refusal-rejects-replay",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "replay-is-not-accepted",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "replay-refusal-verification-reads-events",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            },
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "replay-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "replay_refusal",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "replay_accepted_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
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
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "replay-does-not-create-effect",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/35",
      "value": {
        "pattern_id": "replay-occurrence-verification-reads-events",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_occurrence_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            },
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/36",
      "value": {
        "pattern_id": "replay-occurrence-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_occurrence_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "duplicate_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
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
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "first_attempt",
          "first_result",
          "replay_attempt",
          "replay_refusal"
        ]
      }
    }
  ]
}
```

### replay_refusal

Declare replay refusal for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "replay_refusal",
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
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "replay-attempt-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "replay-refusal-rejects-replay",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "replay-is-not-accepted",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "replay-refusal-verification-reads-events",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            },
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "replay-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "replay_refusal",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "replay_accepted_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
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
      "ref": "/claim_patterns/35",
      "value": {
        "pattern_id": "replay-occurrence-verification-reads-events",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_occurrence_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            },
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/37",
      "value": {
        "pattern_id": "effect-state-after-replay",
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
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_replay"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/38",
      "value": {
        "pattern_id": "observation-after-replay-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_replay",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_replay"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/39",
      "value": {
        "pattern_id": "effect-state-stable-after-replay",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_state_after_replay",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/40",
      "value": {
        "pattern_id": "replay-effect-verification-reads-states",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_effect_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_first"
            },
            {
              "kind": "reference",
              "role": "observation_after_replay"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "first_attempt",
          "first_result",
          "replay_attempt",
          "replay_refusal"
        ]
      }
    }
  ]
}
```

### effect_subject

Declare effect subject for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "effect_subject",
        "allowed_type_terms": [
          "cc:resource"
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
        "pattern_id": "effect-state-after-first-use",
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
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "first-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_effect_verification",
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
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_first",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_first_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
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
        "pattern_id": "operation-writes-effect-subject",
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
      "ref": "/claim_patterns/37",
      "value": {
        "pattern_id": "effect-state-after-replay",
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
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_replay"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "effect-state-before-first-use",
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
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/41",
      "value": {
        "pattern_id": "replay-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_effect_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_subject"
            },
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_replay",
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
              "role": "effect_state_after_first"
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
    }
  ]
}
```

### effect_occurrence_population

Declare effect occurrence population for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "effect_occurrence_population",
        "allowed_type_terms": [
          "cc:population"
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
        "pattern_id": "effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_occurrence_population",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "effect-population-cardinality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_occurrence_population",
          "operator": "number:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "effect_occurrence_count"
            }
          ]
        }
      }
    }
  ]
}
```

### effect_occurrence

Declare effect occurrence for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "effect_occurrence",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact",
          "cc:entity"
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
        "pattern_id": "effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_occurrence_population",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "replay-does-not-create-effect",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/36",
      "value": {
        "pattern_id": "replay-occurrence-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_occurrence_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "duplicate_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
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
      "ref": "/claim_patterns/41",
      "value": {
        "pattern_id": "replay-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_effect_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_subject"
            },
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_replay",
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
              "role": "effect_state_after_first"
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
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "first-attempt-creates-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        }
      }
    }
  ]
}
```

### effect_state_before

Declare effect state before for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "effect_state_before",
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
        "pattern_id": "first-use-changes-effect-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_state_after_first",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "first-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_effect_verification",
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
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_first",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_first_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
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
        "pattern_id": "effect-state-before-first-use",
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
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "observation-before-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_before",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "effect_state_before",
          "effect_state_after_first",
          "effect_state_after_replay",
          "expected_success_state",
          "first_result_state"
        ]
      }
    }
  ]
}
```

### effect_state_after_first

Declare effect state after first for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "effect_state_after_first",
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
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "first-result-observation-records-state",
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
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result_state"
            },
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "effect-state-after-first-use",
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
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "first-use-changes-effect-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_state_after_first",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "first-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_effect_verification",
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
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_first",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_first_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
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
      "ref": "/claim_patterns/39",
      "value": {
        "pattern_id": "effect-state-stable-after-replay",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_state_after_replay",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/41",
      "value": {
        "pattern_id": "replay-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_effect_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_subject"
            },
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_replay",
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
              "role": "effect_state_after_first"
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
          "effect_state_before",
          "effect_state_after_first",
          "effect_state_after_replay",
          "expected_success_state",
          "first_result_state"
        ]
      }
    }
  ]
}
```

### effect_state_after_replay

Declare effect state after replay for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "effect_state_after_replay",
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
      "ref": "/claim_patterns/37",
      "value": {
        "pattern_id": "effect-state-after-replay",
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
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_replay"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/38",
      "value": {
        "pattern_id": "observation-after-replay-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_replay",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_replay"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/39",
      "value": {
        "pattern_id": "effect-state-stable-after-replay",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_state_after_replay",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/41",
      "value": {
        "pattern_id": "replay-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_effect_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_subject"
            },
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_replay",
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
              "role": "effect_state_after_first"
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
          "effect_state_before",
          "effect_state_after_first",
          "effect_state_after_replay",
          "expected_success_state",
          "first_result_state"
        ]
      }
    }
  ]
}
```

### expected_success_state

Declare expected success state for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "expected_success_state",
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "expected-success-state-conforms",
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "first-result-matches-expected-success",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "first_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "first_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
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
          "effect_state_before",
          "effect_state_after_first",
          "effect_state_after_replay",
          "expected_success_state",
          "first_result_state"
        ]
      }
    }
  ]
}
```

### first_result_state

Declare first result state for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "first_result_state",
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
        "pattern_id": "first-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "first-result-observation-records-state",
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
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result_state"
            },
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "first-result-matches-expected-success",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "first_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "first_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
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
          "effect_state_before",
          "effect_state_after_first",
          "effect_state_after_replay",
          "expected_success_state",
          "first_result_state"
        ]
      }
    }
  ]
}
```

### success_criterion

Declare success criterion for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "expected-success-state-conforms",
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

### success_verification

Declare success verification for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "success_verification",
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
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "success-verification-reads-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "first_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "first_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
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
          "success_verification",
          "first_effect_verification",
          "consumption_verification",
          "replay_refusal_verification",
          "replay_occurrence_verification",
          "replay_effect_verification"
        ]
      }
    }
  ]
}
```

### first_effect_verification

Declare first effect verification for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "first_effect_verification",
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
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "first-effect-verification-reads-states",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_effect_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_before"
            },
            {
              "kind": "reference",
              "role": "observation_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "first-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_effect_verification",
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
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_first",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_first_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
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
          "success_verification",
          "first_effect_verification",
          "consumption_verification",
          "replay_refusal_verification",
          "replay_occurrence_verification",
          "replay_effect_verification"
        ]
      }
    }
  ]
}
```

### consumption_verification

Declare consumption verification for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "consumption_verification",
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
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "consumption-verification-reads-replay",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "consumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            },
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "consumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "consumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "single_use_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_still_live_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
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
          "success_verification",
          "first_effect_verification",
          "consumption_verification",
          "replay_refusal_verification",
          "replay_occurrence_verification",
          "replay_effect_verification"
        ]
      }
    }
  ]
}
```

### replay_refusal_verification

Declare replay refusal verification for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "replay_refusal_verification",
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
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "replay-refusal-verification-reads-events",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            },
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "replay-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "replay_refusal",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "replay_accepted_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
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
          "success_verification",
          "first_effect_verification",
          "consumption_verification",
          "replay_refusal_verification",
          "replay_occurrence_verification",
          "replay_effect_verification"
        ]
      }
    }
  ]
}
```

### replay_occurrence_verification

Declare replay occurrence verification for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "replay_occurrence_verification",
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
      "ref": "/claim_patterns/35",
      "value": {
        "pattern_id": "replay-occurrence-verification-reads-events",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_occurrence_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            },
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/36",
      "value": {
        "pattern_id": "replay-occurrence-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_occurrence_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "duplicate_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
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
          "success_verification",
          "first_effect_verification",
          "consumption_verification",
          "replay_refusal_verification",
          "replay_occurrence_verification",
          "replay_effect_verification"
        ]
      }
    }
  ]
}
```

### replay_effect_verification

Declare replay effect verification for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "replay_effect_verification",
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
      "ref": "/claim_patterns/40",
      "value": {
        "pattern_id": "replay-effect-verification-reads-states",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_effect_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_first"
            },
            {
              "kind": "reference",
              "role": "observation_after_replay"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/41",
      "value": {
        "pattern_id": "replay-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_effect_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_subject"
            },
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_replay",
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
              "role": "effect_state_after_first"
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
          "success_verification",
          "first_effect_verification",
          "consumption_verification",
          "replay_refusal_verification",
          "replay_occurrence_verification",
          "replay_effect_verification"
        ]
      }
    }
  ]
}
```

### first_use_failure_condition

Declare first use failure condition for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "first_use_failure_condition",
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "first_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "first_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
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
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "first_use_failure_condition",
          "no_first_effect_condition",
          "authority_still_live_condition",
          "replay_accepted_condition",
          "duplicate_effect_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "success-verifies-first-result",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "first_use_failure_condition"
          ]
        }
      }
    }
  ]
}
```

### no_first_effect_condition

Declare no first effect condition for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "no_first_effect_condition",
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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "first-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_effect_verification",
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
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_first",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_first_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
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
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "first_use_failure_condition",
          "no_first_effect_condition",
          "authority_still_live_condition",
          "replay_accepted_condition",
          "duplicate_effect_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "first-effect-verifies-transition",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "no_first_effect_condition"
          ]
        }
      }
    }
  ]
}
```

### authority_still_live_condition

Declare authority still live condition for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authority_still_live_condition",
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
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "consumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "consumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "single_use_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_still_live_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
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
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "first_use_failure_condition",
          "no_first_effect_condition",
          "authority_still_live_condition",
          "replay_accepted_condition",
          "duplicate_effect_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "consumption-verifies-authority",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "authority_still_live_condition"
          ]
        }
      }
    }
  ]
}
```

### replay_accepted_condition

Declare replay accepted condition for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "replay_accepted_condition",
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
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "replay-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "replay_refusal",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "replay_accepted_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
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
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "first_use_failure_condition",
          "no_first_effect_condition",
          "authority_still_live_condition",
          "replay_accepted_condition",
          "duplicate_effect_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "refusal-verifies-replay",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "replay_accepted_condition"
          ]
        }
      }
    }
  ]
}
```

### duplicate_effect_condition

Declare duplicate effect condition for proof.single-use.replay-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "duplicate_effect_condition",
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
      "ref": "/claim_patterns/36",
      "value": {
        "pattern_id": "replay-occurrence-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_occurrence_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "duplicate_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
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
      "ref": "/claim_patterns/41",
      "value": {
        "pattern_id": "replay-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_effect_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_subject"
            },
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_replay",
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
              "role": "effect_state_after_first"
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
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "first_use_failure_condition",
          "no_first_effect_condition",
          "authority_still_live_condition",
          "replay_accepted_condition",
          "duplicate_effect_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "value": {
        "relation_pattern_id": "replay-occurrence-verifies-no-create",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "duplicate_effect_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/5",
      "value": {
        "relation_pattern_id": "replay-effect-verifies-stability",
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
| single_use_authority | semantic_parameter | single_use_authority |  |
| input | semantic_parameter | input |  |
| first_attempt | semantic_parameter | first_attempt |  |
| first_result | semantic_parameter | first_result |  |
| replay_attempt | semantic_parameter | replay_attempt |  |
| replay_refusal | semantic_parameter | replay_refusal |  |
| effect_subject | semantic_parameter | effect_subject |  |
| effect_occurrence_population | semantic_parameter | effect_occurrence_population |  |
| effect_occurrence | semantic_parameter | effect_occurrence |  |
| effect_state_before | semantic_parameter | effect_state_before |  |
| effect_state_after_first | semantic_parameter | effect_state_after_first |  |
| effect_state_after_replay | semantic_parameter | effect_state_after_replay |  |
| observation_before | observation_requirement |  | Acquire observation_before for the exact subject, attempt and applicability in this profile. |
| observation_after_first | observation_requirement |  | Acquire observation_after_first for the exact subject, attempt and applicability in this profile. |
| observation_after_replay | observation_requirement |  | Acquire observation_after_replay for the exact subject, attempt and applicability in this profile. |
| expected_success_state | semantic_parameter | expected_success_state |  |
| first_result_state | semantic_parameter | first_result_state |  |
| success_criterion | semantic_parameter | success_criterion |  |
| success_verification | semantic_parameter | success_verification |  |
| first_effect_verification | semantic_parameter | first_effect_verification |  |
| consumption_verification | semantic_parameter | consumption_verification |  |
| replay_refusal_verification | semantic_parameter | replay_refusal_verification |  |
| replay_occurrence_verification | semantic_parameter | replay_occurrence_verification |  |
| replay_effect_verification | semantic_parameter | replay_effect_verification |  |
| first_use_failure_condition | semantic_parameter | first_use_failure_condition |  |
| no_first_effect_condition | semantic_parameter | no_first_effect_condition |  |
| authority_still_live_condition | semantic_parameter | authority_still_live_condition |  |
| replay_accepted_condition | semantic_parameter | replay_accepted_condition |  |
| duplicate_effect_condition | semantic_parameter | duplicate_effect_condition |  |
| effect_occurrence_count | definition_constant |  |  |

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
        "/claim_patterns/23",
        "/claim_patterns/3",
        "/claim_patterns/6"
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
      "role": "single_use_authority",
      "kind": "semantic_parameter",
      "parameter": "single_use_authority",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/24",
        "/claim_patterns/26",
        "/claim_patterns/28",
        "/claim_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "single_use_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability",
          "cc:configuration"
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
      "role": "input",
      "kind": "semantic_parameter",
      "parameter": "input",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/claim_patterns/28",
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "input",
        "allowed_type_terms": [
          "cc:actor",
          "cc:artifact",
          "cc:configuration",
          "cc:entity"
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
      "role": "first_attempt",
      "kind": "semantic_parameter",
      "parameter": "first_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/13",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "first_attempt",
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
      "role": "first_result",
      "kind": "semantic_parameter",
      "parameter": "first_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/claim_patterns/34",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "first_result",
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
      "role": "replay_attempt",
      "kind": "semantic_parameter",
      "parameter": "replay_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/claim_patterns/27",
        "/claim_patterns/29",
        "/claim_patterns/30",
        "/claim_patterns/31",
        "/claim_patterns/32",
        "/claim_patterns/33",
        "/claim_patterns/34",
        "/claim_patterns/35",
        "/claim_patterns/36",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "replay_attempt",
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
      "role": "replay_refusal",
      "kind": "semantic_parameter",
      "parameter": "replay_refusal",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/29",
        "/claim_patterns/30",
        "/claim_patterns/31",
        "/claim_patterns/32",
        "/claim_patterns/33",
        "/claim_patterns/35",
        "/claim_patterns/37",
        "/claim_patterns/38",
        "/claim_patterns/39",
        "/claim_patterns/40",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "replay_refusal",
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
      "role": "effect_subject",
      "kind": "semantic_parameter",
      "parameter": "effect_subject",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/claim_patterns/21",
        "/claim_patterns/3",
        "/claim_patterns/37",
        "/claim_patterns/4",
        "/claim_patterns/41"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "effect_subject",
        "allowed_type_terms": [
          "cc:resource"
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
      "role": "effect_occurrence_population",
      "kind": "semantic_parameter",
      "parameter": "effect_occurrence_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "effect_occurrence_population",
        "allowed_type_terms": [
          "cc:population"
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
      "role": "effect_occurrence",
      "kind": "semantic_parameter",
      "parameter": "effect_occurrence",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/34",
        "/claim_patterns/36",
        "/claim_patterns/41",
        "/claim_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "effect_occurrence",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact",
          "cc:entity"
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
      "role": "effect_state_before",
      "kind": "semantic_parameter",
      "parameter": "effect_state_before",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/claim_patterns/21",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "effect_state_before",
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
      "role": "effect_state_after_first",
      "kind": "semantic_parameter",
      "parameter": "effect_state_after_first",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/21",
        "/claim_patterns/39",
        "/claim_patterns/41",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "effect_state_after_first",
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
      "role": "effect_state_after_replay",
      "kind": "semantic_parameter",
      "parameter": "effect_state_after_replay",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/37",
        "/claim_patterns/38",
        "/claim_patterns/39",
        "/claim_patterns/41",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "effect_state_after_replay",
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
      "role": "observation_before",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_before for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.single-use.replay-refusal/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_before",
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
      "role": "observation_after_first",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/16",
        "/claim_patterns/20",
        "/claim_patterns/40",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_after_first for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.single-use.replay-refusal/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_after_first",
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
      "role": "observation_after_replay",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/38",
        "/claim_patterns/40",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_after_replay for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.single-use.replay-refusal/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_after_replay",
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
      "role": "expected_success_state",
      "kind": "semantic_parameter",
      "parameter": "expected_success_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/15",
        "/claim_patterns/17",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "expected_success_state",
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
      "role": "first_result_state",
      "kind": "semantic_parameter",
      "parameter": "first_result_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/17",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "first_result_state",
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
      "role": "success_criterion",
      "kind": "semantic_parameter",
      "parameter": "success_criterion",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12"
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
      "role": "success_verification",
      "kind": "semantic_parameter",
      "parameter": "success_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "success_verification",
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
      "role": "first_effect_verification",
      "kind": "semantic_parameter",
      "parameter": "first_effect_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/claim_patterns/21",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "first_effect_verification",
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
      "role": "consumption_verification",
      "kind": "semantic_parameter",
      "parameter": "consumption_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "consumption_verification",
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
      "role": "replay_refusal_verification",
      "kind": "semantic_parameter",
      "parameter": "replay_refusal_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/32",
        "/claim_patterns/33",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "replay_refusal_verification",
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
      "role": "replay_occurrence_verification",
      "kind": "semantic_parameter",
      "parameter": "replay_occurrence_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/35",
        "/claim_patterns/36",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "replay_occurrence_verification",
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
      "role": "replay_effect_verification",
      "kind": "semantic_parameter",
      "parameter": "replay_effect_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/40",
        "/claim_patterns/41",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "replay_effect_verification",
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
      "role": "first_use_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "first_use_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/distinct_reference_role_sets/4",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "first_use_failure_condition",
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
      "role": "no_first_effect_condition",
      "kind": "semantic_parameter",
      "parameter": "no_first_effect_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/distinct_reference_role_sets/4",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "no_first_effect_condition",
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
      "role": "authority_still_live_condition",
      "kind": "semantic_parameter",
      "parameter": "authority_still_live_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/28",
        "/distinct_reference_role_sets/4",
        "/falsifier_condition_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_still_live_condition",
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
      "role": "replay_accepted_condition",
      "kind": "semantic_parameter",
      "parameter": "replay_accepted_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/33",
        "/distinct_reference_role_sets/4",
        "/falsifier_condition_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "replay_accepted_condition",
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
      "role": "duplicate_effect_condition",
      "kind": "semantic_parameter",
      "parameter": "duplicate_effect_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/36",
        "/claim_patterns/41",
        "/distinct_reference_role_sets/4",
        "/falsifier_condition_bindings/4",
        "/falsifier_condition_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "duplicate_effect_condition",
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
      "role": "effect_occurrence_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "effect_occurrence_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1,
        "maximum": 1
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "first_attempt",
          "first_result",
          "replay_attempt",
          "replay_refusal"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "effect_state_before",
          "effect_state_after_first",
          "effect_state_after_replay",
          "expected_success_state",
          "first_result_state"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "observation_before",
          "observation_after_first",
          "observation_after_replay"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "success_verification",
          "first_effect_verification",
          "consumption_verification",
          "replay_refusal_verification",
          "replay_occurrence_verification",
          "replay_effect_verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "constraint": {
        "roles": [
          "first_use_failure_condition",
          "no_first_effect_condition",
          "authority_still_live_condition",
          "replay_accepted_condition",
          "duplicate_effect_condition"
        ]
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "authority-authorizes-first-use",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "single_use_authority",
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
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "effect-population-membership",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_occurrence_population",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "effect-population-cardinality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_occurrence_population",
          "operator": "number:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "effect_occurrence_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "operation-writes-effect-subject",
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
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "effect-state-before-first-use",
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
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "observation-before-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_before",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "first-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
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
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "first-attempt-uses-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "first-attempt-uses-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "first-attempt-creates-effect",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "first-attempt-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "first-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "expected-success-state-conforms",
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
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "first-result-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "first-result-observation-records-state",
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
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result_state"
            },
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "first-result-matches-expected-success",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
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
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "success-verification-reads-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
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
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "first_result_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "first_use_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
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
        "pattern_id": "effect-state-after-first-use",
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
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "first-use-changes-effect-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_state_after_first",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "first-effect-verification-reads-states",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_effect_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_before"
            },
            {
              "kind": "reference",
              "role": "observation_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "first-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_effect_verification",
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
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_first",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_first_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_before"
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
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "first-result-precedes-replay",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_result",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "replay-performs-same-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
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
      "ref": "/claim_patterns/24",
      "constraint": {
        "pattern_id": "replay-uses-same-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "constraint": {
        "pattern_id": "replay-uses-same-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "constraint": {
        "pattern_id": "authority-consumed-after-first-use",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "single_use_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "constraint": {
        "pattern_id": "consumption-verification-reads-replay",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "consumption_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "first_result"
            },
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "constraint": {
        "pattern_id": "consumption-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "consumption_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "single_use_authority"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "single_use_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_still_live_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input"
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
      "ref": "/claim_patterns/29",
      "constraint": {
        "pattern_id": "replay-attempt-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "constraint": {
        "pattern_id": "replay-refusal-rejects-replay",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "constraint": {
        "pattern_id": "replay-is-not-accepted",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "constraint": {
        "pattern_id": "replay-refusal-verification-reads-events",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            },
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "constraint": {
        "pattern_id": "replay-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "replay_refusal",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "replay_accepted_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
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
      "ref": "/claim_patterns/34",
      "constraint": {
        "pattern_id": "replay-does-not-create-effect",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "first_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/35",
      "constraint": {
        "pattern_id": "replay-occurrence-verification-reads-events",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_occurrence_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "replay_attempt"
            },
            {
              "kind": "reference",
              "role": "replay_refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/36",
      "constraint": {
        "pattern_id": "replay-occurrence-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_occurrence_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "replay_attempt",
          "operator": "reference:creates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "duplicate_effect_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_occurrence"
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
      "ref": "/claim_patterns/37",
      "constraint": {
        "pattern_id": "effect-state-after-replay",
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
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_replay"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/38",
      "constraint": {
        "pattern_id": "observation-after-replay-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_after_replay",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_replay"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/39",
      "constraint": {
        "pattern_id": "effect-state-stable-after-replay",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "effect_state_after_replay",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_state_after_first"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/40",
      "constraint": {
        "pattern_id": "replay-effect-verification-reads-states",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_effect_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "replay_refusal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_after_first"
            },
            {
              "kind": "reference",
              "role": "observation_after_replay"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/41",
      "constraint": {
        "pattern_id": "replay-effect-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "replay_effect_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "effect_subject"
            },
            {
              "kind": "reference",
              "role": "effect_occurrence"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "effect_state_after_replay",
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
              "role": "effect_state_after_first"
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
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "success-verifies-first-result",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "first_use_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "first-effect-verifies-transition",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "no_first_effect_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "consumption-verifies-authority",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "authority_still_live_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "refusal-verifies-replay",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "replay_accepted_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "constraint": {
        "relation_pattern_id": "replay-occurrence-verifies-no-create",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "duplicate_effect_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/5",
      "constraint": {
        "relation_pattern_id": "replay-effect-verifies-stability",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "duplicate_effect_condition"
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "success-verifies-first-result",
        "role": "verifies",
        "source_claim_pattern_id": "success-verification",
        "target_claim_pattern_id": "first-result-matches-expected-success"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "first-effect-verifies-transition",
        "role": "verifies",
        "source_claim_pattern_id": "first-effect-verification",
        "target_claim_pattern_id": "first-use-changes-effect-state"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "consumption-verifies-authority",
        "role": "verifies",
        "source_claim_pattern_id": "consumption-verification",
        "target_claim_pattern_id": "authority-consumed-after-first-use"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "refusal-verifies-replay",
        "role": "verifies",
        "source_claim_pattern_id": "replay-refusal-verification",
        "target_claim_pattern_id": "replay-is-not-accepted"
      }
    },
    {
      "ref": "/relation_patterns/4",
      "constraint": {
        "pattern_id": "replay-occurrence-verifies-no-create",
        "role": "verifies",
        "source_claim_pattern_id": "replay-occurrence-verification",
        "target_claim_pattern_id": "replay-does-not-create-effect"
      }
    },
    {
      "ref": "/relation_patterns/5",
      "constraint": {
        "pattern_id": "replay-effect-verifies-stability",
        "role": "verifies",
        "source_claim_pattern_id": "replay-effect-verification",
        "target_claim_pattern_id": "effect-state-stable-after-replay"
      }
    },
    {
      "ref": "/collection_patterns/0",
      "constraint": {
        "pattern_id": "proof-sequence",
        "collection_kind": "ordered_sequence",
        "match_mode": "subsequence",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "proof_single_use_replay_refusal_sequence",
        "member_claim_pattern_ids": [
          "effect-state-before-first-use",
          "observation-before-records-state",
          "first-attempt-performs-operation",
          "first-attempt-precedes-result",
          "first-result-accepts-attempt",
          "effect-state-after-first-use",
          "first-use-changes-effect-state",
          "first-result-precedes-replay",
          "replay-performs-same-operation",
          "authority-consumed-after-first-use",
          "replay-attempt-precedes-refusal",
          "replay-refusal-rejects-replay",
          "replay-is-not-accepted",
          "effect-state-after-replay",
          "effect-state-stable-after-replay"
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
        "collection_purpose": "proof_single_use_replay_refusal_population",
        "member_claim_pattern_ids": [
          "authority-authorizes-first-use",
          "effect-population-membership",
          "effect-population-cardinality",
          "operation-writes-effect-subject",
          "effect-state-before-first-use",
          "observation-before-records-state",
          "first-attempt-performs-operation",
          "first-attempt-uses-authority",
          "first-attempt-uses-input",
          "first-attempt-creates-effect",
          "first-attempt-precedes-result",
          "first-result-accepts-attempt",
          "expected-success-state-conforms",
          "first-result-has-state",
          "first-result-observation-records-state",
          "first-result-matches-expected-success",
          "success-verification-reads-result",
          "success-verification",
          "effect-state-after-first-use",
          "first-use-changes-effect-state",
          "first-effect-verification-reads-states",
          "first-effect-verification",
          "first-result-precedes-replay",
          "replay-performs-same-operation",
          "replay-uses-same-authority",
          "replay-uses-same-input",
          "authority-consumed-after-first-use",
          "consumption-verification-reads-replay",
          "consumption-verification",
          "replay-attempt-precedes-refusal",
          "replay-refusal-rejects-replay",
          "replay-is-not-accepted",
          "replay-refusal-verification-reads-events",
          "replay-refusal-verification",
          "replay-does-not-create-effect",
          "replay-occurrence-verification-reads-events",
          "replay-occurrence-verification",
          "effect-state-after-replay",
          "observation-after-replay-records-state",
          "effect-state-stable-after-replay",
          "replay-effect-verification-reads-states",
          "replay-effect-verification"
        ]
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "authority-authorizes-first-use"
          },
          {
            "pattern": "effect-population-membership"
          },
          {
            "pattern": "effect-population-cardinality"
          },
          {
            "pattern": "operation-writes-effect-subject"
          },
          {
            "pattern": "effect-state-before-first-use"
          },
          {
            "pattern": "observation-before-records-state"
          },
          {
            "pattern": "first-attempt-performs-operation"
          },
          {
            "pattern": "first-attempt-uses-authority"
          },
          {
            "pattern": "first-attempt-uses-input"
          },
          {
            "pattern": "first-attempt-creates-effect"
          },
          {
            "pattern": "first-attempt-precedes-result"
          },
          {
            "pattern": "first-result-accepts-attempt"
          },
          {
            "pattern": "expected-success-state-conforms"
          },
          {
            "pattern": "first-result-has-state"
          },
          {
            "pattern": "first-result-observation-records-state"
          },
          {
            "pattern": "first-result-matches-expected-success"
          },
          {
            "pattern": "success-verification-reads-result"
          },
          {
            "pattern": "success-verification"
          },
          {
            "pattern": "effect-state-after-first-use"
          },
          {
            "pattern": "first-use-changes-effect-state"
          },
          {
            "pattern": "first-effect-verification-reads-states"
          },
          {
            "pattern": "first-effect-verification"
          },
          {
            "pattern": "first-result-precedes-replay"
          },
          {
            "pattern": "replay-performs-same-operation"
          },
          {
            "pattern": "replay-uses-same-authority"
          },
          {
            "pattern": "replay-uses-same-input"
          },
          {
            "pattern": "authority-consumed-after-first-use"
          },
          {
            "pattern": "consumption-verification-reads-replay"
          },
          {
            "pattern": "consumption-verification"
          },
          {
            "pattern": "replay-attempt-precedes-refusal"
          },
          {
            "pattern": "replay-refusal-rejects-replay"
          },
          {
            "pattern": "replay-is-not-accepted"
          },
          {
            "pattern": "replay-refusal-verification-reads-events"
          },
          {
            "pattern": "replay-refusal-verification"
          },
          {
            "pattern": "replay-does-not-create-effect"
          },
          {
            "pattern": "replay-occurrence-verification-reads-events"
          },
          {
            "pattern": "replay-occurrence-verification"
          },
          {
            "pattern": "effect-state-after-replay"
          },
          {
            "pattern": "observation-after-replay-records-state"
          },
          {
            "pattern": "effect-state-stable-after-replay"
          },
          {
            "pattern": "replay-effect-verification-reads-states"
          },
          {
            "pattern": "replay-effect-verification"
          },
          {
            "pattern": "success-verifies-first-result"
          },
          {
            "pattern": "first-effect-verifies-transition"
          },
          {
            "pattern": "consumption-verifies-authority"
          },
          {
            "pattern": "refusal-verifies-replay"
          },
          {
            "pattern": "replay-occurrence-verifies-no-create"
          },
          {
            "pattern": "replay-effect-verifies-stability"
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
      "single_use_authority",
      "input",
      "first_attempt",
      "first_result",
      "replay_attempt",
      "replay_refusal",
      "effect_subject",
      "effect_occurrence_population",
      "effect_occurrence",
      "effect_state_before",
      "effect_state_after_first",
      "effect_state_after_replay",
      "expected_success_state",
      "first_result_state",
      "success_criterion",
      "success_verification",
      "first_effect_verification",
      "consumption_verification",
      "replay_refusal_verification",
      "replay_occurrence_verification",
      "replay_effect_verification",
      "first_use_failure_condition",
      "no_first_effect_condition",
      "authority_still_live_condition",
      "replay_accepted_condition",
      "duplicate_effect_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "observation_before",
      "observation_after_first",
      "observation_after_replay"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.single-use.replay-refusal.",
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
        "missing": "No named proof.single-use.replay-refusal constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.single-use.replay-refusal.",
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
