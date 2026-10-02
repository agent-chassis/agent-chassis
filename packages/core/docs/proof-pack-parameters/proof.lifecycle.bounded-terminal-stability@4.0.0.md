# proof.lifecycle.bounded-terminal-stability@4.0.0

<!-- Generated from validated package metadata. -->

For one declared lifecycle entity, terminal event, terminal state, and explicit bounded horizon, one complete nonempty horizon-scoped observation population records the terminal state for every observation after the terminal event and before the horizon; complete singleton observed-state and terminal-state populations are equal; and one complete in-horizon reactivation-event population has exact cardinality zero.

Profile digest: 70ca1add63597016b58367ac8f033c0ede96262036d77914c3cdf6f4427974a2. Parameter digest: 3fabdc9f96a31999d759c43359b0448d81b445f01c82770b12ce4cedfd110d74.

Admission digest: 2f3532d3f341abf512e3c0512bb25646158f12a9f53498bfb65c791d9ddeb115.

Roles: 19/19 accounted; 3 owned gaps. Semantic parameters: 13; internal roles: 6.

## Guarantee and exclusions

For one declared lifecycle entity, terminal event, terminal state, and explicit bounded horizon, one complete nonempty horizon-scoped observation population records the terminal state for every observation after the terminal event and before the horizon; complete singleton observed-state and terminal-state populations are equal; and one complete in-horizon reactivation-event population has exact cardinality zero.

- delivered-evidence-authenticity-or-plan-implementation
- dishonest-identity-population-state-event-observation-and-horizon-grounding
- forever-after-stability
- observations-events-actors-and-resources-outside-declared-populations
- post-horizon-behavior
- real-time-truth-or-clock-accuracy
- transient-state-changes-between-elected-observations

## Parameters

### lifecycle_entity

Declare lifecycle entity for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "lifecycle_entity",
        "allowed_type_terms": [
          "cc:lifecycle_entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
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
        "pattern_id": "terminal-event-completes-entity",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_event",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "lifecycle_entity"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "each-observation-reads-entity",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "lifecycle_entity"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verification-reads-bounded-window",
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
              "role": "lifecycle_entity"
            },
            {
              "kind": "reference",
              "role": "terminal_event"
            },
            {
              "kind": "reference",
              "role": "terminal_state"
            },
            {
              "kind": "reference",
              "role": "bounded_horizon"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "reactivation_population"
            }
          ]
        }
      }
    }
  ]
}
```

### terminal_event

Declare terminal event for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "terminal_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
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
        "pattern_id": "terminal-event-completes-entity",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_event",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "lifecycle_entity"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "terminal-event-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_event",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "terminal-before-each-observation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "terminal_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verification-reads-bounded-window",
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
              "role": "lifecycle_entity"
            },
            {
              "kind": "reference",
              "role": "terminal_event"
            },
            {
              "kind": "reference",
              "role": "terminal_state"
            },
            {
              "kind": "reference",
              "role": "bounded_horizon"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "reactivation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "terminal_event",
          "bounded_horizon"
        ]
      }
    }
  ]
}
```

### terminal_state

Declare terminal state for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "terminal_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
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
        "pattern_id": "terminal-event-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_event",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "terminal-state-in-terminal-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "each-observation-records-terminal-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verification-reads-bounded-window",
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
              "role": "lifecycle_entity"
            },
            {
              "kind": "reference",
              "role": "terminal_event"
            },
            {
              "kind": "reference",
              "role": "terminal_state"
            },
            {
              "kind": "reference",
              "role": "bounded_horizon"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "reactivation_population"
            }
          ]
        }
      }
    }
  ]
}
```

### bounded_horizon

Declare bounded horizon for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "bounded_horizon",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-observation-before-horizon",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "bounded_horizon"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verification-reads-bounded-window",
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
              "role": "lifecycle_entity"
            },
            {
              "kind": "reference",
              "role": "terminal_event"
            },
            {
              "kind": "reference",
              "role": "terminal_state"
            },
            {
              "kind": "reference",
              "role": "bounded_horizon"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "reactivation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "terminal_event",
          "bounded_horizon"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-observation-population",
        "comparison": "complete_population",
        "roles": [
          "observation_population",
          "observations"
        ],
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "bounded_horizon"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-reactivation-population",
        "comparison": "complete_population",
        "roles": [
          "reactivation_population",
          "reactivation_events"
        ],
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "bounded_horizon"
          ]
        }
      }
    }
  ]
}
```

### terminal_state_population

Declare terminal state population for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/6",
      "value": {
        "role": "terminal_state_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
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
        "pattern_id": "verify-bounded-state-stability",
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
              "role": "observation_population"
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
          "subject_role": "observed_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_regression_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "terminal-state-in-terminal-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "observed-states-equal-terminal-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_state_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-terminal-state-population",
        "comparison": "complete_population",
        "roles": [
          "terminal_state_population",
          "terminal_states"
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

### terminal_states

Declare terminal states for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "terminal_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-terminal-state-population",
        "comparison": "complete_population",
        "roles": [
          "terminal_state_population",
          "terminal_states"
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
        "reference_role": "terminal_states",
        "number_role": "state_count"
      }
    }
  ]
}
```

### observed_state_population

Declare observed state population for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "observed_state_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
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
        "pattern_id": "verify-bounded-state-stability",
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
              "role": "observation_population"
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
          "subject_role": "observed_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_regression_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "observed-states-equal-terminal-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_state_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verification-reads-bounded-window",
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
              "role": "lifecycle_entity"
            },
            {
              "kind": "reference",
              "role": "terminal_event"
            },
            {
              "kind": "reference",
              "role": "terminal_state"
            },
            {
              "kind": "reference",
              "role": "bounded_horizon"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "reactivation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-observed-state-population",
        "comparison": "complete_population",
        "roles": [
          "observed_state_population",
          "observed_states"
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

### observed_states

Declare observed states for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "observed_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-observed-state-population",
        "comparison": "complete_population",
        "roles": [
          "observed_state_population",
          "observed_states"
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
        "reference_role": "observed_states",
        "number_role": "state_count"
      }
    }
  ]
}
```

### reactivation_population

Declare reactivation population for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "reactivation_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verify-zero-reactivation",
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
              "role": "reactivation_population"
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
          "subject_role": "reactivation_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "reactivation_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "reactivation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verification-reads-bounded-window",
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
              "role": "lifecycle_entity"
            },
            {
              "kind": "reference",
              "role": "terminal_event"
            },
            {
              "kind": "reference",
              "role": "terminal_state"
            },
            {
              "kind": "reference",
              "role": "bounded_horizon"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "reactivation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-reactivation-population",
        "comparison": "complete_population",
        "roles": [
          "reactivation_population",
          "reactivation_events"
        ],
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "bounded_horizon"
          ]
        }
      }
    }
  ]
}
```

### reactivation_events

Declare reactivation events for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "reactivation_events",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-reactivation-population",
        "comparison": "complete_population",
        "roles": [
          "reactivation_population",
          "reactivation_events"
        ],
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "bounded_horizon"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "value": {
        "reference_role": "reactivation_events",
        "number_role": "reactivation_count"
      }
    }
  ]
}
```

### verification

Declare verification for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "verify-bounded-state-stability",
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
              "role": "observation_population"
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
          "subject_role": "observed_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_regression_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verify-zero-reactivation",
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
              "role": "reactivation_population"
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
          "subject_role": "reactivation_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "reactivation_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "reactivation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verification-reads-bounded-window",
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
              "role": "lifecycle_entity"
            },
            {
              "kind": "reference",
              "role": "terminal_event"
            },
            {
              "kind": "reference",
              "role": "terminal_state"
            },
            {
              "kind": "reference",
              "role": "bounded_horizon"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "reactivation_population"
            }
          ]
        }
      }
    }
  ]
}
```

### state_regression_condition

Declare state regression condition for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "state_regression_condition",
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "verify-bounded-state-stability",
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
              "role": "observation_population"
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
          "subject_role": "observed_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_regression_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "state_regression_condition",
          "reactivation_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-target-state-stability",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "state_regression_condition"
          ]
        }
      }
    }
  ]
}
```

### reactivation_condition

Declare reactivation condition for proof.lifecycle.bounded-terminal-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "reactivation_condition",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verify-zero-reactivation",
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
              "role": "reactivation_population"
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
          "subject_role": "reactivation_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "reactivation_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "reactivation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "state_regression_condition",
          "reactivation_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-target-zero-reactivation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "reactivation_condition"
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
| lifecycle_entity | semantic_parameter | lifecycle_entity |  |
| terminal_event | semantic_parameter | terminal_event |  |
| terminal_state | semantic_parameter | terminal_state |  |
| bounded_horizon | semantic_parameter | bounded_horizon |  |
| observation_population | observation_requirement |  | Acquire observation_population for the exact subject, attempt and applicability in this profile. |
| observations | observation_requirement |  | Acquire observations for the exact subject, attempt and applicability in this profile. |
| terminal_state_population | semantic_parameter | terminal_state_population |  |
| terminal_states | semantic_parameter | terminal_states |  |
| observed_state_population | semantic_parameter | observed_state_population |  |
| observed_states | semantic_parameter | observed_states |  |
| reactivation_population | semantic_parameter | reactivation_population |  |
| reactivation_events | semantic_parameter | reactivation_events |  |
| reactivation_count_signal | observation_requirement |  | Acquire reactivation_count_signal for the exact subject, attempt and applicability in this profile. |
| verification | semantic_parameter | verification |  |
| state_regression_condition | semantic_parameter | state_regression_condition |  |
| reactivation_condition | semantic_parameter | reactivation_condition |  |
| observation_count | complete_population_count | observations |  |
| state_count | definition_constant |  |  |
| reactivation_count | definition_constant |  |  |

```json
{
  "roles": [
    {
      "role": "lifecycle_entity",
      "kind": "semantic_parameter",
      "parameter": "lifecycle_entity",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/5",
        "/claim_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "lifecycle_entity",
        "allowed_type_terms": [
          "cc:lifecycle_entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "terminal_event",
      "kind": "semantic_parameter",
      "parameter": "terminal_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/3",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "terminal_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "terminal_state",
      "kind": "semantic_parameter",
      "parameter": "terminal_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/claim_patterns/6",
        "/claim_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "terminal_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "bounded_horizon",
      "kind": "semantic_parameter",
      "parameter": "bounded_horizon",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/0",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "bounded_horizon",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_population",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/9",
        "/reference_binding_patterns/0"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_population for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.lifecycle.bounded-terminal-stability/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observations",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observations for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.lifecycle.bounded-terminal-stability/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observations",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "terminal_state_population",
      "kind": "semantic_parameter",
      "parameter": "terminal_state_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/2",
        "/claim_patterns/7",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "terminal_state_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "terminal_states",
      "kind": "semantic_parameter",
      "parameter": "terminal_states",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "terminal_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "observed_state_population",
      "kind": "semantic_parameter",
      "parameter": "observed_state_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_state_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observed_states",
      "kind": "semantic_parameter",
      "parameter": "observed_states",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "reactivation_population",
      "kind": "semantic_parameter",
      "parameter": "reactivation_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/9",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "reactivation_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "reactivation_events",
      "kind": "semantic_parameter",
      "parameter": "reactivation_events",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "reactivation_events",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "reactivation_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/8"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire reactivation_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.lifecycle.bounded-terminal-stability/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "reactivation_count_signal",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
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
        "/claim_patterns/10",
        "/claim_patterns/11",
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
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "state_regression_condition",
      "kind": "semantic_parameter",
      "parameter": "state_regression_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/distinct_reference_role_sets/1",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "state_regression_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "reactivation_condition",
      "kind": "semantic_parameter",
      "parameter": "reactivation_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/distinct_reference_role_sets/1",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "reactivation_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "observations"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observation_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "state_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_role_count_bindings/1",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "state_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1,
        "maximum": 1
      }
    },
    {
      "role": "reactivation_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/8",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "reactivation_count",
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
          "terminal_event",
          "bounded_horizon"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "state_regression_condition",
          "reactivation_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-observation-population",
        "comparison": "complete_population",
        "roles": [
          "observation_population",
          "observations"
        ],
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "bounded_horizon"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "constraint": {
        "pattern_id": "complete-terminal-state-population",
        "comparison": "complete_population",
        "roles": [
          "terminal_state_population",
          "terminal_states"
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
        "pattern_id": "complete-observed-state-population",
        "comparison": "complete_population",
        "roles": [
          "observed_state_population",
          "observed_states"
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
        "pattern_id": "complete-reactivation-population",
        "comparison": "complete_population",
        "roles": [
          "reactivation_population",
          "reactivation_events"
        ],
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "bounded_horizon"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "constraint": {
        "reference_role": "observations",
        "number_role": "observation_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "terminal_states",
        "number_role": "state_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "observed_states",
        "number_role": "state_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "reactivation_events",
        "number_role": "reactivation_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "terminal-event-completes-entity",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_event",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "lifecycle_entity"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "terminal-event-has-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_event",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "terminal-state-in-terminal-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "terminal-before-each-observation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "terminal_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "each-observation-before-horizon",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "bounded_horizon"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "each-observation-reads-entity",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "lifecycle_entity"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "each-observation-records-terminal-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "observed-states-equal-terminal-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_state_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "reactivation-count-zero",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "reactivation_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "reactivation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "verification-reads-bounded-window",
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
              "role": "lifecycle_entity"
            },
            {
              "kind": "reference",
              "role": "terminal_event"
            },
            {
              "kind": "reference",
              "role": "terminal_state"
            },
            {
              "kind": "reference",
              "role": "bounded_horizon"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "reactivation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "verify-bounded-state-stability",
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
              "role": "observation_population"
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
          "subject_role": "observed_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_regression_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "terminal_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "verify-zero-reactivation",
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
              "role": "reactivation_population"
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
          "subject_role": "reactivation_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "reactivation_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "reactivation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-state-stability",
        "role": "verifies",
        "source_claim_pattern_id": "verify-bounded-state-stability",
        "target_claim_pattern_id": "observed-states-equal-terminal-state"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-target-zero-reactivation",
        "role": "verifies",
        "source_claim_pattern_id": "verify-zero-reactivation",
        "target_claim_pattern_id": "reactivation-count-zero"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-state-stability",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "state_regression_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-target-zero-reactivation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "reactivation_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-observation-population"
          },
          {
            "pattern": "complete-terminal-state-population"
          },
          {
            "pattern": "complete-observed-state-population"
          },
          {
            "pattern": "complete-reactivation-population"
          },
          {
            "pattern": "terminal-event-completes-entity"
          },
          {
            "pattern": "terminal-event-has-state"
          },
          {
            "pattern": "terminal-state-in-terminal-population"
          },
          {
            "pattern": "terminal-before-each-observation"
          },
          {
            "pattern": "each-observation-before-horizon"
          },
          {
            "pattern": "each-observation-reads-entity"
          },
          {
            "pattern": "each-observation-records-terminal-state"
          },
          {
            "pattern": "observed-states-equal-terminal-state"
          },
          {
            "pattern": "reactivation-count-zero"
          },
          {
            "pattern": "verification-reads-bounded-window"
          },
          {
            "pattern": "verify-bounded-state-stability"
          },
          {
            "pattern": "verify-zero-reactivation"
          },
          {
            "pattern": "verification-target-state-stability"
          },
          {
            "pattern": "verification-target-zero-reactivation"
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
      "lifecycle_entity",
      "terminal_event",
      "terminal_state",
      "bounded_horizon",
      "terminal_state_population",
      "terminal_states",
      "observed_state_population",
      "observed_states",
      "reactivation_population",
      "reactivation_events",
      "verification",
      "state_regression_condition",
      "reactivation_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "observation_population",
      "observations",
      "reactivation_count_signal"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.lifecycle.bounded-terminal-stability.",
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
        "missing": "No named proof.lifecycle.bounded-terminal-stability constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.lifecycle.bounded-terminal-stability.",
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
