# proof.policy.declared-limit-propagation@4.0.0

<!-- Generated from validated package metadata. -->

For one exact closed declared policy and one exact raw UTF-8 guidance artifact, the package-owned transformer associates every required policy key with exactly one plain decimal value and exact unit token, refuses missing, duplicate, stale, conflicting, substituted, wrong-unit, and unrelated-number guidance, and emits complete policy-key and association populations, exact counts, associations, and one canonical report bound to the exact source-set digest.

Profile digest: 2acf4c49da5b019ad3efa919b4c750ff9f700ef28fef8f4a1921745bd9228bc8. Parameter digest: b274c9450994dcfd8c9b1d036cca764dc6e22998e48c47b738b9852d5c614b57.

Admission digest: 00224989fa444ced0caccd7bdc65be297429aa18abb4b776944f3f8873d64de3.

Roles: 21/21 accounted; 2 owned gaps. Semantic parameters: 14; internal roles: 7.

## Guarantee and exclusions

For one exact closed declared policy and one exact raw UTF-8 guidance artifact, the package-owned transformer associates every required policy key with exactly one plain decimal value and exact unit token, refuses missing, duplicate, stale, conflicting, substituted, wrong-unit, and unrelated-number guidance, and emits complete policy-key and association populations, exact counts, associations, and one canonical report bound to the exact source-set digest.

- additional-live-guidance-surfaces-beyond-the-one-captured-artifact
- artifact-acquisition-completeness-before-exact-capture
- declared-policy-document-correspondence-to-enforced-limit-and-unit
- evidence-authority-applicability-authority-or-cce-consequences
- guidance-propagation-does-not-entail-boundary-consistency
- locally-redigested-or-unadmitted-profile-variants
- non-plain-decimal-numeral-forms
- runtime-truth-or-production-enforcement
- shared-policy-identity-across-independently-assessed-packs

## Parameters

### policy_artifact

Declare policy artifact for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/1",
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
      "ref": "/claim_patterns/3",
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
      "ref": "/claim_patterns/4",
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
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verify-report-is-propagated",
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
              "role": "policy_artifact"
            },
            {
              "kind": "reference",
              "role": "guidance_artifact"
            },
            {
              "kind": "reference",
              "role": "propagation_report"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "propagation_report",
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
          "policy_artifact",
          "guidance_artifact",
          "propagation_report"
        ]
      }
    }
  ]
}
```

### guidance_artifact

Declare guidance artifact for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "guidance_artifact",
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
        "pattern_id": "guidance-contains-association-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "guidance_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "association_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "guidance-contains-key-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "guidance_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "key_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verify-report-is-propagated",
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
              "role": "policy_artifact"
            },
            {
              "kind": "reference",
              "role": "guidance_artifact"
            },
            {
              "kind": "reference",
              "role": "propagation_report"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "propagation_report",
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
          "policy_artifact",
          "guidance_artifact",
          "propagation_report"
        ]
      }
    }
  ]
}
```

### propagation_report

Declare propagation report for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "propagation_report",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "report-is-propagated",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "propagation_report",
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
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verify-report-is-propagated",
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
              "role": "policy_artifact"
            },
            {
              "kind": "reference",
              "role": "guidance_artifact"
            },
            {
              "kind": "reference",
              "role": "propagation_report"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "propagation_report",
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
          "policy_artifact",
          "guidance_artifact",
          "propagation_report"
        ]
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-report-is-propagated",
        "reference_role_joins": [
          {
            "role": "propagation_report",
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

Declare verification for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verify-report-is-propagated",
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
              "role": "policy_artifact"
            },
            {
              "kind": "reference",
              "role": "guidance_artifact"
            },
            {
              "kind": "reference",
              "role": "propagation_report"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "propagation_report",
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

Declare limit population for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/3",
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
          "association_population",
          "surface_population",
          "key_population"
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

Declare declared limits for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "pattern_id": "each-guidance-association-targets-one-limit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "guidance_associations",
          "member_role": "guidance_association",
          "complete_population_pattern_id": "complete-guidance-associations",
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
          "subject_role": "guidance_association",
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
        "pattern_id": "each-policy-key-resolves-to-one-limit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "policy_keys",
          "member_role": "policy_key",
          "complete_population_pattern_id": "complete-policy-keys",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "declared_limits",
              "operator": "reference:resolves_to",
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
          "subject_role": "policy_key",
          "operator": "reference:resolves_to",
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
      "ref": "/claim_patterns/2",
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

Declare unit population for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/4",
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
          "association_population",
          "surface_population",
          "key_population"
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

Declare measurement units for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/2",
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

### association_population

Declare association population for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "association_population",
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
        "pattern_id": "guidance-contains-association-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "guidance_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "association_population"
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
          "association_population",
          "surface_population",
          "key_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-guidance-associations",
        "comparison": "complete_population",
        "roles": [
          "association_population",
          "guidance_associations"
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

### guidance_associations

Declare guidance associations for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "guidance_associations",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "each-guidance-association-targets-one-limit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "guidance_associations",
          "member_role": "guidance_association",
          "complete_population_pattern_id": "complete-guidance-associations",
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
          "subject_role": "guidance_association",
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
        "pattern_id": "complete-guidance-associations",
        "comparison": "complete_population",
        "roles": [
          "association_population",
          "guidance_associations"
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
        "reference_role": "guidance_associations",
        "number_role": "guidance_associations_count"
      }
    }
  ]
}
```

### surface_population

Declare surface population for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "surface_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "limit_population",
          "unit_population",
          "association_population",
          "surface_population",
          "key_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-guidance-surfaces",
        "comparison": "complete_population",
        "roles": [
          "surface_population",
          "guidance_surfaces"
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

### guidance_surfaces

Declare guidance surfaces for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "guidance_surfaces",
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
        "pattern_id": "complete-guidance-surfaces",
        "comparison": "complete_population",
        "roles": [
          "surface_population",
          "guidance_surfaces"
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
        "reference_role": "guidance_surfaces",
        "number_role": "guidance_surfaces_count"
      }
    }
  ]
}
```

### key_population

Declare key population for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "key_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "guidance-contains-key-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "guidance_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "key_population"
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
          "association_population",
          "surface_population",
          "key_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-policy-keys",
        "comparison": "complete_population",
        "roles": [
          "key_population",
          "policy_keys"
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

### policy_keys

Declare policy keys for proof.policy.declared-limit-propagation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/15",
      "value": {
        "role": "policy_keys",
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
        "pattern_id": "each-policy-key-resolves-to-one-limit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "policy_keys",
          "member_role": "policy_key",
          "complete_population_pattern_id": "complete-policy-keys",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "declared_limits",
              "operator": "reference:resolves_to",
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
          "subject_role": "policy_key",
          "operator": "reference:resolves_to",
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
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-policy-keys",
        "comparison": "complete_population",
        "roles": [
          "key_population",
          "policy_keys"
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
        "reference_role": "policy_keys",
        "number_role": "policy_keys_count"
      }
    }
  ]
}
```

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |
| guidance_subject | capability_gap |  | Required role guidance_subject has no rule-linked semantic source. |
| policy_artifact | semantic_parameter | policy_artifact |  |
| guidance_artifact | semantic_parameter | guidance_artifact |  |
| propagation_report | semantic_parameter | propagation_report |  |
| verification | semantic_parameter | verification |  |
| mismatch_condition | capability_gap |  | Required role mismatch_condition has no rule-linked semantic source. |
| limit_population | semantic_parameter | limit_population |  |
| declared_limits | semantic_parameter | declared_limits |  |
| unit_population | semantic_parameter | unit_population |  |
| measurement_units | semantic_parameter | measurement_units |  |
| association_population | semantic_parameter | association_population |  |
| guidance_associations | semantic_parameter | guidance_associations |  |
| surface_population | semantic_parameter | surface_population |  |
| guidance_surfaces | semantic_parameter | guidance_surfaces |  |
| key_population | semantic_parameter | key_population |  |
| policy_keys | semantic_parameter | policy_keys |  |
| declared_limits_count | complete_population_count | declared_limits |  |
| measurement_units_count | complete_population_count | measurement_units |  |
| guidance_associations_count | complete_population_count | guidance_associations |  |
| guidance_surfaces_count | complete_population_count | guidance_surfaces |  |
| policy_keys_count | complete_population_count | policy_keys |  |

```json
{
  "roles": [
    {
      "role": "guidance_subject",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role guidance_subject has no rule-linked semantic source.",
        "source": "profiles/proof.policy.declared-limit-propagation/4.0.0/profile.json#/reference_roles/0",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "guidance_subject",
        "allowed_type_terms": [
          "cc:process",
          "cc:runtime_component"
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
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/8",
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
      "role": "guidance_artifact",
      "kind": "semantic_parameter",
      "parameter": "guidance_artifact",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "guidance_artifact",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "propagation_report",
      "kind": "semantic_parameter",
      "parameter": "propagation_report",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0",
        "/falsifier_occurrence_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "propagation_report",
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
        "/claim_patterns/8"
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
        "source": "profiles/proof.policy.declared-limit-propagation/4.0.0/profile.json#/reference_roles/5",
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
        "/claim_patterns/3",
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
        "/claim_patterns/2",
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
        "/claim_patterns/4",
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
        "/claim_patterns/2",
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
      "role": "association_population",
      "kind": "semantic_parameter",
      "parameter": "association_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "association_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "guidance_associations",
      "kind": "semantic_parameter",
      "parameter": "guidance_associations",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "guidance_associations",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "surface_population",
      "kind": "semantic_parameter",
      "parameter": "surface_population",
      "inputs": [],
      "rule_refs": [
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "surface_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "guidance_surfaces",
      "kind": "semantic_parameter",
      "parameter": "guidance_surfaces",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "guidance_surfaces",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "key_population",
      "kind": "semantic_parameter",
      "parameter": "key_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/6",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "key_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "policy_keys",
      "kind": "semantic_parameter",
      "parameter": "policy_keys",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/reference_binding_patterns/4",
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "policy_keys",
        "allowed_type_terms": [
          "cc:configuration"
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
      "role": "guidance_associations_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "guidance_associations"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "guidance_associations_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "guidance_surfaces_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "guidance_surfaces"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "guidance_surfaces_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "policy_keys_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "policy_keys"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "policy_keys_count",
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
          "policy_artifact",
          "guidance_artifact",
          "propagation_report"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "limit_population",
          "unit_population",
          "association_population",
          "surface_population",
          "key_population"
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
        "pattern_id": "complete-guidance-associations",
        "comparison": "complete_population",
        "roles": [
          "association_population",
          "guidance_associations"
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
        "pattern_id": "complete-guidance-surfaces",
        "comparison": "complete_population",
        "roles": [
          "surface_population",
          "guidance_surfaces"
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
        "pattern_id": "complete-policy-keys",
        "comparison": "complete_population",
        "roles": [
          "key_population",
          "policy_keys"
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
        "reference_role": "guidance_associations",
        "number_role": "guidance_associations_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "guidance_surfaces",
        "number_role": "guidance_surfaces_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "constraint": {
        "reference_role": "policy_keys",
        "number_role": "policy_keys_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "each-guidance-association-targets-one-limit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "guidance_associations",
          "member_role": "guidance_association",
          "complete_population_pattern_id": "complete-guidance-associations",
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
          "subject_role": "guidance_association",
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
        "pattern_id": "each-policy-key-resolves-to-one-limit",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "policy_keys",
          "member_role": "policy_key",
          "complete_population_pattern_id": "complete-policy-keys",
          "quantifier": "universal",
          "empty_behavior": "vacuously_satisfied",
          "association_bindings": [
            {
              "associated_role": "declared_limits",
              "operator": "reference:resolves_to",
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
          "subject_role": "policy_key",
          "operator": "reference:resolves_to",
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
      "ref": "/claim_patterns/2",
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
      "ref": "/claim_patterns/3",
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
      "ref": "/claim_patterns/4",
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
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "guidance-contains-association-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "guidance_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "association_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "guidance-contains-key-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "guidance_artifact",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "key_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "report-is-propagated",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "propagation_report",
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
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "verify-report-is-propagated",
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
              "role": "policy_artifact"
            },
            {
              "kind": "reference",
              "role": "guidance_artifact"
            },
            {
              "kind": "reference",
              "role": "propagation_report"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "propagation_report",
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
        "pattern_id": "verification-targets-report-is-propagated",
        "role": "verifies",
        "source_claim_pattern_id": "verify-report-is-propagated",
        "target_claim_pattern_id": "report-is-propagated"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-report-is-propagated",
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/falsifier_occurrence_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-report-is-propagated",
        "reference_role_joins": [
          {
            "role": "propagation_report",
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
            "pattern": "complete-guidance-associations"
          },
          {
            "pattern": "complete-guidance-surfaces"
          },
          {
            "pattern": "complete-policy-keys"
          },
          {
            "pattern": "each-guidance-association-targets-one-limit"
          },
          {
            "pattern": "each-policy-key-resolves-to-one-limit"
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
            "pattern": "guidance-contains-association-population"
          },
          {
            "pattern": "guidance-contains-key-population"
          },
          {
            "pattern": "report-is-propagated"
          },
          {
            "pattern": "verify-report-is-propagated"
          },
          {
            "pattern": "verification-targets-report-is-propagated"
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
      "policy_artifact",
      "guidance_artifact",
      "propagation_report",
      "verification",
      "limit_population",
      "declared_limits",
      "unit_population",
      "measurement_units",
      "association_population",
      "guidance_associations",
      "surface_population",
      "guidance_surfaces",
      "key_population",
      "policy_keys"
    ],
    "declaration_outputs": [],
    "required_observations": [],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.policy.declared-limit-propagation.",
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
        "missing": "No named proof.policy.declared-limit-propagation constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.policy.declared-limit-propagation.",
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
