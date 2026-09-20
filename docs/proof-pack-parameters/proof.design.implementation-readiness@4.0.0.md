# proof.design.implementation-readiness@4.0.0

<!-- Generated from validated package metadata. -->

One authored design unit names independently bound repository-grounded implementation and test loci; declares a complete nonempty requirement population, an exact four-field warning shape with exact code, severity, message-template, and payload-schema values, an authored complete validation population equal to the requirement population, and a complete placeholder population with exact count zero.

Profile digest: cf180ce70319fc4329a7f522cef85c08c98a69e743a71ef09c086287583e8fe7. Parameter digest: 65357426fe82da30a7027b3aeb4ceead43d0d6f3e44cd7d0d6310ad5cf1285ab.

Admission digest: 8e87761fddb1722f5dbd6e3ff63038443ae3a3428c3cafdda39921bb132dca5d.

Roles: 28/28 accounted; 0 owned gaps. Semantic parameters: 23; internal roles: 5.

## Guarantee and exclusions

One authored design unit names independently bound repository-grounded implementation and test loci; declares a complete nonempty requirement population, an exact four-field warning shape with exact code, severity, message-template, and payload-schema values, an authored complete validation population equal to the requirement population, and a complete placeholder population with exact count zero.

- authored-population-truth
- grounded-identity-existence
- omitted-authored-requirement
- product-sufficiency
- runtime-and-repository-truth
- warning-runtime-execution

## Parameters

### design_unit

Declare design unit for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "design_unit",
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "design-names-grounded-loci",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "design_unit",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "implementation_locus"
            },
            {
              "kind": "reference",
              "role": "test_locus"
            }
          ]
        }
      }
    }
  ]
}
```

### requirement_population

Declare requirement population for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "requirement_population",
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
        "pattern_id": "implementation-locus-targets-requirements",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "implementation_locus",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "requirement_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "validation-covers-all-requirements",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "validation_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "requirement_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "requirement_population",
          "placeholder_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-requirement-population",
        "comparison": "complete_population",
        "roles": [
          "requirement_population",
          "requirements"
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

### requirements

Declare requirements for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "requirements",
        "allowed_type_terms": [
          "cc:requirement",
          "cc:criterion"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-requirement-population",
        "comparison": "complete_population",
        "roles": [
          "requirement_population",
          "requirements"
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
        "reference_role": "requirements",
        "number_role": "requirement_count"
      }
    }
  ]
}
```

### implementation_locus

Declare implementation locus for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "implementation_locus",
        "allowed_type_terms": [
          "cc:runtime_component",
          "cc:operation",
          "cc:resource"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "design-names-grounded-loci",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "design_unit",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "implementation_locus"
            },
            {
              "kind": "reference",
              "role": "test_locus"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "implementation-locus-targets-requirements",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "implementation_locus",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "requirement_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "test-locus-targets-implementation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "implementation_locus"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "implementation_locus",
          "test_locus"
        ]
      }
    }
  ]
}
```

### test_locus

Declare test locus for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "test_locus",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "design-names-grounded-loci",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "design_unit",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "implementation_locus"
            },
            {
              "kind": "reference",
              "role": "test_locus"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "test-locus-covers-validation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "validation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "warning-shape-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_signal"
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
          "subject_role": "warning_shape_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "warning_shape_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "test-locus-targets-implementation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "implementation_locus"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "implementation_locus",
          "test_locus"
        ]
      }
    }
  ]
}
```

### warning_signal

Declare warning signal for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_signal",
        "allowed_type_terms": [
          "cc:evidence",
          "cc:artifact"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "warning-shape-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_signal"
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
          "subject_role": "warning_shape_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "warning_shape_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "warning-signal-contains-shape",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_signal",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "warning-signal-carries-exact-values",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_signal",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_value"
            },
            {
              "kind": "reference",
              "role": "warning_severity_value"
            },
            {
              "kind": "reference",
              "role": "warning_message_template"
            },
            {
              "kind": "reference",
              "role": "warning_payload_schema"
            }
          ]
        }
      }
    }
  ]
}
```

### warning_shape_population

Declare warning shape population for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_shape_population",
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "warning-shape-exact",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_shape_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "warning-shape-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_signal"
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
          "subject_role": "warning_shape_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "warning_shape_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "warning-signal-contains-shape",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_signal",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "warning-shape-includes-required-fields",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_shape_population",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_field"
            },
            {
              "kind": "reference",
              "role": "warning_severity_field"
            },
            {
              "kind": "reference",
              "role": "warning_message_field"
            },
            {
              "kind": "reference",
              "role": "warning_payload_field"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-warning-shape",
        "comparison": "complete_population",
        "roles": [
          "warning_shape_population",
          "warning_fields"
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

### warning_fields

Declare warning fields for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_fields",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence"
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
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-warning-shape",
        "comparison": "complete_population",
        "roles": [
          "warning_shape_population",
          "warning_fields"
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
        "reference_role": "warning_fields",
        "number_role": "warning_field_count"
      }
    }
  ]
}
```

### required_warning_shape_population

Declare required warning shape population for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "required_warning_shape_population",
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "warning-shape-exact",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_shape_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "warning-shape-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_signal"
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
          "subject_role": "warning_shape_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "warning_shape_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-required-warning-shape",
        "comparison": "complete_population",
        "roles": [
          "required_warning_shape_population",
          "required_warning_fields"
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

### required_warning_fields

Declare required warning fields for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "required_warning_fields",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence"
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
        "pattern_id": "complete-required-warning-shape",
        "comparison": "complete_population",
        "roles": [
          "required_warning_shape_population",
          "required_warning_fields"
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
        "reference_role": "required_warning_fields",
        "number_role": "required_warning_field_count"
      }
    }
  ]
}
```

### warning_code_field

Declare warning code field for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_code_field",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence"
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
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "warning-code-value-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_code_field",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "warning-shape-includes-required-fields",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_shape_population",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_field"
            },
            {
              "kind": "reference",
              "role": "warning_severity_field"
            },
            {
              "kind": "reference",
              "role": "warning_message_field"
            },
            {
              "kind": "reference",
              "role": "warning_payload_field"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "warning_code_field",
          "warning_severity_field",
          "warning_message_field",
          "warning_payload_field"
        ]
      }
    }
  ]
}
```

### warning_severity_field

Declare warning severity field for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_severity_field",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence"
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
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "warning-severity-value-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_severity_field",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_severity_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "warning-shape-includes-required-fields",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_shape_population",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_field"
            },
            {
              "kind": "reference",
              "role": "warning_severity_field"
            },
            {
              "kind": "reference",
              "role": "warning_message_field"
            },
            {
              "kind": "reference",
              "role": "warning_payload_field"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "warning_code_field",
          "warning_severity_field",
          "warning_message_field",
          "warning_payload_field"
        ]
      }
    }
  ]
}
```

### warning_message_field

Declare warning message field for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_message_field",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence"
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
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "warning-message-template-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_message_field",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_message_template"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "warning-shape-includes-required-fields",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_shape_population",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_field"
            },
            {
              "kind": "reference",
              "role": "warning_severity_field"
            },
            {
              "kind": "reference",
              "role": "warning_message_field"
            },
            {
              "kind": "reference",
              "role": "warning_payload_field"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "warning_code_field",
          "warning_severity_field",
          "warning_message_field",
          "warning_payload_field"
        ]
      }
    }
  ]
}
```

### warning_payload_field

Declare warning payload field for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_payload_field",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence"
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
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "warning-payload-schema-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_payload_field",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_payload_schema"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "warning-shape-includes-required-fields",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_shape_population",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_field"
            },
            {
              "kind": "reference",
              "role": "warning_severity_field"
            },
            {
              "kind": "reference",
              "role": "warning_message_field"
            },
            {
              "kind": "reference",
              "role": "warning_payload_field"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "warning_code_field",
          "warning_severity_field",
          "warning_message_field",
          "warning_payload_field"
        ]
      }
    }
  ]
}
```

### warning_code_value

Declare warning code value for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_code_value",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
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
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "warning-signal-carries-exact-values",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_signal",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_value"
            },
            {
              "kind": "reference",
              "role": "warning_severity_value"
            },
            {
              "kind": "reference",
              "role": "warning_message_template"
            },
            {
              "kind": "reference",
              "role": "warning_payload_schema"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "warning-code-value-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_code_field",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "warning_code_value",
          "warning_severity_value",
          "warning_message_template",
          "warning_payload_schema"
        ]
      }
    }
  ]
}
```

### warning_severity_value

Declare warning severity value for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_severity_value",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
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
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "warning-signal-carries-exact-values",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_signal",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_value"
            },
            {
              "kind": "reference",
              "role": "warning_severity_value"
            },
            {
              "kind": "reference",
              "role": "warning_message_template"
            },
            {
              "kind": "reference",
              "role": "warning_payload_schema"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "warning-severity-value-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_severity_field",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_severity_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "warning_code_value",
          "warning_severity_value",
          "warning_message_template",
          "warning_payload_schema"
        ]
      }
    }
  ]
}
```

### warning_message_template

Declare warning message template for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_message_template",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
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
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "warning-signal-carries-exact-values",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_signal",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_value"
            },
            {
              "kind": "reference",
              "role": "warning_severity_value"
            },
            {
              "kind": "reference",
              "role": "warning_message_template"
            },
            {
              "kind": "reference",
              "role": "warning_payload_schema"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "warning-message-template-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_message_field",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_message_template"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "warning_code_value",
          "warning_severity_value",
          "warning_message_template",
          "warning_payload_schema"
        ]
      }
    }
  ]
}
```

### warning_payload_schema

Declare warning payload schema for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_payload_schema",
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
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "warning-signal-carries-exact-values",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_signal",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_value"
            },
            {
              "kind": "reference",
              "role": "warning_severity_value"
            },
            {
              "kind": "reference",
              "role": "warning_message_template"
            },
            {
              "kind": "reference",
              "role": "warning_payload_schema"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "warning-payload-schema-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_payload_field",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_payload_schema"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "warning_code_value",
          "warning_severity_value",
          "warning_message_template",
          "warning_payload_schema"
        ]
      }
    }
  ]
}
```

### validation_population

Declare validation population for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/18",
      "value": {
        "role": "validation_population",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "validation-covers-all-requirements",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "validation_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "requirement_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "test-locus-covers-validation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "validation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-validation-population",
        "comparison": "complete_population",
        "roles": [
          "validation_population",
          "validated_requirements"
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

### validated_requirements

Declare validated requirements for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/19",
      "value": {
        "role": "validated_requirements",
        "allowed_type_terms": [
          "cc:requirement",
          "cc:criterion"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-validation-population",
        "comparison": "complete_population",
        "roles": [
          "validation_population",
          "validated_requirements"
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
        "reference_role": "validated_requirements",
        "number_role": "validation_count"
      }
    }
  ]
}
```

### placeholder_population

Declare placeholder population for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/20",
      "value": {
        "role": "placeholder_population",
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
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "placeholder-population-empty",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "placeholder_population",
          "operator": "number:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "placeholder_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "requirement_population",
          "placeholder_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-placeholder-population",
        "comparison": "complete_population",
        "roles": [
          "placeholder_population",
          "placeholders"
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

### placeholders

Declare placeholders for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/21",
      "value": {
        "role": "placeholders",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:requirement",
          "cc:resource"
        ],
        "cardinality": "zero_or_more",
        "allowed_identity_kinds": [
          "profile_term",
          "durable_id"
        ]
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-placeholder-population",
        "comparison": "complete_population",
        "roles": [
          "placeholder_population",
          "placeholders"
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
        "reference_role": "placeholders",
        "number_role": "placeholder_count"
      }
    }
  ]
}
```

### warning_shape_mismatch_condition

Declare warning shape mismatch condition for proof.design.implementation-readiness. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "warning_shape_mismatch_condition",
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
        "pattern_id": "warning-shape-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_signal"
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
          "subject_role": "warning_shape_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "warning_shape_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-warning-shape",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "warning_shape_mismatch_condition"
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
| design_unit | semantic_parameter | design_unit |  |
| requirement_population | semantic_parameter | requirement_population |  |
| requirements | semantic_parameter | requirements |  |
| implementation_locus | semantic_parameter | implementation_locus |  |
| test_locus | semantic_parameter | test_locus |  |
| warning_signal | semantic_parameter | warning_signal |  |
| warning_shape_population | semantic_parameter | warning_shape_population |  |
| warning_fields | semantic_parameter | warning_fields |  |
| required_warning_shape_population | semantic_parameter | required_warning_shape_population |  |
| required_warning_fields | semantic_parameter | required_warning_fields |  |
| warning_code_field | semantic_parameter | warning_code_field |  |
| warning_severity_field | semantic_parameter | warning_severity_field |  |
| warning_message_field | semantic_parameter | warning_message_field |  |
| warning_payload_field | semantic_parameter | warning_payload_field |  |
| warning_code_value | semantic_parameter | warning_code_value |  |
| warning_severity_value | semantic_parameter | warning_severity_value |  |
| warning_message_template | semantic_parameter | warning_message_template |  |
| warning_payload_schema | semantic_parameter | warning_payload_schema |  |
| validation_population | semantic_parameter | validation_population |  |
| validated_requirements | semantic_parameter | validated_requirements |  |
| placeholder_population | semantic_parameter | placeholder_population |  |
| placeholders | semantic_parameter | placeholders |  |
| warning_shape_mismatch_condition | semantic_parameter | warning_shape_mismatch_condition |  |
| requirement_count | complete_population_count | requirements |  |
| validation_count | complete_population_count | validated_requirements |  |
| warning_field_count | definition_constant |  |  |
| required_warning_field_count | definition_constant |  |  |
| placeholder_count | definition_constant |  |  |

```json
{
  "roles": [
    {
      "role": "design_unit",
      "kind": "semantic_parameter",
      "parameter": "design_unit",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "design_unit",
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
      "role": "requirement_population",
      "kind": "semantic_parameter",
      "parameter": "requirement_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/11",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "requirement_population",
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
      "role": "requirements",
      "kind": "semantic_parameter",
      "parameter": "requirements",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "requirements",
        "allowed_type_terms": [
          "cc:requirement",
          "cc:criterion"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id"
        ]
      }
    },
    {
      "role": "implementation_locus",
      "kind": "semantic_parameter",
      "parameter": "implementation_locus",
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
        "role": "implementation_locus",
        "allowed_type_terms": [
          "cc:runtime_component",
          "cc:operation",
          "cc:resource"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol"
        ]
      }
    },
    {
      "role": "test_locus",
      "kind": "semantic_parameter",
      "parameter": "test_locus",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/12",
        "/claim_patterns/14",
        "/claim_patterns/2",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "test_locus",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol"
        ]
      }
    },
    {
      "role": "warning_signal",
      "kind": "semantic_parameter",
      "parameter": "warning_signal",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/3",
        "/claim_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_signal",
        "allowed_type_terms": [
          "cc:evidence",
          "cc:artifact"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol"
        ]
      }
    },
    {
      "role": "warning_shape_population",
      "kind": "semantic_parameter",
      "parameter": "warning_shape_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/14",
        "/claim_patterns/3",
        "/claim_patterns/9",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_shape_population",
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
      "role": "warning_fields",
      "kind": "semantic_parameter",
      "parameter": "warning_fields",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_fields",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "required_warning_shape_population",
      "kind": "semantic_parameter",
      "parameter": "required_warning_shape_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/14",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "required_warning_shape_population",
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
      "role": "required_warning_fields",
      "kind": "semantic_parameter",
      "parameter": "required_warning_fields",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "required_warning_fields",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:evidence"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "warning_code_field",
      "kind": "semantic_parameter",
      "parameter": "warning_code_field",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_code_field",
        "allowed_type_terms": [
          "cc:configuration",
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
      "role": "warning_severity_field",
      "kind": "semantic_parameter",
      "parameter": "warning_severity_field",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/6",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_severity_field",
        "allowed_type_terms": [
          "cc:configuration",
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
      "role": "warning_message_field",
      "kind": "semantic_parameter",
      "parameter": "warning_message_field",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_message_field",
        "allowed_type_terms": [
          "cc:configuration",
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
      "role": "warning_payload_field",
      "kind": "semantic_parameter",
      "parameter": "warning_payload_field",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_payload_field",
        "allowed_type_terms": [
          "cc:configuration",
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
      "role": "warning_code_value",
      "kind": "semantic_parameter",
      "parameter": "warning_code_value",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_code_value",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "warning_severity_value",
      "kind": "semantic_parameter",
      "parameter": "warning_severity_value",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_severity_value",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "warning_message_template",
      "kind": "semantic_parameter",
      "parameter": "warning_message_template",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_message_template",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "warning_payload_schema",
      "kind": "semantic_parameter",
      "parameter": "warning_payload_schema",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_payload_schema",
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
      "role": "validation_population",
      "kind": "semantic_parameter",
      "parameter": "validation_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "validation_population",
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
      "role": "validated_requirements",
      "kind": "semantic_parameter",
      "parameter": "validated_requirements",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "validated_requirements",
        "allowed_type_terms": [
          "cc:requirement",
          "cc:criterion"
        ],
        "cardinality": "one_or_more",
        "allowed_identity_kinds": [
          "repository_path",
          "code_symbol",
          "durable_id"
        ]
      }
    },
    {
      "role": "placeholder_population",
      "kind": "semantic_parameter",
      "parameter": "placeholder_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "placeholder_population",
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
      "role": "placeholders",
      "kind": "semantic_parameter",
      "parameter": "placeholders",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/4",
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "placeholders",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:requirement",
          "cc:resource"
        ],
        "cardinality": "zero_or_more",
        "allowed_identity_kinds": [
          "profile_term",
          "durable_id"
        ]
      }
    },
    {
      "role": "warning_shape_mismatch_condition",
      "kind": "semantic_parameter",
      "parameter": "warning_shape_mismatch_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_shape_mismatch_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "requirement_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "requirements"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "requirement_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "validation_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "validated_requirements"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "validation_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "warning_field_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "warning_field_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 4,
        "maximum": 4
      }
    },
    {
      "role": "required_warning_field_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "required_warning_field_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 4,
        "maximum": 4
      }
    },
    {
      "role": "placeholder_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "placeholder_count",
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
          "implementation_locus",
          "test_locus"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "requirement_population",
          "placeholder_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "warning_code_field",
          "warning_severity_field",
          "warning_message_field",
          "warning_payload_field"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "warning_code_value",
          "warning_severity_value",
          "warning_message_template",
          "warning_payload_schema"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-requirement-population",
        "comparison": "complete_population",
        "roles": [
          "requirement_population",
          "requirements"
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
        "pattern_id": "complete-warning-shape",
        "comparison": "complete_population",
        "roles": [
          "warning_shape_population",
          "warning_fields"
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
        "pattern_id": "complete-required-warning-shape",
        "comparison": "complete_population",
        "roles": [
          "required_warning_shape_population",
          "required_warning_fields"
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
        "pattern_id": "complete-validation-population",
        "comparison": "complete_population",
        "roles": [
          "validation_population",
          "validated_requirements"
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
        "pattern_id": "complete-placeholder-population",
        "comparison": "complete_population",
        "roles": [
          "placeholder_population",
          "placeholders"
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
        "reference_role": "requirements",
        "number_role": "requirement_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "validated_requirements",
        "number_role": "validation_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "warning_fields",
        "number_role": "warning_field_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "required_warning_fields",
        "number_role": "required_warning_field_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "constraint": {
        "reference_role": "placeholders",
        "number_role": "placeholder_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "design-names-grounded-loci",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "design_unit",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "implementation_locus"
            },
            {
              "kind": "reference",
              "role": "test_locus"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "implementation-locus-targets-requirements",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "implementation_locus",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "requirement_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "test-locus-targets-implementation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "implementation_locus"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "warning-signal-contains-shape",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_signal",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "warning-signal-carries-exact-values",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_signal",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_value"
            },
            {
              "kind": "reference",
              "role": "warning_severity_value"
            },
            {
              "kind": "reference",
              "role": "warning_message_template"
            },
            {
              "kind": "reference",
              "role": "warning_payload_schema"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "warning-code-value-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_code_field",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "warning-severity-value-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_severity_field",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_severity_value"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "warning-message-template-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_message_field",
          "operator": "reference:has_value",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_message_template"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "warning-payload-schema-exact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_payload_field",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_payload_schema"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "warning-shape-includes-required-fields",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_shape_population",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_code_field"
            },
            {
              "kind": "reference",
              "role": "warning_severity_field"
            },
            {
              "kind": "reference",
              "role": "warning_message_field"
            },
            {
              "kind": "reference",
              "role": "warning_payload_field"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "warning-shape-exact",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "warning_shape_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "validation-covers-all-requirements",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "validation_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "requirement_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "test-locus-covers-validation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "validation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "placeholder-population-empty",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "placeholder_population",
          "operator": "number:has_cardinality",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "placeholder_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "warning-shape-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "test_locus",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "warning_signal"
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
          "subject_role": "warning_shape_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "warning_shape_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "required_warning_shape_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-warning-shape",
        "role": "verifies",
        "source_claim_pattern_id": "warning-shape-verification",
        "target_claim_pattern_id": "warning-shape-exact"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-warning-shape",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "warning_shape_mismatch_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-requirement-population"
          },
          {
            "pattern": "complete-warning-shape"
          },
          {
            "pattern": "complete-required-warning-shape"
          },
          {
            "pattern": "complete-validation-population"
          },
          {
            "pattern": "complete-placeholder-population"
          },
          {
            "pattern": "design-names-grounded-loci"
          },
          {
            "pattern": "implementation-locus-targets-requirements"
          },
          {
            "pattern": "test-locus-targets-implementation"
          },
          {
            "pattern": "warning-signal-contains-shape"
          },
          {
            "pattern": "warning-signal-carries-exact-values"
          },
          {
            "pattern": "warning-code-value-exact"
          },
          {
            "pattern": "warning-severity-value-exact"
          },
          {
            "pattern": "warning-message-template-exact"
          },
          {
            "pattern": "warning-payload-schema-exact"
          },
          {
            "pattern": "warning-shape-includes-required-fields"
          },
          {
            "pattern": "warning-shape-exact"
          },
          {
            "pattern": "validation-covers-all-requirements"
          },
          {
            "pattern": "test-locus-covers-validation"
          },
          {
            "pattern": "placeholder-population-empty"
          },
          {
            "pattern": "warning-shape-verification"
          },
          {
            "pattern": "verification-targets-warning-shape"
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
      "design_unit",
      "requirement_population",
      "requirements",
      "implementation_locus",
      "test_locus",
      "warning_signal",
      "warning_shape_population",
      "warning_fields",
      "required_warning_shape_population",
      "required_warning_fields",
      "warning_code_field",
      "warning_severity_field",
      "warning_message_field",
      "warning_payload_field",
      "warning_code_value",
      "warning_severity_value",
      "warning_message_template",
      "warning_payload_schema",
      "validation_population",
      "validated_requirements",
      "placeholder_population",
      "placeholders",
      "warning_shape_mismatch_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.design.implementation-readiness.",
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
        "missing": "No named proof.design.implementation-readiness constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.design.implementation-readiness.",
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
