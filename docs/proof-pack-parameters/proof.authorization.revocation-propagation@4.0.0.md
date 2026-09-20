# proof.authorization.revocation-propagation@4.0.0

<!-- Generated from validated package metadata. -->

For one declared authority and revocation event, one complete declared enforcement-consumer population applies the same revoked state during a finite declared propagation interval after revocation and before every member of one complete declared post-revocation attempt population; every such attempt uses that authority, targets that consumer population, is a member of an equal complete refused-attempt population, and neither writes nor mutates any member of one complete declared protected-effect population.

Profile digest: 8db0e17480c65b002867c59f444c334814788bd9808ea94e9983a2b0234e9e95. Parameter digest: 43d70f2fbfcc2a5d43347d65f1af6941361d0fc6ddeceed43ee1de2e2bfbd780.

Admission digest: a43dbe4b60ee4e92bb417e5ff9b14a13486f0343e412074828b6988f0a97c112.

Roles: 26/26 accounted; 1 owned gaps. Semantic parameters: 21; internal roles: 5.

## Guarantee and exclusions

For one declared authority and revocation event, one complete declared enforcement-consumer population applies the same revoked state during a finite declared propagation interval after revocation and before every member of one complete declared post-revocation attempt population; every such attempt uses that authority, targets that consumer population, is a member of an equal complete refused-attempt population, and neither writes nor mutates any member of one complete declared protected-effect population.

- concurrency-outside-the-declared-revocation-propagation-attempt-order
- consumers-attempts-resources-and-effects-outside-declared-complete-populations
- delivered-evidence-authenticity-or-plan-implementation
- dishonest-authority-event-state-population-identity-and-role-grounding
- eventual-delivery-propagation-liveness-or-wall-clock-bound
- runtime-truth-or-authenticity-of-authored-claims

## Parameters

### authority

Declare authority for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability"
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "revocation-invalidates-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "revocation_event",
          "operator": "reference:invalidates",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "verification-reads-shared-revocation-graph",
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
              "role": "authority"
            },
            {
              "kind": "reference",
              "role": "revocation_event"
            },
            {
              "kind": "reference",
              "role": "propagation_interval"
            },
            {
              "kind": "reference",
              "role": "consumer_population"
            },
            {
              "kind": "reference",
              "role": "attempt_population"
            },
            {
              "kind": "reference",
              "role": "refused_attempt_population"
            },
            {
              "kind": "reference",
              "role": "protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "applied_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-consumer-observes-authority-during-propagation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "consumers",
          "member_role": "consumer"
        },
        "proposition_template": {
          "subject_role": "consumer",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "each-attempt-uses-revoked-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "authority",
          "revocation_event",
          "propagation_interval",
          "revoked_state",
          "refused_state"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-consumer-population",
        "comparison": "complete_population",
        "roles": [
          "consumer_population",
          "consumers"
        ],
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "authority"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-protected-effect-population",
        "comparison": "complete_population",
        "roles": [
          "protected_effect_population",
          "protected_effects"
        ],
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "authority"
          ]
        }
      }
    }
  ]
}
```

### propagation_interval

Declare propagation interval for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: bounded_observation.

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
        "role": "propagation_interval",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "verification-reads-shared-revocation-graph",
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
              "role": "authority"
            },
            {
              "kind": "reference",
              "role": "revocation_event"
            },
            {
              "kind": "reference",
              "role": "propagation_interval"
            },
            {
              "kind": "reference",
              "role": "consumer_population"
            },
            {
              "kind": "reference",
              "role": "attempt_population"
            },
            {
              "kind": "reference",
              "role": "refused_attempt_population"
            },
            {
              "kind": "reference",
              "role": "protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "applied_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "revocation-precedes-propagation-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "revocation_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "propagation_interval"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-consumer-observes-authority-during-propagation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "consumers",
          "member_role": "consumer"
        },
        "proposition_template": {
          "subject_role": "consumer",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-consumer-applies-revoked-state-during-propagation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "consumers",
          "member_role": "consumer"
        },
        "proposition_template": {
          "subject_role": "consumer",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "applied-state-equals-revoked-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "applied_state_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "propagation-interval-precedes-each-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "propagation_interval",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
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
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "authority",
          "revocation_event",
          "propagation_interval",
          "revoked_state",
          "refused_state"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-applied-state-population",
        "comparison": "complete_population",
        "roles": [
          "applied_state_population",
          "applied_states"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "propagation_interval"
          ]
        }
      }
    }
  ]
}
```

### revoked_state

Declare revoked state for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "revoked_state",
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
        "pattern_id": "revocation-records-revoked-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "revocation_event",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-consumer-applies-revoked-state-during-propagation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "consumers",
          "member_role": "consumer"
        },
        "proposition_template": {
          "subject_role": "consumer",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "authority",
          "revocation_event",
          "propagation_interval",
          "revoked_state",
          "refused_state"
        ]
      }
    }
  ]
}
```

### refused_state

Declare refused state for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "refused_state",
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
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "each-attempt-is-refused",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refused_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "authority",
          "revocation_event",
          "propagation_interval",
          "revoked_state",
          "refused_state"
        ]
      }
    }
  ]
}
```

### consumer_population

Declare consumer population for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "consumer_population",
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "verification-reads-shared-revocation-graph",
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
              "role": "authority"
            },
            {
              "kind": "reference",
              "role": "revocation_event"
            },
            {
              "kind": "reference",
              "role": "propagation_interval"
            },
            {
              "kind": "reference",
              "role": "consumer_population"
            },
            {
              "kind": "reference",
              "role": "attempt_population"
            },
            {
              "kind": "reference",
              "role": "refused_attempt_population"
            },
            {
              "kind": "reference",
              "role": "protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "applied_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "verify-consumer-applied-state",
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
              "role": "consumer_population"
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
          "subject_role": "applied_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_consumer_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "each-attempt-targets-consumer-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "consumer_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "consumer_population",
          "attempt_population",
          "protected_effect_population",
          "revoked_state_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-consumer-population",
        "comparison": "complete_population",
        "roles": [
          "consumer_population",
          "consumers"
        ],
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "authority"
          ]
        }
      }
    }
  ]
}
```

### consumers

Declare consumers for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "consumers",
        "allowed_type_terms": [
          "cc:runtime_component",
          "cc:actor",
          "cc:process"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-consumer-observes-authority-during-propagation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "consumers",
          "member_role": "consumer"
        },
        "proposition_template": {
          "subject_role": "consumer",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-consumer-applies-revoked-state-during-propagation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "consumers",
          "member_role": "consumer"
        },
        "proposition_template": {
          "subject_role": "consumer",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-consumer-population",
        "comparison": "complete_population",
        "roles": [
          "consumer_population",
          "consumers"
        ],
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "authority"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "value": {
        "reference_role": "consumers",
        "number_role": "consumer_count"
      }
    }
  ]
}
```

### attempt_population

Declare attempt population for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "attempt_population",
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "all-post-revocation-attempts-refused",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refused_attempt_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "no-post-revocation-attempt-writes-protected-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt_population",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "no-post-revocation-attempt-mutates-protected-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt_population",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "verification-reads-shared-revocation-graph",
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
              "role": "authority"
            },
            {
              "kind": "reference",
              "role": "revocation_event"
            },
            {
              "kind": "reference",
              "role": "propagation_interval"
            },
            {
              "kind": "reference",
              "role": "consumer_population"
            },
            {
              "kind": "reference",
              "role": "attempt_population"
            },
            {
              "kind": "reference",
              "role": "refused_attempt_population"
            },
            {
              "kind": "reference",
              "role": "protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "applied_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "verify-all-attempts-refused",
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
              "role": "refused_attempt_population"
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
          "subject_role": "refused_attempt_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "accepted_attempt_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "verify-no-protected-write",
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
              "role": "protected_effect_population"
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
          "subject_role": "attempt_population",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "post_revocation_write_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "verify-no-protected-mutation",
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
              "role": "attempt_population"
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
          "subject_role": "attempt_population",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "post_revocation_mutation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "consumer_population",
          "attempt_population",
          "protected_effect_population",
          "revoked_state_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-post-revocation-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "attempt_population",
          "attempts"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "revocation_event"
          ]
        }
      }
    }
  ]
}
```

### attempts

Declare attempts for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "attempts",
        "allowed_type_terms": [
          "cc:event"
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "each-attempt-does-not-write-protected-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "each-attempt-does-not-mutate-protected-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "propagation-interval-precedes-each-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "propagation_interval",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
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
        "pattern_id": "each-attempt-uses-revoked-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "each-attempt-targets-consumer-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "consumer_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "each-attempt-is-refused",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refused_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-post-revocation-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "attempt_population",
          "attempts"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "revocation_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "value": {
        "reference_role": "attempts",
        "number_role": "attempt_count"
      }
    }
  ]
}
```

### refused_attempt_population

Declare refused attempt population for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "refused_attempt_population",
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "all-post-revocation-attempts-refused",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refused_attempt_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "verification-reads-shared-revocation-graph",
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
              "role": "authority"
            },
            {
              "kind": "reference",
              "role": "revocation_event"
            },
            {
              "kind": "reference",
              "role": "propagation_interval"
            },
            {
              "kind": "reference",
              "role": "consumer_population"
            },
            {
              "kind": "reference",
              "role": "attempt_population"
            },
            {
              "kind": "reference",
              "role": "refused_attempt_population"
            },
            {
              "kind": "reference",
              "role": "protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "applied_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "verify-all-attempts-refused",
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
              "role": "refused_attempt_population"
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
          "subject_role": "refused_attempt_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "accepted_attempt_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-refused-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "refused_attempt_population",
          "refused_attempts"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "revocation_event"
          ]
        }
      }
    }
  ]
}
```

### refused_attempts

Declare refused attempts for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "refused_attempts",
        "allowed_type_terms": [
          "cc:event"
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
        "pattern_id": "complete-refused-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "refused_attempt_population",
          "refused_attempts"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "revocation_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "value": {
        "reference_role": "refused_attempts",
        "number_role": "attempt_count"
      }
    }
  ]
}
```

### protected_effect_population

Declare protected effect population for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "protected_effect_population",
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "verification-reads-shared-revocation-graph",
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
              "role": "authority"
            },
            {
              "kind": "reference",
              "role": "revocation_event"
            },
            {
              "kind": "reference",
              "role": "propagation_interval"
            },
            {
              "kind": "reference",
              "role": "consumer_population"
            },
            {
              "kind": "reference",
              "role": "attempt_population"
            },
            {
              "kind": "reference",
              "role": "refused_attempt_population"
            },
            {
              "kind": "reference",
              "role": "protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "applied_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "verify-no-protected-write",
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
              "role": "protected_effect_population"
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
          "subject_role": "attempt_population",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "post_revocation_write_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "consumer_population",
          "attempt_population",
          "protected_effect_population",
          "revoked_state_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-protected-effect-population",
        "comparison": "complete_population",
        "roles": [
          "protected_effect_population",
          "protected_effects"
        ],
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "authority"
          ]
        }
      }
    }
  ]
}
```

### protected_effects

Declare protected effects for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "protected_effects",
        "allowed_type_terms": [
          "cc:resource",
          "cc:artifact",
          "cc:configuration",
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "each-attempt-does-not-write-protected-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "each-attempt-does-not-mutate-protected-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "no-post-revocation-attempt-writes-protected-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt_population",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "no-post-revocation-attempt-mutates-protected-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt_population",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "verify-no-protected-write",
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
              "role": "protected_effect_population"
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
          "subject_role": "attempt_population",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "post_revocation_write_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "verify-no-protected-mutation",
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
              "role": "attempt_population"
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
          "subject_role": "attempt_population",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "post_revocation_mutation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-protected-effect-population",
        "comparison": "complete_population",
        "roles": [
          "protected_effect_population",
          "protected_effects"
        ],
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "authority"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "value": {
        "reference_role": "protected_effects",
        "number_role": "effect_count"
      }
    }
  ]
}
```

### revoked_state_population

Declare revoked state population for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "revoked_state_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "verify-consumer-applied-state",
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
              "role": "consumer_population"
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
          "subject_role": "applied_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_consumer_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "applied-state-equals-revoked-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "applied_state_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "consumer_population",
          "attempt_population",
          "protected_effect_population",
          "revoked_state_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-revoked-state-population",
        "comparison": "complete_population",
        "roles": [
          "revoked_state_population",
          "revoked_states"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "revocation_event"
          ]
        }
      }
    }
  ]
}
```

### revoked_states

Declare revoked states for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "revoked_states",
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
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-revoked-state-population",
        "comparison": "complete_population",
        "roles": [
          "revoked_state_population",
          "revoked_states"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "revocation_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "value": {
        "reference_role": "revoked_states",
        "number_role": "state_count"
      }
    }
  ]
}
```

### applied_state_population

Declare applied state population for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/15",
      "value": {
        "role": "applied_state_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "verification-reads-shared-revocation-graph",
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
              "role": "authority"
            },
            {
              "kind": "reference",
              "role": "revocation_event"
            },
            {
              "kind": "reference",
              "role": "propagation_interval"
            },
            {
              "kind": "reference",
              "role": "consumer_population"
            },
            {
              "kind": "reference",
              "role": "attempt_population"
            },
            {
              "kind": "reference",
              "role": "refused_attempt_population"
            },
            {
              "kind": "reference",
              "role": "protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "applied_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "verify-consumer-applied-state",
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
              "role": "consumer_population"
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
          "subject_role": "applied_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_consumer_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "applied-state-equals-revoked-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "applied_state_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-applied-state-population",
        "comparison": "complete_population",
        "roles": [
          "applied_state_population",
          "applied_states"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "propagation_interval"
          ]
        }
      }
    }
  ]
}
```

### applied_states

Declare applied states for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/16",
      "value": {
        "role": "applied_states",
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
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-applied-state-population",
        "comparison": "complete_population",
        "roles": [
          "applied_state_population",
          "applied_states"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "propagation_interval"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "value": {
        "reference_role": "applied_states",
        "number_role": "state_count"
      }
    }
  ]
}
```

### verification

Declare verification for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "verification-reads-shared-revocation-graph",
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
              "role": "authority"
            },
            {
              "kind": "reference",
              "role": "revocation_event"
            },
            {
              "kind": "reference",
              "role": "propagation_interval"
            },
            {
              "kind": "reference",
              "role": "consumer_population"
            },
            {
              "kind": "reference",
              "role": "attempt_population"
            },
            {
              "kind": "reference",
              "role": "refused_attempt_population"
            },
            {
              "kind": "reference",
              "role": "protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "applied_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "verify-consumer-applied-state",
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
              "role": "consumer_population"
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
          "subject_role": "applied_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_consumer_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "verify-all-attempts-refused",
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
              "role": "refused_attempt_population"
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
          "subject_role": "refused_attempt_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "accepted_attempt_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "verify-no-protected-write",
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
              "role": "protected_effect_population"
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
          "subject_role": "attempt_population",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "post_revocation_write_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "verify-no-protected-mutation",
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
              "role": "attempt_population"
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
          "subject_role": "attempt_population",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "post_revocation_mutation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    }
  ]
}
```

### stale_consumer_condition

Declare stale consumer condition for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "stale_consumer_condition",
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
        "pattern_id": "verify-consumer-applied-state",
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
              "role": "consumer_population"
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
          "subject_role": "applied_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_consumer_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "stale_consumer_condition",
          "accepted_attempt_condition",
          "post_revocation_write_condition",
          "post_revocation_mutation_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-target-consumer-state",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_consumer_condition"
          ]
        }
      }
    }
  ]
}
```

### accepted_attempt_condition

Declare accepted attempt condition for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "accepted_attempt_condition",
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
        "pattern_id": "verify-all-attempts-refused",
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
              "role": "refused_attempt_population"
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
          "subject_role": "refused_attempt_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "accepted_attempt_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "stale_consumer_condition",
          "accepted_attempt_condition",
          "post_revocation_write_condition",
          "post_revocation_mutation_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-target-refusal",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "accepted_attempt_condition"
          ]
        }
      }
    }
  ]
}
```

### post_revocation_write_condition

Declare post revocation write condition for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "post_revocation_write_condition",
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
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "verify-no-protected-write",
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
              "role": "protected_effect_population"
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
          "subject_role": "attempt_population",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "post_revocation_write_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "stale_consumer_condition",
          "accepted_attempt_condition",
          "post_revocation_write_condition",
          "post_revocation_mutation_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "verification-target-no-write",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "post_revocation_write_condition"
          ]
        }
      }
    }
  ]
}
```

### post_revocation_mutation_condition

Declare post revocation mutation condition for proof.authorization.revocation-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "post_revocation_mutation_condition",
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
        "pattern_id": "verify-no-protected-mutation",
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
              "role": "attempt_population"
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
          "subject_role": "attempt_population",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "post_revocation_mutation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "stale_consumer_condition",
          "accepted_attempt_condition",
          "post_revocation_write_condition",
          "post_revocation_mutation_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "verification-target-no-mutation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "post_revocation_mutation_condition"
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
| authority | semantic_parameter | authority |  |
| revocation_event | observation_requirement |  | Acquire revocation_event for the exact subject, attempt and applicability in this profile. |
| propagation_interval | semantic_parameter | propagation_interval |  |
| revoked_state | semantic_parameter | revoked_state |  |
| refused_state | semantic_parameter | refused_state |  |
| consumer_population | semantic_parameter | consumer_population |  |
| consumers | semantic_parameter | consumers |  |
| attempt_population | semantic_parameter | attempt_population |  |
| attempts | semantic_parameter | attempts |  |
| refused_attempt_population | semantic_parameter | refused_attempt_population |  |
| refused_attempts | semantic_parameter | refused_attempts |  |
| protected_effect_population | semantic_parameter | protected_effect_population |  |
| protected_effects | semantic_parameter | protected_effects |  |
| revoked_state_population | semantic_parameter | revoked_state_population |  |
| revoked_states | semantic_parameter | revoked_states |  |
| applied_state_population | semantic_parameter | applied_state_population |  |
| applied_states | semantic_parameter | applied_states |  |
| verification | semantic_parameter | verification |  |
| stale_consumer_condition | semantic_parameter | stale_consumer_condition |  |
| accepted_attempt_condition | semantic_parameter | accepted_attempt_condition |  |
| post_revocation_write_condition | semantic_parameter | post_revocation_write_condition |  |
| post_revocation_mutation_condition | semantic_parameter | post_revocation_mutation_condition |  |
| consumer_count | complete_population_count | consumers |  |
| attempt_count | complete_population_count | attempts, refused_attempts |  |
| effect_count | complete_population_count | protected_effects |  |
| state_count | definition_constant |  |  |

```json
{
  "roles": [
    {
      "role": "authority",
      "kind": "semantic_parameter",
      "parameter": "authority",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/15",
        "/claim_patterns/3",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/0",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability"
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
      "role": "revocation_event",
      "kind": "observation_requirement",
      "parameter": null,
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
        "/claim_patterns/2",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/1",
        "/reference_binding_patterns/2",
        "/reference_binding_patterns/4"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire revocation_event for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authorization.revocation-propagation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "revocation_event",
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
      "role": "propagation_interval",
      "kind": "semantic_parameter",
      "parameter": "propagation_interval",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "propagation_interval",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "revoked_state",
      "kind": "semantic_parameter",
      "parameter": "revoked_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/4",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "revoked_state",
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
      "role": "refused_state",
      "kind": "semantic_parameter",
      "parameter": "refused_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "refused_state",
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
      "role": "consumer_population",
      "kind": "semantic_parameter",
      "parameter": "consumer_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "consumer_population",
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
      "role": "consumers",
      "kind": "semantic_parameter",
      "parameter": "consumers",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "consumers",
        "allowed_type_terms": [
          "cc:runtime_component",
          "cc:actor",
          "cc:process"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "attempt_population",
      "kind": "semantic_parameter",
      "parameter": "attempt_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_population",
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
      "role": "attempts",
      "kind": "semantic_parameter",
      "parameter": "attempts",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempts",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "refused_attempt_population",
      "kind": "semantic_parameter",
      "parameter": "refused_attempt_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/15",
        "/claim_patterns/17",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "refused_attempt_population",
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
      "role": "refused_attempts",
      "kind": "semantic_parameter",
      "parameter": "refused_attempts",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "refused_attempts",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "protected_effect_population",
      "kind": "semantic_parameter",
      "parameter": "protected_effect_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/18",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_effect_population",
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
      "role": "protected_effects",
      "kind": "semantic_parameter",
      "parameter": "protected_effects",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_effects",
        "allowed_type_terms": [
          "cc:resource",
          "cc:artifact",
          "cc:configuration",
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "revoked_state_population",
      "kind": "semantic_parameter",
      "parameter": "revoked_state_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "revoked_state_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "revoked_states",
      "kind": "semantic_parameter",
      "parameter": "revoked_states",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/4",
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "revoked_states",
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
      "role": "applied_state_population",
      "kind": "semantic_parameter",
      "parameter": "applied_state_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/5",
        "/reference_binding_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "applied_state_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "applied_states",
      "kind": "semantic_parameter",
      "parameter": "applied_states",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/5",
        "/reference_role_count_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "applied_states",
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
      "role": "verification",
      "kind": "semantic_parameter",
      "parameter": "verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
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
      "role": "stale_consumer_condition",
      "kind": "semantic_parameter",
      "parameter": "stale_consumer_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "stale_consumer_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "accepted_attempt_condition",
      "kind": "semantic_parameter",
      "parameter": "accepted_attempt_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "accepted_attempt_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "post_revocation_write_condition",
      "kind": "semantic_parameter",
      "parameter": "post_revocation_write_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "post_revocation_write_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "post_revocation_mutation_condition",
      "kind": "semantic_parameter",
      "parameter": "post_revocation_mutation_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "post_revocation_mutation_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "consumer_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "consumers"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "consumer_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "attempt_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "attempts",
        "refused_attempts"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/1",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "attempt_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "effect_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "protected_effects"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/3"
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
      "role": "state_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_role_count_bindings/4",
        "/reference_role_count_bindings/5"
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
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "authority",
          "revocation_event",
          "propagation_interval",
          "revoked_state",
          "refused_state"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "consumer_population",
          "attempt_population",
          "protected_effect_population",
          "revoked_state_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "stale_consumer_condition",
          "accepted_attempt_condition",
          "post_revocation_write_condition",
          "post_revocation_mutation_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-consumer-population",
        "comparison": "complete_population",
        "roles": [
          "consumer_population",
          "consumers"
        ],
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "authority"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "constraint": {
        "pattern_id": "complete-post-revocation-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "attempt_population",
          "attempts"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "revocation_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "constraint": {
        "pattern_id": "complete-refused-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "refused_attempt_population",
          "refused_attempts"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "revocation_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "constraint": {
        "pattern_id": "complete-protected-effect-population",
        "comparison": "complete_population",
        "roles": [
          "protected_effect_population",
          "protected_effects"
        ],
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "authority"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "constraint": {
        "pattern_id": "complete-revoked-state-population",
        "comparison": "complete_population",
        "roles": [
          "revoked_state_population",
          "revoked_states"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "revocation_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "constraint": {
        "pattern_id": "complete-applied-state-population",
        "comparison": "complete_population",
        "roles": [
          "applied_state_population",
          "applied_states"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "propagation_interval"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "constraint": {
        "reference_role": "consumers",
        "number_role": "consumer_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "attempts",
        "number_role": "attempt_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "refused_attempts",
        "number_role": "attempt_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "protected_effects",
        "number_role": "effect_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "constraint": {
        "reference_role": "revoked_states",
        "number_role": "state_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "constraint": {
        "reference_role": "applied_states",
        "number_role": "state_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "revocation-invalidates-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "revocation_event",
          "operator": "reference:invalidates",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "revocation-records-revoked-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "revocation_event",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "revocation-precedes-propagation-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "revocation_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "propagation_interval"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "each-consumer-observes-authority-during-propagation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "consumers",
          "member_role": "consumer"
        },
        "proposition_template": {
          "subject_role": "consumer",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "each-consumer-applies-revoked-state-during-propagation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "consumers",
          "member_role": "consumer"
        },
        "proposition_template": {
          "subject_role": "consumer",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "applied-state-equals-revoked-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "applied_state_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "propagation_interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "propagation-interval-precedes-each-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "propagation_interval",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
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
      "constraint": {
        "pattern_id": "each-attempt-uses-revoked-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "each-attempt-targets-consumer-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "consumer_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "each-attempt-is-refused",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refused_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "each-attempt-does-not-write-protected-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "each-attempt-does-not-mutate-protected-effects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "attempts",
          "member_role": "attempt"
        },
        "proposition_template": {
          "subject_role": "attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "all-post-revocation-attempts-refused",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refused_attempt_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "no-post-revocation-attempt-writes-protected-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt_population",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "no-post-revocation-attempt-mutates-protected-effects",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "attempt_population",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "revocation_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "verification-reads-shared-revocation-graph",
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
              "role": "authority"
            },
            {
              "kind": "reference",
              "role": "revocation_event"
            },
            {
              "kind": "reference",
              "role": "propagation_interval"
            },
            {
              "kind": "reference",
              "role": "consumer_population"
            },
            {
              "kind": "reference",
              "role": "attempt_population"
            },
            {
              "kind": "reference",
              "role": "refused_attempt_population"
            },
            {
              "kind": "reference",
              "role": "protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "applied_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "verify-consumer-applied-state",
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
              "role": "consumer_population"
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
          "subject_role": "applied_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_consumer_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "revoked_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "verify-all-attempts-refused",
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
              "role": "refused_attempt_population"
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
          "subject_role": "refused_attempt_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "accepted_attempt_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "attempt_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "verify-no-protected-write",
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
              "role": "protected_effect_population"
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
          "subject_role": "attempt_population",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "post_revocation_write_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "verify-no-protected-mutation",
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
              "role": "attempt_population"
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
          "subject_role": "attempt_population",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "post_revocation_mutation_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-consumer-state",
        "role": "verifies",
        "source_claim_pattern_id": "verify-consumer-applied-state",
        "target_claim_pattern_id": "applied-state-equals-revoked-state"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-target-refusal",
        "role": "verifies",
        "source_claim_pattern_id": "verify-all-attempts-refused",
        "target_claim_pattern_id": "all-post-revocation-attempts-refused"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "verification-target-no-write",
        "role": "verifies",
        "source_claim_pattern_id": "verify-no-protected-write",
        "target_claim_pattern_id": "no-post-revocation-attempt-writes-protected-effects"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "verification-target-no-mutation",
        "role": "verifies",
        "source_claim_pattern_id": "verify-no-protected-mutation",
        "target_claim_pattern_id": "no-post-revocation-attempt-mutates-protected-effects"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-consumer-state",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_consumer_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-target-refusal",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "accepted_attempt_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "verification-target-no-write",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "post_revocation_write_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "verification-target-no-mutation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "post_revocation_mutation_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-consumer-population"
          },
          {
            "pattern": "complete-post-revocation-attempt-population"
          },
          {
            "pattern": "complete-refused-attempt-population"
          },
          {
            "pattern": "complete-protected-effect-population"
          },
          {
            "pattern": "complete-revoked-state-population"
          },
          {
            "pattern": "complete-applied-state-population"
          },
          {
            "pattern": "revocation-invalidates-authority"
          },
          {
            "pattern": "revocation-records-revoked-state"
          },
          {
            "pattern": "revocation-precedes-propagation-interval"
          },
          {
            "pattern": "each-consumer-observes-authority-during-propagation"
          },
          {
            "pattern": "each-consumer-applies-revoked-state-during-propagation"
          },
          {
            "pattern": "applied-state-equals-revoked-state"
          },
          {
            "pattern": "propagation-interval-precedes-each-attempt"
          },
          {
            "pattern": "each-attempt-uses-revoked-authority"
          },
          {
            "pattern": "each-attempt-targets-consumer-population"
          },
          {
            "pattern": "each-attempt-is-refused"
          },
          {
            "pattern": "each-attempt-does-not-write-protected-effects"
          },
          {
            "pattern": "each-attempt-does-not-mutate-protected-effects"
          },
          {
            "pattern": "all-post-revocation-attempts-refused"
          },
          {
            "pattern": "no-post-revocation-attempt-writes-protected-effects"
          },
          {
            "pattern": "no-post-revocation-attempt-mutates-protected-effects"
          },
          {
            "pattern": "verification-reads-shared-revocation-graph"
          },
          {
            "pattern": "verify-consumer-applied-state"
          },
          {
            "pattern": "verify-all-attempts-refused"
          },
          {
            "pattern": "verify-no-protected-write"
          },
          {
            "pattern": "verify-no-protected-mutation"
          },
          {
            "pattern": "verification-target-consumer-state"
          },
          {
            "pattern": "verification-target-refusal"
          },
          {
            "pattern": "verification-target-no-write"
          },
          {
            "pattern": "verification-target-no-mutation"
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
      "authority",
      "propagation_interval",
      "revoked_state",
      "refused_state",
      "consumer_population",
      "consumers",
      "attempt_population",
      "attempts",
      "refused_attempt_population",
      "refused_attempts",
      "protected_effect_population",
      "protected_effects",
      "revoked_state_population",
      "revoked_states",
      "applied_state_population",
      "applied_states",
      "verification",
      "stale_consumer_condition",
      "accepted_attempt_condition",
      "post_revocation_write_condition",
      "post_revocation_mutation_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "revocation_event"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.authorization.revocation-propagation.",
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
        "missing": "No named proof.authorization.revocation-propagation constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.authorization.revocation-propagation.",
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
