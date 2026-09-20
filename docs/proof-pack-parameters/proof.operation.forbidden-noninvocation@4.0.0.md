# proof.operation.forbidden-noninvocation@4.0.0

<!-- Generated from validated package metadata. -->

For one caller-declared subject operation, one declared execution context, and one complete exact nonempty forbidden-operation population, the subject does not use any forbidden member in that context; one verification reads the exact subject, context, population, and every forbidden member, verifies that prohibition, and carries same-subject, same-context positive use of the same complete population as its falsifier.

Profile digest: d33c7c3eb034b334d4bcda5705c3334a98e408ecf91663b03bab81b60058956d. Parameter digest: 155ade16dc80fb3a012eaafe94dcfa930ab9ac985630e3f23833a6cb6c312007.

Admission digest: 79e064866a623f91c5026045e05c25b36f728287fdace8535780415ce1df9e6d.

Roles: 5/5 accounted; 0 owned gaps. Semantic parameters: 5; internal roles: 0.

## Guarantee and exclusions

For one caller-declared subject operation, one declared execution context, and one complete exact nonempty forbidden-operation population, the subject does not use any forbidden member in that context; one verification reads the exact subject, context, population, and every forbidden member, verifies that prohibition, and carries same-subject, same-context positive use of the same complete population as its falsifier.

- actual-execution-or-mutation-test-outcome
- dishonest-reference-context-population-or-verification-grounding
- dynamic-reflective-or-environment-dependent-invocation-absent-from-the-declared-model
- forbidden-operations-outside-the-caller-declared-complete-population
- invocation-after-or-outside-the-declared-context
- production-path-or-call-graph-discovery

## Parameters

### subject_operation

Declare subject operation for proof.operation.forbidden-noninvocation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "subject_operation",
        "allowed_type_terms": [
          "cc:operation",
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "subject-does-not-use-forbidden-operations",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "subject_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "execution_context"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "verification-observes-exact-noninvocation-subjects",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "verify-forbidden-operation-noninvocation",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
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
          "subject_role": "subject_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "execution_context"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "subject_operation",
          "execution_context",
          "forbidden_operation_population",
          "verification"
        ]
      }
    }
  ]
}
```

### execution_context

Declare execution context for proof.operation.forbidden-noninvocation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "execution_context",
        "allowed_type_terms": [
          "cc:authority",
          "cc:configuration",
          "cc:scope",
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "profile_term",
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
        "pattern_id": "subject-does-not-use-forbidden-operations",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "subject_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "execution_context"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "verification-observes-exact-noninvocation-subjects",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "verify-forbidden-operation-noninvocation",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
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
          "subject_role": "subject_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "execution_context"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "subject_operation",
          "execution_context",
          "forbidden_operation_population",
          "verification"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-forbidden-operation-noninvocation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "execution_context"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-forbidden-operation-population",
        "comparison": "complete_population",
        "roles": [
          "forbidden_operation_population",
          "forbidden_operations"
        ],
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "execution_context"
          ]
        }
      }
    }
  ]
}
```

### forbidden_operation_population

Declare forbidden operation population for proof.operation.forbidden-noninvocation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "forbidden_operation_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "profile_term",
          "repository_path",
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
        "pattern_id": "verification-observes-exact-noninvocation-subjects",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "verify-forbidden-operation-noninvocation",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
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
          "subject_role": "subject_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "execution_context"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "subject_operation",
          "execution_context",
          "forbidden_operation_population",
          "verification"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-forbidden-operation-population",
        "comparison": "complete_population",
        "roles": [
          "forbidden_operation_population",
          "forbidden_operations"
        ],
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "execution_context"
          ]
        }
      }
    }
  ]
}
```

### forbidden_operations

Declare forbidden operations for proof.operation.forbidden-noninvocation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "forbidden_operations",
        "allowed_type_terms": [
          "cc:operation",
          "cc:process",
          "cc:runtime_component"
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "subject-does-not-use-forbidden-operations",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "subject_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "execution_context"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "verification-observes-exact-noninvocation-subjects",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "verify-forbidden-operation-noninvocation",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
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
          "subject_role": "subject_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "execution_context"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-forbidden-operation-population",
        "comparison": "complete_population",
        "roles": [
          "forbidden_operation_population",
          "forbidden_operations"
        ],
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "execution_context"
          ]
        }
      }
    }
  ]
}
```

### verification

Declare verification for proof.operation.forbidden-noninvocation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "verification-observes-exact-noninvocation-subjects",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "verify-forbidden-operation-noninvocation",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
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
          "subject_role": "subject_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "execution_context"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "subject_operation",
          "execution_context",
          "forbidden_operation_population",
          "verification"
        ]
      }
    }
  ]
}
```

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |
| subject_operation | semantic_parameter | subject_operation |  |
| execution_context | semantic_parameter | execution_context |  |
| forbidden_operation_population | semantic_parameter | forbidden_operation_population |  |
| forbidden_operations | semantic_parameter | forbidden_operations |  |
| verification | semantic_parameter | verification |  |

```json
{
  "roles": [
    {
      "role": "subject_operation",
      "kind": "semantic_parameter",
      "parameter": "subject_operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "subject_operation",
        "allowed_type_terms": [
          "cc:operation",
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
      "role": "execution_context",
      "kind": "semantic_parameter",
      "parameter": "execution_context",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/distinct_reference_role_sets/0",
        "/falsifier_condition_bindings/0",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "execution_context",
        "allowed_type_terms": [
          "cc:authority",
          "cc:configuration",
          "cc:scope",
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "profile_term",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "forbidden_operation_population",
      "kind": "semantic_parameter",
      "parameter": "forbidden_operation_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_operation_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "profile_term",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "forbidden_operations",
      "kind": "semantic_parameter",
      "parameter": "forbidden_operations",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_operations",
        "allowed_type_terms": [
          "cc:operation",
          "cc:process",
          "cc:runtime_component"
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
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/distinct_reference_role_sets/0"
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
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "subject_operation",
          "execution_context",
          "forbidden_operation_population",
          "verification"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-forbidden-operation-population",
        "comparison": "complete_population",
        "roles": [
          "forbidden_operation_population",
          "forbidden_operations"
        ],
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "execution_context"
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "subject-does-not-use-forbidden-operations",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "subject_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "execution_context"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "verification-observes-exact-noninvocation-subjects",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "verify-forbidden-operation-noninvocation",
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
              "role": "subject_operation"
            },
            {
              "kind": "reference",
              "role": "execution_context"
            },
            {
              "kind": "reference",
              "role": "forbidden_operation_population"
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
          "subject_role": "subject_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "execution_context"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_operations"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-forbidden-operation-noninvocation",
        "role": "verifies",
        "source_claim_pattern_id": "verify-forbidden-operation-noninvocation",
        "target_claim_pattern_id": "subject-does-not-use-forbidden-operations"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-forbidden-operation-noninvocation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "execution_context"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-forbidden-operation-population"
          },
          {
            "pattern": "subject-does-not-use-forbidden-operations"
          },
          {
            "pattern": "verification-observes-exact-noninvocation-subjects"
          },
          {
            "pattern": "verify-forbidden-operation-noninvocation"
          },
          {
            "pattern": "verification-targets-forbidden-operation-noninvocation"
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
      "subject_operation",
      "execution_context",
      "forbidden_operation_population",
      "forbidden_operations",
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
      "missing": "No authored exact inter-pack dependency recipe for proof.operation.forbidden-noninvocation.",
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
        "missing": "No named proof.operation.forbidden-noninvocation constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.operation.forbidden-noninvocation.",
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
