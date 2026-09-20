# proof.ordering.lexicographic-conformance@4.0.0

<!-- Generated from validated package metadata. -->

For exact captured input, complete result, ordering policy, and item-key/comparator evidence artifacts, the package-owned deterministic-lexicographic-conformance.v1 transformer validates complete mutually inclusive item populations and exact counts, at least two typed keys with explicit precedence and direction, first-unequal-key ordering, equal-key fallthrough to one stable item-identity tie-breaker, non-equality for every distinguishable pair, the complete captured result, and observed input, declaration, and equivalent-serialization permutation invariance; it emits one exact digest-bound conformance report containing the complete typed fact set and derived declared-item, result-item, and policy-key populations, and the profile retains its own population, count, claim, falsifier, and verifies spine.

Profile digest: 310c34d26afb0b6ad757ec7a55dfea1305f3cead32034ecbc51b67ec841af22b. Parameter digest: b03d280a180dcd40d1e184660b70e59979cee7c1c605b361abd7a64061c31db0.

Admission digest: 4affe3f377ec022093d6aaa721eca797096695f7af6f28556dc1021475c02ce4.

Roles: 24/24 accounted; 3 owned gaps. Semantic parameters: 19; internal roles: 5.

## Guarantee and exclusions

For exact captured input, complete result, ordering policy, and item-key/comparator evidence artifacts, the package-owned deterministic-lexicographic-conformance.v1 transformer validates complete mutually inclusive item populations and exact counts, at least two typed keys with explicit precedence and direction, first-unequal-key ordering, equal-key fallthrough to one stable item-identity tie-breaker, non-equality for every distinguishable pair, the complete captured result, and observed input, declaration, and equivalent-serialization permutation invariance; it emits one exact digest-bound conformance report containing the complete typed fact set and derived declared-item, result-item, and policy-key populations, and the profile retains its own population, count, claim, falsifier, and verifies spine.

- artifact-acquisition-completeness-before-exact-capture
- caller-supplied-source-truth-or-authority
- empty-or-singleton-item-or-policy-key-populations
- ordering-behavior-after-the-captured-observation-boundary
- pack-applicability-evidence-authority-or-cce-consequence
- pagination-performance-or-resource-behavior
- runtime-or-deployment-behavior-outside-captured-artifacts
- undeclared-coercion-null-nan-locale-collation-normalization-or-punctuation-semantics

## Parameters

### ordering_operation

Declare ordering operation for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "ordering_operation",
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
        "pattern_id": "operation-reads-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input_snapshot"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "operation-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_snapshot"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "operation-deterministic",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "verify-determinism",
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
              "role": "ordering_operation"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "boolean:deterministic",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "nondeterminism_condition"
            ]
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
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "operation-uses-comparator",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "comparator"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "ordering_operation",
          "comparator",
          "verification"
        ]
      }
    }
  ]
}
```

### input_snapshot

Declare input snapshot for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "input_snapshot",
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
        "pattern_id": "operation-reads-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input_snapshot"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "conformance-report-records-exact-sources-and-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "declared_population"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "key_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "input-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "input_snapshot",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verification-reads-artifacts",
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
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "conformance_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "conformance_report",
          "input_snapshot",
          "item_key_evidence",
          "ordering_policy",
          "result_snapshot"
        ]
      }
    }
  ]
}
```

### result_snapshot

Declare result snapshot for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "result_snapshot",
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "operation-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_snapshot"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "conformance-report-records-exact-sources-and-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "declared_population"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "key_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "result-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_snapshot",
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
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "result-emits-count",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_snapshot",
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
      "value": {
        "pattern_id": "verification-reads-artifacts",
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
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "conformance_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "conformance_report",
          "input_snapshot",
          "item_key_evidence",
          "ordering_policy",
          "result_snapshot"
        ]
      }
    }
  ]
}
```

### declared_population

Declare declared population for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "declared_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "declared-within-result",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "declared_population",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "result-within-declared",
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
              "role": "declared_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verify-declared-within-result",
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
              "role": "declared_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "declared_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "population_mismatch_condition"
            ]
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "verify-result-within-declared",
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
              "role": "result_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "reverse_population_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "conformance-report-records-exact-sources-and-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "declared_population"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "key_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "input-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "input_snapshot",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "declared_population",
          "result_population",
          "key_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-declared-population",
        "comparison": "complete_population",
        "roles": [
          "declared_population",
          "declared_items"
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

### declared_items

Declare declared items for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "declared_items",
        "allowed_type_terms": [
          "cc:artifact",
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
        "pattern_id": "complete-declared-population",
        "comparison": "complete_population",
        "roles": [
          "declared_population",
          "declared_items"
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
        "reference_role": "declared_items",
        "number_role": "item_count"
      }
    }
  ]
}
```

### result_population

Declare result population for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "result_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "declared-within-result",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "declared_population",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "result-within-declared",
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
              "role": "declared_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "verify-declared-within-result",
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
              "role": "declared_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "declared_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "population_mismatch_condition"
            ]
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "verify-result-within-declared",
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
              "role": "result_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "reverse_population_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "conformance-report-records-exact-sources-and-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "declared_population"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "key_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "result-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_snapshot",
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
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "declared_population",
          "result_population",
          "key_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-result-population",
        "comparison": "complete_population",
        "roles": [
          "result_population",
          "result_items"
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

### result_items

Declare result items for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "result_items",
        "allowed_type_terms": [
          "cc:artifact",
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
        "pattern_id": "complete-result-population",
        "comparison": "complete_population",
        "roles": [
          "result_population",
          "result_items"
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
        "reference_role": "result_items",
        "number_role": "item_count"
      }
    }
  ]
}
```

### ordering_policy

Declare ordering policy for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/8",
      "value": {
        "role": "ordering_policy",
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
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "conformance-report-records-exact-sources-and-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "declared_population"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "key_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "policy-carries-keys",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_policy",
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
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "policy-carries-tie-breaker",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_policy",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stable_tie_breaker"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "comparator-uses-policy",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "comparator",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "policy_keys"
            },
            {
              "kind": "reference",
              "role": "stable_tie_breaker"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "operation-uses-comparator",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "comparator"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verification-reads-artifacts",
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
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "conformance_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "conformance_report",
          "input_snapshot",
          "item_key_evidence",
          "ordering_policy",
          "result_snapshot"
        ]
      }
    }
  ]
}
```

### key_population

Declare key population for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "conformance-report-records-exact-sources-and-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "declared_population"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "key_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "policy-carries-keys",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_policy",
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
          "declared_population",
          "result_population",
          "key_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-key-population",
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

Declare policy keys for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/10",
      "value": {
        "role": "policy_keys",
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
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "comparator-uses-policy",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "comparator",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "policy_keys"
            },
            {
              "kind": "reference",
              "role": "stable_tie_breaker"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-key-population",
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
      "ref": "/reference_role_count_bindings/2",
      "value": {
        "reference_role": "policy_keys",
        "number_role": "policy_key_count"
      }
    }
  ]
}
```

### stable_tie_breaker

Declare stable tie breaker for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/11",
      "value": {
        "role": "stable_tie_breaker",
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
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "policy-carries-tie-breaker",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_policy",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stable_tie_breaker"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "comparator-uses-policy",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "comparator",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "policy_keys"
            },
            {
              "kind": "reference",
              "role": "stable_tie_breaker"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            }
          ]
        }
      }
    }
  ]
}
```

### comparator

Declare comparator for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "comparator",
        "allowed_type_terms": [
          "cc:operation",
          "cc:process"
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
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "comparator-uses-policy",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "comparator",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "policy_keys"
            },
            {
              "kind": "reference",
              "role": "stable_tie_breaker"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "operation-uses-comparator",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "comparator"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "ordering_operation",
          "comparator",
          "verification"
        ]
      }
    }
  ]
}
```

### conformant_state

Declare conformant state for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "conformant_state",
        "allowed_type_terms": [
          "cc:state"
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
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "lexicographic-conformance-established",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "conformant_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "verify-lexicographic-conformance",
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
              "role": "conformance_report"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "conformance_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "conformant_state"
            }
          ]
        }
      }
    }
  ]
}
```

### verification

Declare verification for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "pattern_id": "verify-declared-within-result",
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
              "role": "declared_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "declared_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "population_mismatch_condition"
            ]
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "verify-result-within-declared",
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
              "role": "result_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "reverse_population_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "verify-result-count",
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
              "role": "result_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "result_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "count_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "item_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "verify-determinism",
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
              "role": "ordering_operation"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "boolean:deterministic",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "nondeterminism_condition"
            ]
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
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "verify-lexicographic-conformance",
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
              "role": "conformance_report"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "conformance_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "conformant_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verification-reads-artifacts",
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
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "conformance_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "ordering_operation",
          "comparator",
          "verification"
        ]
      }
    }
  ]
}
```

### population_mismatch_condition

Declare population mismatch condition for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "population_mismatch_condition",
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
        "pattern_id": "verify-declared-within-result",
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
              "role": "declared_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "declared_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "population_mismatch_condition"
            ]
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
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "conformance_failure_condition",
          "count_mismatch_condition",
          "nondeterminism_condition",
          "population_mismatch_condition",
          "reverse_population_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-target-declared-population",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "population_mismatch_condition"
          ]
        }
      }
    }
  ]
}
```

### reverse_population_mismatch_condition

Declare reverse population mismatch condition for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "reverse_population_mismatch_condition",
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
        "pattern_id": "verify-result-within-declared",
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
              "role": "result_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "reverse_population_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "conformance_failure_condition",
          "count_mismatch_condition",
          "nondeterminism_condition",
          "population_mismatch_condition",
          "reverse_population_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-target-result-population",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "reverse_population_mismatch_condition"
          ]
        }
      }
    }
  ]
}
```

### count_mismatch_condition

Declare count mismatch condition for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "count_mismatch_condition",
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
        "pattern_id": "verify-result-count",
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
              "role": "result_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "result_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "count_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "item_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "conformance_failure_condition",
          "count_mismatch_condition",
          "nondeterminism_condition",
          "population_mismatch_condition",
          "reverse_population_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "verification-target-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "count_mismatch_condition"
          ]
        }
      }
    }
  ]
}
```

### nondeterminism_condition

Declare nondeterminism condition for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "nondeterminism_condition",
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
        "pattern_id": "verify-determinism",
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
              "role": "ordering_operation"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "boolean:deterministic",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "nondeterminism_condition"
            ]
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
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "conformance_failure_condition",
          "count_mismatch_condition",
          "nondeterminism_condition",
          "population_mismatch_condition",
          "reverse_population_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "verification-target-determinism",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "nondeterminism_condition"
          ]
        }
      }
    }
  ]
}
```

### conformance_failure_condition

Declare conformance failure condition for proof.ordering.lexicographic-conformance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "conformance_failure_condition",
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
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "verify-lexicographic-conformance",
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
              "role": "conformance_report"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "conformance_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "conformant_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "conformance_failure_condition",
          "count_mismatch_condition",
          "nondeterminism_condition",
          "population_mismatch_condition",
          "reverse_population_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "value": {
        "relation_pattern_id": "verification-target-lexicographic-conformance",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "conformance_failure_condition"
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
| ordering_operation | semantic_parameter | ordering_operation |  |
| input_snapshot | semantic_parameter | input_snapshot |  |
| result_snapshot | semantic_parameter | result_snapshot |  |
| declared_population | semantic_parameter | declared_population |  |
| declared_items | semantic_parameter | declared_items |  |
| result_population | semantic_parameter | result_population |  |
| result_items | semantic_parameter | result_items |  |
| result_count_signal | observation_requirement |  | Acquire result_count_signal for the exact subject, attempt and applicability in this profile. |
| ordering_policy | semantic_parameter | ordering_policy |  |
| key_population | semantic_parameter | key_population |  |
| policy_keys | semantic_parameter | policy_keys |  |
| stable_tie_breaker | semantic_parameter | stable_tie_breaker |  |
| comparator | semantic_parameter | comparator |  |
| item_key_evidence | observation_requirement |  | Acquire item_key_evidence for the exact subject, attempt and applicability in this profile. |
| conformance_report | observation_requirement |  | Acquire conformance_report for the exact subject, attempt and applicability in this profile. |
| conformant_state | semantic_parameter | conformant_state |  |
| verification | semantic_parameter | verification |  |
| population_mismatch_condition | semantic_parameter | population_mismatch_condition |  |
| reverse_population_mismatch_condition | semantic_parameter | reverse_population_mismatch_condition |  |
| count_mismatch_condition | semantic_parameter | count_mismatch_condition |  |
| nondeterminism_condition | semantic_parameter | nondeterminism_condition |  |
| conformance_failure_condition | semantic_parameter | conformance_failure_condition |  |
| item_count | complete_population_count | declared_items, result_items |  |
| policy_key_count | complete_population_count | policy_keys |  |

```json
{
  "roles": [
    {
      "role": "ordering_operation",
      "kind": "semantic_parameter",
      "parameter": "ordering_operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/13",
        "/claim_patterns/17",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "ordering_operation",
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
      "role": "input_snapshot",
      "kind": "semantic_parameter",
      "parameter": "input_snapshot",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/18",
        "/claim_patterns/2",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "input_snapshot",
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
      "role": "result_snapshot",
      "kind": "semantic_parameter",
      "parameter": "result_snapshot",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/18",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "result_snapshot",
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
      "role": "declared_population",
      "kind": "semantic_parameter",
      "parameter": "declared_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/18",
        "/claim_patterns/2",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "declared_items",
      "kind": "semantic_parameter",
      "parameter": "declared_items",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "declared_items",
        "allowed_type_terms": [
          "cc:artifact",
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
      "role": "result_population",
      "kind": "semantic_parameter",
      "parameter": "result_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/18",
        "/claim_patterns/3",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "result_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "result_items",
      "kind": "semantic_parameter",
      "parameter": "result_items",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "result_items",
        "allowed_type_terms": [
          "cc:artifact",
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
      "role": "result_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/16",
        "/claim_patterns/4"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire result_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ordering.lexicographic-conformance/4.0.0/profile.json",
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
      "role": "ordering_policy",
      "kind": "semantic_parameter",
      "parameter": "ordering_policy",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "ordering_policy",
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
      "role": "key_population",
      "kind": "semantic_parameter",
      "parameter": "key_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/2"
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
        "/claim_patterns/7",
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "policy_keys",
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
      "role": "stable_tie_breaker",
      "kind": "semantic_parameter",
      "parameter": "stable_tie_breaker",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/6",
        "/claim_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "stable_tie_breaker",
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
      "role": "comparator",
      "kind": "semantic_parameter",
      "parameter": "comparator",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "comparator",
        "allowed_type_terms": [
          "cc:operation",
          "cc:process"
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
      "role": "item_key_evidence",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire item_key_evidence for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ordering.lexicographic-conformance/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "item_key_evidence",
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
      "role": "conformance_report",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire conformance_report for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ordering.lexicographic-conformance/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "conformance_report",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one",
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ]
      }
    },
    {
      "role": "conformant_state",
      "kind": "semantic_parameter",
      "parameter": "conformant_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/claim_patterns/20"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "conformant_state",
        "allowed_type_terms": [
          "cc:state"
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
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/20",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/3"
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
      "role": "population_mismatch_condition",
      "kind": "semantic_parameter",
      "parameter": "population_mismatch_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "population_mismatch_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "reverse_population_mismatch_condition",
      "kind": "semantic_parameter",
      "parameter": "reverse_population_mismatch_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "reverse_population_mismatch_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "count_mismatch_condition",
      "kind": "semantic_parameter",
      "parameter": "count_mismatch_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "count_mismatch_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "nondeterminism_condition",
      "kind": "semantic_parameter",
      "parameter": "nondeterminism_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "nondeterminism_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "conformance_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "conformance_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/distinct_reference_role_sets/2",
        "/falsifier_condition_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "conformance_failure_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "item_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "declared_items",
        "result_items"
      ],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/16",
        "/reference_role_count_bindings/0",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "item_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 2
      }
    },
    {
      "role": "policy_key_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "policy_keys"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "policy_key_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 2
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "conformance_report",
          "input_snapshot",
          "item_key_evidence",
          "ordering_policy",
          "result_snapshot"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "declared_population",
          "result_population",
          "key_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "conformance_failure_condition",
          "count_mismatch_condition",
          "nondeterminism_condition",
          "population_mismatch_condition",
          "reverse_population_mismatch_condition"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "ordering_operation",
          "comparator",
          "verification"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-declared-population",
        "comparison": "complete_population",
        "roles": [
          "declared_population",
          "declared_items"
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
        "pattern_id": "complete-result-population",
        "comparison": "complete_population",
        "roles": [
          "result_population",
          "result_items"
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
        "pattern_id": "complete-key-population",
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
        "reference_role": "declared_items",
        "number_role": "item_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "result_items",
        "number_role": "item_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "policy_keys",
        "number_role": "policy_key_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "operation-reads-input",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input_snapshot"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "operation-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "result_snapshot"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "input-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "input_snapshot",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "result-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_snapshot",
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
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "result-emits-count",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "result_snapshot",
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
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "policy-carries-keys",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_policy",
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
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "policy-carries-tie-breaker",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_policy",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stable_tie_breaker"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "comparator-uses-policy",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "comparator",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "policy_keys"
            },
            {
              "kind": "reference",
              "role": "stable_tie_breaker"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "operation-uses-comparator",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "comparator"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "verification-reads-artifacts",
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
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "conformance_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "declared-within-result",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "declared_population",
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
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "result-within-declared",
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
              "role": "declared_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "result-count-exact",
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
              "value_role": "item_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "operation-deterministic",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "ordering_operation",
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
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "verify-declared-within-result",
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
              "role": "declared_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "declared_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "population_mismatch_condition"
            ]
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
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "verify-result-within-declared",
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
              "role": "result_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "result_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "reverse_population_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "declared_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "verify-result-count",
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
              "role": "result_count_signal"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "result_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "count_mismatch_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "item_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "verify-determinism",
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
              "role": "ordering_operation"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "ordering_operation",
          "operator": "boolean:deterministic",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "nondeterminism_condition"
            ]
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
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "conformance-report-records-exact-sources-and-populations",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "input_snapshot"
            },
            {
              "kind": "reference",
              "role": "result_snapshot"
            },
            {
              "kind": "reference",
              "role": "ordering_policy"
            },
            {
              "kind": "reference",
              "role": "item_key_evidence"
            },
            {
              "kind": "reference",
              "role": "declared_population"
            },
            {
              "kind": "reference",
              "role": "result_population"
            },
            {
              "kind": "reference",
              "role": "key_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "lexicographic-conformance-established",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "conformant_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "verify-lexicographic-conformance",
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
              "role": "conformance_report"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "conformance_report",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "conformance_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "conformant_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-declared-population",
        "role": "verifies",
        "source_claim_pattern_id": "verify-declared-within-result",
        "target_claim_pattern_id": "declared-within-result"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-target-result-population",
        "role": "verifies",
        "source_claim_pattern_id": "verify-result-within-declared",
        "target_claim_pattern_id": "result-within-declared"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "verification-target-count",
        "role": "verifies",
        "source_claim_pattern_id": "verify-result-count",
        "target_claim_pattern_id": "result-count-exact"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "verification-target-determinism",
        "role": "verifies",
        "source_claim_pattern_id": "verify-determinism",
        "target_claim_pattern_id": "operation-deterministic"
      }
    },
    {
      "ref": "/relation_patterns/4",
      "constraint": {
        "pattern_id": "verification-target-lexicographic-conformance",
        "role": "verifies",
        "source_claim_pattern_id": "verify-lexicographic-conformance",
        "target_claim_pattern_id": "lexicographic-conformance-established"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-declared-population",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "population_mismatch_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-target-result-population",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "reverse_population_mismatch_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "verification-target-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "count_mismatch_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "verification-target-determinism",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "nondeterminism_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "constraint": {
        "relation_pattern_id": "verification-target-lexicographic-conformance",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "conformance_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-declared-population"
          },
          {
            "pattern": "complete-result-population"
          },
          {
            "pattern": "complete-key-population"
          },
          {
            "pattern": "operation-reads-input"
          },
          {
            "pattern": "operation-returns-result"
          },
          {
            "pattern": "input-carries-population"
          },
          {
            "pattern": "result-carries-population"
          },
          {
            "pattern": "result-emits-count"
          },
          {
            "pattern": "policy-carries-keys"
          },
          {
            "pattern": "policy-carries-tie-breaker"
          },
          {
            "pattern": "comparator-uses-policy"
          },
          {
            "pattern": "operation-uses-comparator"
          },
          {
            "pattern": "verification-reads-artifacts"
          },
          {
            "pattern": "declared-within-result"
          },
          {
            "pattern": "result-within-declared"
          },
          {
            "pattern": "result-count-exact"
          },
          {
            "pattern": "operation-deterministic"
          },
          {
            "pattern": "verify-declared-within-result"
          },
          {
            "pattern": "verify-result-within-declared"
          },
          {
            "pattern": "verify-result-count"
          },
          {
            "pattern": "verify-determinism"
          },
          {
            "pattern": "conformance-report-records-exact-sources-and-populations"
          },
          {
            "pattern": "lexicographic-conformance-established"
          },
          {
            "pattern": "verify-lexicographic-conformance"
          },
          {
            "pattern": "verification-target-declared-population"
          },
          {
            "pattern": "verification-target-result-population"
          },
          {
            "pattern": "verification-target-count"
          },
          {
            "pattern": "verification-target-determinism"
          },
          {
            "pattern": "verification-target-lexicographic-conformance"
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
      "ordering_operation",
      "input_snapshot",
      "result_snapshot",
      "declared_population",
      "declared_items",
      "result_population",
      "result_items",
      "ordering_policy",
      "key_population",
      "policy_keys",
      "stable_tie_breaker",
      "comparator",
      "conformant_state",
      "verification",
      "population_mismatch_condition",
      "reverse_population_mismatch_condition",
      "count_mismatch_condition",
      "nondeterminism_condition",
      "conformance_failure_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "result_count_signal",
      "item_key_evidence",
      "conformance_report"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.ordering.lexicographic-conformance.",
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
        "missing": "No named proof.ordering.lexicographic-conformance constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.ordering.lexicographic-conformance.",
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
