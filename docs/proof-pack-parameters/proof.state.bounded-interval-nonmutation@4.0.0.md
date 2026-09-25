# proof.state.bounded-interval-nonmutation@4.0.0

<!-- Generated from validated package metadata. -->

For one caller-declared actor or process, one declared interval with distinct ordered start and end events, and one complete exact nonempty protected-resource population, the actor neither writes nor mutates any protected member during that interval; same-actor, same-population, same-interval positive write and mutation propositions falsify the plan, including mutate then restore.

Profile digest: 937e729ac57add4eb1db4d3f459be576d261a329825589ca7bc6e212d21e55c7. Parameter digest: d410a20d7e033ec4e94ba07cad1b724c9c67b48f7ee10c6762d78b26264338d1.

Admission digest: e20e03c60aac2fdeb9acf6d0ceadcb91e357b6d98bd80b6ef096d98f70ca3553.

Roles: 8/8 accounted; 0 owned gaps. Semantic parameters: 7; internal roles: 1.

## Guarantee and exclusions

For one caller-declared actor or process, one declared interval with distinct ordered start and end events, and one complete exact nonempty protected-resource population, the actor neither writes nor mutates any protected member during that interval; same-actor, same-population, same-interval positive write and mutation propositions falsify the plan, including mutate then restore.

- actions-outside-the-declared-interval
- delete-or-create-unless-represented-as-write-or-mutation
- dishonest-identities-populations-intervals-or-grounding
- real-time-clock-trace-or-evidence-truth
- trace-omissions-or-unreported-transient-activity
- undiscovered-actors-or-protected-resources

## Parameters

### actor

Declare actor for proof.state.bounded-interval-nonmutation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "actor",
        "allowed_type_terms": [
          "cc:actor",
          "cc:process",
          "cc:runtime_component"
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
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "actor-does-not-write-protected-resources-during-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "actor",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "actor-does-not-mutate-protected-resources-during-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "actor",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verification-observes-exact-bounded-proof-subjects",
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
              "role": "actor"
            },
            {
              "kind": "reference",
              "role": "start_event"
            },
            {
              "kind": "reference",
              "role": "end_event"
            },
            {
              "kind": "reference",
              "role": "interval"
            },
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "verify-no-during-interval-write",
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
              "role": "protected_resource_population"
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
          "subject_role": "actor",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "verify-no-during-interval-mutation",
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
              "role": "interval"
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
          "subject_role": "actor",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "actor",
          "interval",
          "start_event",
          "end_event",
          "protected_resource_population"
        ]
      }
    }
  ]
}
```

### interval

Declare interval for proof.state.bounded-interval-nonmutation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/1",
      "value": {
        "role": "interval",
        "allowed_type_terms": [
          "cc:event",
          "cc:process",
          "cc:scope"
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
        "pattern_id": "start-event-starts-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "start_event",
          "operator": "reference:starts",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interval"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "end-event-completes-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "end_event",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interval"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "actor-does-not-write-protected-resources-during-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "actor",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "actor-does-not-mutate-protected-resources-during-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "actor",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verification-observes-exact-bounded-proof-subjects",
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
              "role": "actor"
            },
            {
              "kind": "reference",
              "role": "start_event"
            },
            {
              "kind": "reference",
              "role": "end_event"
            },
            {
              "kind": "reference",
              "role": "interval"
            },
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "verify-no-during-interval-write",
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
              "role": "protected_resource_population"
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
          "subject_role": "actor",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "verify-no-during-interval-mutation",
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
              "role": "interval"
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
          "subject_role": "actor",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "actor",
          "interval",
          "start_event",
          "end_event",
          "protected_resource_population"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-target-no-write",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "interval"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-target-no-mutation",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "interval"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-protected-resource-population",
        "comparison": "complete_population",
        "roles": [
          "protected_resource_population",
          "protected_resources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "interval"
          ]
        }
      }
    }
  ]
}
```

### start_event

Declare start event for proof.state.bounded-interval-nonmutation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "start_event",
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
        "pattern_id": "start-event-starts-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "start_event",
          "operator": "reference:starts",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interval"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "start-event-precedes-end-event",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "start_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "end_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verification-observes-exact-bounded-proof-subjects",
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
              "role": "actor"
            },
            {
              "kind": "reference",
              "role": "start_event"
            },
            {
              "kind": "reference",
              "role": "end_event"
            },
            {
              "kind": "reference",
              "role": "interval"
            },
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "actor",
          "interval",
          "start_event",
          "end_event",
          "protected_resource_population"
        ]
      }
    }
  ]
}
```

### end_event

Declare end event for proof.state.bounded-interval-nonmutation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "end_event",
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "end-event-completes-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "end_event",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interval"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "start-event-precedes-end-event",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "start_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "end_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verification-observes-exact-bounded-proof-subjects",
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
              "role": "actor"
            },
            {
              "kind": "reference",
              "role": "start_event"
            },
            {
              "kind": "reference",
              "role": "end_event"
            },
            {
              "kind": "reference",
              "role": "interval"
            },
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "actor",
          "interval",
          "start_event",
          "end_event",
          "protected_resource_population"
        ]
      }
    }
  ]
}
```

### protected_resource_population

Declare protected resource population for proof.state.bounded-interval-nonmutation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "protected_resource_population",
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
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "verify-no-during-interval-write",
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
              "role": "protected_resource_population"
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
          "subject_role": "actor",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "actor",
          "interval",
          "start_event",
          "end_event",
          "protected_resource_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-protected-resource-population",
        "comparison": "complete_population",
        "roles": [
          "protected_resource_population",
          "protected_resources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "interval"
          ]
        }
      }
    }
  ]
}
```

### protected_resources

Declare protected resources for proof.state.bounded-interval-nonmutation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "protected_resources",
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
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "actor-does-not-write-protected-resources-during-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "actor",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "actor-does-not-mutate-protected-resources-during-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "actor",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verification-observes-exact-bounded-proof-subjects",
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
              "role": "actor"
            },
            {
              "kind": "reference",
              "role": "start_event"
            },
            {
              "kind": "reference",
              "role": "end_event"
            },
            {
              "kind": "reference",
              "role": "interval"
            },
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "verify-no-during-interval-write",
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
              "role": "protected_resource_population"
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
          "subject_role": "actor",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "verify-no-during-interval-mutation",
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
              "role": "interval"
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
          "subject_role": "actor",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-protected-resource-population",
        "comparison": "complete_population",
        "roles": [
          "protected_resource_population",
          "protected_resources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "interval"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "value": {
        "reference_role": "protected_resources",
        "number_role": "protected_resource_count"
      }
    }
  ]
}
```

### verification

Declare verification for proof.state.bounded-interval-nonmutation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verification-observes-exact-bounded-proof-subjects",
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
              "role": "actor"
            },
            {
              "kind": "reference",
              "role": "start_event"
            },
            {
              "kind": "reference",
              "role": "end_event"
            },
            {
              "kind": "reference",
              "role": "interval"
            },
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "verify-no-during-interval-write",
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
              "role": "protected_resource_population"
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
          "subject_role": "actor",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "verify-no-during-interval-mutation",
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
              "role": "interval"
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
          "subject_role": "actor",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
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
| actor | semantic_parameter | actor |  |
| interval | semantic_parameter | interval |  |
| start_event | semantic_parameter | start_event |  |
| end_event | semantic_parameter | end_event |  |
| protected_resource_population | semantic_parameter | protected_resource_population |  |
| protected_resources | semantic_parameter | protected_resources |  |
| verification | semantic_parameter | verification |  |
| protected_resource_count | complete_population_count | protected_resources |  |

```json
{
  "roles": [
    {
      "role": "actor",
      "kind": "semantic_parameter",
      "parameter": "actor",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "actor",
        "allowed_type_terms": [
          "cc:actor",
          "cc:process",
          "cc:runtime_component"
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
      "role": "interval",
      "kind": "semantic_parameter",
      "parameter": "interval",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/0",
        "/falsifier_condition_bindings/0",
        "/falsifier_condition_bindings/1",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "interval",
        "allowed_type_terms": [
          "cc:event",
          "cc:process",
          "cc:scope"
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
      "role": "start_event",
      "kind": "semantic_parameter",
      "parameter": "start_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/2",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "start_event",
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
      "role": "end_event",
      "kind": "semantic_parameter",
      "parameter": "end_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "end_event",
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
      "role": "protected_resource_population",
      "kind": "semantic_parameter",
      "parameter": "protected_resource_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/6",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_resource_population",
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
      "role": "protected_resources",
      "kind": "semantic_parameter",
      "parameter": "protected_resources",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_resources",
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
      "role": "verification",
      "kind": "semantic_parameter",
      "parameter": "verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7"
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
      "role": "protected_resource_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "protected_resources"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/0"
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
          "actor",
          "interval",
          "start_event",
          "end_event",
          "protected_resource_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-protected-resource-population",
        "comparison": "complete_population",
        "roles": [
          "protected_resource_population",
          "protected_resources"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "interval"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "constraint": {
        "reference_role": "protected_resources",
        "number_role": "protected_resource_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "start-event-starts-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "start_event",
          "operator": "reference:starts",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interval"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "end-event-completes-interval",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "end_event",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "interval"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "start-event-precedes-end-event",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "start_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "end_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "actor-does-not-write-protected-resources-during-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "actor",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "actor-does-not-mutate-protected-resources-during-interval",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "actor",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "verification-observes-exact-bounded-proof-subjects",
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
              "role": "actor"
            },
            {
              "kind": "reference",
              "role": "start_event"
            },
            {
              "kind": "reference",
              "role": "end_event"
            },
            {
              "kind": "reference",
              "role": "interval"
            },
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "verify-no-during-interval-write",
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
              "role": "protected_resource_population"
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
          "subject_role": "actor",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "verify-no-during-interval-mutation",
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
              "role": "interval"
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
          "subject_role": "actor",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "interval"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resources"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-no-write",
        "role": "verifies",
        "source_claim_pattern_id": "verify-no-during-interval-write",
        "target_claim_pattern_id": "actor-does-not-write-protected-resources-during-interval"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-target-no-mutation",
        "role": "verifies",
        "source_claim_pattern_id": "verify-no-during-interval-mutation",
        "target_claim_pattern_id": "actor-does-not-mutate-protected-resources-during-interval"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-no-write",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "interval"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-target-no-mutation",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "interval"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-protected-resource-population"
          },
          {
            "pattern": "start-event-starts-interval"
          },
          {
            "pattern": "end-event-completes-interval"
          },
          {
            "pattern": "start-event-precedes-end-event"
          },
          {
            "pattern": "actor-does-not-write-protected-resources-during-interval"
          },
          {
            "pattern": "actor-does-not-mutate-protected-resources-during-interval"
          },
          {
            "pattern": "verification-observes-exact-bounded-proof-subjects"
          },
          {
            "pattern": "verify-no-during-interval-write"
          },
          {
            "pattern": "verify-no-during-interval-mutation"
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
      "actor",
      "interval",
      "start_event",
      "end_event",
      "protected_resource_population",
      "protected_resources",
      "verification"
    ],
    "declaration_outputs": [],
    "required_observations": [],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.state.bounded-interval-nonmutation.",
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
        "missing": "No named proof.state.bounded-interval-nonmutation constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.state.bounded-interval-nonmutation.",
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
