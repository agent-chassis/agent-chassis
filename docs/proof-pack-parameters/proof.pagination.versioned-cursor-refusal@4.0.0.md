# proof.pagination.versioned-cursor-refusal@4.0.0

<!-- Generated from validated package metadata. -->

Every cursor and successful returned page in the complete declared traversal populations resolves to its traversal source version; after a relevant mutation the current version differs in identity and captured content from the selected stale cursor version, the exact next-page attempt using that cursor is refused, and before refusal and throughout that stale-attempt scope no page artifact or page-return event is returned, no cursor-advance event is emitted, and no complete declared protected effect is written or mutated; a non-stale control proves an unrelated-source mutation does not cause refusal.

Profile digest: 9462a2b95ee74a76aaf0b0a28e72fe226bb63a2367c19e265b5c18847e18d3c1. Parameter digest: 98259723fc017d6e4b76e4c2e62c396f86553565fa104543e8062013616af6a3.

Admission digest: 4c1b598d7bcd67d712f20d3c1457bda37a38592547859b6d019e6f628853cc5a.

Roles: 57/57 accounted; 9 owned gaps. Semantic parameters: 48; internal roles: 9.

## Guarantee and exclusions

Every cursor and successful returned page in the complete declared traversal populations resolves to its traversal source version; after a relevant mutation the current version differs in identity and captured content from the selected stale cursor version, the exact next-page attempt using that cursor is refused, and before refusal and throughout that stale-attempt scope no page artifact or page-return event is returned, no cursor-advance event is emitted, and no complete declared protected effect is written or mutated; a non-stale control proves an unrelated-source mutation does not cause refusal.

- capture-provenance
- cross-pack-shared-role-identity
- cursor-retention-or-isolation
- evidence-authority-or-cce-consequence
- runtime-truth
- standalone-traversal-completeness
- undeclared-mutation

## Parameters

### mutation_trace

Declare mutation trace for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    }
  ]
}
```

### projection_result

Declare projection result for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    }
  ]
}
```

### traversal

Declare traversal for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "pattern_id": "each-primary-cursor-resolves-traversal-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "primary_cursors",
          "member_role": "primary_cursor"
        },
        "proposition_template": {
          "subject_role": "primary_cursor",
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
              "role": "traversal_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "each-primary-page-resolves-traversal-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "primary_returned_pages",
          "member_role": "primary_returned_page"
        },
        "proposition_template": {
          "subject_role": "primary_returned_page",
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
              "role": "traversal_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
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
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "stale-attempt-uses-exact-cursor",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stale_cursor"
            }
          ]
        }
      }
    }
  ]
}
```

### control_traversal

Declare control traversal for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "control_traversal",
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "each-control-cursor-resolves-control-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "control_cursors",
          "member_role": "control_cursor_member"
        },
        "proposition_template": {
          "subject_role": "control_cursor_member",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "unrelated-mutation-mutates-unrelated-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "unrelated_mutation",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-control-page-resolves-control-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "control_returned_pages",
          "member_role": "control_returned_page_member"
        },
        "proposition_template": {
          "subject_role": "control_returned_page_member",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_source_version"
            }
          ]
        }
      }
    }
  ]
}
```

### live_source

Declare live source for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/4",
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
        "pattern_id": "live-source-current-at-stale-attempt",
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
              "stale_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "current_source_version"
            }
          ]
        }
      }
    }
  ]
}
```

### unrelated_source

Declare unrelated source for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "unrelated_source",
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
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "unrelated-mutation-mutates-unrelated-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "unrelated_mutation",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_source"
            }
          ]
        }
      }
    }
  ]
}
```

### traversal_source_version

Declare traversal source version for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "each-primary-cursor-resolves-traversal-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "primary_cursors",
          "member_role": "primary_cursor"
        },
        "proposition_template": {
          "subject_role": "primary_cursor",
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
              "role": "traversal_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "each-primary-page-resolves-traversal-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "primary_returned_pages",
          "member_role": "primary_returned_page"
        },
        "proposition_template": {
          "subject_role": "primary_returned_page",
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
              "role": "traversal_source_version"
            }
          ]
        }
      }
    }
  ]
}
```

### current_source_version

Declare current source version for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "current_source_version",
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
        "pattern_id": "live-source-current-at-stale-attempt",
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
              "stale_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "current_source_version"
            }
          ]
        }
      }
    }
  ]
}
```

### control_source_version

Declare control source version for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "control_source_version",
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "each-control-cursor-resolves-control-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "control_cursors",
          "member_role": "control_cursor_member"
        },
        "proposition_template": {
          "subject_role": "control_cursor_member",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-control-page-resolves-control-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "control_returned_pages",
          "member_role": "control_returned_page_member"
        },
        "proposition_template": {
          "subject_role": "control_returned_page_member",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_source_version"
            }
          ]
        }
      }
    }
  ]
}
```

### primary_cursor_population

Declare primary cursor population for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "primary_cursor_population",
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
        "pattern_id": "complete-primary-cursor-population",
        "comparison": "complete_population",
        "roles": [
          "primary_cursor_population",
          "primary_cursors"
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

### primary_cursors

Declare primary cursors for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "primary_cursors",
        "allowed_type_terms": [
          "cc:state"
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
        "pattern_id": "each-primary-cursor-resolves-traversal-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "primary_cursors",
          "member_role": "primary_cursor"
        },
        "proposition_template": {
          "subject_role": "primary_cursor",
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
              "role": "traversal_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-primary-cursor-population",
        "comparison": "complete_population",
        "roles": [
          "primary_cursor_population",
          "primary_cursors"
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

### control_cursor_population

Declare control cursor population for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "control_cursor_population",
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
        "pattern_id": "complete-control-cursor-population",
        "comparison": "complete_population",
        "roles": [
          "control_cursor_population",
          "control_cursors"
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

### control_cursors

Declare control cursors for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "control_cursors",
        "allowed_type_terms": [
          "cc:state"
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
        "pattern_id": "each-control-cursor-resolves-control-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "control_cursors",
          "member_role": "control_cursor_member"
        },
        "proposition_template": {
          "subject_role": "control_cursor_member",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-control-cursor-population",
        "comparison": "complete_population",
        "roles": [
          "control_cursor_population",
          "control_cursors"
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

### stale_cursor

Declare stale cursor for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "stale_cursor",
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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "stale-attempt-uses-exact-cursor",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stale_cursor"
            }
          ]
        }
      }
    }
  ]
}
```

### page_attempt_population

Declare page attempt population for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_binding_patterns/2",
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

Declare page attempts for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
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

### primary_returned_page_population

Declare primary returned page population for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/22",
      "value": {
        "role": "primary_returned_page_population",
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
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-primary-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "primary_returned_page_population",
          "primary_returned_pages"
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

### primary_returned_pages

Declare primary returned pages for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/23",
      "value": {
        "role": "primary_returned_pages",
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
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "each-primary-page-resolves-traversal-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "primary_returned_pages",
          "member_role": "primary_returned_page"
        },
        "proposition_template": {
          "subject_role": "primary_returned_page",
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
              "role": "traversal_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-primary-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "primary_returned_page_population",
          "primary_returned_pages"
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

### control_returned_page_population

Declare control returned page population for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/24",
      "value": {
        "role": "control_returned_page_population",
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
        "pattern_id": "complete-control-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "control_returned_page_population",
          "control_returned_pages"
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

### control_returned_pages

Declare control returned pages for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/25",
      "value": {
        "role": "control_returned_pages",
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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "each-control-page-resolves-control-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "control_returned_pages",
          "member_role": "control_returned_page_member"
        },
        "proposition_template": {
          "subject_role": "control_returned_page_member",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-control-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "control_returned_page_population",
          "control_returned_pages"
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

Declare mutation population for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/26",
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
      "ref": "/reference_binding_patterns/5",
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

Declare mutations for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/27",
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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
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

### return_population

Declare return population for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/28",
      "value": {
        "role": "return_population",
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
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "complete-return-population",
        "comparison": "complete_population",
        "roles": [
          "return_population",
          "returns"
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

### returns

Declare returns for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/29",
      "value": {
        "role": "returns",
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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "complete-return-population",
        "comparison": "complete_population",
        "roles": [
          "return_population",
          "returns"
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

### advancement_population

Declare advancement population for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/30",
      "value": {
        "role": "advancement_population",
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
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "complete-advancement-population",
        "comparison": "complete_population",
        "roles": [
          "advancement_population",
          "advancements"
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

### advancements

Declare advancements for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/31",
      "value": {
        "role": "advancements",
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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "complete-advancement-population",
        "comparison": "complete_population",
        "roles": [
          "advancement_population",
          "advancements"
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

### effect_occurrence_population

Declare effect occurrence population for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/32",
      "value": {
        "role": "effect_occurrence_population",
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
      "ref": "/reference_binding_patterns/8",
      "value": {
        "pattern_id": "complete-effect-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "effect_occurrence_population",
          "effect_occurrences"
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

### effect_occurrences

Declare effect occurrences for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/33",
      "value": {
        "role": "effect_occurrences",
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
      "ref": "/reference_binding_patterns/8",
      "value": {
        "pattern_id": "complete-effect-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "effect_occurrence_population",
          "effect_occurrences"
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

### protected_effect_population

Declare protected effect population for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/34",
      "value": {
        "role": "protected_effect_population",
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
      "ref": "/reference_binding_patterns/9",
      "value": {
        "pattern_id": "complete-protected-effect-population",
        "comparison": "complete_population",
        "roles": [
          "protected_effect_population",
          "protected_effects"
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

### protected_effects

Declare protected effects for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/35",
      "value": {
        "role": "protected_effects",
        "allowed_type_terms": [
          "cc:resource",
          "cc:state",
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
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "no-stale-protected-write",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "write_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "no-stale-protected-mutation",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "mutation_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "verify-no-stale-protected-write",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "write_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "verify-no-stale-protected-mutation",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "mutation_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/9",
      "value": {
        "pattern_id": "complete-protected-effect-population",
        "comparison": "complete_population",
        "roles": [
          "protected_effect_population",
          "protected_effects"
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

### prior_page_attempt

Declare prior page attempt for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/36",
      "value": {
        "role": "prior_page_attempt",
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
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "prior-attempt-precedes-relevant-mutation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "prior_page_attempt",
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

### stale_attempt

Declare stale attempt for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/37",
      "value": {
        "role": "stale_attempt",
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "stale-attempt-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "no-stale-page-return",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "return_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_result_artifact"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "no-stale-page-return-event",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "emission_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_return_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "no-stale-cursor-advance",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "advancement_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cursor_advance_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "no-stale-protected-write",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "write_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "no-stale-protected-mutation",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "mutation_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "verify-no-stale-page-return",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "return_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_result_artifact"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "verify-no-stale-page-return-event",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "emission_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_return_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "verify-no-stale-cursor-advance",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "advancement_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cursor_advance_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "verify-no-stale-protected-write",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "write_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "verify-no-stale-protected-mutation",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "mutation_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "relevant-mutation-precedes-stale-attempt",
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
              "role": "stale_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "live-source-current-at-stale-attempt",
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
              "stale_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "current_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "stale-attempt-uses-exact-cursor",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stale_cursor"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "refusal-rejects-stale-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stale_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "relation-verify-no-stale-page-return",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "return_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "relation-verify-no-stale-page-return-event",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "emission_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "relation-verify-no-stale-cursor-advance",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "advancement_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "relation-verify-no-stale-protected-write",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "write_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "value": {
        "relation_pattern_id": "relation-verify-no-stale-protected-mutation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "mutation_failure_condition"
          ]
        }
      }
    }
  ]
}
```

### control_attempt

Declare control attempt for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/38",
      "value": {
        "role": "control_attempt",
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "unrelated-mutation-precedes-control-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "unrelated_mutation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "control-attempt-returns-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "control_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_returned_page"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "control-attempt-emits-advancement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "control_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_advancement"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "no-unrelated-mutation-false-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrelated_mutation",
              "false_refusal_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "verify-no-unrelated-mutation-false-refusal",
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
              "role": "refusal"
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
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrelated_mutation",
              "false_refusal_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    }
  ]
}
```

### relevant_mutation

Declare relevant mutation for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/39",
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
      "ref": "/claim_patterns/4",
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
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "prior-attempt-precedes-relevant-mutation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "prior_page_attempt",
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
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "relevant-mutation-precedes-stale-attempt",
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
              "role": "stale_attempt"
            }
          ]
        }
      }
    }
  ]
}
```

### unrelated_mutation

Declare unrelated mutation for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/40",
      "value": {
        "role": "unrelated_mutation",
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
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "unrelated-mutation-mutates-unrelated-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "unrelated_mutation",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "unrelated-mutation-precedes-control-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "unrelated_mutation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "no-unrelated-mutation-false-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrelated_mutation",
              "false_refusal_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "verify-no-unrelated-mutation-false-refusal",
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
              "role": "refusal"
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
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrelated_mutation",
              "false_refusal_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/5",
      "value": {
        "relation_pattern_id": "relation-verify-no-unrelated-mutation-false-refusal",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "unrelated_mutation",
            "false_refusal_condition"
          ]
        }
      }
    }
  ]
}
```

### refusal

Declare refusal for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/41",
      "value": {
        "role": "refusal",
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "stale-attempt-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "no-unrelated-mutation-false-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrelated_mutation",
              "false_refusal_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "verify-no-unrelated-mutation-false-refusal",
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
              "role": "refusal"
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
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrelated_mutation",
              "false_refusal_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "refusal-rejects-stale-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stale_attempt"
            }
          ]
        }
      }
    }
  ]
}
```

### page_result_artifact

Declare page result artifact for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/42",
      "value": {
        "role": "page_result_artifact",
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
        "pattern_id": "no-stale-page-return",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "return_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_result_artifact"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "verify-no-stale-page-return",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "return_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_result_artifact"
            }
          ]
        }
      }
    }
  ]
}
```

### page_return_event

Declare page return event for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/43",
      "value": {
        "role": "page_return_event",
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "no-stale-page-return-event",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "emission_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_return_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "verify-no-stale-page-return-event",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "emission_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_return_event"
            }
          ]
        }
      }
    }
  ]
}
```

### cursor_advance_event

Declare cursor advance event for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/44",
      "value": {
        "role": "cursor_advance_event",
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
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "no-stale-cursor-advance",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "advancement_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cursor_advance_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "verify-no-stale-cursor-advance",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "advancement_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cursor_advance_event"
            }
          ]
        }
      }
    }
  ]
}
```

### control_advancement

Declare control advancement for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/48",
      "value": {
        "role": "control_advancement",
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
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "control-attempt-emits-advancement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "control_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_advancement"
            }
          ]
        }
      }
    }
  ]
}
```

### control_returned_page

Declare control returned page for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/49",
      "value": {
        "role": "control_returned_page",
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
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "control-attempt-returns-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "control_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_returned_page"
            }
          ]
        }
      }
    }
  ]
}
```

### verification

Declare verification for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/50",
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
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "verify-no-stale-page-return",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "return_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_result_artifact"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "verify-no-stale-page-return-event",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "emission_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_return_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "verify-no-stale-cursor-advance",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "advancement_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cursor_advance_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "verify-no-stale-protected-write",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "write_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "verify-no-stale-protected-mutation",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "mutation_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "verify-no-unrelated-mutation-false-refusal",
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
              "role": "refusal"
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
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrelated_mutation",
              "false_refusal_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    }
  ]
}
```

### return_failure_condition

Declare return failure condition for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/51",
      "value": {
        "role": "return_failure_condition",
        "allowed_type_terms": [
          "cc:criterion"
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
        "pattern_id": "no-stale-page-return",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "return_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_result_artifact"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "verify-no-stale-page-return",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "return_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_result_artifact"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "relation-verify-no-stale-page-return",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "return_failure_condition"
          ]
        }
      }
    }
  ]
}
```

### emission_failure_condition

Declare emission failure condition for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/52",
      "value": {
        "role": "emission_failure_condition",
        "allowed_type_terms": [
          "cc:criterion"
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
        "pattern_id": "no-stale-page-return-event",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "emission_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_return_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "verify-no-stale-page-return-event",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "emission_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_return_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "relation-verify-no-stale-page-return-event",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "emission_failure_condition"
          ]
        }
      }
    }
  ]
}
```

### advancement_failure_condition

Declare advancement failure condition for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/53",
      "value": {
        "role": "advancement_failure_condition",
        "allowed_type_terms": [
          "cc:criterion"
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
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "no-stale-cursor-advance",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "advancement_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cursor_advance_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "verify-no-stale-cursor-advance",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "advancement_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cursor_advance_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "relation-verify-no-stale-cursor-advance",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "advancement_failure_condition"
          ]
        }
      }
    }
  ]
}
```

### write_failure_condition

Declare write failure condition for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/54",
      "value": {
        "role": "write_failure_condition",
        "allowed_type_terms": [
          "cc:criterion"
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
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "no-stale-protected-write",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "write_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "verify-no-stale-protected-write",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "write_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "relation-verify-no-stale-protected-write",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "write_failure_condition"
          ]
        }
      }
    }
  ]
}
```

### mutation_failure_condition

Declare mutation failure condition for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/55",
      "value": {
        "role": "mutation_failure_condition",
        "allowed_type_terms": [
          "cc:criterion"
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "no-stale-protected-mutation",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "mutation_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "verify-no-stale-protected-mutation",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "mutation_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "value": {
        "relation_pattern_id": "relation-verify-no-stale-protected-mutation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "mutation_failure_condition"
          ]
        }
      }
    }
  ]
}
```

### false_refusal_condition

Declare false refusal condition for proof.pagination.versioned-cursor-refusal. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/reference_roles/56",
      "value": {
        "role": "false_refusal_condition",
        "allowed_type_terms": [
          "cc:criterion"
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
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "no-unrelated-mutation-false-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrelated_mutation",
              "false_refusal_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "verify-no-unrelated-mutation-false-refusal",
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
              "role": "refusal"
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
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrelated_mutation",
              "false_refusal_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/5",
      "value": {
        "relation_pattern_id": "relation-verify-no-unrelated-mutation-false-refusal",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "unrelated_mutation",
            "false_refusal_condition"
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
| control_traversal | semantic_parameter | control_traversal |  |
| live_source | semantic_parameter | live_source |  |
| control_source | capability_gap |  | Required role control_source has no rule-linked semantic source. |
| unrelated_source | semantic_parameter | unrelated_source |  |
| traversal_source_version | semantic_parameter | traversal_source_version |  |
| current_source_version | semantic_parameter | current_source_version |  |
| control_source_version | semantic_parameter | control_source_version |  |
| primary_cursor_population | semantic_parameter | primary_cursor_population |  |
| primary_cursors | semantic_parameter | primary_cursors |  |
| control_cursor_population | semantic_parameter | control_cursor_population |  |
| control_cursors | semantic_parameter | control_cursors |  |
| stale_cursor | semantic_parameter | stale_cursor |  |
| control_cursor | capability_gap |  | Required role control_cursor has no rule-linked semantic source. |
| page_attempt_population | semantic_parameter | page_attempt_population |  |
| page_attempts | semantic_parameter | page_attempts |  |
| primary_returned_page_population | semantic_parameter | primary_returned_page_population |  |
| primary_returned_pages | semantic_parameter | primary_returned_pages |  |
| control_returned_page_population | semantic_parameter | control_returned_page_population |  |
| control_returned_pages | semantic_parameter | control_returned_pages |  |
| mutation_population | semantic_parameter | mutation_population |  |
| mutations | semantic_parameter | mutations |  |
| return_population | semantic_parameter | return_population |  |
| returns | semantic_parameter | returns |  |
| advancement_population | semantic_parameter | advancement_population |  |
| advancements | semantic_parameter | advancements |  |
| effect_occurrence_population | semantic_parameter | effect_occurrence_population |  |
| effect_occurrences | semantic_parameter | effect_occurrences |  |
| protected_effect_population | semantic_parameter | protected_effect_population |  |
| protected_effects | semantic_parameter | protected_effects |  |
| prior_page_attempt | semantic_parameter | prior_page_attempt |  |
| stale_attempt | semantic_parameter | stale_attempt |  |
| control_attempt | semantic_parameter | control_attempt |  |
| relevant_mutation | semantic_parameter | relevant_mutation |  |
| unrelated_mutation | semantic_parameter | unrelated_mutation |  |
| refusal | semantic_parameter | refusal |  |
| page_result_artifact | semantic_parameter | page_result_artifact |  |
| page_return_event | semantic_parameter | page_return_event |  |
| cursor_advance_event | semantic_parameter | cursor_advance_event |  |
| cursor_state | capability_gap |  | Required role cursor_state has no rule-linked semantic source. |
| traversal_state | capability_gap |  | Required role traversal_state has no rule-linked semantic source. |
| control_return | capability_gap |  | Required role control_return has no rule-linked semantic source. |
| control_advancement | semantic_parameter | control_advancement |  |
| control_returned_page | semantic_parameter | control_returned_page |  |
| verification | semantic_parameter | verification |  |
| return_failure_condition | semantic_parameter | return_failure_condition |  |
| emission_failure_condition | semantic_parameter | emission_failure_condition |  |
| advancement_failure_condition | semantic_parameter | advancement_failure_condition |  |
| write_failure_condition | semantic_parameter | write_failure_condition |  |
| mutation_failure_condition | semantic_parameter | mutation_failure_condition |  |
| false_refusal_condition | semantic_parameter | false_refusal_condition |  |

```json
{
  "roles": [
    {
      "role": "mutation_trace",
      "kind": "semantic_parameter",
      "parameter": "mutation_trace",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21"
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
        "/claim_patterns/21"
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
        "/claim_patterns/21"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire primary_before_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.versioned-cursor-refusal/4.0.0/profile.json",
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
        "/claim_patterns/21"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire primary_after_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.versioned-cursor-refusal/4.0.0/profile.json",
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
        "/claim_patterns/21"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire control_before_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.versioned-cursor-refusal/4.0.0/profile.json",
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
        "/claim_patterns/21"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire control_after_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.pagination.versioned-cursor-refusal/4.0.0/profile.json",
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
        "/claim_patterns/2",
        "/claim_patterns/21",
        "/claim_patterns/4",
        "/claim_patterns/8"
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
      "role": "control_traversal",
      "kind": "semantic_parameter",
      "parameter": "control_traversal",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/16",
        "/claim_patterns/21",
        "/claim_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "control_traversal",
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
        "/claim_patterns/4",
        "/claim_patterns/7"
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
      "role": "control_source",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role control_source has no rule-linked semantic source.",
        "source": "profiles/proof.pagination.versioned-cursor-refusal/4.0.0/profile.json#/reference_roles/9",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "control_source",
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
      "role": "unrelated_source",
      "kind": "semantic_parameter",
      "parameter": "unrelated_source",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "unrelated_source",
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
      "role": "traversal_source_version",
      "kind": "semantic_parameter",
      "parameter": "traversal_source_version",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/2"
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
      "role": "current_source_version",
      "kind": "semantic_parameter",
      "parameter": "current_source_version",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "current_source_version",
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
      "role": "control_source_version",
      "kind": "semantic_parameter",
      "parameter": "control_source_version",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "control_source_version",
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
      "role": "primary_cursor_population",
      "kind": "semantic_parameter",
      "parameter": "primary_cursor_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "primary_cursor_population",
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
      "role": "primary_cursors",
      "kind": "semantic_parameter",
      "parameter": "primary_cursors",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/21",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "primary_cursors",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "control_cursor_population",
      "kind": "semantic_parameter",
      "parameter": "control_cursor_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "control_cursor_population",
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
      "role": "control_cursors",
      "kind": "semantic_parameter",
      "parameter": "control_cursors",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/21",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "control_cursors",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "stale_cursor",
      "kind": "semantic_parameter",
      "parameter": "stale_cursor",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "stale_cursor",
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
      "role": "control_cursor",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role control_cursor has no rule-linked semantic source.",
        "source": "profiles/proof.pagination.versioned-cursor-refusal/4.0.0/profile.json#/reference_roles/19",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "control_cursor",
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
        "/reference_binding_patterns/2"
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
        "/claim_patterns/21",
        "/reference_binding_patterns/2"
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
      "role": "primary_returned_page_population",
      "kind": "semantic_parameter",
      "parameter": "primary_returned_page_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "primary_returned_page_population",
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
      "role": "primary_returned_pages",
      "kind": "semantic_parameter",
      "parameter": "primary_returned_pages",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/claim_patterns/21",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "primary_returned_pages",
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
      "role": "control_returned_page_population",
      "kind": "semantic_parameter",
      "parameter": "control_returned_page_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "control_returned_page_population",
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
      "role": "control_returned_pages",
      "kind": "semantic_parameter",
      "parameter": "control_returned_pages",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/claim_patterns/3",
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "control_returned_pages",
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
      "role": "mutation_population",
      "kind": "semantic_parameter",
      "parameter": "mutation_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/5"
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
        "/claim_patterns/21",
        "/reference_binding_patterns/5"
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
      "role": "return_population",
      "kind": "semantic_parameter",
      "parameter": "return_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "return_population",
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
      "role": "returns",
      "kind": "semantic_parameter",
      "parameter": "returns",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/reference_binding_patterns/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "returns",
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
      "role": "advancement_population",
      "kind": "semantic_parameter",
      "parameter": "advancement_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "advancement_population",
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
      "role": "advancements",
      "kind": "semantic_parameter",
      "parameter": "advancements",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/reference_binding_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "advancements",
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
      "role": "effect_occurrence_population",
      "kind": "semantic_parameter",
      "parameter": "effect_occurrence_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "effect_occurrence_population",
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
      "role": "effect_occurrences",
      "kind": "semantic_parameter",
      "parameter": "effect_occurrences",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "effect_occurrences",
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
      "role": "protected_effect_population",
      "kind": "semantic_parameter",
      "parameter": "protected_effect_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_effect_population",
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
      "role": "protected_effects",
      "kind": "semantic_parameter",
      "parameter": "protected_effects",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/21",
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/reference_binding_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_effects",
        "allowed_type_terms": [
          "cc:resource",
          "cc:state",
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "prior_page_attempt",
      "kind": "semantic_parameter",
      "parameter": "prior_page_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "prior_page_attempt",
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
      "role": "stale_attempt",
      "kind": "semantic_parameter",
      "parameter": "stale_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/21",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/falsifier_condition_bindings/0",
        "/falsifier_condition_bindings/1",
        "/falsifier_condition_bindings/2",
        "/falsifier_condition_bindings/3",
        "/falsifier_condition_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "stale_attempt",
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
      "role": "control_attempt",
      "kind": "semantic_parameter",
      "parameter": "control_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/20",
        "/claim_patterns/21",
        "/claim_patterns/27"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "control_attempt",
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
      "role": "relevant_mutation",
      "kind": "semantic_parameter",
      "parameter": "relevant_mutation",
      "inputs": [],
      "rule_refs": [
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
      "role": "unrelated_mutation",
      "kind": "semantic_parameter",
      "parameter": "unrelated_mutation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/20",
        "/claim_patterns/27",
        "/falsifier_condition_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "unrelated_mutation",
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
      "role": "refusal",
      "kind": "semantic_parameter",
      "parameter": "refusal",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/20",
        "/claim_patterns/21",
        "/claim_patterns/27",
        "/claim_patterns/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "refusal",
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
      "role": "page_result_artifact",
      "kind": "semantic_parameter",
      "parameter": "page_result_artifact",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/22"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "page_result_artifact",
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
      "role": "page_return_event",
      "kind": "semantic_parameter",
      "parameter": "page_return_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/23"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "page_return_event",
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
      "role": "cursor_advance_event",
      "kind": "semantic_parameter",
      "parameter": "cursor_advance_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/24"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cursor_advance_event",
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
      "role": "cursor_state",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role cursor_state has no rule-linked semantic source.",
        "source": "profiles/proof.pagination.versioned-cursor-refusal/4.0.0/profile.json#/reference_roles/45",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "cursor_state",
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
      "role": "traversal_state",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role traversal_state has no rule-linked semantic source.",
        "source": "profiles/proof.pagination.versioned-cursor-refusal/4.0.0/profile.json#/reference_roles/46",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "traversal_state",
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
      "role": "control_return",
      "kind": "capability_gap",
      "parameter": null,
      "inputs": [],
      "rule_refs": [],
      "capability": null,
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Required role control_return has no rule-linked semantic source.",
        "source": "profiles/proof.pagination.versioned-cursor-refusal/4.0.0/profile.json#/reference_roles/47",
        "consequence": "The required type/cardinality survives; no new guarantee or input mapping is invented."
      },
      "refinement": {
        "role": "control_return",
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
      "role": "control_advancement",
      "kind": "semantic_parameter",
      "parameter": "control_advancement",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "control_advancement",
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
      "role": "control_returned_page",
      "kind": "semantic_parameter",
      "parameter": "control_returned_page",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "control_returned_page",
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
      "role": "verification",
      "kind": "semantic_parameter",
      "parameter": "verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/claim_patterns/27"
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
      "role": "return_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "return_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/22",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "return_failure_condition",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "emission_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "emission_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/23",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "emission_failure_condition",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "advancement_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "advancement_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/24",
        "/falsifier_condition_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "advancement_failure_condition",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "write_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "write_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/25",
        "/falsifier_condition_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "write_failure_condition",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "mutation_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "mutation_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/26",
        "/falsifier_condition_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "mutation_failure_condition",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "false_refusal_condition",
      "kind": "semantic_parameter",
      "parameter": "false_refusal_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/claim_patterns/27",
        "/falsifier_condition_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "false_refusal_condition",
        "allowed_type_terms": [
          "cc:criterion"
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
        "pattern_id": "complete-primary-cursor-population",
        "comparison": "complete_population",
        "roles": [
          "primary_cursor_population",
          "primary_cursors"
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
        "pattern_id": "complete-control-cursor-population",
        "comparison": "complete_population",
        "roles": [
          "control_cursor_population",
          "control_cursors"
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
      "ref": "/reference_binding_patterns/3",
      "constraint": {
        "pattern_id": "complete-primary-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "primary_returned_page_population",
          "primary_returned_pages"
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
        "pattern_id": "complete-control-returned-page-population",
        "comparison": "complete_population",
        "roles": [
          "control_returned_page_population",
          "control_returned_pages"
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
      "ref": "/reference_binding_patterns/6",
      "constraint": {
        "pattern_id": "complete-return-population",
        "comparison": "complete_population",
        "roles": [
          "return_population",
          "returns"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "constraint": {
        "pattern_id": "complete-advancement-population",
        "comparison": "complete_population",
        "roles": [
          "advancement_population",
          "advancements"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/8",
      "constraint": {
        "pattern_id": "complete-effect-occurrence-population",
        "comparison": "complete_population",
        "roles": [
          "effect_occurrence_population",
          "effect_occurrences"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/9",
      "constraint": {
        "pattern_id": "complete-protected-effect-population",
        "comparison": "complete_population",
        "roles": [
          "protected_effect_population",
          "protected_effects"
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
        "pattern_id": "each-primary-cursor-resolves-traversal-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "primary_cursors",
          "member_role": "primary_cursor"
        },
        "proposition_template": {
          "subject_role": "primary_cursor",
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
              "role": "traversal_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "each-control-cursor-resolves-control-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "control_cursors",
          "member_role": "control_cursor_member"
        },
        "proposition_template": {
          "subject_role": "control_cursor_member",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "each-primary-page-resolves-traversal-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "primary_returned_pages",
          "member_role": "primary_returned_page"
        },
        "proposition_template": {
          "subject_role": "primary_returned_page",
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
              "role": "traversal_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "each-control-page-resolves-control-version",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "control_returned_pages",
          "member_role": "control_returned_page_member"
        },
        "proposition_template": {
          "subject_role": "control_returned_page_member",
          "operator": "reference:resolves_to",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
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
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "prior-attempt-precedes-relevant-mutation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "prior_page_attempt",
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
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "relevant-mutation-precedes-stale-attempt",
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
              "role": "stale_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "live-source-current-at-stale-attempt",
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
              "stale_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "current_source_version"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "stale-attempt-uses-exact-cursor",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stale_cursor"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "refusal-rejects-stale-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "stale_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "stale-attempt-precedes-refusal",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refusal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "no-stale-page-return",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "return_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_result_artifact"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "no-stale-page-return-event",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "emission_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_return_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "no-stale-cursor-advance",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "advancement_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cursor_advance_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "no-stale-protected-write",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "write_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "no-stale-protected-mutation",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "stale_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "mutation_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "unrelated-mutation-mutates-unrelated-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "unrelated_mutation",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "control_traversal"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "unrelated_source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "unrelated-mutation-precedes-control-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "unrelated_mutation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "control-attempt-returns-page",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "control_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_returned_page"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "control-attempt-emits-advancement",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "control_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_advancement"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "no-unrelated-mutation-false-refusal",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrelated_mutation",
              "false_refusal_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "verification-reads-exact-versioned-cursor-captures",
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
              "role": "control_traversal"
            },
            {
              "kind": "reference",
              "role": "primary_cursors"
            },
            {
              "kind": "reference",
              "role": "control_cursors"
            },
            {
              "kind": "reference",
              "role": "page_attempts"
            },
            {
              "kind": "reference",
              "role": "primary_returned_pages"
            },
            {
              "kind": "reference",
              "role": "control_returned_pages"
            },
            {
              "kind": "reference",
              "role": "mutations"
            },
            {
              "kind": "reference",
              "role": "returns"
            },
            {
              "kind": "reference",
              "role": "advancements"
            },
            {
              "kind": "reference",
              "role": "protected_effects"
            },
            {
              "kind": "reference",
              "role": "stale_attempt"
            },
            {
              "kind": "reference",
              "role": "stale_cursor"
            },
            {
              "kind": "reference",
              "role": "refusal"
            },
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "verify-no-stale-page-return",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "return_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_result_artifact"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "verify-no-stale-page-return-event",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "emission_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "page_return_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "constraint": {
        "pattern_id": "verify-no-stale-cursor-advance",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:emits",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "advancement_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cursor_advance_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "constraint": {
        "pattern_id": "verify-no-stale-protected-write",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "write_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "constraint": {
        "pattern_id": "verify-no-stale-protected-mutation",
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
              "role": "stale_attempt"
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
          "subject_role": "stale_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "stale_attempt",
              "mutation_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_effects"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "constraint": {
        "pattern_id": "verify-no-unrelated-mutation-false-refusal",
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
              "role": "refusal"
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
          "subject_role": "refusal",
          "operator": "reference:rejects",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrelated_mutation",
              "false_refusal_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "control_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "relation-verify-no-stale-page-return",
        "role": "verifies",
        "source_claim_pattern_id": "verify-no-stale-page-return",
        "target_claim_pattern_id": "no-stale-page-return"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "relation-verify-no-stale-page-return-event",
        "role": "verifies",
        "source_claim_pattern_id": "verify-no-stale-page-return-event",
        "target_claim_pattern_id": "no-stale-page-return-event"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "relation-verify-no-stale-cursor-advance",
        "role": "verifies",
        "source_claim_pattern_id": "verify-no-stale-cursor-advance",
        "target_claim_pattern_id": "no-stale-cursor-advance"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "relation-verify-no-stale-protected-write",
        "role": "verifies",
        "source_claim_pattern_id": "verify-no-stale-protected-write",
        "target_claim_pattern_id": "no-stale-protected-write"
      }
    },
    {
      "ref": "/relation_patterns/4",
      "constraint": {
        "pattern_id": "relation-verify-no-stale-protected-mutation",
        "role": "verifies",
        "source_claim_pattern_id": "verify-no-stale-protected-mutation",
        "target_claim_pattern_id": "no-stale-protected-mutation"
      }
    },
    {
      "ref": "/relation_patterns/5",
      "constraint": {
        "pattern_id": "relation-verify-no-unrelated-mutation-false-refusal",
        "role": "verifies",
        "source_claim_pattern_id": "verify-no-unrelated-mutation-false-refusal",
        "target_claim_pattern_id": "no-unrelated-mutation-false-refusal"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "relation-verify-no-stale-page-return",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "return_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "relation-verify-no-stale-page-return-event",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "emission_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "relation-verify-no-stale-cursor-advance",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "advancement_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "relation-verify-no-stale-protected-write",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "write_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "constraint": {
        "relation_pattern_id": "relation-verify-no-stale-protected-mutation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "stale_attempt",
            "mutation_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/5",
      "constraint": {
        "relation_pattern_id": "relation-verify-no-unrelated-mutation-false-refusal",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "unrelated_mutation",
            "false_refusal_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-primary-cursor-population"
          },
          {
            "pattern": "complete-control-cursor-population"
          },
          {
            "pattern": "complete-page-attempt-population"
          },
          {
            "pattern": "complete-primary-returned-page-population"
          },
          {
            "pattern": "complete-control-returned-page-population"
          },
          {
            "pattern": "complete-mutation-population"
          },
          {
            "pattern": "complete-return-population"
          },
          {
            "pattern": "complete-advancement-population"
          },
          {
            "pattern": "complete-effect-occurrence-population"
          },
          {
            "pattern": "complete-protected-effect-population"
          },
          {
            "pattern": "each-primary-cursor-resolves-traversal-version"
          },
          {
            "pattern": "each-control-cursor-resolves-control-version"
          },
          {
            "pattern": "each-primary-page-resolves-traversal-version"
          },
          {
            "pattern": "each-control-page-resolves-control-version"
          },
          {
            "pattern": "relevant-mutation-mutates-live-source"
          },
          {
            "pattern": "prior-attempt-precedes-relevant-mutation"
          },
          {
            "pattern": "relevant-mutation-precedes-stale-attempt"
          },
          {
            "pattern": "live-source-current-at-stale-attempt"
          },
          {
            "pattern": "stale-attempt-uses-exact-cursor"
          },
          {
            "pattern": "refusal-rejects-stale-attempt"
          },
          {
            "pattern": "stale-attempt-precedes-refusal"
          },
          {
            "pattern": "no-stale-page-return"
          },
          {
            "pattern": "no-stale-page-return-event"
          },
          {
            "pattern": "no-stale-cursor-advance"
          },
          {
            "pattern": "no-stale-protected-write"
          },
          {
            "pattern": "no-stale-protected-mutation"
          },
          {
            "pattern": "unrelated-mutation-mutates-unrelated-source"
          },
          {
            "pattern": "unrelated-mutation-precedes-control-attempt"
          },
          {
            "pattern": "control-attempt-returns-page"
          },
          {
            "pattern": "control-attempt-emits-advancement"
          },
          {
            "pattern": "no-unrelated-mutation-false-refusal"
          },
          {
            "pattern": "verification-reads-exact-versioned-cursor-captures"
          },
          {
            "pattern": "verify-no-stale-page-return"
          },
          {
            "pattern": "verify-no-stale-page-return-event"
          },
          {
            "pattern": "verify-no-stale-cursor-advance"
          },
          {
            "pattern": "verify-no-stale-protected-write"
          },
          {
            "pattern": "verify-no-stale-protected-mutation"
          },
          {
            "pattern": "verify-no-unrelated-mutation-false-refusal"
          },
          {
            "pattern": "relation-verify-no-stale-page-return"
          },
          {
            "pattern": "relation-verify-no-stale-page-return-event"
          },
          {
            "pattern": "relation-verify-no-stale-cursor-advance"
          },
          {
            "pattern": "relation-verify-no-stale-protected-write"
          },
          {
            "pattern": "relation-verify-no-stale-protected-mutation"
          },
          {
            "pattern": "relation-verify-no-unrelated-mutation-false-refusal"
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
      "control_traversal",
      "live_source",
      "unrelated_source",
      "traversal_source_version",
      "current_source_version",
      "control_source_version",
      "primary_cursor_population",
      "primary_cursors",
      "control_cursor_population",
      "control_cursors",
      "stale_cursor",
      "page_attempt_population",
      "page_attempts",
      "primary_returned_page_population",
      "primary_returned_pages",
      "control_returned_page_population",
      "control_returned_pages",
      "mutation_population",
      "mutations",
      "return_population",
      "returns",
      "advancement_population",
      "advancements",
      "effect_occurrence_population",
      "effect_occurrences",
      "protected_effect_population",
      "protected_effects",
      "prior_page_attempt",
      "stale_attempt",
      "control_attempt",
      "relevant_mutation",
      "unrelated_mutation",
      "refusal",
      "page_result_artifact",
      "page_return_event",
      "cursor_advance_event",
      "control_advancement",
      "control_returned_page",
      "verification",
      "return_failure_condition",
      "emission_failure_condition",
      "advancement_failure_condition",
      "write_failure_condition",
      "mutation_failure_condition",
      "false_refusal_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "primary_before_capture",
      "primary_after_capture",
      "control_before_capture",
      "control_after_capture"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.pagination.versioned-cursor-refusal.",
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
        "missing": "No named proof.pagination.versioned-cursor-refusal constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.pagination.versioned-cursor-refusal.",
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
