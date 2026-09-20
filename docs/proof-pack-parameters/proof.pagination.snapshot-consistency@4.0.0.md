# proof.pagination.snapshot-consistency@4.0.0

<!-- Generated from validated package metadata. -->

Every page attempt and returned page in the complete declared traversal populations resolves to one immutable snapshot identity and exact captured state; a declared relevant live-source mutation occurs between selected page reads, changes the exact live-source version while the selected snapshot identity and captured state remain unchanged, and the stable and mutation-interleaved ordered member-occurrence sequences are identical.

Profile digest: 73fe9548950e963d20c499b344cd0cb633494afc7285835bcae776295acec01d. Parameter digest: 14df3f6db597a2d40fe4d1c844ecc67b8d5c1e352567f768ec17e7a26f7c763d.

Admission digest: 92750e23859494490ddd780add8217791fc340a291fc6d059e3e2178b051e513.

Roles: 31/31 accounted; 6 owned gaps. Semantic parameters: 25; internal roles: 6.

## Guarantee and exclusions

Every page attempt and returned page in the complete declared traversal populations resolves to one immutable snapshot identity and exact captured state; a declared relevant live-source mutation occurs between selected page reads, changes the exact live-source version while the selected snapshot identity and captured state remain unchanged, and the stable and mutation-interleaved ordered member-occurrence sequences are identical.

- capture-provenance
- evidence-authority-or-cce-consequence
- runtime-truth
- snapshot-retention-or-isolation
- standalone-traversal-completeness
- undeclared-mutation

## Parameters

### mutation_trace

Declare mutation trace for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    }
  ]
}
```

### projection_result

Declare projection result for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    }
  ]
}
```

### traversal

Declare traversal for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "each-attempt-resolves-selected-snapshot",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "page_attempts",
          "member_role": "page_attempt"
        },
        "proposition_template": {
          "subject_role": "page_attempt",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "each-returned-page-resolves-selected-snapshot",
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
            "mode": "where",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "relevant-mutation-mutates-live-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "relevant_mutation",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "live_source"
            }
          ]
        }
      }
    }
  ]
}
```

### live_source

Declare live source for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/7",
      "value": {
        "role": "live_source",
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
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "relevant-mutation-mutates-live-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "relevant_mutation",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "live_source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "live-source-initial-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "live_source",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "first_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initial_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "live-source-later-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "live_source",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "later_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_source_version"
            }
          ]
        }
      }
    }
  ]
}
```

### snapshot

Declare snapshot for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/8",
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "each-attempt-resolves-selected-snapshot",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "page_attempts",
          "member_role": "page_attempt"
        },
        "proposition_template": {
          "subject_role": "page_attempt",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "each-returned-page-resolves-selected-snapshot",
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
            "mode": "where",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "snapshot-state-at-first-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "snapshot",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "first_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "snapshot-state-at-later-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "snapshot",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "later_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot_state"
            }
          ]
        }
      }
    }
  ]
}
```

### snapshot_state

Declare snapshot state for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/9",
      "value": {
        "role": "snapshot_state",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "snapshot-state-at-first-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "snapshot",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "first_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "snapshot-state-at-later-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "snapshot",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "later_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot_state"
            }
          ]
        }
      }
    }
  ]
}
```

### initial_source_version

Declare initial source version for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "initial_source_version",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "live-source-initial-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "live_source",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "first_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initial_source_version"
            }
          ]
        }
      }
    }
  ]
}
```

### later_source_version

Declare later source version for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "later_source_version",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "live-source-later-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "live_source",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "later_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_source_version"
            }
          ]
        }
      }
    }
  ]
}
```

### page_attempt_population

Declare page attempt population for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "page_attempt_population",
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
        "pattern_id": "complete-page-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "page_attempt_population",
          "page_attempts"
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

### page_attempts

Declare page attempts for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "page_attempts",
        "allowed_type_terms": [
          "cc:event"
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "each-attempt-resolves-selected-snapshot",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "page_attempts",
          "member_role": "page_attempt"
        },
        "proposition_template": {
          "subject_role": "page_attempt",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-page-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "page_attempt_population",
          "page_attempts"
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

### returned_page_population

Declare returned page population for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "returned_page_population",
          "returned_pages"
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

### returned_pages

Declare returned pages for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "each-returned-page-resolves-selected-snapshot",
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
            "mode": "where",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "returned_page_population",
          "returned_pages"
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

### member_occurrence_population

Declare member occurrence population for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "member_occurrence_population",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "comparison-records-ordered-sequences",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "sequence_comparison_result",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-member-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "member_occurrence_population",
          "member_occurrences"
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

### member_occurrences

Declare member occurrences for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/17",
      "value": {
        "role": "member_occurrences",
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
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-member-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "member_occurrence_population",
          "member_occurrences"
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

### stable_member_occurrence_population

Declare stable member occurrence population for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "stable_member_occurrence_population",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "comparison-records-ordered-sequences",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "sequence_comparison_result",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-stable-member-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "stable_member_occurrence_population",
          "stable_member_occurrences"
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

### stable_member_occurrences

Declare stable member occurrences for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "stable_member_occurrences",
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
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-stable-member-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "stable_member_occurrence_population",
          "stable_member_occurrences"
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

### mutation_population

Declare mutation population for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "mutation_population",
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
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-mutation-population",
        "comparison": "complete_population",
        "roles": [
          "mutation_population",
          "mutations"
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

### mutations

Declare mutations for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "mutations",
        "allowed_type_terms": [
          "cc:event"
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
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-mutation-population",
        "comparison": "complete_population",
        "roles": [
          "mutation_population",
          "mutations"
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

### first_page_attempt

Declare first page attempt for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "first_page_attempt",
        "allowed_type_terms": [
          "cc:event"
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
        "pattern_id": "snapshot-state-at-first-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "snapshot",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "first_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "live-source-initial-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "live_source",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "first_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initial_source_version"
            }
          ]
        }
      }
    }
  ]
}
```

### later_page_attempt

Declare later page attempt for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "later_page_attempt",
        "allowed_type_terms": [
          "cc:event"
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
        "pattern_id": "snapshot-state-at-later-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "snapshot",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "later_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "mutation-precedes-later-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "relevant_mutation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_page_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "live-source-later-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "live_source",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "later_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_source_version"
            }
          ]
        }
      }
    }
  ]
}
```

### first_returned_page

Declare first returned page for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "first_returned_page",
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
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "first-page-precedes-mutation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_returned_page",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "relevant_mutation"
            }
          ]
        }
      }
    }
  ]
}
```

### relevant_mutation

Declare relevant mutation for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "relevant_mutation",
        "allowed_type_terms": [
          "cc:event"
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "first-page-precedes-mutation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_returned_page",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "relevant_mutation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "mutation-precedes-later-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "relevant_mutation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_page_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "relevant-mutation-mutates-live-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "relevant_mutation",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "live_source"
            }
          ]
        }
      }
    }
  ]
}
```

### identical_sequence_state

Declare identical sequence state for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "identical_sequence_state",
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "ordered-sequences-identical",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "sequence_comparison_result",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "identical_sequence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verify-ordered-sequences-identical",
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
              "role": "sequence_comparison_result"
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
          "subject_role": "sequence_comparison_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "sequence_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "identical_sequence_state"
            }
          ]
        }
      }
    }
  ]
}
```

### verification

Declare verification for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "verification",
        "allowed_type_terms": [
          "cc:test",
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verify-ordered-sequences-identical",
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
              "role": "sequence_comparison_result"
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
          "subject_role": "sequence_comparison_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "sequence_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "identical_sequence_state"
            }
          ]
        }
      }
    }
  ]
}
```

### sequence_failure_condition

Declare sequence failure condition for proof.pagination.snapshot-consistency. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "sequence_failure_condition",
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "verify-ordered-sequences-identical",
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
              "role": "sequence_comparison_result"
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
          "subject_role": "sequence_comparison_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "sequence_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "identical_sequence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-sequence-equality",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "sequence_failure_condition"
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
| primary_before_capture | observation_requirement |  | Acquire primary_before_capture for the exact subject, attempt and applicability in this profile. |
| primary_after_capture | observation_requirement |  | Acquire primary_after_capture for the exact subject, attempt and applicability in this profile. |
| control_before_capture | observation_requirement |  | Acquire control_before_capture for the exact subject, attempt and applicability in this profile. |
| control_after_capture | observation_requirement |  | Acquire control_after_capture for the exact subject, attempt and applicability in this profile. |
| traversal | semantic_parameter | traversal |  |
| live_source | semantic_parameter | live_source |  |
| snapshot | semantic_parameter | snapshot |  |
| snapshot_state | semantic_parameter | snapshot_state |  |
| initial_source_version | semantic_parameter | initial_source_version |  |
| later_source_version | semantic_parameter | later_source_version |  |
| page_attempt_population | semantic_parameter | page_attempt_population |  |
| page_attempts | semantic_parameter | page_attempts |  |
| returned_page_population | semantic_parameter | returned_page_population |  |
| returned_pages | semantic_parameter | returned_pages |  |
| member_occurrence_population | semantic_parameter | member_occurrence_population |  |
| member_occurrences | semantic_parameter | member_occurrences |  |
| stable_member_occurrence_population | semantic_parameter | stable_member_occurrence_population |  |
| stable_member_occurrences | semantic_parameter | stable_member_occurrences |  |
| mutation_population | semantic_parameter | mutation_population |  |
| mutations | semantic_parameter | mutations |  |
| first_page_attempt | semantic_parameter | first_page_attempt |  |
| later_page_attempt | semantic_parameter | later_page_attempt |  |
| first_returned_page | semantic_parameter | first_returned_page |  |
| later_returned_page | capability_gap |  | Required role later_returned_page has no rule-linked semantic source. |
| relevant_mutation | semantic_parameter | relevant_mutation |  |
| sequence_comparison_result | observation_requirement |  | Acquire sequence_comparison_result for the exact subject, attempt and applicability in this profile. |
| identical_sequence_state | semantic_parameter | identical_sequence_state |  |
| verification | semantic_parameter | verification |  |
| sequence_failure_condition | semantic_parameter | sequence_failure_condition |  |

```json
{
  "roles": [
    {
      "role": "mutation_trace",
      "kind": "semantic_parameter",
      "parameter": "mutation_trace",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "mutation_trace",
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
      "role": "projection_result",
      "kind": "semantic_parameter",
      "parameter": "projection_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "projection_result",
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
      "role": "primary_before_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire primary_before_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.snapshot-consistency/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "primary_before_capture",
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
      "role": "primary_after_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire primary_after_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.snapshot-consistency/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "primary_after_capture",
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
      "role": "control_before_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire control_before_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.snapshot-consistency/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "control_before_capture",
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
      "role": "control_after_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire control_after_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.snapshot-consistency/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "control_after_capture",
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
      "role": "traversal",
      "kind": "semantic_parameter",
      "parameter": "traversal",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/11",
        "/claim_patterns/6"
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
      "role": "live_source",
      "kind": "semantic_parameter",
      "parameter": "live_source",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "live_source",
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
      "role": "snapshot",
      "kind": "semantic_parameter",
      "parameter": "snapshot",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/11",
        "/claim_patterns/2",
        "/claim_patterns/3"
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
      "role": "snapshot_state",
      "kind": "semantic_parameter",
      "parameter": "snapshot_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/2",
        "/claim_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "snapshot_state",
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
      "role": "initial_source_version",
      "kind": "semantic_parameter",
      "parameter": "initial_source_version",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "initial_source_version",
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
      "role": "later_source_version",
      "kind": "semantic_parameter",
      "parameter": "later_source_version",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_source_version",
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
      "role": "page_attempt_population",
      "kind": "semantic_parameter",
      "parameter": "page_attempt_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "page_attempt_population",
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
      "role": "page_attempts",
      "kind": "semantic_parameter",
      "parameter": "page_attempts",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/11",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "page_attempts",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "returned_page_population",
      "kind": "semantic_parameter",
      "parameter": "returned_page_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1"
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
        "/claim_patterns/1",
        "/claim_patterns/11",
        "/reference_binding_patterns/1"
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
      "role": "member_occurrence_population",
      "kind": "semantic_parameter",
      "parameter": "member_occurrence_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/9",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "member_occurrence_population",
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
      "role": "member_occurrences",
      "kind": "semantic_parameter",
      "parameter": "member_occurrences",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "member_occurrences",
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
      "role": "stable_member_occurrence_population",
      "kind": "semantic_parameter",
      "parameter": "stable_member_occurrence_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/9",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "stable_member_occurrence_population",
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
      "role": "stable_member_occurrences",
      "kind": "semantic_parameter",
      "parameter": "stable_member_occurrences",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "stable_member_occurrences",
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
      "role": "mutation_population",
      "kind": "semantic_parameter",
      "parameter": "mutation_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "mutation_population",
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
      "role": "mutations",
      "kind": "semantic_parameter",
      "parameter": "mutations",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "mutations",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "first_page_attempt",
      "kind": "semantic_parameter",
      "parameter": "first_page_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/claim_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "first_page_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "later_page_attempt",
      "kind": "semantic_parameter",
      "parameter": "later_page_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "later_page_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "first_returned_page",
      "kind": "semantic_parameter",
      "parameter": "first_returned_page",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "first_returned_page",
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
      "role": "later_returned_page",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role later_returned_page has no rule-linked semantic source.",
        "source": "profiles/proof.pagination.snapshot-consistency/4.0.0/profile.json#/reference_roles/25",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "later_returned_page",
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
      "role": "relevant_mutation",
      "kind": "semantic_parameter",
      "parameter": "relevant_mutation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "relevant_mutation",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "sequence_comparison_result",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/9"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire sequence_comparison_result for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.snapshot-consistency/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "sequence_comparison_result",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "identical_sequence_state",
      "kind": "semantic_parameter",
      "parameter": "identical_sequence_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/12"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "identical_sequence_state",
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
      "role": "verification",
      "kind": "semantic_parameter",
      "parameter": "verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/12"
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
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "sequence_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "sequence_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "sequence_failure_condition",
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
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-page-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "page_attempt_population",
          "page_attempts"
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
        "pattern_id": "complete-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "returned_page_population",
          "returned_pages"
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
        "pattern_id": "complete-member-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "member_occurrence_population",
          "member_occurrences"
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
        "pattern_id": "complete-stable-member-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "stable_member_occurrence_population",
          "stable_member_occurrences"
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
        "pattern_id": "complete-mutation-population",
        "comparison": "complete_population",
        "roles": [
          "mutation_population",
          "mutations"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "each-attempt-resolves-selected-snapshot",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "page_attempts",
          "member_role": "page_attempt"
        },
        "proposition_template": {
          "subject_role": "page_attempt",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
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
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "each-returned-page-resolves-selected-snapshot",
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
            "mode": "where",
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
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "snapshot-state-at-first-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "snapshot",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "first_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "snapshot-state-at-later-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "snapshot",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "later_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "snapshot_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "first-page-precedes-mutation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "first_returned_page",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "relevant_mutation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "mutation-precedes-later-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "relevant_mutation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_page_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "relevant-mutation-mutates-live-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "relevant_mutation",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "live_source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "live-source-initial-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "live_source",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "first_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initial_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "live-source-later-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "live_source",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "later_page_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "later_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "comparison-records-ordered-sequences",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "sequence_comparison_result",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "ordered-sequences-identical",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "sequence_comparison_result",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "identical_sequence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "verification-reads-exact-pagination-captures",
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
              "role": "primary_before_capture"
            },
            {
              "kind": "reference",
              "role": "primary_after_capture"
            },
            {
              "kind": "reference",
              "role": "control_before_capture"
            },
            {
              "kind": "reference",
              "role": "control_after_capture"
            },
            {
              "kind": "reference",
              "role": "projection_result"
            },
            {
              "kind": "reference",
              "role": "traversal"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "returned_pages"
            },
            {
              "kind": "reference",
              "role": "member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "stable_member_occurrence_population"
            },
            {
              "kind": "reference",
              "role": "relevant_mutation"
            },
            {
              "kind": "reference",
              "role": "snapshot"
            },
            {
              "kind": "reference",
              "role": "snapshot_state"
            },
            {
              "kind": "reference",
              "role": "initial_source_version"
            },
            {
              "kind": "reference",
              "role": "later_source_version"
            },
            {
              "kind": "reference",
              "role": "sequence_comparison_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "verify-ordered-sequences-identical",
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
              "role": "sequence_comparison_result"
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
          "subject_role": "sequence_comparison_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "sequence_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "identical_sequence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-sequence-equality",
        "role": "verifies",
        "source_claim_pattern_id": "verify-ordered-sequences-identical",
        "target_claim_pattern_id": "ordered-sequences-identical"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-sequence-equality",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "sequence_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-page-attempt-population"
          },
          {
            "pattern": "complete-returned-page-population"
          },
          {
            "pattern": "complete-member-occurrence-population"
          },
          {
            "pattern": "complete-stable-member-occurrence-population"
          },
          {
            "pattern": "complete-mutation-population"
          },
          {
            "pattern": "each-attempt-resolves-selected-snapshot"
          },
          {
            "pattern": "each-returned-page-resolves-selected-snapshot"
          },
          {
            "pattern": "snapshot-state-at-first-page"
          },
          {
            "pattern": "snapshot-state-at-later-page"
          },
          {
            "pattern": "first-page-precedes-mutation"
          },
          {
            "pattern": "mutation-precedes-later-page"
          },
          {
            "pattern": "relevant-mutation-mutates-live-source"
          },
          {
            "pattern": "live-source-initial-state"
          },
          {
            "pattern": "live-source-later-state"
          },
          {
            "pattern": "comparison-records-ordered-sequences"
          },
          {
            "pattern": "ordered-sequences-identical"
          },
          {
            "pattern": "verification-reads-exact-pagination-captures"
          },
          {
            "pattern": "verify-ordered-sequences-identical"
          },
          {
            "pattern": "verification-targets-sequence-equality"
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
      "traversal",
      "live_source",
      "snapshot",
      "snapshot_state",
      "initial_source_version",
      "later_source_version",
      "page_attempt_population",
      "page_attempts",
      "returned_page_population",
      "returned_pages",
      "member_occurrence_population",
      "member_occurrences",
      "stable_member_occurrence_population",
      "stable_member_occurrences",
      "mutation_population",
      "mutations",
      "first_page_attempt",
      "later_page_attempt",
      "first_returned_page",
      "relevant_mutation",
      "identical_sequence_state",
      "verification",
      "sequence_failure_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "primary_before_capture",
      "primary_after_capture",
      "control_before_capture",
      "control_after_capture",
      "sequence_comparison_result"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.pagination.snapshot-consistency.",
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
        "missing": "No named proof.pagination.snapshot-consistency constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.pagination.snapshot-consistency.",
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
