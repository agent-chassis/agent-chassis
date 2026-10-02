# proof.dormancy.nonactivation@4.0.0

<!-- Generated from validated package metadata. -->

For one directly constructible and independently registrable declared component, one exact captured complete production reachability snapshot, one exact captured default-configuration artifact, and one exact captured activation-observation artifact, the declared complete graph and production-entrypoint populations contain the selected component and entrypoints, the default configuration declares the component inactive, the declared complete activation-event population has exactly zero members, and a separately bound no-path result covers every declared production entrypoint and that component.

Profile digest: 1f229576477a504057b41719d0c8c49144159117d5ba871ab5a0a78896f38e26. Parameter digest: 85c19aac685798cb71b578a29354852064a951c23106687d917133bd5a58451f.

Admission digest: 30924d31511bb9da2a9b9f06b5af20eabbb8fd202514d38302a418c5e26ef8b2.

Roles: 17/17 accounted; 1 owned gaps. Semantic parameters: 15; internal roles: 2.

## Guarantee and exclusions

For one directly constructible and independently registrable declared component, one exact captured complete production reachability snapshot, one exact captured default-configuration artifact, and one exact captured activation-observation artifact, the declared complete graph and production-entrypoint populations contain the selected component and entrypoints, the default configuration declares the component inactive, the declared complete activation-event population has exactly zero members, and a separately bound no-path result covers every declared production entrypoint and that component.

- activation-after-the-captured-observation-boundary
- dishonest-complete-population-or-resolver-result
- dishonest-reference-artifact-state-or-identity-grounding
- dynamic-reflection-loading-or-environment-routes-absent-from-the-captured-graph
- independent-proof-that-captured-artifact-bytes-semantically-mean-inactive
- production-path-discovery-outside-the-caller-supplied-complete-snapshot
- resolver-authority-or-independent-transitive-reachability-recomputation
- runtime-authority-pack-applicability-or-cce-consequence

## Parameters

### construction_operation

Declare construction operation for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "construction_operation",
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
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "construction_operation",
          "registration_operation"
        ]
      }
    },
    {
      "ref": "/resolver_fact_patterns/0",
      "value": {
        "pattern_id": "direct-construction-succeeds",
        "resolver_kind": "direct-construction",
        "fact_key": "succeeds",
        "argument_roles": [
          "construction_operation",
          "dormant_component"
        ]
      }
    }
  ]
}
```

### registration_operation

Declare registration operation for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "registration_operation",
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
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "construction_operation",
          "registration_operation"
        ]
      }
    },
    {
      "ref": "/resolver_fact_patterns/1",
      "value": {
        "pattern_id": "direct-registration-succeeds",
        "resolver_kind": "direct-registration",
        "fact_key": "succeeds",
        "argument_roles": [
          "registration_operation",
          "registry",
          "dormant_component"
        ]
      }
    }
  ]
}
```

### registry

Declare registry for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "registry",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:resource"
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
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "dormant_component",
          "registry"
        ]
      }
    },
    {
      "ref": "/resolver_fact_patterns/1",
      "value": {
        "pattern_id": "direct-registration-succeeds",
        "resolver_kind": "direct-registration",
        "fact_key": "succeeds",
        "argument_roles": [
          "registration_operation",
          "registry",
          "dormant_component"
        ]
      }
    }
  ]
}
```

### dormant_component

Declare dormant component for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "dormant_component",
        "allowed_type_terms": [
          "cc:runtime_component",
          "cc:entity",
          "cc:resource"
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
        "pattern_id": "component-is-a-graph-node",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "dormant_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "graph_node_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "dormancy-verification",
        "claim_kind": "verification",
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
              "role": "production_graph"
            },
            {
              "kind": "reference",
              "role": "production_entrypoint_population"
            },
            {
              "kind": "reference",
              "role": "dormant_component"
            },
            {
              "kind": "reference",
              "role": "activation_trace"
            },
            {
              "kind": "reference",
              "role": "default_configuration_artifact"
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
          "subject_role": "activation_event_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "activation_detected_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "activation_event_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "dormant_component",
          "registry"
        ]
      }
    },
    {
      "ref": "/resolver_fact_patterns/0",
      "value": {
        "pattern_id": "direct-construction-succeeds",
        "resolver_kind": "direct-construction",
        "fact_key": "succeeds",
        "argument_roles": [
          "construction_operation",
          "dormant_component"
        ]
      }
    },
    {
      "ref": "/resolver_fact_patterns/1",
      "value": {
        "pattern_id": "direct-registration-succeeds",
        "resolver_kind": "direct-registration",
        "fact_key": "succeeds",
        "argument_roles": [
          "registration_operation",
          "registry",
          "dormant_component"
        ]
      }
    },
    {
      "ref": "/resolver_fact_patterns/2",
      "value": {
        "pattern_id": "no-production-path-to-component",
        "resolver_kind": "code-reachability",
        "fact_key": "no-path-from-declared-production-entrypoints",
        "argument_roles": [
          "production_graph",
          "production_entrypoints",
          "dormant_component"
        ]
      }
    },
    {
      "ref": "/resolver_fact_patterns/3",
      "value": {
        "pattern_id": "complete-activation-observation-is-empty",
        "resolver_kind": "activation-observation",
        "fact_key": "complete-population-is-empty",
        "argument_roles": [
          "activation_trace",
          "activation_event_population",
          "dormant_component"
        ]
      }
    }
  ]
}
```

### production_graph

Declare production graph for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "production_graph",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration"
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
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "dormancy-verification",
        "claim_kind": "verification",
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
              "role": "production_graph"
            },
            {
              "kind": "reference",
              "role": "production_entrypoint_population"
            },
            {
              "kind": "reference",
              "role": "dormant_component"
            },
            {
              "kind": "reference",
              "role": "activation_trace"
            },
            {
              "kind": "reference",
              "role": "default_configuration_artifact"
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
          "subject_role": "activation_event_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "activation_detected_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "activation_event_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "production_graph",
          "graph_node_population",
          "production_entrypoint_population",
          "activation_event_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "activation_trace",
          "default_configuration_artifact",
          "production_graph"
        ]
      }
    },
    {
      "ref": "/resolver_fact_patterns/2",
      "value": {
        "pattern_id": "no-production-path-to-component",
        "resolver_kind": "code-reachability",
        "fact_key": "no-path-from-declared-production-entrypoints",
        "argument_roles": [
          "production_graph",
          "production_entrypoints",
          "dormant_component"
        ]
      }
    }
  ]
}
```

### graph_node_population

Declare graph node population for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "graph_node_population",
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "component-is-a-graph-node",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "dormant_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "graph_node_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "entrypoints-are-graph-nodes",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "production_entrypoint_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "graph_node_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "production_graph",
          "graph_node_population",
          "production_entrypoint_population",
          "activation_event_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-graph-node-population",
        "comparison": "complete_population",
        "roles": [
          "graph_node_population",
          "graph_nodes"
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

### graph_nodes

Declare graph nodes for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "graph_nodes",
        "allowed_type_terms": [
          "cc:operation",
          "cc:resource",
          "cc:runtime_component",
          "cc:entity"
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
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-graph-node-population",
        "comparison": "complete_population",
        "roles": [
          "graph_node_population",
          "graph_nodes"
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

### production_entrypoint_population

Declare production entrypoint population for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "production_entrypoint_population",
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "entrypoints-are-graph-nodes",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "production_entrypoint_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "graph_node_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "dormancy-verification",
        "claim_kind": "verification",
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
              "role": "production_graph"
            },
            {
              "kind": "reference",
              "role": "production_entrypoint_population"
            },
            {
              "kind": "reference",
              "role": "dormant_component"
            },
            {
              "kind": "reference",
              "role": "activation_trace"
            },
            {
              "kind": "reference",
              "role": "default_configuration_artifact"
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
          "subject_role": "activation_event_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "activation_detected_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "activation_event_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "production_graph",
          "graph_node_population",
          "production_entrypoint_population",
          "activation_event_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-production-entrypoint-population",
        "comparison": "complete_population",
        "roles": [
          "production_entrypoint_population",
          "production_entrypoints"
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

### production_entrypoints

Declare production entrypoints for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "production_entrypoints",
        "allowed_type_terms": [
          "cc:operation",
          "cc:resource"
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
        "pattern_id": "complete-production-entrypoint-population",
        "comparison": "complete_population",
        "roles": [
          "production_entrypoint_population",
          "production_entrypoints"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/resolver_fact_patterns/2",
      "value": {
        "pattern_id": "no-production-path-to-component",
        "resolver_kind": "code-reachability",
        "fact_key": "no-path-from-declared-production-entrypoints",
        "argument_roles": [
          "production_graph",
          "production_entrypoints",
          "dormant_component"
        ]
      }
    }
  ]
}
```

### activation_event_population

Declare activation event population for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "activation_event_population",
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
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "activation-trace-records-complete-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "activation_trace",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "activation_event_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "activation-population-is-empty",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "activation_event_population",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "activation_event_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "dormancy-verification",
        "claim_kind": "verification",
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
              "role": "production_graph"
            },
            {
              "kind": "reference",
              "role": "production_entrypoint_population"
            },
            {
              "kind": "reference",
              "role": "dormant_component"
            },
            {
              "kind": "reference",
              "role": "activation_trace"
            },
            {
              "kind": "reference",
              "role": "default_configuration_artifact"
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
          "subject_role": "activation_event_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "activation_detected_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "activation_event_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "production_graph",
          "graph_node_population",
          "production_entrypoint_population",
          "activation_event_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-activation-event-population",
        "comparison": "complete_population",
        "roles": [
          "activation_event_population",
          "activation_events"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/resolver_fact_patterns/3",
      "value": {
        "pattern_id": "complete-activation-observation-is-empty",
        "resolver_kind": "activation-observation",
        "fact_key": "complete-population-is-empty",
        "argument_roles": [
          "activation_trace",
          "activation_event_population",
          "dormant_component"
        ]
      }
    }
  ]
}
```

### activation_events

Declare activation events for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "activation_events",
        "allowed_type_terms": [
          "cc:event",
          "cc:evidence"
        ],
        "cardinality": "zero_or_more",
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
        "pattern_id": "complete-activation-event-population",
        "comparison": "complete_population",
        "roles": [
          "activation_event_population",
          "activation_events"
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
        "reference_role": "activation_events",
        "number_role": "activation_event_count"
      }
    }
  ]
}
```

### default_configuration_artifact

Declare default configuration artifact for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "default_configuration_artifact",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration"
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
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "default-configuration-is-inactive",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "default_configuration_artifact",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "default_inactive_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "dormancy-verification",
        "claim_kind": "verification",
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
              "role": "production_graph"
            },
            {
              "kind": "reference",
              "role": "production_entrypoint_population"
            },
            {
              "kind": "reference",
              "role": "dormant_component"
            },
            {
              "kind": "reference",
              "role": "activation_trace"
            },
            {
              "kind": "reference",
              "role": "default_configuration_artifact"
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
          "subject_role": "activation_event_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "activation_detected_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "activation_event_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "activation_trace",
          "default_configuration_artifact",
          "production_graph"
        ]
      }
    }
  ]
}
```

### default_inactive_state

Declare default inactive state for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "default_inactive_state",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "profile_term"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "default-configuration-is-inactive",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "default_configuration_artifact",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "default_inactive_state"
            }
          ]
        }
      }
    }
  ]
}
```

### verification

Declare verification for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
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
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "dormancy-verification",
        "claim_kind": "verification",
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
              "role": "production_graph"
            },
            {
              "kind": "reference",
              "role": "production_entrypoint_population"
            },
            {
              "kind": "reference",
              "role": "dormant_component"
            },
            {
              "kind": "reference",
              "role": "activation_trace"
            },
            {
              "kind": "reference",
              "role": "default_configuration_artifact"
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
          "subject_role": "activation_event_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "activation_detected_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "activation_event_count"
            }
          ]
        }
      }
    }
  ]
}
```

### activation_detected_condition

Declare activation detected condition for proof.dormancy.nonactivation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "activation_detected_condition",
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
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "dormancy-verification",
        "claim_kind": "verification",
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
              "role": "production_graph"
            },
            {
              "kind": "reference",
              "role": "production_entrypoint_population"
            },
            {
              "kind": "reference",
              "role": "dormant_component"
            },
            {
              "kind": "reference",
              "role": "activation_trace"
            },
            {
              "kind": "reference",
              "role": "default_configuration_artifact"
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
          "subject_role": "activation_event_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "activation_detected_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "activation_event_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-nonactivation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "activation_detected_condition"
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
| construction_operation | semantic_parameter | construction_operation |  |
| registration_operation | semantic_parameter | registration_operation |  |
| registry | semantic_parameter | registry |  |
| dormant_component | semantic_parameter | dormant_component |  |
| production_graph | semantic_parameter | production_graph |  |
| graph_node_population | semantic_parameter | graph_node_population |  |
| graph_nodes | semantic_parameter | graph_nodes |  |
| production_entrypoint_population | semantic_parameter | production_entrypoint_population |  |
| production_entrypoints | semantic_parameter | production_entrypoints |  |
| activation_event_population | semantic_parameter | activation_event_population |  |
| activation_events | semantic_parameter | activation_events |  |
| activation_trace | observation_requirement |  | Acquire activation_trace for the exact subject, attempt and applicability in this profile. |
| default_configuration_artifact | semantic_parameter | default_configuration_artifact |  |
| default_inactive_state | semantic_parameter | default_inactive_state |  |
| verification | semantic_parameter | verification |  |
| activation_detected_condition | semantic_parameter | activation_detected_condition |  |
| activation_event_count | definition_constant |  |  |

```json
{
  "roles": [
    {
      "role": "construction_operation",
      "kind": "semantic_parameter",
      "parameter": "construction_operation",
      "inputs": [],
      "rule_refs": [
        "/distinct_reference_role_sets/0",
        "/resolver_fact_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "construction_operation",
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
      "role": "registration_operation",
      "kind": "semantic_parameter",
      "parameter": "registration_operation",
      "inputs": [],
      "rule_refs": [
        "/distinct_reference_role_sets/0",
        "/resolver_fact_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "registration_operation",
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
      "role": "registry",
      "kind": "semantic_parameter",
      "parameter": "registry",
      "inputs": [],
      "rule_refs": [
        "/distinct_reference_role_sets/1",
        "/resolver_fact_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "registry",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:resource"
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
      "role": "dormant_component",
      "kind": "semantic_parameter",
      "parameter": "dormant_component",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/1",
        "/resolver_fact_patterns/0",
        "/resolver_fact_patterns/1",
        "/resolver_fact_patterns/2",
        "/resolver_fact_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "dormant_component",
        "allowed_type_terms": [
          "cc:runtime_component",
          "cc:entity",
          "cc:resource"
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
      "role": "production_graph",
      "kind": "semantic_parameter",
      "parameter": "production_graph",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/distinct_reference_role_sets/2",
        "/distinct_reference_role_sets/3",
        "/resolver_fact_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "production_graph",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "graph_node_population",
      "kind": "semantic_parameter",
      "parameter": "graph_node_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/distinct_reference_role_sets/2",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "graph_node_population",
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
      "role": "graph_nodes",
      "kind": "semantic_parameter",
      "parameter": "graph_nodes",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "graph_nodes",
        "allowed_type_terms": [
          "cc:operation",
          "cc:resource",
          "cc:runtime_component",
          "cc:entity"
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
      "role": "production_entrypoint_population",
      "kind": "semantic_parameter",
      "parameter": "production_entrypoint_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/2",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "production_entrypoint_population",
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
      "role": "production_entrypoints",
      "kind": "semantic_parameter",
      "parameter": "production_entrypoints",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1",
        "/resolver_fact_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "production_entrypoints",
        "allowed_type_terms": [
          "cc:operation",
          "cc:resource"
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
      "role": "activation_event_population",
      "kind": "semantic_parameter",
      "parameter": "activation_event_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/2",
        "/reference_binding_patterns/2",
        "/resolver_fact_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "activation_event_population",
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
      "role": "activation_events",
      "kind": "semantic_parameter",
      "parameter": "activation_events",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "activation_events",
        "allowed_type_terms": [
          "cc:event",
          "cc:evidence"
        ],
        "cardinality": "zero_or_more",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "activation_trace",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/3",
        "/resolver_fact_patterns/3"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire activation_trace for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.dormancy.nonactivation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "activation_trace",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "default_configuration_artifact",
      "kind": "semantic_parameter",
      "parameter": "default_configuration_artifact",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "default_configuration_artifact",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "default_inactive_state",
      "kind": "semantic_parameter",
      "parameter": "default_inactive_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "default_inactive_state",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "profile_term"
        ]
      }
    },
    {
      "role": "verification",
      "kind": "semantic_parameter",
      "parameter": "verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5"
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
          "repository_path",
          "durable_id"
        ]
      }
    },
    {
      "role": "activation_detected_condition",
      "kind": "semantic_parameter",
      "parameter": "activation_detected_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "activation_detected_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "activation_event_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "activation_event_count",
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
          "construction_operation",
          "registration_operation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "dormant_component",
          "registry"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "production_graph",
          "graph_node_population",
          "production_entrypoint_population",
          "activation_event_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "activation_trace",
          "default_configuration_artifact",
          "production_graph"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-graph-node-population",
        "comparison": "complete_population",
        "roles": [
          "graph_node_population",
          "graph_nodes"
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
        "pattern_id": "complete-production-entrypoint-population",
        "comparison": "complete_population",
        "roles": [
          "production_entrypoint_population",
          "production_entrypoints"
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
        "pattern_id": "complete-activation-event-population",
        "comparison": "complete_population",
        "roles": [
          "activation_event_population",
          "activation_events"
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
        "reference_role": "activation_events",
        "number_role": "activation_event_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "component-is-a-graph-node",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "dormant_component",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "graph_node_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "entrypoints-are-graph-nodes",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "production_entrypoint_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "graph_node_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "default-configuration-is-inactive",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "default_configuration_artifact",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "default_inactive_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "activation-trace-records-complete-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "activation_trace",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "activation_event_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "activation-population-is-empty",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "activation_event_population",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "activation_event_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "dormancy-verification",
        "claim_kind": "verification",
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
              "role": "production_graph"
            },
            {
              "kind": "reference",
              "role": "production_entrypoint_population"
            },
            {
              "kind": "reference",
              "role": "dormant_component"
            },
            {
              "kind": "reference",
              "role": "activation_trace"
            },
            {
              "kind": "reference",
              "role": "default_configuration_artifact"
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
          "subject_role": "activation_event_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "activation_detected_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "activation_event_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-nonactivation",
        "role": "verifies",
        "source_claim_pattern_id": "dormancy-verification",
        "target_claim_pattern_id": "activation-population-is-empty"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-nonactivation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "activation_detected_condition"
          ]
        }
      }
    },
    {
      "ref": "/resolver_fact_patterns/0",
      "constraint": {
        "pattern_id": "direct-construction-succeeds",
        "resolver_kind": "direct-construction",
        "fact_key": "succeeds",
        "argument_roles": [
          "construction_operation",
          "dormant_component"
        ]
      }
    },
    {
      "ref": "/resolver_fact_patterns/1",
      "constraint": {
        "pattern_id": "direct-registration-succeeds",
        "resolver_kind": "direct-registration",
        "fact_key": "succeeds",
        "argument_roles": [
          "registration_operation",
          "registry",
          "dormant_component"
        ]
      }
    },
    {
      "ref": "/resolver_fact_patterns/2",
      "constraint": {
        "pattern_id": "no-production-path-to-component",
        "resolver_kind": "code-reachability",
        "fact_key": "no-path-from-declared-production-entrypoints",
        "argument_roles": [
          "production_graph",
          "production_entrypoints",
          "dormant_component"
        ]
      }
    },
    {
      "ref": "/resolver_fact_patterns/3",
      "constraint": {
        "pattern_id": "complete-activation-observation-is-empty",
        "resolver_kind": "activation-observation",
        "fact_key": "complete-population-is-empty",
        "argument_roles": [
          "activation_trace",
          "activation_event_population",
          "dormant_component"
        ]
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-graph-node-population"
          },
          {
            "pattern": "complete-production-entrypoint-population"
          },
          {
            "pattern": "complete-activation-event-population"
          },
          {
            "pattern": "component-is-a-graph-node"
          },
          {
            "pattern": "entrypoints-are-graph-nodes"
          },
          {
            "pattern": "default-configuration-is-inactive"
          },
          {
            "pattern": "activation-trace-records-complete-population"
          },
          {
            "pattern": "activation-population-is-empty"
          },
          {
            "pattern": "dormancy-verification"
          },
          {
            "pattern": "verification-targets-nonactivation"
          },
          {
            "pattern": "direct-construction-succeeds"
          },
          {
            "pattern": "direct-registration-succeeds"
          },
          {
            "pattern": "no-production-path-to-component"
          },
          {
            "pattern": "complete-activation-observation-is-empty"
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
      "construction_operation",
      "registration_operation",
      "registry",
      "dormant_component",
      "production_graph",
      "graph_node_population",
      "graph_nodes",
      "production_entrypoint_population",
      "production_entrypoints",
      "activation_event_population",
      "activation_events",
      "default_configuration_artifact",
      "default_inactive_state",
      "verification",
      "activation_detected_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "activation_trace"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.dormancy.nonactivation.",
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
        "missing": "No named proof.dormancy.nonactivation constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.dormancy.nonactivation.",
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
