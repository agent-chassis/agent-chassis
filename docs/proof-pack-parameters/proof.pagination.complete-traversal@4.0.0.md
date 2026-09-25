# proof.pagination.complete-traversal@4.0.0

<!-- Generated from validated package metadata. -->

For one exact package-authenticated authoritative ordered-occurrence population and exact captured finite pagination trace, every occurrence is returned exactly once in authoritative order through one canonical initial state, one linear opaque cursor chain, one snapshot/version identity, and one terminal page, with equality-normalized completeness and fail-closed resource accounting.

Profile digest: 28ba21ec44f1ceb0f3078717abf74a071206a0f600c50ced31b7b10078136e67. Parameter digest: 0662fe4a656cad0ffd6f8729eee2c666effccb45be28aa74083e4641475dcc1e.

Admission digest: bd150c38766c9c61a694d6eaf105474d1435ff5d3e73aaa0f6ccec55ca751268.

Roles: 35/35 accounted; 7 owned gaps. Semantic parameters: 28; internal roles: 7.

## Guarantee and exclusions

For one exact package-authenticated authoritative ordered-occurrence population and exact captured finite pagination trace, every occurrence is returned exactly once in authoritative order through one canonical initial state, one linear opaque cursor chain, one snapshot/version identity, and one terminal page, with equality-normalized completeness and fail-closed resource accounting.

- caller-declared-population-completeness
- cas-linearizability
- cross-contract-result-join
- cross-pack-result-join
- runtime-truth
- snapshot-acquisition-atomicity
- traversal-liveness
- unrepresented-concurrency

## Parameters

### mutation_trace

Declare mutation trace for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "mutation_trace",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    }
  ]
}
```

### projection_result

Declare projection result for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "projection_result",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    }
  ]
}
```

### authoritative_population

Declare authoritative population for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authoritative_population",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "authentication-occurrence-authenticates-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authentication_evidence_occurrence",
          "operator": "reference:authenticates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "authentication_observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authoritative_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "population-has-authenticated-source-of-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authoritative_population",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "authentication_observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authenticated_source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "traversal-uses-authoritative-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "traversal",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authoritative_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    }
  ]
}
```

### authoritative_occurrence_population

Declare authoritative occurrence population for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authoritative_occurrence_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-authoritative-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "authoritative_occurrence_population",
          "authoritative_occurrences"
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

### authoritative_occurrences

Declare authoritative occurrences for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authoritative_occurrences",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-authoritative-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "authoritative_occurrence_population",
          "authoritative_occurrences"
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

### returned_occurrence_population

Declare returned occurrence population for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "returned_occurrence_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-returned-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "returned_occurrence_population",
          "returned_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    }
  ]
}
```

### returned_occurrences

Declare returned occurrences for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "returned_occurrences",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-returned-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "returned_occurrence_population",
          "returned_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    }
  ]
}
```

### returned_page_population

Declare returned page population for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "returned_page_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "returned_page_population",
          "returned_pages"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    }
  ]
}
```

### returned_pages

Declare returned pages for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "returned_pages",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-page-resolves-snapshot",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "returned_pages",
          "member_role": "returned_page"
        },
        "proposition_template": {
          "subject_role": "returned_page",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-page-uses-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "returned_pages",
          "member_role": "returned_page"
        },
        "proposition_template": {
          "subject_role": "returned_page",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "traversal_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "returned_page_population",
          "returned_pages"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    }
  ]
}
```

### cursor_transition_population

Declare cursor transition population for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cursor_transition_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-cursor-transition-population",
        "comparison": "complete_population",
        "roles": [
          "cursor_transition_population",
          "cursor_transitions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    }
  ]
}
```

### cursor_transitions

Declare cursor transitions for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cursor_transitions",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-cursor-transition-population",
        "comparison": "complete_population",
        "roles": [
          "cursor_transition_population",
          "cursor_transitions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    }
  ]
}
```

### equality_normalized_member_population

Declare equality normalized member population for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "equality_normalized_member_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-equality-normalized-member-population",
        "comparison": "complete_population",
        "roles": [
          "equality_normalized_member_population",
          "equality_normalized_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    }
  ]
}
```

### equality_normalized_members

Declare equality normalized members for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "equality_normalized_members",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-equality-normalized-member-population",
        "comparison": "complete_population",
        "roles": [
          "equality_normalized_member_population",
          "equality_normalized_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    }
  ]
}
```

### authentication_observation_attempt

Declare authentication observation attempt for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authentication_observation_attempt",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "authentication-occurrence-authenticates-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authentication_evidence_occurrence",
          "operator": "reference:authenticates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "authentication_observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authoritative_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "population-has-authenticated-source-of-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authoritative_population",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "authentication_observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authenticated_source"
            }
          ]
        }
      }
    }
  ]
}
```

### authenticated_source

Declare authenticated source for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authenticated_source",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity",
          "cc:process",
          "cc:resource",
          "cc:runtime_component"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "population-has-authenticated-source-of-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authoritative_population",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "authentication_observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authenticated_source"
            }
          ]
        }
      }
    }
  ]
}
```

### equality_policy

Declare equality policy for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/22",
      "value": {
        "role": "equality_policy",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    }
  ]
}
```

### resource_policy

Declare resource policy for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/23",
      "value": {
        "role": "resource_policy",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    }
  ]
}
```

### traversal

Declare traversal for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "traversal",
        "allowed_type_terms": [
          "cc:process"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "traversal-uses-authoritative-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "traversal",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authoritative_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-page-resolves-snapshot",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "returned_pages",
          "member_role": "returned_page"
        },
        "proposition_template": {
          "subject_role": "returned_page",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-page-uses-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "returned_pages",
          "member_role": "returned_page"
        },
        "proposition_template": {
          "subject_role": "returned_page",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "traversal_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "terminal-page-completes-traversal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_page",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "traversal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "traversal-has-exact-order",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "traversal",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "exact_order_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "traversal-has-exact-equality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "traversal",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "exact_equality_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verify-complete-traversal",
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
              "role": "traversal"
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
          "subject_role": "traversal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "traversal_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "exact_order_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-returned-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "returned_occurrence_population",
          "returned_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "returned_page_population",
          "returned_pages"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-cursor-transition-population",
        "comparison": "complete_population",
        "roles": [
          "cursor_transition_population",
          "cursor_transitions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-equality-normalized-member-population",
        "comparison": "complete_population",
        "roles": [
          "equality_normalized_member_population",
          "equality_normalized_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    }
  ]
}
```

### snapshot

Declare snapshot for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/25",
      "value": {
        "role": "snapshot",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-page-resolves-snapshot",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "returned_pages",
          "member_role": "returned_page"
        },
        "proposition_template": {
          "subject_role": "returned_page",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    }
  ]
}
```

### traversal_source_version

Declare traversal source version for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/26",
      "value": {
        "role": "traversal_source_version",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-page-uses-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "returned_pages",
          "member_role": "returned_page"
        },
        "proposition_template": {
          "subject_role": "returned_page",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "traversal_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    }
  ]
}
```

### terminal_page

Declare terminal page for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/27",
      "value": {
        "role": "terminal_page",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "terminal-page-completes-traversal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_page",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "traversal"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    }
  ]
}
```

### exact_order_state

Declare exact order state for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/28",
      "value": {
        "role": "exact_order_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "traversal-has-exact-order",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "traversal",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "exact_order_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verify-complete-traversal",
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
              "role": "traversal"
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
          "subject_role": "traversal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "traversal_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "exact_order_state"
            }
          ]
        }
      }
    }
  ]
}
```

### exact_equality_state

Declare exact equality state for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/29",
      "value": {
        "role": "exact_equality_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "traversal-has-exact-equality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "traversal",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "exact_equality_state"
            }
          ]
        }
      }
    }
  ]
}
```

### aggregate_input_accounting

Declare aggregate input accounting for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/30",
      "value": {
        "role": "aggregate_input_accounting",
        "allowed_type_terms": [
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    }
  ]
}
```

### canonical_result_accounting

Declare canonical result accounting for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/31",
      "value": {
        "role": "canonical_result_accounting",
        "allowed_type_terms": [
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    }
  ]
}
```

### work_accounting

Declare work accounting for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/32",
      "value": {
        "role": "work_accounting",
        "allowed_type_terms": [
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    }
  ]
}
```

### verification

Declare verification for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/33",
      "value": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
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
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verify-complete-traversal",
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
              "role": "traversal"
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
          "subject_role": "traversal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "traversal_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "exact_order_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    }
  ]
}
```

### traversal_failure_condition

Declare traversal failure condition for proof.pagination.complete-traversal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/34",
      "value": {
        "role": "traversal_failure_condition",
        "allowed_type_terms": [
          "cc:criterion",
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "verify-complete-traversal",
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
              "role": "traversal"
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
          "subject_role": "traversal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "traversal_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "exact_order_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-complete-traversal",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "traversal_failure_condition"
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
| mutation_trace | semantic_parameter | mutation_trace |  |
| projection_result | semantic_parameter | projection_result |  |
| authoritative_population | semantic_parameter | authoritative_population |  |
| authoritative_occurrence_population | semantic_parameter | authoritative_occurrence_population |  |
| authoritative_occurrences | semantic_parameter | authoritative_occurrences |  |
| returned_occurrence_population | semantic_parameter | returned_occurrence_population |  |
| returned_occurrences | semantic_parameter | returned_occurrences |  |
| returned_page_population | semantic_parameter | returned_page_population |  |
| returned_pages | semantic_parameter | returned_pages |  |
| cursor_transition_population | semantic_parameter | cursor_transition_population |  |
| cursor_transitions | semantic_parameter | cursor_transitions |  |
| equality_normalized_member_population | semantic_parameter | equality_normalized_member_population |  |
| equality_normalized_members | semantic_parameter | equality_normalized_members |  |
| authentication_evidence_occurrence | observation_requirement |  | Acquire authentication_evidence_occurrence for the exact subject, attempt and applicability in this profile. |
| authentication_observation_attempt | semantic_parameter | authentication_observation_attempt |  |
| authenticated_source | semantic_parameter | authenticated_source |  |
| target_resolution_witness | observation_requirement |  | Acquire target_resolution_witness for the exact subject, attempt and applicability in this profile. |
| source_authentication_witness | observation_requirement |  | Acquire source_authentication_witness for the exact subject, attempt and applicability in this profile. |
| source_of_record_witness | observation_requirement |  | Acquire source_of_record_witness for the exact subject, attempt and applicability in this profile. |
| attempt_binding_witness | observation_requirement |  | Acquire attempt_binding_witness for the exact subject, attempt and applicability in this profile. |
| authentication_witness | observation_requirement |  | Acquire authentication_witness for the exact subject, attempt and applicability in this profile. |
| authentication_capture | observation_requirement |  | Acquire authentication_capture for the exact subject, attempt and applicability in this profile. |
| equality_policy | semantic_parameter | equality_policy |  |
| resource_policy | semantic_parameter | resource_policy |  |
| traversal | semantic_parameter | traversal |  |
| snapshot | semantic_parameter | snapshot |  |
| traversal_source_version | semantic_parameter | traversal_source_version |  |
| terminal_page | semantic_parameter | terminal_page |  |
| exact_order_state | semantic_parameter | exact_order_state |  |
| exact_equality_state | semantic_parameter | exact_equality_state |  |
| aggregate_input_accounting | semantic_parameter | aggregate_input_accounting |  |
| canonical_result_accounting | semantic_parameter | canonical_result_accounting |  |
| work_accounting | semantic_parameter | work_accounting |  |
| verification | semantic_parameter | verification |  |
| traversal_failure_condition | semantic_parameter | traversal_failure_condition |  |

```json
{
  "roles": [
    {
      "role": "mutation_trace",
      "kind": "semantic_parameter",
      "parameter": "mutation_trace",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "mutation_trace",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "projection_result",
      "kind": "semantic_parameter",
      "parameter": "projection_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "projection_result",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authoritative_population",
      "kind": "semantic_parameter",
      "parameter": "authoritative_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authoritative_population",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authoritative_occurrence_population",
      "kind": "semantic_parameter",
      "parameter": "authoritative_occurrence_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authoritative_occurrence_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authoritative_occurrences",
      "kind": "semantic_parameter",
      "parameter": "authoritative_occurrences",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authoritative_occurrences",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "returned_occurrence_population",
      "kind": "semantic_parameter",
      "parameter": "returned_occurrence_population",
      "inputs": [],
      "rule_refs": [
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "returned_occurrence_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "returned_occurrences",
      "kind": "semantic_parameter",
      "parameter": "returned_occurrences",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "returned_occurrences",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "returned_page_population",
      "kind": "semantic_parameter",
      "parameter": "returned_page_population",
      "inputs": [],
      "rule_refs": [
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "returned_page_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "returned_pages",
      "kind": "semantic_parameter",
      "parameter": "returned_pages",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/8",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "returned_pages",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "cursor_transition_population",
      "kind": "semantic_parameter",
      "parameter": "cursor_transition_population",
      "inputs": [],
      "rule_refs": [
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cursor_transition_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cursor_transitions",
      "kind": "semantic_parameter",
      "parameter": "cursor_transitions",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cursor_transitions",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "equality_normalized_member_population",
      "kind": "semantic_parameter",
      "parameter": "equality_normalized_member_population",
      "inputs": [],
      "rule_refs": [
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "equality_normalized_member_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "equality_normalized_members",
      "kind": "semantic_parameter",
      "parameter": "equality_normalized_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "equality_normalized_members",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "authentication_evidence_occurrence",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/8"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire authentication_evidence_occurrence for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.complete-traversal/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "authentication_evidence_occurrence",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authentication_observation_attempt",
      "kind": "semantic_parameter",
      "parameter": "authentication_observation_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authentication_observation_attempt",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authenticated_source",
      "kind": "semantic_parameter",
      "parameter": "authenticated_source",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authenticated_source",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity",
          "cc:process",
          "cc:resource",
          "cc:runtime_component"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "target_resolution_witness",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire target_resolution_witness for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.complete-traversal/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "target_resolution_witness",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "source_authentication_witness",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire source_authentication_witness for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.complete-traversal/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "source_authentication_witness",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "source_of_record_witness",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire source_of_record_witness for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.complete-traversal/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "source_of_record_witness",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "attempt_binding_witness",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire attempt_binding_witness for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.complete-traversal/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "attempt_binding_witness",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authentication_witness",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire authentication_witness for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.complete-traversal/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "authentication_witness",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authentication_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire authentication_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.complete-traversal/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "authentication_capture",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "equality_policy",
      "kind": "semantic_parameter",
      "parameter": "equality_policy",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "equality_policy",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "resource_policy",
      "kind": "semantic_parameter",
      "parameter": "resource_policy",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "resource_policy",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "traversal",
      "kind": "semantic_parameter",
      "parameter": "traversal",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/1",
        "/reference_binding_patterns/2",
        "/reference_binding_patterns/3",
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "traversal",
        "allowed_type_terms": [
          "cc:process"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "snapshot",
      "kind": "semantic_parameter",
      "parameter": "snapshot",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "snapshot",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "traversal_source_version",
      "kind": "semantic_parameter",
      "parameter": "traversal_source_version",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "traversal_source_version",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "terminal_page",
      "kind": "semantic_parameter",
      "parameter": "terminal_page",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "terminal_page",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "exact_order_state",
      "kind": "semantic_parameter",
      "parameter": "exact_order_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/6",
        "/claim_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "exact_order_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "exact_equality_state",
      "kind": "semantic_parameter",
      "parameter": "exact_equality_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "exact_equality_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "aggregate_input_accounting",
      "kind": "semantic_parameter",
      "parameter": "aggregate_input_accounting",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "aggregate_input_accounting",
        "allowed_type_terms": [
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "canonical_result_accounting",
      "kind": "semantic_parameter",
      "parameter": "canonical_result_accounting",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "canonical_result_accounting",
        "allowed_type_terms": [
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "work_accounting",
      "kind": "semantic_parameter",
      "parameter": "work_accounting",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "work_accounting",
        "allowed_type_terms": [
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id"
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
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "traversal_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "traversal_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/9",
        "/distinct_reference_role_sets/0",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "traversal_failure_condition",
        "allowed_type_terms": [
          "cc:criterion",
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
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
          "mutation_trace",
          "projection_result",
          "authoritative_population",
          "returned_occurrence_population",
          "returned_page_population",
          "cursor_transition_population",
          "equality_normalized_member_population",
          "traversal",
          "snapshot",
          "traversal_source_version",
          "terminal_page",
          "verification",
          "traversal_failure_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-authoritative-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "authoritative_occurrence_population",
          "authoritative_occurrences"
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
        "pattern_id": "complete-returned-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "returned_occurrence_population",
          "returned_occurrences"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "constraint": {
        "pattern_id": "complete-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "returned_page_population",
          "returned_pages"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "constraint": {
        "pattern_id": "complete-cursor-transition-population",
        "comparison": "complete_population",
        "roles": [
          "cursor_transition_population",
          "cursor_transitions"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "constraint": {
        "pattern_id": "complete-equality-normalized-member-population",
        "comparison": "complete_population",
        "roles": [
          "equality_normalized_member_population",
          "equality_normalized_members"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "traversal"
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "authentication-occurrence-authenticates-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authentication_evidence_occurrence",
          "operator": "reference:authenticates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "authentication_observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authoritative_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "population-has-authenticated-source-of-record",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authoritative_population",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "authentication_observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authenticated_source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "traversal-uses-authoritative-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "traversal",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "authoritative_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "each-page-resolves-snapshot",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "returned_pages",
          "member_role": "returned_page"
        },
        "proposition_template": {
          "subject_role": "returned_page",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "each-page-uses-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "returned_pages",
          "member_role": "returned_page"
        },
        "proposition_template": {
          "subject_role": "returned_page",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "traversal_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "terminal-page-completes-traversal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "terminal_page",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "traversal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "traversal-has-exact-order",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "traversal",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "exact_order_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "traversal-has-exact-equality",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "traversal",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "exact_equality_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "verification-reads-exact-traversal-bindings",
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
              "role": "mutation_trace"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "authoritative_population"
            },
            {
              "kind": "reference",
              "role": "authentication_evidence_occurrence"
            },
            {
              "kind": "reference",
              "role": "target_resolution_witness"
            },
            {
              "kind": "reference",
              "role": "source_authentication_witness"
            },
            {
              "kind": "reference",
              "role": "source_of_record_witness"
            },
            {
              "kind": "reference",
              "role": "attempt_binding_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_witness"
            },
            {
              "kind": "reference",
              "role": "authentication_capture"
            },
            {
              "kind": "reference",
              "role": "equality_policy"
            },
            {
              "kind": "reference",
              "role": "resource_policy"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "cursor_transitions"
            },
            {
              "kind": "reference",
              "role": "aggregate_input_accounting"
            },
            {
              "kind": "reference",
              "role": "canonical_result_accounting"
            },
            {
              "kind": "reference",
              "role": "work_accounting"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "verify-complete-traversal",
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
              "role": "traversal"
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
          "subject_role": "traversal",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "traversal_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "exact_order_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-complete-traversal",
        "role": "verifies",
        "source_claim_pattern_id": "verify-complete-traversal",
        "target_claim_pattern_id": "traversal-has-exact-order"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-complete-traversal",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "traversal_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-authoritative-occurrence-population"
          },
          {
            "pattern": "complete-returned-occurrence-population"
          },
          {
            "pattern": "complete-returned-page-population"
          },
          {
            "pattern": "complete-cursor-transition-population"
          },
          {
            "pattern": "complete-equality-normalized-member-population"
          },
          {
            "pattern": "authentication-occurrence-authenticates-population"
          },
          {
            "pattern": "population-has-authenticated-source-of-record"
          },
          {
            "pattern": "traversal-uses-authoritative-population"
          },
          {
            "pattern": "each-page-resolves-snapshot"
          },
          {
            "pattern": "each-page-uses-version"
          },
          {
            "pattern": "terminal-page-completes-traversal"
          },
          {
            "pattern": "traversal-has-exact-order"
          },
          {
            "pattern": "traversal-has-exact-equality"
          },
          {
            "pattern": "verification-reads-exact-traversal-bindings"
          },
          {
            "pattern": "verify-complete-traversal"
          },
          {
            "pattern": "verification-targets-complete-traversal"
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
      "mutation_trace",
      "projection_result",
      "authoritative_population",
      "authoritative_occurrence_population",
      "authoritative_occurrences",
      "returned_occurrence_population",
      "returned_occurrences",
      "returned_page_population",
      "returned_pages",
      "cursor_transition_population",
      "cursor_transitions",
      "equality_normalized_member_population",
      "equality_normalized_members",
      "authentication_observation_attempt",
      "authenticated_source",
      "equality_policy",
      "resource_policy",
      "traversal",
      "snapshot",
      "traversal_source_version",
      "terminal_page",
      "exact_order_state",
      "exact_equality_state",
      "aggregate_input_accounting",
      "canonical_result_accounting",
      "work_accounting",
      "verification",
      "traversal_failure_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "authentication_evidence_occurrence",
      "target_resolution_witness",
      "source_authentication_witness",
      "source_of_record_witness",
      "attempt_binding_witness",
      "authentication_witness",
      "authentication_capture"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.pagination.complete-traversal.",
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
        "missing": "No named proof.pagination.complete-traversal constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.pagination.complete-traversal.",
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
