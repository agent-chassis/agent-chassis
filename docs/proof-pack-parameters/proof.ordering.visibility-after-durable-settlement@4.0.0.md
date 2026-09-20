# proof.ordering.visibility-after-durable-settlement@4.0.0

<!-- Generated from validated package metadata. -->

For one caller-declared effect population, declared success or visibility cannot precede durable settlement of every declared effect; failure visibility is empty, and a selected post-visibility observation of that declared population equals the caller-declared expected durable state.

Profile digest: ff03e0a4dce59b8ecdf7b811f5f383b3fbe3380509c8e3aa7e46df823c750cbd. Parameter digest: 9c9c1c3f9da41ba163f7d9201a34f25932b23b8b90419b3228bfff12807d1fc0.

Admission digest: 1a1cb92007446fce2e2062c2443f1b9069caa1c8e751f2830393b5ee0078ab8b.

Roles: 26/26 accounted; 3 owned gaps. Semantic parameters: 21; internal roles: 5.

## Guarantee and exclusions

For one caller-declared effect population, declared success or visibility cannot precede durable settlement of every declared effect; failure visibility is empty, and a selected post-visibility observation of that declared population equals the caller-declared expected durable state.

- dishonest-grounding-or-self-authored-evidence
- eventual-visibility-liveness
- heterogeneous-arbitrary-effect-to-state-pairing
- runtime-clock-or-event-order-truth
- runtime-identity-or-population-truth
- runtime-state-or-observation-truth

## Parameters

### durable_effect_population

Declare durable effect population for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/0",
      "value": {
        "role": "durable_effect_population",
        "allowed_type_terms": [
          "cc:population"
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
        "pattern_id": "durable-effects-within-settled-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "durable_effect_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "settled-effects-within-durable-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_effect_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "durable-settlement-completeness-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "durable_effect_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "durable_not_settled_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "settlement-population-exactness-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "settled_effect_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settled_not_durable_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "expected-state-complete-against-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_durable_state",
          "operator": "reference:complete_against",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "post-observation-reads-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "durable_effect_population",
          "settled_effect_population",
          "allowed_settled_state_population",
          "failure_visibility_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-durable-effect-population",
        "comparison": "complete_population",
        "roles": [
          "durable_effect_population",
          "durable_effects"
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

### durable_effects

Declare durable effects for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/1",
      "value": {
        "role": "durable_effects",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-durable-effect-population",
        "comparison": "complete_population",
        "roles": [
          "durable_effect_population",
          "durable_effects"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "value": {
        "reference_role": "durable_effects",
        "number_role": "effect_count"
      }
    }
  ]
}
```

### settled_effect_population

Declare settled effect population for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/2",
      "value": {
        "role": "settled_effect_population",
        "allowed_type_terms": [
          "cc:population"
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
        "pattern_id": "durable-effects-within-settled-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "durable_effect_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "settled-effects-within-durable-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_effect_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "durable-settlement-completeness-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "durable_effect_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "durable_not_settled_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "settlement-population-exactness-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "settled_effect_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settled_not_durable_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "durable_effect_population",
          "settled_effect_population",
          "allowed_settled_state_population",
          "failure_visibility_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-settled-effect-population",
        "comparison": "complete_population",
        "roles": [
          "settled_effect_population",
          "settled_effects"
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

### settled_effects

Declare settled effects for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "settled_effects",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-settled-effect-has-selected-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "settled_effects",
          "member_role": "settled_effect"
        },
        "proposition_template": {
          "subject_role": "settled_effect",
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
              "role": "selected_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-settled-effect-population",
        "comparison": "complete_population",
        "roles": [
          "settled_effect_population",
          "settled_effects"
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
        "reference_role": "settled_effects",
        "number_role": "effect_count"
      }
    }
  ]
}
```

### allowed_settled_state_population

Declare allowed settled state population for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/4",
      "value": {
        "role": "allowed_settled_state_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "settled-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "selected_settled_state"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "selected_settled_state",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "disallowed_settled_state_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "selected-settled-state-allowed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "selected_settled_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "durable_effect_population",
          "settled_effect_population",
          "allowed_settled_state_population",
          "failure_visibility_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-allowed-settled-state-population",
        "comparison": "complete_population",
        "roles": [
          "allowed_settled_state_population",
          "allowed_settled_states"
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

### allowed_settled_states

Declare allowed settled states for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/5",
      "value": {
        "role": "allowed_settled_states",
        "allowed_type_terms": [
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
        "pattern_id": "complete-allowed-settled-state-population",
        "comparison": "complete_population",
        "roles": [
          "allowed_settled_state_population",
          "allowed_settled_states"
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

### selected_settled_state

Declare selected settled state for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "selected_settled_state",
        "allowed_type_terms": [
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "settled-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "selected_settled_state"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "selected_settled_state",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "disallowed_settled_state_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "selected-settled-state-allowed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "selected_settled_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-settled-effect-has-selected-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "settled_effects",
          "member_role": "settled_effect"
        },
        "proposition_template": {
          "subject_role": "settled_effect",
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
              "role": "selected_settled_state"
            }
          ]
        }
      }
    }
  ]
}
```

### settlement_event

Declare settlement event for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "settlement_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
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
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "visibility-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "visibility_event"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "visibility_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_visibility_condition"
            ]
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
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-settled-effect-has-selected-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "settled_effects",
          "member_role": "settled_effect"
        },
        "proposition_template": {
          "subject_role": "settled_effect",
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
              "role": "selected_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "visibility-does-not-precede-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "visibility_event",
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
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "settlement_event",
          "visibility_event",
          "failure_event",
          "post_visibility_observation",
          "verification"
        ]
      }
    }
  ]
}
```

### visibility_event

Declare visibility event for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "visibility_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
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
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "visibility-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "visibility_event"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "visibility_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_visibility_condition"
            ]
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "observation-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "post_visibility_observation"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_observation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "visibility_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "visibility-does-not-precede-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "visibility_event",
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
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "post-observation-does-not-precede-visibility",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "visibility_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "settlement_event",
          "visibility_event",
          "failure_event",
          "post_visibility_observation",
          "verification"
        ]
      }
    }
  ]
}
```

### post_visibility_observation

Declare post visibility observation for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "post_visibility_observation",
        "allowed_type_terms": [
          "cc:evidence",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "observation-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "post_visibility_observation"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_observation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "visibility_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "post-observation-does-not-precede-visibility",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "visibility_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "post-observation-reads-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "post-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_durable_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "settlement_event",
          "visibility_event",
          "failure_event",
          "post_visibility_observation",
          "verification"
        ]
      }
    }
  ]
}
```

### expected_durable_state

Declare expected durable state for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "expected_durable_state",
        "allowed_type_terms": [
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "post-visibility-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_durable_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_observation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_durable_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "expected-state-complete-against-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_durable_state",
          "operator": "reference:complete_against",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "post-visibility-state-current",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_durable_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_durable_state"
            }
          ]
        }
      }
    }
  ]
}
```

### observed_durable_state

Declare observed durable state for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "observed_durable_state",
        "allowed_type_terms": [
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "post-visibility-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_durable_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_observation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_durable_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "post-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_durable_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "post-visibility-state-current",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_durable_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_durable_state"
            }
          ]
        }
      }
    }
  ]
}
```

### failure_event

Declare failure event for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failure_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
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
        "pattern_id": "failure-branch-declares-visibility-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_event",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "settlement_event",
          "visibility_event",
          "failure_event",
          "post_visibility_observation",
          "verification"
        ]
      }
    }
  ]
}
```

### failure_visibility_population

Declare failure visibility population for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failure_visibility_population",
        "allowed_type_terms": [
          "cc:population"
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
        "pattern_id": "failure-branch-declares-visibility-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_event",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "failure-visibility-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "failure_visibility_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "failure_visibility_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "zero_visibility_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "durable_effect_population",
          "settled_effect_population",
          "allowed_settled_state_population",
          "failure_visibility_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-failure-visibility-population",
        "comparison": "complete_population",
        "roles": [
          "failure_visibility_population",
          "failure_visibility_events"
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

### failure_visibility_events

Declare failure visibility events for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failure_visibility_events",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "zero_or_more",
        "allowed_identity_kinds": [
          "code_symbol",
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
        "pattern_id": "complete-failure-visibility-population",
        "comparison": "complete_population",
        "roles": [
          "failure_visibility_population",
          "failure_visibility_events"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "value": {
        "reference_role": "failure_visibility_events",
        "number_role": "zero_visibility_count"
      }
    }
  ]
}
```

### verification

Declare verification for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "durable-settlement-completeness-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "durable_effect_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "durable_not_settled_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "settlement-population-exactness-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "settled_effect_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settled_not_durable_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "settled-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "selected_settled_state"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "selected_settled_state",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "disallowed_settled_state_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "visibility-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "visibility_event"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "visibility_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_visibility_condition"
            ]
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "observation-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "post_visibility_observation"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_observation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "visibility_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "post-visibility-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_durable_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_observation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_durable_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "failure-visibility-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "failure_visibility_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "failure_visibility_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "zero_visibility_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "settlement_event",
          "visibility_event",
          "failure_event",
          "post_visibility_observation",
          "verification"
        ]
      }
    }
  ]
}
```

### durable_not_settled_condition

Declare durable not settled condition for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "durable_not_settled_condition",
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
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "durable-settlement-completeness-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "durable_effect_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "durable_not_settled_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "durable_not_settled_condition",
          "settled_not_durable_condition",
          "disallowed_settled_state_condition",
          "premature_visibility_condition",
          "premature_observation_condition",
          "stale_observation_condition",
          "failure_visibility_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-durable-settlement-completeness",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "durable_not_settled_condition"
          ]
        }
      }
    }
  ]
}
```

### settled_not_durable_condition

Declare settled not durable condition for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "settled_not_durable_condition",
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
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "settlement-population-exactness-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "settled_effect_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settled_not_durable_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "durable_not_settled_condition",
          "settled_not_durable_condition",
          "disallowed_settled_state_condition",
          "premature_visibility_condition",
          "premature_observation_condition",
          "stale_observation_condition",
          "failure_visibility_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-targets-settlement-population-exactness",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "settled_not_durable_condition"
          ]
        }
      }
    }
  ]
}
```

### disallowed_settled_state_condition

Declare disallowed settled state condition for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "disallowed_settled_state_condition",
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "settled-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "selected_settled_state"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "selected_settled_state",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "disallowed_settled_state_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "durable_not_settled_condition",
          "settled_not_durable_condition",
          "disallowed_settled_state_condition",
          "premature_visibility_condition",
          "premature_observation_condition",
          "stale_observation_condition",
          "failure_visibility_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "verification-targets-settled-state",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "disallowed_settled_state_condition"
          ]
        }
      }
    }
  ]
}
```

### premature_visibility_condition

Declare premature visibility condition for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "premature_visibility_condition",
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
        "pattern_id": "visibility-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "visibility_event"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "visibility_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_visibility_condition"
            ]
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
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "durable_not_settled_condition",
          "settled_not_durable_condition",
          "disallowed_settled_state_condition",
          "premature_visibility_condition",
          "premature_observation_condition",
          "stale_observation_condition",
          "failure_visibility_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "verification-targets-visibility-order",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "premature_visibility_condition"
          ]
        }
      }
    }
  ]
}
```

### failure_visibility_condition

Declare failure visibility condition for proof.ordering.visibility-after-durable-settlement. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "failure_visibility_condition",
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
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "failure-visibility-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "failure_visibility_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "failure_visibility_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "zero_visibility_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "durable_not_settled_condition",
          "settled_not_durable_condition",
          "disallowed_settled_state_condition",
          "premature_visibility_condition",
          "premature_observation_condition",
          "stale_observation_condition",
          "failure_visibility_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/6",
      "value": {
        "relation_pattern_id": "verification-targets-failure-visibility",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "failure_visibility_condition"
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
| durable_effect_population | semantic_parameter | durable_effect_population |  |
| durable_effects | semantic_parameter | durable_effects |  |
| settled_effect_population | semantic_parameter | settled_effect_population |  |
| settled_effects | semantic_parameter | settled_effects |  |
| allowed_settled_state_population | semantic_parameter | allowed_settled_state_population |  |
| allowed_settled_states | semantic_parameter | allowed_settled_states |  |
| selected_settled_state | semantic_parameter | selected_settled_state |  |
| settlement_event | semantic_parameter | settlement_event |  |
| visibility_event | semantic_parameter | visibility_event |  |
| post_visibility_observation | semantic_parameter | post_visibility_observation |  |
| expected_durable_state | semantic_parameter | expected_durable_state |  |
| observed_durable_state | semantic_parameter | observed_durable_state |  |
| failure_event | semantic_parameter | failure_event |  |
| failure_visibility_population | semantic_parameter | failure_visibility_population |  |
| failure_visibility_events | semantic_parameter | failure_visibility_events |  |
| failure_visibility_count_signal | observation_requirement |  | Acquire failure_visibility_count_signal for the exact subject, attempt and applicability in this profile. |
| verification | semantic_parameter | verification |  |
| durable_not_settled_condition | semantic_parameter | durable_not_settled_condition |  |
| settled_not_durable_condition | semantic_parameter | settled_not_durable_condition |  |
| disallowed_settled_state_condition | semantic_parameter | disallowed_settled_state_condition |  |
| premature_visibility_condition | semantic_parameter | premature_visibility_condition |  |
| premature_observation_condition | observation_requirement |  | Acquire premature_observation_condition for the exact subject, attempt and applicability in this profile. |
| stale_observation_condition | observation_requirement |  | Acquire stale_observation_condition for the exact subject, attempt and applicability in this profile. |
| failure_visibility_condition | semantic_parameter | failure_visibility_condition |  |
| effect_count | complete_population_count | durable_effects, settled_effects |  |
| zero_visibility_count | definition_constant |  |  |

```json
{
  "roles": [
    {
      "role": "durable_effect_population",
      "kind": "semantic_parameter",
      "parameter": "durable_effect_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "durable_effect_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "durable_effects",
      "kind": "semantic_parameter",
      "parameter": "durable_effects",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "durable_effects",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "settled_effect_population",
      "kind": "semantic_parameter",
      "parameter": "settled_effect_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "settled_effect_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "settled_effects",
      "kind": "semantic_parameter",
      "parameter": "settled_effects",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "settled_effects",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "allowed_settled_state_population",
      "kind": "semantic_parameter",
      "parameter": "allowed_settled_state_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/15",
        "/claim_patterns/2",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_settled_state_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "allowed_settled_states",
      "kind": "semantic_parameter",
      "parameter": "allowed_settled_states",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_settled_states",
        "allowed_type_terms": [
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
      "role": "selected_settled_state",
      "kind": "semantic_parameter",
      "parameter": "selected_settled_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/15",
        "/claim_patterns/2",
        "/claim_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "selected_settled_state",
        "allowed_type_terms": [
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
      "role": "settlement_event",
      "kind": "semantic_parameter",
      "parameter": "settlement_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/16",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/distinct_reference_role_sets/1"
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
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "visibility_event",
      "kind": "semantic_parameter",
      "parameter": "visibility_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "visibility_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "post_visibility_observation",
      "kind": "semantic_parameter",
      "parameter": "post_visibility_observation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/17",
        "/claim_patterns/5",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "post_visibility_observation",
        "allowed_type_terms": [
          "cc:evidence",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "expected_durable_state",
      "kind": "semantic_parameter",
      "parameter": "expected_durable_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/18",
        "/claim_patterns/6",
        "/claim_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "expected_durable_state",
        "allowed_type_terms": [
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
      "role": "observed_durable_state",
      "kind": "semantic_parameter",
      "parameter": "observed_durable_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/18",
        "/claim_patterns/8",
        "/claim_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_durable_state",
        "allowed_type_terms": [
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
      "role": "failure_event",
      "kind": "semantic_parameter",
      "parameter": "failure_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/12",
        "/distinct_reference_role_sets/1"
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
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "failure_visibility_population",
      "kind": "semantic_parameter",
      "parameter": "failure_visibility_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/12",
        "/claim_patterns/19",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_visibility_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "failure_visibility_events",
      "kind": "semantic_parameter",
      "parameter": "failure_visibility_events",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_visibility_events",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "zero_or_more",
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "failure_visibility_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/19"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire failure_visibility_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ordering.visibility-after-durable-settlement/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "failure_visibility_count_signal",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "verification",
      "kind": "semantic_parameter",
      "parameter": "verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path"
        ]
      }
    },
    {
      "role": "durable_not_settled_condition",
      "kind": "semantic_parameter",
      "parameter": "durable_not_settled_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "durable_not_settled_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "settled_not_durable_condition",
      "kind": "semantic_parameter",
      "parameter": "settled_not_durable_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "settled_not_durable_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "disallowed_settled_state_condition",
      "kind": "semantic_parameter",
      "parameter": "disallowed_settled_state_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "disallowed_settled_state_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "premature_visibility_condition",
      "kind": "semantic_parameter",
      "parameter": "premature_visibility_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "premature_visibility_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "premature_observation_condition",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/4"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire premature_observation_condition for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ordering.visibility-after-durable-settlement/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "premature_observation_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "stale_observation_condition",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/5"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire stale_observation_condition for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ordering.visibility-after-durable-settlement/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "stale_observation_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "failure_visibility_condition",
      "kind": "semantic_parameter",
      "parameter": "failure_visibility_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "failure_visibility_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "effect_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "durable_effects",
        "settled_effects"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/0",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "effect_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "zero_visibility_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/19",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "zero_visibility_count",
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
          "durable_effect_population",
          "settled_effect_population",
          "allowed_settled_state_population",
          "failure_visibility_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "settlement_event",
          "visibility_event",
          "failure_event",
          "post_visibility_observation",
          "verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "durable_not_settled_condition",
          "settled_not_durable_condition",
          "disallowed_settled_state_condition",
          "premature_visibility_condition",
          "premature_observation_condition",
          "stale_observation_condition",
          "failure_visibility_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-durable-effect-population",
        "comparison": "complete_population",
        "roles": [
          "durable_effect_population",
          "durable_effects"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "constraint": {
        "pattern_id": "complete-settled-effect-population",
        "comparison": "complete_population",
        "roles": [
          "settled_effect_population",
          "settled_effects"
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
        "pattern_id": "complete-allowed-settled-state-population",
        "comparison": "complete_population",
        "roles": [
          "allowed_settled_state_population",
          "allowed_settled_states"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "constraint": {
        "pattern_id": "complete-failure-visibility-population",
        "comparison": "complete_population",
        "roles": [
          "failure_visibility_population",
          "failure_visibility_events"
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
        "reference_role": "durable_effects",
        "number_role": "effect_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "settled_effects",
        "number_role": "effect_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "failure_visibility_events",
        "number_role": "zero_visibility_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "durable-effects-within-settled-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "durable_effect_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "settled-effects-within-durable-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "settled_effect_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "selected-settled-state-allowed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "selected_settled_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "each-settled-effect-has-selected-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "settled_effects",
          "member_role": "settled_effect"
        },
        "proposition_template": {
          "subject_role": "settled_effect",
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
              "role": "selected_settled_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "visibility-does-not-precede-settlement",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "visibility_event",
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
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "post-observation-does-not-precede-visibility",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "visibility_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "expected-state-complete-against-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_durable_state",
          "operator": "reference:complete_against",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "post-observation-reads-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "post-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_durable_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "post-visibility-state-current",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_durable_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_durable_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "failure-branch-declares-visibility-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_event",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "failure-visibility-population-empty",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "failure_visibility_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "zero_visibility_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "verification-reads-complete-proof",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            },
            {
              "kind": "reference",
              "role": "selected_settled_state"
            },
            {
              "kind": "reference",
              "role": "settlement_event"
            },
            {
              "kind": "reference",
              "role": "visibility_event"
            },
            {
              "kind": "reference",
              "role": "post_visibility_observation"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            },
            {
              "kind": "reference",
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "failure_event"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "durable-settlement-completeness-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "durable_effect_population"
            },
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "durable_effect_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "durable_not_settled_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "settled_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "settlement-population-exactness-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "settled_effect_population"
            },
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "settled_effect_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "settled_not_durable_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "durable_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "settled-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "selected_settled_state"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "selected_settled_state",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "disallowed_settled_state_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_settled_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "visibility-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "visibility_event"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "visibility_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_visibility_condition"
            ]
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
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "observation-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "post_visibility_observation"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "post_visibility_observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_observation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "visibility_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "post-visibility-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "observed_durable_state"
            },
            {
              "kind": "reference",
              "role": "expected_durable_state"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_durable_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_observation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_durable_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "failure-visibility-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
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
              "role": "failure_visibility_population"
            },
            {
              "kind": "reference",
              "role": "failure_visibility_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "failure_visibility_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "failure_visibility_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "zero_visibility_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-durable-settlement-completeness",
        "role": "verifies",
        "source_claim_pattern_id": "durable-settlement-completeness-verification",
        "target_claim_pattern_id": "durable-effects-within-settled-effects"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-targets-settlement-population-exactness",
        "role": "verifies",
        "source_claim_pattern_id": "settlement-population-exactness-verification",
        "target_claim_pattern_id": "settled-effects-within-durable-effects"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "verification-targets-settled-state",
        "role": "verifies",
        "source_claim_pattern_id": "settled-state-verification",
        "target_claim_pattern_id": "selected-settled-state-allowed"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "verification-targets-visibility-order",
        "role": "verifies",
        "source_claim_pattern_id": "visibility-order-verification",
        "target_claim_pattern_id": "visibility-does-not-precede-settlement"
      }
    },
    {
      "ref": "/relation_patterns/4",
      "constraint": {
        "pattern_id": "verification-targets-observation-order",
        "role": "verifies",
        "source_claim_pattern_id": "observation-order-verification",
        "target_claim_pattern_id": "post-observation-does-not-precede-visibility"
      }
    },
    {
      "ref": "/relation_patterns/5",
      "constraint": {
        "pattern_id": "verification-targets-post-visibility-state",
        "role": "verifies",
        "source_claim_pattern_id": "post-visibility-state-verification",
        "target_claim_pattern_id": "post-visibility-state-current"
      }
    },
    {
      "ref": "/relation_patterns/6",
      "constraint": {
        "pattern_id": "verification-targets-failure-visibility",
        "role": "verifies",
        "source_claim_pattern_id": "failure-visibility-verification",
        "target_claim_pattern_id": "failure-visibility-population-empty"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-durable-settlement-completeness",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "durable_not_settled_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-targets-settlement-population-exactness",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "settled_not_durable_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "verification-targets-settled-state",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "disallowed_settled_state_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "verification-targets-visibility-order",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "premature_visibility_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "constraint": {
        "relation_pattern_id": "verification-targets-observation-order",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "premature_observation_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/5",
      "constraint": {
        "relation_pattern_id": "verification-targets-post-visibility-state",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_observation_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/6",
      "constraint": {
        "relation_pattern_id": "verification-targets-failure-visibility",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "failure_visibility_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-durable-effect-population"
          },
          {
            "pattern": "complete-settled-effect-population"
          },
          {
            "pattern": "complete-allowed-settled-state-population"
          },
          {
            "pattern": "complete-failure-visibility-population"
          },
          {
            "pattern": "durable-effects-within-settled-effects"
          },
          {
            "pattern": "settled-effects-within-durable-effects"
          },
          {
            "pattern": "selected-settled-state-allowed"
          },
          {
            "pattern": "each-settled-effect-has-selected-state"
          },
          {
            "pattern": "visibility-does-not-precede-settlement"
          },
          {
            "pattern": "post-observation-does-not-precede-visibility"
          },
          {
            "pattern": "expected-state-complete-against-effects"
          },
          {
            "pattern": "post-observation-reads-effects"
          },
          {
            "pattern": "post-observation-records-state"
          },
          {
            "pattern": "post-visibility-state-current"
          },
          {
            "pattern": "failure-branch-declares-visibility-population"
          },
          {
            "pattern": "failure-visibility-population-empty"
          },
          {
            "pattern": "verification-reads-complete-proof"
          },
          {
            "pattern": "durable-settlement-completeness-verification"
          },
          {
            "pattern": "settlement-population-exactness-verification"
          },
          {
            "pattern": "settled-state-verification"
          },
          {
            "pattern": "visibility-order-verification"
          },
          {
            "pattern": "observation-order-verification"
          },
          {
            "pattern": "post-visibility-state-verification"
          },
          {
            "pattern": "failure-visibility-verification"
          },
          {
            "pattern": "verification-targets-durable-settlement-completeness"
          },
          {
            "pattern": "verification-targets-settlement-population-exactness"
          },
          {
            "pattern": "verification-targets-settled-state"
          },
          {
            "pattern": "verification-targets-visibility-order"
          },
          {
            "pattern": "verification-targets-observation-order"
          },
          {
            "pattern": "verification-targets-post-visibility-state"
          },
          {
            "pattern": "verification-targets-failure-visibility"
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
      "durable_effect_population",
      "durable_effects",
      "settled_effect_population",
      "settled_effects",
      "allowed_settled_state_population",
      "allowed_settled_states",
      "selected_settled_state",
      "settlement_event",
      "visibility_event",
      "post_visibility_observation",
      "expected_durable_state",
      "observed_durable_state",
      "failure_event",
      "failure_visibility_population",
      "failure_visibility_events",
      "verification",
      "durable_not_settled_condition",
      "settled_not_durable_condition",
      "disallowed_settled_state_condition",
      "premature_visibility_condition",
      "failure_visibility_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "failure_visibility_count_signal",
      "premature_observation_condition",
      "stale_observation_condition"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.ordering.visibility-after-durable-settlement.",
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
        "missing": "No named proof.ordering.visibility-after-durable-settlement constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.ordering.visibility-after-durable-settlement.",
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
