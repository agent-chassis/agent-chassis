# proof.result-shape.cross-representation-parity@4.0.0

<!-- Generated from validated package metadata. -->

For one declared logical source, two distinct result surfaces expose equal complete populations of typed member descriptors by mutual subset, bind one shared exact nonnegative member count, emit count signals equal to that count, and expose one explicitly selected canonical value pair that is exactly equal. One verification reads both full representations and each verified behavior has its controlled complement as a separate falsifier.

Profile digest: abbc6e30664d821b34adddc0a02c54b40f6bb3e0e91302e14b402eba2a389162. Parameter digest: 9f014d9621e0ebae975ac8b2cae72aba1cebbe5313984b5174b53b0f1d0245a2.

Admission digest: 47269880848e69f0c81f561b15dd1d062ac3b9aee55dab2f5223f64769c6d19f.

Roles: 18/18 accounted; 2 owned gaps. Semantic parameters: 15; internal roles: 3.

## Guarantee and exclusions

For one declared logical source, two distinct result surfaces expose equal complete populations of typed member descriptors by mutual subset, bind one shared exact nonnegative member count, emit count signals equal to that count, and expose one explicitly selected canonical value pair that is exactly equal. One verification reads both full representations and each verified behavior has its controlled complement as a separate falsifier.

- applicability-selection
- automatic-or-arbitrary-multi-value-pairing
- business-semantics-referential-integrity-and-cross-member-invariants
- caller-authored-population-truthfulness-and-completeness
- delivered-test-implementation-and-result-value-authenticity
- field-name-or-schema-mapping
- independent-schema-truthfulness-or-compatibility
- logical-source-provenance
- nested-recursive-value-parity
- ordering-transport-media-type-pagination-and-streaming-parity
- type-coercion-normalization-unit-conversion-rounding-or-timezone-conversion
- typed-member-descriptor-authoritative-construction-or-existence

## Parameters

### logical_source

Declare logical source for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "logical_source",
        "allowed_type_terms": [
          "cc:entity",
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
        "pattern_id": "source-emits-both-results",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "logical_source",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-both-representations",
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
              "role": "logical_source"
            },
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            },
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "logical_source",
          "left_result",
          "right_result",
          "verification"
        ]
      }
    }
  ]
}
```

### left_result

Declare left result for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "left_result",
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
        "pattern_id": "source-emits-both-results",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "logical_source",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "left-result-exposes-parity-inputs",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "left_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-both-representations",
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
              "role": "logical_source"
            },
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            },
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "logical_source",
          "left_result",
          "right_result",
          "verification"
        ]
      }
    }
  ]
}
```

### right_result

Declare right result for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "right_result",
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
        "pattern_id": "source-emits-both-results",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "logical_source",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "right-result-exposes-parity-inputs",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "right_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-both-representations",
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
              "role": "logical_source"
            },
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            },
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "logical_source",
          "left_result",
          "right_result",
          "verification"
        ]
      }
    }
  ]
}
```

### left_population

Declare left population for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "left_population",
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "left-result-exposes-parity-inputs",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "left_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "right-population-parity-verification",
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
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "right_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "right_population_not_subset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "left-population-within-right",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "left_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "right-population-within-left",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "right_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-both-representations",
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
              "role": "logical_source"
            },
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            },
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "left-population-parity-verification",
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
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "left_population_not_subset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "left_population",
          "right_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-left-member-population",
        "comparison": "complete_population",
        "roles": [
          "left_population",
          "left_members"
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

### left_members

Declare left members for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "left_members",
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
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-left-member-population",
        "comparison": "complete_population",
        "roles": [
          "left_population",
          "left_members"
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
        "reference_role": "left_members",
        "number_role": "member_count"
      }
    }
  ]
}
```

### right_population

Declare right population for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "right_population",
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
        "pattern_id": "right-population-parity-verification",
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
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "right_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "right_population_not_subset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "right-result-exposes-parity-inputs",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "right_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "left-population-within-right",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "left_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "right-population-within-left",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "right_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-both-representations",
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
              "role": "logical_source"
            },
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            },
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "left-population-parity-verification",
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
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "left_population_not_subset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "left_population",
          "right_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-right-member-population",
        "comparison": "complete_population",
        "roles": [
          "right_population",
          "right_members"
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

### right_members

Declare right members for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "right_members",
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
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-right-member-population",
        "comparison": "complete_population",
        "roles": [
          "right_population",
          "right_members"
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
        "reference_role": "right_members",
        "number_role": "member_count"
      }
    }
  ]
}
```

### left_selected_canonical_value

Declare left selected canonical value for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: selected_value_comparison.

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
        "role": "left_selected_canonical_value",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "left-result-exposes-parity-inputs",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "left_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "canonical-value-verification",
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
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_selected_canonical_value",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "canonical_value_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "selected-canonical-values-equal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "left_selected_canonical_value",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-both-representations",
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
              "role": "logical_source"
            },
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            },
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    }
  ]
}
```

### right_selected_canonical_value

Declare right selected canonical value for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: selected_value_comparison.

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
        "role": "right_selected_canonical_value",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
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
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "canonical-value-verification",
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
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_selected_canonical_value",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "canonical_value_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "right-result-exposes-parity-inputs",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "right_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "selected-canonical-values-equal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "left_selected_canonical_value",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-both-representations",
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
              "role": "logical_source"
            },
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            },
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    }
  ]
}
```

### verification

Declare verification for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "right-population-parity-verification",
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
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "right_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "right_population_not_subset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "left-count-verification",
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
              "role": "left_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "left_count_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "right-count-verification",
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
              "role": "right_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "right_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "right_count_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "canonical-value-verification",
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
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_selected_canonical_value",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "canonical_value_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-both-representations",
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
              "role": "logical_source"
            },
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            },
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "left-population-parity-verification",
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
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "left_population_not_subset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "logical_source",
          "left_result",
          "right_result",
          "verification"
        ]
      }
    }
  ]
}
```

### left_population_not_subset_condition

Declare left population not subset condition for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "left_population_not_subset_condition",
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
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "left-population-parity-verification",
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
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "left_population_not_subset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "left_population_not_subset_condition",
          "right_population_not_subset_condition",
          "left_count_mismatch_condition",
          "right_count_mismatch_condition",
          "canonical_value_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-left-population-parity",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "left_population_not_subset_condition"
          ]
        }
      }
    }
  ]
}
```

### right_population_not_subset_condition

Declare right population not subset condition for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "right_population_not_subset_condition",
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
        "pattern_id": "right-population-parity-verification",
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
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "right_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "right_population_not_subset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "left_population_not_subset_condition",
          "right_population_not_subset_condition",
          "left_count_mismatch_condition",
          "right_count_mismatch_condition",
          "canonical_value_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-targets-right-population-parity",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "right_population_not_subset_condition"
          ]
        }
      }
    }
  ]
}
```

### left_count_mismatch_condition

Declare left count mismatch condition for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "left_count_mismatch_condition",
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
        "pattern_id": "left-count-verification",
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
              "role": "left_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "left_count_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "left_population_not_subset_condition",
          "right_population_not_subset_condition",
          "left_count_mismatch_condition",
          "right_count_mismatch_condition",
          "canonical_value_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "verification-targets-left-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "left_count_mismatch_condition"
          ]
        }
      }
    }
  ]
}
```

### right_count_mismatch_condition

Declare right count mismatch condition for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "right_count_mismatch_condition",
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "right-count-verification",
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
              "role": "right_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "right_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "right_count_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "left_population_not_subset_condition",
          "right_population_not_subset_condition",
          "left_count_mismatch_condition",
          "right_count_mismatch_condition",
          "canonical_value_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "verification-targets-right-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "right_count_mismatch_condition"
          ]
        }
      }
    }
  ]
}
```

### canonical_value_mismatch_condition

Declare canonical value mismatch condition for proof.result-shape.cross-representation-parity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "canonical_value_mismatch_condition",
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
        "pattern_id": "canonical-value-verification",
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
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_selected_canonical_value",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "canonical_value_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "left_population_not_subset_condition",
          "right_population_not_subset_condition",
          "left_count_mismatch_condition",
          "right_count_mismatch_condition",
          "canonical_value_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "value": {
        "relation_pattern_id": "verification-targets-canonical-value",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "canonical_value_mismatch_condition"
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
| logical_source | semantic_parameter | logical_source |  |
| left_result | semantic_parameter | left_result |  |
| right_result | semantic_parameter | right_result |  |
| left_population | semantic_parameter | left_population |  |
| left_members | semantic_parameter | left_members |  |
| right_population | semantic_parameter | right_population |  |
| right_members | semantic_parameter | right_members |  |
| left_count_signal | observation_requirement |  | Acquire left_count_signal for the exact subject, attempt and applicability in this profile. |
| right_count_signal | observation_requirement |  | Acquire right_count_signal for the exact subject, attempt and applicability in this profile. |
| left_selected_canonical_value | semantic_parameter | left_selected_canonical_value |  |
| right_selected_canonical_value | semantic_parameter | right_selected_canonical_value |  |
| verification | semantic_parameter | verification |  |
| left_population_not_subset_condition | semantic_parameter | left_population_not_subset_condition |  |
| right_population_not_subset_condition | semantic_parameter | right_population_not_subset_condition |  |
| left_count_mismatch_condition | semantic_parameter | left_count_mismatch_condition |  |
| right_count_mismatch_condition | semantic_parameter | right_count_mismatch_condition |  |
| canonical_value_mismatch_condition | semantic_parameter | canonical_value_mismatch_condition |  |
| member_count | complete_population_count | left_members, right_members |  |

```json
{
  "roles": [
    {
      "role": "logical_source",
      "kind": "semantic_parameter",
      "parameter": "logical_source",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "logical_source",
        "allowed_type_terms": [
          "cc:entity",
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
      "role": "left_result",
      "kind": "semantic_parameter",
      "parameter": "left_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "left_result",
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
      "role": "right_result",
      "kind": "semantic_parameter",
      "parameter": "right_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/2",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "right_result",
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
      "role": "left_population",
      "kind": "semantic_parameter",
      "parameter": "left_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/10",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "left_population",
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
      "role": "left_members",
      "kind": "semantic_parameter",
      "parameter": "left_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "left_members",
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
      "role": "right_population",
      "kind": "semantic_parameter",
      "parameter": "right_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "right_population",
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
      "role": "right_members",
      "kind": "semantic_parameter",
      "parameter": "right_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "right_members",
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
      "role": "left_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/11",
        "/claim_patterns/5",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire left_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.result-shape.cross-representation-parity/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "left_count_signal",
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
      "role": "right_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/2",
        "/claim_patterns/6",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire right_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.result-shape.cross-representation-parity/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "right_count_signal",
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
      "role": "left_selected_canonical_value",
      "kind": "semantic_parameter",
      "parameter": "left_selected_canonical_value",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/13",
        "/claim_patterns/7",
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "left_selected_canonical_value",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "right_selected_canonical_value",
      "kind": "semantic_parameter",
      "parameter": "right_selected_canonical_value",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/2",
        "/claim_patterns/7",
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "right_selected_canonical_value",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
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
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/8",
        "/claim_patterns/9",
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
          "repository_path"
        ]
      }
    },
    {
      "role": "left_population_not_subset_condition",
      "kind": "semantic_parameter",
      "parameter": "left_population_not_subset_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/9",
        "/distinct_reference_role_sets/3",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "left_population_not_subset_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "right_population_not_subset_condition",
      "kind": "semantic_parameter",
      "parameter": "right_population_not_subset_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/distinct_reference_role_sets/3",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "right_population_not_subset_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "left_count_mismatch_condition",
      "kind": "semantic_parameter",
      "parameter": "left_count_mismatch_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/distinct_reference_role_sets/3",
        "/falsifier_condition_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "left_count_mismatch_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "right_count_mismatch_condition",
      "kind": "semantic_parameter",
      "parameter": "right_count_mismatch_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/distinct_reference_role_sets/3",
        "/falsifier_condition_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "right_count_mismatch_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "canonical_value_mismatch_condition",
      "kind": "semantic_parameter",
      "parameter": "canonical_value_mismatch_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/distinct_reference_role_sets/3",
        "/falsifier_condition_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "canonical_value_mismatch_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "member_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "left_members",
        "right_members"
      ],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/reference_role_count_bindings/0",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "member_count",
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
          "logical_source",
          "left_result",
          "right_result",
          "verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "left_population",
          "right_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "left_count_signal",
          "right_count_signal"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "left_population_not_subset_condition",
          "right_population_not_subset_condition",
          "left_count_mismatch_condition",
          "right_count_mismatch_condition",
          "canonical_value_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-left-member-population",
        "comparison": "complete_population",
        "roles": [
          "left_population",
          "left_members"
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
        "pattern_id": "complete-right-member-population",
        "comparison": "complete_population",
        "roles": [
          "right_population",
          "right_members"
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
        "reference_role": "left_members",
        "number_role": "member_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "right_members",
        "number_role": "member_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "source-emits-both-results",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "logical_source",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "left-result-exposes-parity-inputs",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "left_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "right-result-exposes-parity-inputs",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "right_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "left-population-within-right",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "left_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "right-population-within-left",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "right_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "left-count-exact",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "left_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "right-count-exact",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "right_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "selected-canonical-values-equal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "left_selected_canonical_value",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "verification-reads-both-representations",
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
              "role": "logical_source"
            },
            {
              "kind": "reference",
              "role": "left_result"
            },
            {
              "kind": "reference",
              "role": "right_result"
            },
            {
              "kind": "reference",
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_count_signal"
            },
            {
              "kind": "reference",
              "role": "right_count_signal"
            },
            {
              "kind": "reference",
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "left-population-parity-verification",
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
              "role": "left_population"
            },
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "left_population_not_subset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "right-population-parity-verification",
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
              "role": "right_population"
            },
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "right_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "right_population_not_subset_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "left_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "left-count-verification",
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
              "role": "left_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "left_count_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "right-count-verification",
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
              "role": "right_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "right_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "right_count_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "member_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "canonical-value-verification",
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
              "role": "left_selected_canonical_value"
            },
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "left_selected_canonical_value",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "canonical_value_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "right_selected_canonical_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-left-population-parity",
        "role": "verifies",
        "source_claim_pattern_id": "left-population-parity-verification",
        "target_claim_pattern_id": "left-population-within-right"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-targets-right-population-parity",
        "role": "verifies",
        "source_claim_pattern_id": "right-population-parity-verification",
        "target_claim_pattern_id": "right-population-within-left"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "verification-targets-left-count",
        "role": "verifies",
        "source_claim_pattern_id": "left-count-verification",
        "target_claim_pattern_id": "left-count-exact"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "verification-targets-right-count",
        "role": "verifies",
        "source_claim_pattern_id": "right-count-verification",
        "target_claim_pattern_id": "right-count-exact"
      }
    },
    {
      "ref": "/relation_patterns/4",
      "constraint": {
        "pattern_id": "verification-targets-canonical-value",
        "role": "verifies",
        "source_claim_pattern_id": "canonical-value-verification",
        "target_claim_pattern_id": "selected-canonical-values-equal"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-left-population-parity",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "left_population_not_subset_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-targets-right-population-parity",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "right_population_not_subset_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "verification-targets-left-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "left_count_mismatch_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "verification-targets-right-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "right_count_mismatch_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "constraint": {
        "relation_pattern_id": "verification-targets-canonical-value",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "canonical_value_mismatch_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-left-member-population"
          },
          {
            "pattern": "complete-right-member-population"
          },
          {
            "pattern": "source-emits-both-results"
          },
          {
            "pattern": "left-result-exposes-parity-inputs"
          },
          {
            "pattern": "right-result-exposes-parity-inputs"
          },
          {
            "pattern": "left-population-within-right"
          },
          {
            "pattern": "right-population-within-left"
          },
          {
            "pattern": "left-count-exact"
          },
          {
            "pattern": "right-count-exact"
          },
          {
            "pattern": "selected-canonical-values-equal"
          },
          {
            "pattern": "verification-reads-both-representations"
          },
          {
            "pattern": "left-population-parity-verification"
          },
          {
            "pattern": "right-population-parity-verification"
          },
          {
            "pattern": "left-count-verification"
          },
          {
            "pattern": "right-count-verification"
          },
          {
            "pattern": "canonical-value-verification"
          },
          {
            "pattern": "verification-targets-left-population-parity"
          },
          {
            "pattern": "verification-targets-right-population-parity"
          },
          {
            "pattern": "verification-targets-left-count"
          },
          {
            "pattern": "verification-targets-right-count"
          },
          {
            "pattern": "verification-targets-canonical-value"
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
      "logical_source",
      "left_result",
      "right_result",
      "left_population",
      "left_members",
      "right_population",
      "right_members",
      "left_selected_canonical_value",
      "right_selected_canonical_value",
      "verification",
      "left_population_not_subset_condition",
      "right_population_not_subset_condition",
      "left_count_mismatch_condition",
      "right_count_mismatch_condition",
      "canonical_value_mismatch_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "left_count_signal",
      "right_count_signal"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.result-shape.cross-representation-parity.",
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
        "missing": "No named proof.result-shape.cross-representation-parity constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.result-shape.cross-representation-parity.",
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
