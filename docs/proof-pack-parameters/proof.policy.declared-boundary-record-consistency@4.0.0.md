# proof.policy.declared-boundary-record-consistency@4.0.0

<!-- Generated from validated package metadata. -->

For one exact closed declared policy, one exact caller-supplied boundary observation record whose provenance is caller_asserted, and one exact captured subject set, the package-owned transformer measures every subject under the declared closed unit and measurement-class lexicon, derives the complete N-1/N/N+1 census for every nonzero limit and the exact N/N+1 census for a zero maximum, validates every recorded disposition against the complete declared table, and emits complete populations, exact counts, associations, and one canonical report bound to the exact source-set digest.

Profile digest: b9931249971f3f8e10e69501cf6b89fa6da42d37e1afae9cfde6410d6bfe7388. Parameter digest: d04c6809292a1bec7924235ce2034e391afb45c343d9553fa3b4fbe21b933778.

Admission digest: 665e9460f5de3935542e8e8a7a2fa5ab234ebdd8cbe27665eb37f82e3fc8e823.

Roles: 19/19 accounted; 2 owned gaps. Semantic parameters: 13; internal roles: 6.

## Guarantee and exclusions

For one exact closed declared policy, one exact caller-supplied boundary observation record whose provenance is caller_asserted, and one exact captured subject set, the package-owned transformer measures every subject under the declared closed unit and measurement-class lexicon, derives the complete N-1/N/N+1 census for every nonzero limit and the exact N/N+1 census for a zero maximum, validates every recorded disposition against the complete declared table, and emits complete populations, exact counts, associations, and one canonical report bound to the exact source-set digest.

- artifact-acquisition-completeness-before-exact-capture
- boundary-consistency-does-not-entail-guidance-propagation
- caller-asserted-observation-execution-provenance
- captured-execution-transcript-provenance
- declared-policy-document-correspondence-to-enforced-limit-and-unit
- evidence-authority-applicability-authority-or-cce-consequences
- locally-redigested-or-unadmitted-profile-variants
- nonboundary-input-space-behavior
- runtime-truth-or-production-enforcement
- shared-policy-identity-across-independently-assessed-packs

## Parameters

### bounded_subject

Declare bounded subject for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "bounded_subject",
        "allowed_type_terms": [
          "cc:process",
          "cc:runtime_component"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "subject-uses-policy",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "bounded_subject",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "policy_artifact"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "subject-is-deterministic",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "bounded_subject",
          "operator": "boolean:deterministic",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    }
  ]
}
```

### policy_artifact

Declare policy artifact for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_policy_reference.

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
        "role": "policy_artifact",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "policy-contains-limit-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "limit_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "policy-contains-unit-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unit_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "subject-uses-policy",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "bounded_subject",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "policy_artifact"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verify-report-is-conformant",
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
              "role": "observation_artifact"
            },
            {
              "kind": "reference",
              "role": "policy_artifact"
            },
            {
              "kind": "reference",
              "role": "subjects_artifact"
            },
            {
              "kind": "reference",
              "role": "conformance_report"
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
          "subject_role": "conformance_report",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": false
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "observation_artifact",
          "policy_artifact",
          "subjects_artifact",
          "conformance_report"
        ]
      }
    }
  ]
}
```

### subjects_artifact

Declare subjects artifact for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "subjects_artifact",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "subjects-contains-subject-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "subjects_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verify-report-is-conformant",
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
              "role": "observation_artifact"
            },
            {
              "kind": "reference",
              "role": "policy_artifact"
            },
            {
              "kind": "reference",
              "role": "subjects_artifact"
            },
            {
              "kind": "reference",
              "role": "conformance_report"
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
          "subject_role": "conformance_report",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": false
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "observation_artifact",
          "policy_artifact",
          "subjects_artifact",
          "conformance_report"
        ]
      }
    }
  ]
}
```

### conformance_report

Declare conformance report for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "conformance_report",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "report-is-conformant",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "conformance_report",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verify-report-is-conformant",
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
              "role": "observation_artifact"
            },
            {
              "kind": "reference",
              "role": "policy_artifact"
            },
            {
              "kind": "reference",
              "role": "subjects_artifact"
            },
            {
              "kind": "reference",
              "role": "conformance_report"
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
          "subject_role": "conformance_report",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": false
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "observation_artifact",
          "policy_artifact",
          "subjects_artifact",
          "conformance_report"
        ]
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-report-is-conformant",
        "reference_role_joins": [
          {
            "role": "conformance_report",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    }
  ]
}
```

### verification

Declare verification for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verify-report-is-conformant",
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
              "role": "observation_artifact"
            },
            {
              "kind": "reference",
              "role": "policy_artifact"
            },
            {
              "kind": "reference",
              "role": "subjects_artifact"
            },
            {
              "kind": "reference",
              "role": "conformance_report"
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
          "subject_role": "conformance_report",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": false
            }
          ]
        }
      }
    }
  ]
}
```

### limit_population

Declare limit population for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "limit_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "policy-contains-limit-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "limit_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "limit_population",
          "unit_population",
          "case_population",
          "subject_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-declared-limits",
        "comparison": "complete_population",
        "roles": [
          "limit_population",
          "declared_limits"
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

### declared_limits

Declare declared limits for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "declared_limits",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "each-boundary-case-targets-one-limit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "boundary_cases",
          "member_role": "case",
          "complete_population_pattern_id": "complete-boundary-cases",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "declared_limits",
              "operator": "reference:targets",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "complete-declared-limits"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "case",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_limits"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "each-limit-resolves-to-one-unit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "declared_limits",
          "member_role": "limit",
          "complete_population_pattern_id": "complete-declared-limits",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "measurement_units",
              "operator": "reference:resolves_to",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "complete-measurement-units"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "limit",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "measurement_units"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-declared-limits",
        "comparison": "complete_population",
        "roles": [
          "limit_population",
          "declared_limits"
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
        "reference_role": "declared_limits",
        "number_role": "declared_limits_count"
      }
    }
  ]
}
```

### unit_population

Declare unit population for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "unit_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "policy-contains-unit-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unit_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "limit_population",
          "unit_population",
          "case_population",
          "subject_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-measurement-units",
        "comparison": "complete_population",
        "roles": [
          "unit_population",
          "measurement_units"
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

### measurement_units

Declare measurement units for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "measurement_units",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "each-limit-resolves-to-one-unit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "declared_limits",
          "member_role": "limit",
          "complete_population_pattern_id": "complete-declared-limits",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "measurement_units",
              "operator": "reference:resolves_to",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "complete-measurement-units"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "limit",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "measurement_units"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-measurement-units",
        "comparison": "complete_population",
        "roles": [
          "unit_population",
          "measurement_units"
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
        "reference_role": "measurement_units",
        "number_role": "measurement_units_count"
      }
    }
  ]
}
```

### case_population

Declare case population for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "case_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "observation-contains-case-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "case_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "limit_population",
          "unit_population",
          "case_population",
          "subject_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-boundary-cases",
        "comparison": "complete_population",
        "roles": [
          "case_population",
          "boundary_cases"
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

### boundary_cases

Declare boundary cases for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "boundary_cases",
        "allowed_type_terms": [
          "cc:test"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "each-boundary-case-targets-one-limit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "boundary_cases",
          "member_role": "case",
          "complete_population_pattern_id": "complete-boundary-cases",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "declared_limits",
              "operator": "reference:targets",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "complete-declared-limits"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "case",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_limits"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-boundary-cases",
        "comparison": "complete_population",
        "roles": [
          "case_population",
          "boundary_cases"
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
        "reference_role": "boundary_cases",
        "number_role": "boundary_cases_count"
      }
    }
  ]
}
```

### subject_population

Declare subject population for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "subject_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "subjects-contains-subject-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "subjects_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "limit_population",
          "unit_population",
          "case_population",
          "subject_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-measured-subjects",
        "comparison": "complete_population",
        "roles": [
          "subject_population",
          "measured_subjects"
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

### measured_subjects

Declare measured subjects for proof.policy.declared-boundary-record-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "measured_subjects",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-measured-subjects",
        "comparison": "complete_population",
        "roles": [
          "subject_population",
          "measured_subjects"
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
        "reference_role": "measured_subjects",
        "number_role": "measured_subjects_count"
      }
    }
  ]
}
```

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |
| bounded_subject | semantic_parameter | bounded_subject |  |
| observation_artifact | observation_requirement |  | Acquire observation_artifact for the exact subject, attempt and applicability in this profile. |
| policy_artifact | semantic_parameter | policy_artifact |  |
| subjects_artifact | semantic_parameter | subjects_artifact |  |
| conformance_report | semantic_parameter | conformance_report |  |
| verification | semantic_parameter | verification |  |
| mismatch_condition | capability_gap |  | Required role mismatch_condition has no rule-linked semantic source. |
| limit_population | semantic_parameter | limit_population |  |
| declared_limits | semantic_parameter | declared_limits |  |
| unit_population | semantic_parameter | unit_population |  |
| measurement_units | semantic_parameter | measurement_units |  |
| case_population | semantic_parameter | case_population |  |
| boundary_cases | semantic_parameter | boundary_cases |  |
| subject_population | semantic_parameter | subject_population |  |
| measured_subjects | semantic_parameter | measured_subjects |  |
| declared_limits_count | complete_population_count | declared_limits |  |
| measurement_units_count | complete_population_count | measurement_units |  |
| boundary_cases_count | complete_population_count | boundary_cases |  |
| measured_subjects_count | complete_population_count | measured_subjects |  |

```json
{
  "roles": [
    {
      "role": "bounded_subject",
      "kind": "semantic_parameter",
      "parameter": "bounded_subject",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/6",
        "/claim_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "bounded_subject",
        "allowed_type_terms": [
          "cc:process",
          "cc:runtime_component"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_artifact",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_artifact for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.policy.declared-boundary-record-consistency/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_artifact",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "policy_artifact",
      "kind": "semantic_parameter",
      "parameter": "policy_artifact",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/6",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "policy_artifact",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "subjects_artifact",
      "kind": "semantic_parameter",
      "parameter": "subjects_artifact",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "subjects_artifact",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "conformance_report",
      "kind": "semantic_parameter",
      "parameter": "conformance_report",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0",
        "/falsifier_occurrence_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "conformance_report",
        "allowed_type_terms": [
          "cc:evidence"
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
        "/claim_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "mismatch_condition",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role mismatch_condition has no rule-linked semantic source.",
        "source": "profiles/proof.policy.declared-boundary-record-consistency/4.0.0/profile.json#/reference_roles/6",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "mismatch_condition",
        "allowed_type_terms": [
          "cc:state",
          "cc:configuration"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "limit_population",
      "kind": "semantic_parameter",
      "parameter": "limit_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "limit_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "declared_limits",
      "kind": "semantic_parameter",
      "parameter": "declared_limits",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_limits",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "unit_population",
      "kind": "semantic_parameter",
      "parameter": "unit_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "unit_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "measurement_units",
      "kind": "semantic_parameter",
      "parameter": "measurement_units",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "measurement_units",
        "allowed_type_terms": [
          "cc:configuration"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "case_population",
      "kind": "semantic_parameter",
      "parameter": "case_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "case_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "boundary_cases",
      "kind": "semantic_parameter",
      "parameter": "boundary_cases",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "boundary_cases",
        "allowed_type_terms": [
          "cc:test"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "subject_population",
      "kind": "semantic_parameter",
      "parameter": "subject_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "subject_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "measured_subjects",
      "kind": "semantic_parameter",
      "parameter": "measured_subjects",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "measured_subjects",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "declared_limits_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "declared_limits"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_limits_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "measurement_units_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "measurement_units"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "measurement_units_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "boundary_cases_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "boundary_cases"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "boundary_cases_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "measured_subjects_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "measured_subjects"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "measured_subjects_count",
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
          "observation_artifact",
          "policy_artifact",
          "subjects_artifact",
          "conformance_report"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "limit_population",
          "unit_population",
          "case_population",
          "subject_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-declared-limits",
        "comparison": "complete_population",
        "roles": [
          "limit_population",
          "declared_limits"
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
        "pattern_id": "complete-measurement-units",
        "comparison": "complete_population",
        "roles": [
          "unit_population",
          "measurement_units"
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
        "pattern_id": "complete-boundary-cases",
        "comparison": "complete_population",
        "roles": [
          "case_population",
          "boundary_cases"
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
        "pattern_id": "complete-measured-subjects",
        "comparison": "complete_population",
        "roles": [
          "subject_population",
          "measured_subjects"
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
        "reference_role": "declared_limits",
        "number_role": "declared_limits_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "measurement_units",
        "number_role": "measurement_units_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "boundary_cases",
        "number_role": "boundary_cases_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "measured_subjects",
        "number_role": "measured_subjects_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "each-boundary-case-targets-one-limit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "boundary_cases",
          "member_role": "case",
          "complete_population_pattern_id": "complete-boundary-cases",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "declared_limits",
              "operator": "reference:targets",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "complete-declared-limits"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "case",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_limits"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "each-limit-resolves-to-one-unit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "declared_limits",
          "member_role": "limit",
          "complete_population_pattern_id": "complete-declared-limits",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "measurement_units",
              "operator": "reference:resolves_to",
              "member_position": "subject",
              "associated_position": "reference_operand",
              "applicability_context": {
                "mode": "unconditional",
                "operand_roles": []
              },
              "complete_population_pattern_id": "complete-measurement-units"
            }
          ]
        },
        "proposition_template": {
          "subject_role": "limit",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "measurement_units"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "policy-contains-limit-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "limit_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "policy-contains-unit-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "policy_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unit_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "observation-contains-case-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "case_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "subjects-contains-subject-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "subjects_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "subject-uses-policy",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "bounded_subject",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "policy_artifact"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "subject-is-deterministic",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "bounded_subject",
          "operator": "boolean:deterministic",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "report-is-conformant",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "conformance_report",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "verify-report-is-conformant",
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
              "role": "observation_artifact"
            },
            {
              "kind": "reference",
              "role": "policy_artifact"
            },
            {
              "kind": "reference",
              "role": "subjects_artifact"
            },
            {
              "kind": "reference",
              "role": "conformance_report"
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
          "subject_role": "conformance_report",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": false
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-report-is-conformant",
        "role": "verifies",
        "source_claim_pattern_id": "verify-report-is-conformant",
        "target_claim_pattern_id": "report-is-conformant"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-report-is-conformant",
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-report-is-conformant",
        "reference_role_joins": [
          {
            "role": "conformance_report",
            "target_positions": [
              "subject"
            ],
            "verification_positions": [
              "reference_operand"
            ],
            "falsifier_positions": [
              "subject"
            ]
          }
        ],
        "number_role_joins": [],
        "applicability_join": "exact_scope"
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-declared-limits"
          },
          {
            "pattern": "complete-measurement-units"
          },
          {
            "pattern": "complete-boundary-cases"
          },
          {
            "pattern": "complete-measured-subjects"
          },
          {
            "pattern": "each-boundary-case-targets-one-limit"
          },
          {
            "pattern": "each-limit-resolves-to-one-unit"
          },
          {
            "pattern": "policy-contains-limit-population"
          },
          {
            "pattern": "policy-contains-unit-population"
          },
          {
            "pattern": "observation-contains-case-population"
          },
          {
            "pattern": "subjects-contains-subject-population"
          },
          {
            "pattern": "subject-uses-policy"
          },
          {
            "pattern": "subject-is-deterministic"
          },
          {
            "pattern": "report-is-conformant"
          },
          {
            "pattern": "verify-report-is-conformant"
          },
          {
            "pattern": "verification-targets-report-is-conformant"
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
      "bounded_subject",
      "policy_artifact",
      "subjects_artifact",
      "conformance_report",
      "verification",
      "limit_population",
      "declared_limits",
      "unit_population",
      "measurement_units",
      "case_population",
      "boundary_cases",
      "subject_population",
      "measured_subjects"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "observation_artifact"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.policy.declared-boundary-record-consistency.",
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
        "missing": "No named proof.policy.declared-boundary-record-consistency constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.policy.declared-boundary-record-consistency.",
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
