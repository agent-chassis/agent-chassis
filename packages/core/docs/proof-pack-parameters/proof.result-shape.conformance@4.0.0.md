# proof.result-shape.conformance@4.0.0

<!-- Generated from validated package metadata. -->

When one declared operation returns one grounded result governed by one grounded schema, the declared observed-result, required-member, optional-member, allowed-member, forbidden-member, allowed-shape, and forbidden-shape populations are complete; every declared required typed member descriptor is present in the observed result population, every observed typed member descriptor belongs to the exact allowed population, every declared forbidden member descriptor is absent, the observed result shape belongs to the exact allowed-shape population and not to the exact forbidden-shape population, and the emitted result count equals the exact observed-member population cardinality.

Profile digest: 735fc66c518c193972648f0c9d4021803a3e923b241513e47487240da3ed452f. Parameter digest: e905347cb7fe1a7aac46e9a28197b8429c18fe7aa05fe89a54c85e3ac581560b.

Admission digest: 8caca8909f26dac2c7343a186c478314897e34aa858269f92aa6afa9db8f1eaf.

Roles: 32/32 accounted; 1 owned gaps. Semantic parameters: 24; internal roles: 8.

## Guarantee and exclusions

When one declared operation returns one grounded result governed by one grounded schema, the declared observed-result, required-member, optional-member, allowed-member, forbidden-member, allowed-shape, and forbidden-shape populations are complete; every declared required typed member descriptor is present in the observed result population, every observed typed member descriptor belongs to the exact allowed population, every declared forbidden member descriptor is absent, the observed result shape belongs to the exact allowed-shape population and not to the exact forbidden-shape population, and the emitted result count equals the exact observed-member population cardinality.

- authored-schema-truthfulness
- conditional-cross-member-invariants
- delivered-test-implementation
- identity-target-existence
- member-value-business-semantics
- nested-recursive-shape-validation
- optional-member-presence
- schema-version-negotiation
- serialization-and-transport-media

## Parameters

### operation

Declare operation for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "operation-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "operation",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation",
          "result",
          "schema",
          "verification"
        ]
      }
    }
  ]
}
```

### result

Declare result for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "operation-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "operation",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "result-carries-member-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verification-reads-result-contract",
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
              "role": "result"
            },
            {
              "kind": "reference",
              "role": "schema"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            },
            {
              "kind": "reference",
              "role": "result_shape"
            },
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            },
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "result-declares-shape",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_shape"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "result-emits-count",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation",
          "result",
          "schema",
          "verification"
        ]
      }
    }
  ]
}
```

### schema

Declare schema for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "schema",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration"
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
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verification-reads-result-contract",
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
              "role": "result"
            },
            {
              "kind": "reference",
              "role": "schema"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            },
            {
              "kind": "reference",
              "role": "result_shape"
            },
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            },
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "schema-declares-member-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "schema",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "optional_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "schema-declares-shape-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "schema",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation",
          "result",
          "schema",
          "verification"
        ]
      }
    }
  ]
}
```

### result_population

Declare result population for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "result_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "result-carries-member-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "result-members-allowed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verification-reads-result-contract",
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
              "role": "result"
            },
            {
              "kind": "reference",
              "role": "schema"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            },
            {
              "kind": "reference",
              "role": "result_shape"
            },
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            },
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "required-members-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "required_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "missing_required_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        },
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
              "role": "required_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "allowed-members-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unexpected_member_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        },
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
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "each-forbidden-member-absent",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member"
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "required-members-present",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "required_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "result_population",
          "required_population",
          "optional_population",
          "allowed_population",
          "forbidden_member_population",
          "allowed_shape_population",
          "forbidden_shape_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-result-population",
        "comparison": "complete_population",
        "roles": [
          "result_population",
          "result_members"
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

### result_members

Declare result members for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "result_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
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
        "pattern_id": "complete-result-population",
        "comparison": "complete_population",
        "roles": [
          "result_population",
          "result_members"
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
        "reference_role": "result_members",
        "number_role": "result_count"
      }
    }
  ]
}
```

### required_population

Declare required population for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "required_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verification-reads-result-contract",
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
              "role": "result"
            },
            {
              "kind": "reference",
              "role": "schema"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            },
            {
              "kind": "reference",
              "role": "result_shape"
            },
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            },
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "required-members-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "required_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "missing_required_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        },
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
              "role": "required_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "schema-declares-member-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "schema",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "optional_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "required-population-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "required_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "required-members-present",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "required_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "result_population",
          "required_population",
          "optional_population",
          "allowed_population",
          "forbidden_member_population",
          "allowed_shape_population",
          "forbidden_shape_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-required-population",
        "comparison": "complete_population",
        "roles": [
          "required_population",
          "required_members"
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

### required_members

Declare required members for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "required_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
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
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-required-population",
        "comparison": "complete_population",
        "roles": [
          "required_population",
          "required_members"
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
        "reference_role": "required_members",
        "number_role": "required_count"
      }
    }
  ]
}
```

### optional_population

Declare optional population for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "optional_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "schema-declares-member-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "schema",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "optional_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "optional-population-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "optional_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "result_population",
          "required_population",
          "optional_population",
          "allowed_population",
          "forbidden_member_population",
          "allowed_shape_population",
          "forbidden_shape_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-optional-population",
        "comparison": "complete_population",
        "roles": [
          "optional_population",
          "optional_members"
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

### optional_members

Declare optional members for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "optional_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "zero_or_more",
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
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-optional-population",
        "comparison": "complete_population",
        "roles": [
          "optional_population",
          "optional_members"
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
        "reference_role": "optional_members",
        "number_role": "optional_count"
      }
    }
  ]
}
```

### allowed_population

Declare allowed population for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "allowed_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "result-members-allowed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verification-reads-result-contract",
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
              "role": "result"
            },
            {
              "kind": "reference",
              "role": "schema"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            },
            {
              "kind": "reference",
              "role": "result_shape"
            },
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            },
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "allowed-members-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unexpected_member_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        },
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
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "schema-declares-member-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "schema",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "optional_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "required-population-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "required_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "optional-population-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "optional_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "result_population",
          "required_population",
          "optional_population",
          "allowed_population",
          "forbidden_member_population",
          "allowed_shape_population",
          "forbidden_shape_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-allowed-population",
        "comparison": "complete_population",
        "roles": [
          "allowed_population",
          "allowed_members"
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

### allowed_members

Declare allowed members for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "allowed_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
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
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-allowed-population",
        "comparison": "complete_population",
        "roles": [
          "allowed_population",
          "allowed_members"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "value": {
        "reference_role": "allowed_members",
        "number_role": "allowed_count"
      }
    }
  ]
}
```

### forbidden_member_population

Declare forbidden member population for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "forbidden_member_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verification-reads-result-contract",
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
              "role": "result"
            },
            {
              "kind": "reference",
              "role": "schema"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            },
            {
              "kind": "reference",
              "role": "result_shape"
            },
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            },
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "schema-declares-member-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "schema",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "optional_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "result_population",
          "required_population",
          "optional_population",
          "allowed_population",
          "forbidden_member_population",
          "allowed_shape_population",
          "forbidden_shape_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-forbidden-member-population",
        "comparison": "complete_population",
        "roles": [
          "forbidden_member_population",
          "forbidden_members"
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

### forbidden_members

Declare forbidden members for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "forbidden_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
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
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "each-forbidden-member-absent",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member"
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-forbidden-member-population",
        "comparison": "complete_population",
        "roles": [
          "forbidden_member_population",
          "forbidden_members"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "value": {
        "reference_role": "forbidden_members",
        "number_role": "forbidden_member_count"
      }
    }
  ]
}
```

### allowed_shape_population

Declare allowed shape population for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "allowed_shape_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "result-shape-allowed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verification-reads-result-contract",
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
              "role": "result"
            },
            {
              "kind": "reference",
              "role": "schema"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            },
            {
              "kind": "reference",
              "role": "result_shape"
            },
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            },
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "allowed-shape-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "disallowed_shape_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            }
          ]
        },
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
              "role": "allowed_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "schema-declares-shape-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "schema",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "result_population",
          "required_population",
          "optional_population",
          "allowed_population",
          "forbidden_member_population",
          "allowed_shape_population",
          "forbidden_shape_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-allowed-shape-population",
        "comparison": "complete_population",
        "roles": [
          "allowed_shape_population",
          "allowed_shapes"
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

### allowed_shapes

Declare allowed shapes for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "allowed_shapes",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
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
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-allowed-shape-population",
        "comparison": "complete_population",
        "roles": [
          "allowed_shape_population",
          "allowed_shapes"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "value": {
        "reference_role": "allowed_shapes",
        "number_role": "allowed_shape_count"
      }
    }
  ]
}
```

### forbidden_shape_population

Declare forbidden shape population for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "forbidden_shape_population",
        "allowed_type_terms": [
          "cc:population"
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
        "pattern_id": "result-shape-not-forbidden",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verification-reads-result-contract",
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
              "role": "result"
            },
            {
              "kind": "reference",
              "role": "schema"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            },
            {
              "kind": "reference",
              "role": "result_shape"
            },
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            },
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "forbidden-shape-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "forbidden_shape_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        },
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
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "schema-declares-shape-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "schema",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "result_population",
          "required_population",
          "optional_population",
          "allowed_population",
          "forbidden_member_population",
          "allowed_shape_population",
          "forbidden_shape_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "complete-forbidden-shape-population",
        "comparison": "complete_population",
        "roles": [
          "forbidden_shape_population",
          "forbidden_shapes"
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

### forbidden_shapes

Declare forbidden shapes for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "forbidden_shapes",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
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
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "complete-forbidden-shape-population",
        "comparison": "complete_population",
        "roles": [
          "forbidden_shape_population",
          "forbidden_shapes"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/6",
      "value": {
        "reference_role": "forbidden_shapes",
        "number_role": "forbidden_shape_count"
      }
    }
  ]
}
```

### result_shape

Declare result shape for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "result_shape",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "result-shape-allowed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "result-shape-not-forbidden",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verification-reads-result-contract",
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
              "role": "result"
            },
            {
              "kind": "reference",
              "role": "schema"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            },
            {
              "kind": "reference",
              "role": "result_shape"
            },
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            },
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "allowed-shape-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "disallowed_shape_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            }
          ]
        },
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
              "role": "allowed_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "forbidden-shape-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "forbidden_shape_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        },
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
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "result-declares-shape",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_shape"
            }
          ]
        }
      }
    }
  ]
}
```

### verification

Declare verification for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
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
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verification-reads-result-contract",
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
              "role": "result"
            },
            {
              "kind": "reference",
              "role": "schema"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            },
            {
              "kind": "reference",
              "role": "result_shape"
            },
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            },
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "required-members-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "required_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "missing_required_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        },
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
              "role": "required_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "allowed-members-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unexpected_member_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        },
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
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "allowed-shape-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "disallowed_shape_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            }
          ]
        },
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
              "role": "allowed_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "forbidden-shape-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "forbidden_shape_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        },
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
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "result-count-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "incorrect_count_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "result_count"
            }
          ]
        },
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
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation",
          "result",
          "schema",
          "verification"
        ]
      }
    }
  ]
}
```

### missing_required_condition

Declare missing required condition for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "missing_required_condition",
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
        "pattern_id": "required-members-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "required_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "missing_required_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        },
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
              "role": "required_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "missing_required_condition",
          "unexpected_member_condition",
          "disallowed_shape_condition",
          "forbidden_shape_condition",
          "incorrect_count_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-target-required-members",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "missing_required_condition"
          ]
        }
      }
    }
  ]
}
```

### unexpected_member_condition

Declare unexpected member condition for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "unexpected_member_condition",
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
        "pattern_id": "allowed-members-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unexpected_member_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        },
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
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "missing_required_condition",
          "unexpected_member_condition",
          "disallowed_shape_condition",
          "forbidden_shape_condition",
          "incorrect_count_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-target-allowed-members",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "unexpected_member_condition"
          ]
        }
      }
    }
  ]
}
```

### disallowed_shape_condition

Declare disallowed shape condition for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "disallowed_shape_condition",
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
        "pattern_id": "allowed-shape-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "disallowed_shape_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            }
          ]
        },
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
              "role": "allowed_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "missing_required_condition",
          "unexpected_member_condition",
          "disallowed_shape_condition",
          "forbidden_shape_condition",
          "incorrect_count_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "verification-target-allowed-shape",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "disallowed_shape_condition"
          ]
        }
      }
    }
  ]
}
```

### forbidden_shape_condition

Declare forbidden shape condition for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "forbidden_shape_condition",
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
        "pattern_id": "forbidden-shape-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "forbidden_shape_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        },
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
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "missing_required_condition",
          "unexpected_member_condition",
          "disallowed_shape_condition",
          "forbidden_shape_condition",
          "incorrect_count_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "verification-target-forbidden-shape",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "forbidden_shape_condition"
          ]
        }
      }
    }
  ]
}
```

### incorrect_count_condition

Declare incorrect count condition for proof.result-shape.conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "incorrect_count_condition",
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
        "pattern_id": "result-count-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "incorrect_count_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "result_count"
            }
          ]
        },
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
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "missing_required_condition",
          "unexpected_member_condition",
          "disallowed_shape_condition",
          "forbidden_shape_condition",
          "incorrect_count_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "value": {
        "relation_pattern_id": "verification-target-result-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "incorrect_count_condition"
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
| result | semantic_parameter | result |  |
| schema | semantic_parameter | schema |  |
| result_population | semantic_parameter | result_population |  |
| result_members | semantic_parameter | result_members |  |
| required_population | semantic_parameter | required_population |  |
| required_members | semantic_parameter | required_members |  |
| optional_population | semantic_parameter | optional_population |  |
| optional_members | semantic_parameter | optional_members |  |
| allowed_population | semantic_parameter | allowed_population |  |
| allowed_members | semantic_parameter | allowed_members |  |
| forbidden_member_population | semantic_parameter | forbidden_member_population |  |
| forbidden_members | semantic_parameter | forbidden_members |  |
| allowed_shape_population | semantic_parameter | allowed_shape_population |  |
| allowed_shapes | semantic_parameter | allowed_shapes |  |
| forbidden_shape_population | semantic_parameter | forbidden_shape_population |  |
| forbidden_shapes | semantic_parameter | forbidden_shapes |  |
| result_shape | semantic_parameter | result_shape |  |
| result_count_signal | observation_requirement |  | Acquire result_count_signal for the exact subject, attempt and applicability in this profile. |
| verification | semantic_parameter | verification |  |
| missing_required_condition | semantic_parameter | missing_required_condition |  |
| unexpected_member_condition | semantic_parameter | unexpected_member_condition |  |
| disallowed_shape_condition | semantic_parameter | disallowed_shape_condition |  |
| forbidden_shape_condition | semantic_parameter | forbidden_shape_condition |  |
| incorrect_count_condition | semantic_parameter | incorrect_count_condition |  |
| result_count | complete_population_count | result_members |  |
| required_count | complete_population_count | required_members |  |
| optional_count | complete_population_count | optional_members |  |
| allowed_count | complete_population_count | allowed_members |  |
| forbidden_member_count | complete_population_count | forbidden_members |  |
| allowed_shape_count | complete_population_count | allowed_shapes |  |
| forbidden_shape_count | complete_population_count | forbidden_shapes |  |

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
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "operation",
        "allowed_type_terms": [
          "cc:operation"
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
      "role": "result",
      "kind": "semantic_parameter",
      "parameter": "result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/14",
        "/claim_patterns/2",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
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
      "role": "schema",
      "kind": "semantic_parameter",
      "parameter": "schema",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "schema",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration"
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
      "role": "result_population",
      "kind": "semantic_parameter",
      "parameter": "result_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/10",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "result_population",
        "allowed_type_terms": [
          "cc:population"
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
      "role": "result_members",
      "kind": "semantic_parameter",
      "parameter": "result_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "result_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
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
      "role": "required_population",
      "kind": "semantic_parameter",
      "parameter": "required_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "required_population",
        "allowed_type_terms": [
          "cc:population"
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
      "role": "required_members",
      "kind": "semantic_parameter",
      "parameter": "required_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "required_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
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
      "role": "optional_population",
      "kind": "semantic_parameter",
      "parameter": "optional_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "optional_population",
        "allowed_type_terms": [
          "cc:population"
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
      "role": "optional_members",
      "kind": "semantic_parameter",
      "parameter": "optional_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "optional_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "zero_or_more",
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "allowed_population",
      "kind": "semantic_parameter",
      "parameter": "allowed_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/14",
        "/claim_patterns/16",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_population",
        "allowed_type_terms": [
          "cc:population"
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
      "role": "allowed_members",
      "kind": "semantic_parameter",
      "parameter": "allowed_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
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
      "role": "forbidden_member_population",
      "kind": "semantic_parameter",
      "parameter": "forbidden_member_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/3",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_member_population",
        "allowed_type_terms": [
          "cc:population"
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
      "role": "forbidden_members",
      "kind": "semantic_parameter",
      "parameter": "forbidden_members",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/7",
        "/reference_binding_patterns/4",
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
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
      "role": "allowed_shape_population",
      "kind": "semantic_parameter",
      "parameter": "allowed_shape_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/14",
        "/claim_patterns/17",
        "/claim_patterns/4",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_shape_population",
        "allowed_type_terms": [
          "cc:population"
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
      "role": "allowed_shapes",
      "kind": "semantic_parameter",
      "parameter": "allowed_shapes",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/5",
        "/reference_role_count_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_shapes",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
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
      "role": "forbidden_shape_population",
      "kind": "semantic_parameter",
      "parameter": "forbidden_shape_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/14",
        "/claim_patterns/18",
        "/claim_patterns/4",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_shape_population",
        "allowed_type_terms": [
          "cc:population"
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
      "role": "forbidden_shapes",
      "kind": "semantic_parameter",
      "parameter": "forbidden_shapes",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/6",
        "/reference_role_count_bindings/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_shapes",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
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
      "role": "result_shape",
      "kind": "semantic_parameter",
      "parameter": "result_shape",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/14",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "result_shape",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
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
      "role": "result_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/19",
        "/claim_patterns/8"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire result_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.result-shape.conformance/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "result_count_signal",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
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
      "role": "verification",
      "kind": "semantic_parameter",
      "parameter": "verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/distinct_reference_role_sets/0"
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
          "repository_path",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "missing_required_condition",
      "kind": "semantic_parameter",
      "parameter": "missing_required_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "missing_required_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "unexpected_member_condition",
      "kind": "semantic_parameter",
      "parameter": "unexpected_member_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "unexpected_member_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "disallowed_shape_condition",
      "kind": "semantic_parameter",
      "parameter": "disallowed_shape_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "disallowed_shape_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "forbidden_shape_condition",
      "kind": "semantic_parameter",
      "parameter": "forbidden_shape_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_shape_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "incorrect_count_condition",
      "kind": "semantic_parameter",
      "parameter": "incorrect_count_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "incorrect_count_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "result_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "result_members"
      ],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/19",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "result_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "required_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "required_members"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "required_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "optional_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "optional_members"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "optional_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0
      }
    },
    {
      "role": "allowed_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "allowed_members"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "forbidden_member_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "forbidden_members"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_member_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "allowed_shape_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "allowed_shapes"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_shape_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "forbidden_shape_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "forbidden_shapes"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "forbidden_shape_count",
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
          "operation",
          "result",
          "schema",
          "verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "result_population",
          "required_population",
          "optional_population",
          "allowed_population",
          "forbidden_member_population",
          "allowed_shape_population",
          "forbidden_shape_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "missing_required_condition",
          "unexpected_member_condition",
          "disallowed_shape_condition",
          "forbidden_shape_condition",
          "incorrect_count_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-result-population",
        "comparison": "complete_population",
        "roles": [
          "result_population",
          "result_members"
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
        "pattern_id": "complete-required-population",
        "comparison": "complete_population",
        "roles": [
          "required_population",
          "required_members"
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
        "pattern_id": "complete-optional-population",
        "comparison": "complete_population",
        "roles": [
          "optional_population",
          "optional_members"
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
        "pattern_id": "complete-allowed-population",
        "comparison": "complete_population",
        "roles": [
          "allowed_population",
          "allowed_members"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "constraint": {
        "pattern_id": "complete-forbidden-member-population",
        "comparison": "complete_population",
        "roles": [
          "forbidden_member_population",
          "forbidden_members"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "constraint": {
        "pattern_id": "complete-allowed-shape-population",
        "comparison": "complete_population",
        "roles": [
          "allowed_shape_population",
          "allowed_shapes"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "constraint": {
        "pattern_id": "complete-forbidden-shape-population",
        "comparison": "complete_population",
        "roles": [
          "forbidden_shape_population",
          "forbidden_shapes"
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
        "reference_role": "result_members",
        "number_role": "result_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "required_members",
        "number_role": "required_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "optional_members",
        "number_role": "optional_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "allowed_members",
        "number_role": "allowed_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "constraint": {
        "reference_role": "forbidden_members",
        "number_role": "forbidden_member_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "constraint": {
        "reference_role": "allowed_shapes",
        "number_role": "allowed_shape_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/6",
      "constraint": {
        "reference_role": "forbidden_shapes",
        "number_role": "forbidden_shape_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "operation-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "operation",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "result-carries-member-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "result-declares-shape",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_shape"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "schema-declares-member-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "schema",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "optional_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "schema-declares-shape-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "schema",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "required-population-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "required_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "optional-population-allowed",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "optional_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "each-forbidden-member-absent",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "forbidden_members",
          "member_role": "forbidden_member"
        },
        "proposition_template": {
          "subject_role": "forbidden_member",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "result-emits-count",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "required-members-present",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "required_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "result-members-allowed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "result-shape-allowed",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "result-shape-not-forbidden",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "result-count-complete",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "result_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "verification-reads-result-contract",
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
              "role": "result"
            },
            {
              "kind": "reference",
              "role": "schema"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "required_population"
            },
            {
              "kind": "reference",
              "role": "allowed_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_member_population"
            },
            {
              "kind": "reference",
              "role": "result_shape"
            },
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            },
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            },
            {
              "kind": "reference",
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "required-members-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "required_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "missing_required_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_population"
            }
          ]
        },
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
              "role": "required_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "allowed-members-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unexpected_member_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_population"
            }
          ]
        },
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
              "role": "allowed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "allowed-shape-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "disallowed_shape_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "allowed_shape_population"
            }
          ]
        },
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
              "role": "allowed_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "forbidden-shape-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_shape",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "forbidden_shape_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "forbidden_shape_population"
            }
          ]
        },
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
              "role": "forbidden_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "result-count-verification",
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
        "falsifying_proposition_template": {
          "subject_role": "result_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "incorrect_count_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "result_count"
            }
          ]
        },
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
              "role": "result_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-required-members",
        "role": "verifies",
        "source_claim_pattern_id": "required-members-verification",
        "target_claim_pattern_id": "required-members-present"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-target-allowed-members",
        "role": "verifies",
        "source_claim_pattern_id": "allowed-members-verification",
        "target_claim_pattern_id": "result-members-allowed"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "verification-target-allowed-shape",
        "role": "verifies",
        "source_claim_pattern_id": "allowed-shape-verification",
        "target_claim_pattern_id": "result-shape-allowed"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "verification-target-forbidden-shape",
        "role": "verifies",
        "source_claim_pattern_id": "forbidden-shape-verification",
        "target_claim_pattern_id": "result-shape-not-forbidden"
      }
    },
    {
      "ref": "/relation_patterns/4",
      "constraint": {
        "pattern_id": "verification-target-result-count",
        "role": "verifies",
        "source_claim_pattern_id": "result-count-verification",
        "target_claim_pattern_id": "result-count-complete"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-required-members",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "missing_required_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-target-allowed-members",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "unexpected_member_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "verification-target-allowed-shape",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "disallowed_shape_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "verification-target-forbidden-shape",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "forbidden_shape_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "constraint": {
        "relation_pattern_id": "verification-target-result-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "incorrect_count_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-result-population"
          },
          {
            "pattern": "complete-required-population"
          },
          {
            "pattern": "complete-optional-population"
          },
          {
            "pattern": "complete-allowed-population"
          },
          {
            "pattern": "complete-forbidden-member-population"
          },
          {
            "pattern": "complete-allowed-shape-population"
          },
          {
            "pattern": "complete-forbidden-shape-population"
          },
          {
            "pattern": "operation-returns-result"
          },
          {
            "pattern": "result-carries-member-population"
          },
          {
            "pattern": "result-declares-shape"
          },
          {
            "pattern": "schema-declares-member-populations"
          },
          {
            "pattern": "schema-declares-shape-populations"
          },
          {
            "pattern": "required-population-allowed"
          },
          {
            "pattern": "optional-population-allowed"
          },
          {
            "pattern": "each-forbidden-member-absent"
          },
          {
            "pattern": "result-emits-count"
          },
          {
            "pattern": "required-members-present"
          },
          {
            "pattern": "result-members-allowed"
          },
          {
            "pattern": "result-shape-allowed"
          },
          {
            "pattern": "result-shape-not-forbidden"
          },
          {
            "pattern": "result-count-complete"
          },
          {
            "pattern": "verification-reads-result-contract"
          },
          {
            "pattern": "required-members-verification"
          },
          {
            "pattern": "allowed-members-verification"
          },
          {
            "pattern": "allowed-shape-verification"
          },
          {
            "pattern": "forbidden-shape-verification"
          },
          {
            "pattern": "result-count-verification"
          },
          {
            "pattern": "verification-target-required-members"
          },
          {
            "pattern": "verification-target-allowed-members"
          },
          {
            "pattern": "verification-target-allowed-shape"
          },
          {
            "pattern": "verification-target-forbidden-shape"
          },
          {
            "pattern": "verification-target-result-count"
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
      "result",
      "schema",
      "result_population",
      "result_members",
      "required_population",
      "required_members",
      "optional_population",
      "optional_members",
      "allowed_population",
      "allowed_members",
      "forbidden_member_population",
      "forbidden_members",
      "allowed_shape_population",
      "allowed_shapes",
      "forbidden_shape_population",
      "forbidden_shapes",
      "result_shape",
      "verification",
      "missing_required_condition",
      "unexpected_member_condition",
      "disallowed_shape_condition",
      "forbidden_shape_condition",
      "incorrect_count_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "result_count_signal"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.result-shape.conformance.",
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
        "missing": "No named proof.result-shape.conformance constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.result-shape.conformance.",
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
