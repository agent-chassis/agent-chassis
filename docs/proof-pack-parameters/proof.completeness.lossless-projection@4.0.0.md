# proof.completeness.lossless-projection@4.0.0

<!-- Generated from validated package metadata. -->

When one declared structured tool exposes one compact mode and one distinct documented complete mode, the declared compact result omits at least one declared heavy member; every declared omission is absent from the compact population, present in the complete-result population, represented in an omission population whose computed union with the compact population equals the complete source population, and represented in a disclosed population equal to the omission population; the complete-result population equals the source population; the compact result names the complete mode and carries the disclosure, complete total, and omission total; both totals equal the corresponding exact bound population cardinalities; and the selected omission reason is a member of a closed declared reason catalog.

Profile digest: 99620e0574c57d85c97794351c5c66e1a40f3a147ba65161dcbce2ed7b89b4f2. Parameter digest: bca24756b82cd0ccf95ff302b1cc540a87f4dd39f22d6df6be2d7c4b1bc28800.

Admission digest: 17746bf05d20f299ee4517d9e87f4f95fcfa517a9a97f053790e5ac143cd38fa.

Roles: 36/36 accounted; 3 owned gaps. Semantic parameters: 30; internal roles: 6.

## Guarantee and exclusions

When one declared structured tool exposes one compact mode and one distinct documented complete mode, the declared compact result omits at least one declared heavy member; every declared omission is absent from the compact population, present in the complete-result population, represented in an omission population whose computed union with the compact population equals the complete source population, and represented in a disclosed population equal to the omission population; the complete-result population equals the source population; the compact result names the complete mode and carries the disclosure, complete total, and omission total; both totals equal the corresponding exact bound population cardinalities; and the selected omission reason is a member of a closed declared reason catalog.

- authored-population-truthfulness
- code-routing-and-call-graph
- cross-storage-envelope-parity
- delivered-test-implementation
- identity-provenance-truthfulness
- member-byte-value-equality
- modes-outside-bound-pair
- pagination-range-and-cursor-semantics
- redaction-and-security-exemptions

## Parameters

### tool

Declare tool for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "tool",
        "allowed_type_terms": [
          "cc:operation"
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "tool-declares-modes",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "tool",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_mode"
            },
            {
              "kind": "reference",
              "role": "complete_mode"
            }
          ]
        }
      }
    }
  ]
}
```

### compact_mode

Declare compact mode for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "compact_mode",
        "allowed_type_terms": [
          "cc:operation"
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "tool-declares-modes",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "tool",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_mode"
            },
            {
              "kind": "reference",
              "role": "complete_mode"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "compact-mode-in-mode-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_mode",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "mode_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "projection-omission-verification",
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
              "role": "compact_mode"
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
          "subject_role": "omission_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_compact_omission_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "compact-mode-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_mode",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "compact_mode",
          "complete_mode"
        ]
      }
    }
  ]
}
```

### complete_mode

Declare complete mode for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "complete_mode",
        "allowed_type_terms": [
          "cc:operation"
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "tool-declares-modes",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "tool",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_mode"
            },
            {
              "kind": "reference",
              "role": "complete_mode"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "complete-mode-in-mode-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_mode",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "mode_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "disclosure-names-recovery-path",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "disclosure_signal",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_mode"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "lossless-recovery-verification",
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
              "role": "complete_mode"
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
          "subject_role": "complete_result_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrecoverable_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "complete-mode-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_mode",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "compact-result-names-complete-path",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_mode"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "compact_mode",
          "complete_mode"
        ]
      }
    }
  ]
}
```

### mode_population

Declare mode population for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "mode_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "compact-mode-in-mode-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_mode",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "mode_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "complete-mode-in-mode-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_mode",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "mode_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "mode_population",
          "source_population",
          "compact_population",
          "omission_population",
          "reason_catalog"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-mode-population",
        "comparison": "complete_population",
        "roles": [
          "mode_population",
          "tool_modes"
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

### tool_modes

Declare tool modes for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "tool_modes",
        "allowed_type_terms": [
          "cc:operation"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-mode-population",
        "comparison": "complete_population",
        "roles": [
          "mode_population",
          "tool_modes"
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
        "reference_role": "tool_modes",
        "number_role": "mode_count"
      }
    }
  ]
}
```

### compact_result

Declare compact result for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "compact_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
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
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "compact-result-emits-disclosure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosure_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "compact-result-emits-counts",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "total_count_signal"
            },
            {
              "kind": "reference",
              "role": "omission_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "verification-reads-proof-subjects",
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
              "role": "compact_result"
            },
            {
              "kind": "reference",
              "role": "complete_result"
            },
            {
              "kind": "reference",
              "role": "source_population"
            },
            {
              "kind": "reference",
              "role": "omission_population"
            },
            {
              "kind": "reference",
              "role": "disclosed_population"
            },
            {
              "kind": "reference",
              "role": "disclosure_signal"
            },
            {
              "kind": "reference",
              "role": "total_count_signal"
            },
            {
              "kind": "reference",
              "role": "omission_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "compact-mode-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_mode",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "compact-result-names-complete-path",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_mode"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "compact-result-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "compact_result",
          "complete_result"
        ]
      }
    }
  ]
}
```

### complete_result

Declare complete result for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "complete_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
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
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "verification-reads-proof-subjects",
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
              "role": "compact_result"
            },
            {
              "kind": "reference",
              "role": "complete_result"
            },
            {
              "kind": "reference",
              "role": "source_population"
            },
            {
              "kind": "reference",
              "role": "omission_population"
            },
            {
              "kind": "reference",
              "role": "disclosed_population"
            },
            {
              "kind": "reference",
              "role": "disclosure_signal"
            },
            {
              "kind": "reference",
              "role": "total_count_signal"
            },
            {
              "kind": "reference",
              "role": "omission_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "complete-mode-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_mode",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "complete-result-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "compact_result",
          "complete_result"
        ]
      }
    }
  ]
}
```

### source_population

Declare source population for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "source_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "complete-result-lossless",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_result_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "projection-accounting-complete",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "accounted_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "verification-reads-proof-subjects",
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
              "role": "compact_result"
            },
            {
              "kind": "reference",
              "role": "complete_result"
            },
            {
              "kind": "reference",
              "role": "source_population"
            },
            {
              "kind": "reference",
              "role": "omission_population"
            },
            {
              "kind": "reference",
              "role": "disclosed_population"
            },
            {
              "kind": "reference",
              "role": "disclosure_signal"
            },
            {
              "kind": "reference",
              "role": "total_count_signal"
            },
            {
              "kind": "reference",
              "role": "omission_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "lossless-recovery-verification",
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
              "role": "complete_mode"
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
          "subject_role": "complete_result_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrecoverable_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "projection-accounting-verification",
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
              "role": "accounted_population"
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
          "subject_role": "accounted_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unaccounted_source_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "compact-population-within-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "omission-population-within-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "omission_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "mode_population",
          "source_population",
          "compact_population",
          "omission_population",
          "reason_catalog"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-source-population",
        "comparison": "complete_population",
        "roles": [
          "source_population",
          "source_members"
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

### source_members

Declare source members for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "source_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
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
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-source-population",
        "comparison": "complete_population",
        "roles": [
          "source_population",
          "source_members"
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
        "reference_role": "source_members",
        "number_role": "source_count"
      }
    }
  ]
}
```

### compact_population

Declare compact population for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "compact_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "each-omitted-member-absent-from-compact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "omitted_members",
          "member_role": "omitted_member"
        },
        "proposition_template": {
          "subject_role": "omitted_member",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "projection-actually-omits",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "omission_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "verification-reads-projection-partition",
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
              "role": "compact_population"
            },
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "projection-omission-verification",
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
              "role": "compact_mode"
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
          "subject_role": "omission_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_compact_omission_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "compact-result-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "compact-population-within-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "mode_population",
          "source_population",
          "compact_population",
          "omission_population",
          "reason_catalog"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-compact-population",
        "comparison": "complete_population",
        "roles": [
          "compact_population",
          "compact_members"
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

### compact_members

Declare compact members for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "compact_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-compact-population",
        "comparison": "complete_population",
        "roles": [
          "compact_population",
          "compact_members"
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

### omission_population

Declare omission population for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "omission_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "projection-actually-omits",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "omission_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "disclosure-population-complete",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "disclosed_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "verification-reads-projection-partition",
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
              "role": "compact_population"
            },
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "verification-reads-proof-subjects",
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
              "role": "compact_result"
            },
            {
              "kind": "reference",
              "role": "complete_result"
            },
            {
              "kind": "reference",
              "role": "source_population"
            },
            {
              "kind": "reference",
              "role": "omission_population"
            },
            {
              "kind": "reference",
              "role": "disclosed_population"
            },
            {
              "kind": "reference",
              "role": "disclosure_signal"
            },
            {
              "kind": "reference",
              "role": "total_count_signal"
            },
            {
              "kind": "reference",
              "role": "omission_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "projection-omission-verification",
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
              "role": "compact_mode"
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
          "subject_role": "omission_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_compact_omission_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "disclosure-completeness-verification",
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
              "role": "disclosure_signal"
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
          "subject_role": "disclosed_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "silent_omission_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "omission-population-within-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "omission_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "mode_population",
          "source_population",
          "compact_population",
          "omission_population",
          "reason_catalog"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-omission-population",
        "comparison": "complete_population",
        "roles": [
          "omission_population",
          "omitted_members"
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

### omitted_members

Declare omitted members for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "omitted_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
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
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "each-omitted-member-absent-from-compact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "omitted_members",
          "member_role": "omitted_member"
        },
        "proposition_template": {
          "subject_role": "omitted_member",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "each-omitted-member-present-in-complete",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "omitted_members",
          "member_role": "omitted_member"
        },
        "proposition_template": {
          "subject_role": "omitted_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "each-omitted-member-heavy",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "omitted_members",
          "member_role": "omitted_member"
        },
        "proposition_template": {
          "subject_role": "omitted_member",
          "operator": "reference:classifies_as",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "heavy_member_class"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-omission-population",
        "comparison": "complete_population",
        "roles": [
          "omission_population",
          "omitted_members"
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
        "reference_role": "omitted_members",
        "number_role": "omission_count"
      }
    }
  ]
}
```

### complete_result_population

Declare complete result population for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "complete_result_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "each-omitted-member-present-in-complete",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "omitted_members",
          "member_role": "omitted_member"
        },
        "proposition_template": {
          "subject_role": "omitted_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "complete-result-lossless",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_result_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "lossless-recovery-verification",
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
              "role": "complete_mode"
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
          "subject_role": "complete_result_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrecoverable_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "complete-result-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-result-population-binding",
        "comparison": "complete_population",
        "roles": [
          "complete_result_population",
          "complete_result_members"
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

### complete_result_members

Declare complete result members for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "complete_result_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
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
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-result-population-binding",
        "comparison": "complete_population",
        "roles": [
          "complete_result_population",
          "complete_result_members"
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
        "reference_role": "complete_result_members",
        "number_role": "source_count"
      }
    }
  ]
}
```

### disclosed_population

Declare disclosed population for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "disclosed_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "disclosure-population-complete",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "disclosed_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "disclosure-records-omissions",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "disclosure_signal",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "verification-reads-proof-subjects",
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
              "role": "compact_result"
            },
            {
              "kind": "reference",
              "role": "complete_result"
            },
            {
              "kind": "reference",
              "role": "source_population"
            },
            {
              "kind": "reference",
              "role": "omission_population"
            },
            {
              "kind": "reference",
              "role": "disclosed_population"
            },
            {
              "kind": "reference",
              "role": "disclosure_signal"
            },
            {
              "kind": "reference",
              "role": "total_count_signal"
            },
            {
              "kind": "reference",
              "role": "omission_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "disclosure-completeness-verification",
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
              "role": "disclosure_signal"
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
          "subject_role": "disclosed_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "silent_omission_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-disclosed-population",
        "comparison": "complete_population",
        "roles": [
          "disclosed_population",
          "disclosed_members"
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

### disclosed_members

Declare disclosed members for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "disclosed_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
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
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-disclosed-population",
        "comparison": "complete_population",
        "roles": [
          "disclosed_population",
          "disclosed_members"
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
        "reference_role": "disclosed_members",
        "number_role": "omission_count"
      }
    }
  ]
}
```

### accounted_population

Declare accounted population for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "accounted_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "verification-builds-accounted-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accounted_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "projection-accounting-complete",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "accounted_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "projection-accounting-verification",
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
              "role": "accounted_population"
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
          "subject_role": "accounted_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unaccounted_source_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "complete-accounted-population",
        "comparison": "complete_population",
        "roles": [
          "accounted_population",
          "accounted_members"
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

### accounted_members

Declare accounted members for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "accounted_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
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
      "ref": "/reference_binding_patterns/6",
      "value": {
        "pattern_id": "complete-accounted-population",
        "comparison": "complete_population",
        "roles": [
          "accounted_population",
          "accounted_members"
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
        "reference_role": "accounted_members",
        "number_role": "source_count"
      }
    }
  ]
}
```

### reason_catalog

Declare reason catalog for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "reason_catalog",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "reason-selected-from-closed-catalog",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "omission_reason",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "reason_catalog"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "mode_population",
          "source_population",
          "compact_population",
          "omission_population",
          "reason_catalog"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "complete-reason-catalog",
        "comparison": "complete_population",
        "roles": [
          "reason_catalog",
          "allowed_reasons"
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

### allowed_reasons

Declare allowed reasons for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "allowed_reasons",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/7",
      "value": {
        "pattern_id": "complete-reason-catalog",
        "comparison": "complete_population",
        "roles": [
          "reason_catalog",
          "allowed_reasons"
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

### omission_reason

Declare omission reason for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "omission_reason",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "reason-selected-from-closed-catalog",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "omission_reason",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "reason_catalog"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "disclosure-names-reason",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "disclosure_signal",
          "operator": "reference:classifies_as",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "omission_reason"
            }
          ]
        }
      }
    }
  ]
}
```

### heavy_member_class

Declare heavy member class for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "heavy_member_class",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "each-omitted-member-heavy",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "omitted_members",
          "member_role": "omitted_member"
        },
        "proposition_template": {
          "subject_role": "omitted_member",
          "operator": "reference:classifies_as",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "heavy_member_class"
            }
          ]
        }
      }
    }
  ]
}
```

### verification

Declare verification for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "verification-reads-projection-partition",
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
              "role": "compact_population"
            },
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "verification-builds-accounted-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accounted_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "verification-reads-proof-subjects",
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
              "role": "compact_result"
            },
            {
              "kind": "reference",
              "role": "complete_result"
            },
            {
              "kind": "reference",
              "role": "source_population"
            },
            {
              "kind": "reference",
              "role": "omission_population"
            },
            {
              "kind": "reference",
              "role": "disclosed_population"
            },
            {
              "kind": "reference",
              "role": "disclosure_signal"
            },
            {
              "kind": "reference",
              "role": "total_count_signal"
            },
            {
              "kind": "reference",
              "role": "omission_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "projection-omission-verification",
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
              "role": "compact_mode"
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
          "subject_role": "omission_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_compact_omission_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "lossless-recovery-verification",
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
              "role": "complete_mode"
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
          "subject_role": "complete_result_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrecoverable_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "disclosure-completeness-verification",
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
              "role": "disclosure_signal"
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
          "subject_role": "disclosed_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "silent_omission_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "projection-accounting-verification",
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
              "role": "accounted_population"
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
          "subject_role": "accounted_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unaccounted_source_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "total-count-verification",
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
              "role": "total_count_signal"
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
          "subject_role": "total_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "incomplete_total_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "source_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "omission-count-verification",
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
              "role": "omission_count_signal"
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
          "subject_role": "omission_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "incomplete_omission_count_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "omission_count"
            }
          ]
        }
      }
    }
  ]
}
```

### unrecoverable_loss_condition

Declare unrecoverable loss condition for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "unrecoverable_loss_condition",
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
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "lossless-recovery-verification",
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
              "role": "complete_mode"
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
          "subject_role": "complete_result_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrecoverable_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "unrecoverable_loss_condition",
          "no_compact_omission_condition",
          "silent_omission_condition",
          "unaccounted_source_condition",
          "incomplete_total_condition",
          "incomplete_omission_count_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-target-lossless-recovery",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "unrecoverable_loss_condition"
          ]
        }
      }
    }
  ]
}
```

### no_compact_omission_condition

Declare no compact omission condition for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "no_compact_omission_condition",
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
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "projection-omission-verification",
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
              "role": "compact_mode"
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
          "subject_role": "omission_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_compact_omission_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "unrecoverable_loss_condition",
          "no_compact_omission_condition",
          "silent_omission_condition",
          "unaccounted_source_condition",
          "incomplete_total_condition",
          "incomplete_omission_count_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-target-projection-omission",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "no_compact_omission_condition"
          ]
        }
      }
    }
  ]
}
```

### silent_omission_condition

Declare silent omission condition for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "silent_omission_condition",
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
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "disclosure-completeness-verification",
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
              "role": "disclosure_signal"
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
          "subject_role": "disclosed_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "silent_omission_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "unrecoverable_loss_condition",
          "no_compact_omission_condition",
          "silent_omission_condition",
          "unaccounted_source_condition",
          "incomplete_total_condition",
          "incomplete_omission_count_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "verification-target-disclosure-completeness",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "silent_omission_condition"
          ]
        }
      }
    }
  ]
}
```

### unaccounted_source_condition

Declare unaccounted source condition for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "unaccounted_source_condition",
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
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "projection-accounting-verification",
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
              "role": "accounted_population"
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
          "subject_role": "accounted_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unaccounted_source_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "unrecoverable_loss_condition",
          "no_compact_omission_condition",
          "silent_omission_condition",
          "unaccounted_source_condition",
          "incomplete_total_condition",
          "incomplete_omission_count_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "verification-target-projection-accounting",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "unaccounted_source_condition"
          ]
        }
      }
    }
  ]
}
```

### incomplete_total_condition

Declare incomplete total condition for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "incomplete_total_condition",
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
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "total-count-verification",
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
              "role": "total_count_signal"
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
          "subject_role": "total_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "incomplete_total_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "source_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "unrecoverable_loss_condition",
          "no_compact_omission_condition",
          "silent_omission_condition",
          "unaccounted_source_condition",
          "incomplete_total_condition",
          "incomplete_omission_count_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "value": {
        "relation_pattern_id": "verification-target-total-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "incomplete_total_condition"
          ]
        }
      }
    }
  ]
}
```

### incomplete_omission_count_condition

Declare incomplete omission count condition for proof.completeness.lossless-projection. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "incomplete_omission_count_condition",
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
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "omission-count-verification",
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
              "role": "omission_count_signal"
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
          "subject_role": "omission_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "incomplete_omission_count_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "omission_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "unrecoverable_loss_condition",
          "no_compact_omission_condition",
          "silent_omission_condition",
          "unaccounted_source_condition",
          "incomplete_total_condition",
          "incomplete_omission_count_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/5",
      "value": {
        "relation_pattern_id": "verification-target-omission-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "incomplete_omission_count_condition"
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
| tool | semantic_parameter | tool |  |
| compact_mode | semantic_parameter | compact_mode |  |
| complete_mode | semantic_parameter | complete_mode |  |
| mode_population | semantic_parameter | mode_population |  |
| tool_modes | semantic_parameter | tool_modes |  |
| compact_result | semantic_parameter | compact_result |  |
| complete_result | semantic_parameter | complete_result |  |
| source_population | semantic_parameter | source_population |  |
| source_members | semantic_parameter | source_members |  |
| compact_population | semantic_parameter | compact_population |  |
| compact_members | semantic_parameter | compact_members |  |
| omission_population | semantic_parameter | omission_population |  |
| omitted_members | semantic_parameter | omitted_members |  |
| complete_result_population | semantic_parameter | complete_result_population |  |
| complete_result_members | semantic_parameter | complete_result_members |  |
| disclosed_population | semantic_parameter | disclosed_population |  |
| disclosed_members | semantic_parameter | disclosed_members |  |
| accounted_population | semantic_parameter | accounted_population |  |
| accounted_members | semantic_parameter | accounted_members |  |
| reason_catalog | semantic_parameter | reason_catalog |  |
| allowed_reasons | semantic_parameter | allowed_reasons |  |
| omission_reason | semantic_parameter | omission_reason |  |
| heavy_member_class | semantic_parameter | heavy_member_class |  |
| disclosure_signal | observation_requirement |  | Acquire disclosure_signal for the exact subject, attempt and applicability in this profile. |
| total_count_signal | observation_requirement |  | Acquire total_count_signal for the exact subject, attempt and applicability in this profile. |
| omission_count_signal | observation_requirement |  | Acquire omission_count_signal for the exact subject, attempt and applicability in this profile. |
| verification | semantic_parameter | verification |  |
| unrecoverable_loss_condition | semantic_parameter | unrecoverable_loss_condition |  |
| no_compact_omission_condition | semantic_parameter | no_compact_omission_condition |  |
| silent_omission_condition | semantic_parameter | silent_omission_condition |  |
| unaccounted_source_condition | semantic_parameter | unaccounted_source_condition |  |
| incomplete_total_condition | semantic_parameter | incomplete_total_condition |  |
| incomplete_omission_count_condition | semantic_parameter | incomplete_omission_count_condition |  |
| mode_count | definition_constant |  |  |
| source_count | complete_population_count | source_members, complete_result_members, accounted_members |  |
| omission_count | complete_population_count | omitted_members, disclosed_members |  |

```json
{
  "roles": [
    {
      "role": "tool",
      "kind": "semantic_parameter",
      "parameter": "tool",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "tool",
        "allowed_type_terms": [
          "cc:operation"
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
      "role": "compact_mode",
      "kind": "semantic_parameter",
      "parameter": "compact_mode",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/28",
        "/claim_patterns/3",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "compact_mode",
        "allowed_type_terms": [
          "cc:operation"
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
      "role": "complete_mode",
      "kind": "semantic_parameter",
      "parameter": "complete_mode",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/2",
        "/claim_patterns/22",
        "/claim_patterns/29",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "complete_mode",
        "allowed_type_terms": [
          "cc:operation"
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
      "role": "mode_population",
      "kind": "semantic_parameter",
      "parameter": "mode_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/distinct_reference_role_sets/2",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "mode_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "tool_modes",
      "kind": "semantic_parameter",
      "parameter": "tool_modes",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "tool_modes",
        "allowed_type_terms": [
          "cc:operation"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "compact_result",
      "kind": "semantic_parameter",
      "parameter": "compact_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/23",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "compact_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "complete_result",
      "kind": "semantic_parameter",
      "parameter": "complete_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/27",
        "/claim_patterns/4",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "complete_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "source_population",
      "kind": "semantic_parameter",
      "parameter": "source_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/claim_patterns/18",
        "/claim_patterns/27",
        "/claim_patterns/29",
        "/claim_patterns/31",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/2",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "source_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "source_members",
      "kind": "semantic_parameter",
      "parameter": "source_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "source_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "compact_population",
      "kind": "semantic_parameter",
      "parameter": "compact_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/13",
        "/claim_patterns/16",
        "/claim_patterns/28",
        "/claim_patterns/6",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/2",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "compact_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "compact_members",
      "kind": "semantic_parameter",
      "parameter": "compact_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "compact_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "omission_population",
      "kind": "semantic_parameter",
      "parameter": "omission_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/claim_patterns/30",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/2",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "omission_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "omitted_members",
      "kind": "semantic_parameter",
      "parameter": "omitted_members",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "omitted_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "complete_result_population",
      "kind": "semantic_parameter",
      "parameter": "complete_result_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/14",
        "/claim_patterns/29",
        "/claim_patterns/7",
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "complete_result_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "complete_result_members",
      "kind": "semantic_parameter",
      "parameter": "complete_result_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/4",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "complete_result_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "disclosed_population",
      "kind": "semantic_parameter",
      "parameter": "disclosed_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/20",
        "/claim_patterns/27",
        "/claim_patterns/30",
        "/reference_binding_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "disclosed_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "disclosed_members",
      "kind": "semantic_parameter",
      "parameter": "disclosed_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/5",
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "disclosed_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "accounted_population",
      "kind": "semantic_parameter",
      "parameter": "accounted_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/31",
        "/reference_binding_patterns/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "accounted_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "accounted_members",
      "kind": "semantic_parameter",
      "parameter": "accounted_members",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/6",
        "/reference_role_count_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "accounted_members",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "reason_catalog",
      "kind": "semantic_parameter",
      "parameter": "reason_catalog",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/distinct_reference_role_sets/2",
        "/reference_binding_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "reason_catalog",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "allowed_reasons",
      "kind": "semantic_parameter",
      "parameter": "allowed_reasons",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "allowed_reasons",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "omission_reason",
      "kind": "semantic_parameter",
      "parameter": "omission_reason",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/claim_patterns/21"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "omission_reason",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "heavy_member_class",
      "kind": "semantic_parameter",
      "parameter": "heavy_member_class",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "heavy_member_class",
        "allowed_type_terms": [
          "cc:criterion"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "disclosure_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/claim_patterns/21",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/27",
        "/claim_patterns/30",
        "/distinct_reference_role_sets/3"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire disclosure_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.completeness.lossless-projection/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "disclosure_signal",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "total_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/24",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/claim_patterns/32",
        "/distinct_reference_role_sets/3"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire total_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.completeness.lossless-projection/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "total_count_signal",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "omission_count_signal",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/25",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/claim_patterns/33",
        "/distinct_reference_role_sets/3"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire omission_count_signal for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.completeness.lossless-projection/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "omission_count_signal",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
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
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/claim_patterns/30",
        "/claim_patterns/31",
        "/claim_patterns/32",
        "/claim_patterns/33"
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
      "role": "unrecoverable_loss_condition",
      "kind": "semantic_parameter",
      "parameter": "unrecoverable_loss_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/29",
        "/distinct_reference_role_sets/4",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "unrecoverable_loss_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "no_compact_omission_condition",
      "kind": "semantic_parameter",
      "parameter": "no_compact_omission_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/28",
        "/distinct_reference_role_sets/4",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "no_compact_omission_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "silent_omission_condition",
      "kind": "semantic_parameter",
      "parameter": "silent_omission_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/30",
        "/distinct_reference_role_sets/4",
        "/falsifier_condition_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "silent_omission_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "unaccounted_source_condition",
      "kind": "semantic_parameter",
      "parameter": "unaccounted_source_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/31",
        "/distinct_reference_role_sets/4",
        "/falsifier_condition_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "unaccounted_source_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "incomplete_total_condition",
      "kind": "semantic_parameter",
      "parameter": "incomplete_total_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/32",
        "/distinct_reference_role_sets/4",
        "/falsifier_condition_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "incomplete_total_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "incomplete_omission_count_condition",
      "kind": "semantic_parameter",
      "parameter": "incomplete_omission_count_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/33",
        "/distinct_reference_role_sets/4",
        "/falsifier_condition_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "incomplete_omission_count_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "mode_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "mode_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 2,
        "maximum": 2
      }
    },
    {
      "role": "source_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "source_members",
        "complete_result_members",
        "accounted_members"
      ],
      "rule_refs": [
        "/claim_patterns/24",
        "/claim_patterns/32",
        "/reference_role_count_bindings/1",
        "/reference_role_count_bindings/2",
        "/reference_role_count_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "source_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "omission_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "omitted_members",
        "disclosed_members"
      ],
      "rule_refs": [
        "/claim_patterns/25",
        "/claim_patterns/33",
        "/reference_role_count_bindings/3",
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "omission_count",
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
          "compact_mode",
          "complete_mode"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "compact_result",
          "complete_result"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "mode_population",
          "source_population",
          "compact_population",
          "omission_population",
          "reason_catalog"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "disclosure_signal",
          "total_count_signal",
          "omission_count_signal"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "constraint": {
        "roles": [
          "unrecoverable_loss_condition",
          "no_compact_omission_condition",
          "silent_omission_condition",
          "unaccounted_source_condition",
          "incomplete_total_condition",
          "incomplete_omission_count_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-mode-population",
        "comparison": "complete_population",
        "roles": [
          "mode_population",
          "tool_modes"
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
        "pattern_id": "complete-source-population",
        "comparison": "complete_population",
        "roles": [
          "source_population",
          "source_members"
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
        "pattern_id": "complete-compact-population",
        "comparison": "complete_population",
        "roles": [
          "compact_population",
          "compact_members"
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
        "pattern_id": "complete-omission-population",
        "comparison": "complete_population",
        "roles": [
          "omission_population",
          "omitted_members"
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
        "pattern_id": "complete-result-population-binding",
        "comparison": "complete_population",
        "roles": [
          "complete_result_population",
          "complete_result_members"
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
        "pattern_id": "complete-disclosed-population",
        "comparison": "complete_population",
        "roles": [
          "disclosed_population",
          "disclosed_members"
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
        "pattern_id": "complete-accounted-population",
        "comparison": "complete_population",
        "roles": [
          "accounted_population",
          "accounted_members"
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
        "pattern_id": "complete-reason-catalog",
        "comparison": "complete_population",
        "roles": [
          "reason_catalog",
          "allowed_reasons"
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
        "reference_role": "tool_modes",
        "number_role": "mode_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "source_members",
        "number_role": "source_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "complete_result_members",
        "number_role": "source_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "omitted_members",
        "number_role": "omission_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "constraint": {
        "reference_role": "disclosed_members",
        "number_role": "omission_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "constraint": {
        "reference_role": "accounted_members",
        "number_role": "source_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "tool-declares-modes",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "tool",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_mode"
            },
            {
              "kind": "reference",
              "role": "complete_mode"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "compact-mode-in-mode-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_mode",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "mode_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "complete-mode-in-mode-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_mode",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "mode_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "compact-mode-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_mode",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "complete-mode-returns-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_mode",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "compact-result-names-complete-path",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_mode"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "compact-result-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "complete-result-carries-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_result",
          "operator": "reference:contains",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "compact-population-within-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "omission-population-within-source",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "omission_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "each-omitted-member-absent-from-compact",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "omitted_members",
          "member_role": "omitted_member"
        },
        "proposition_template": {
          "subject_role": "omitted_member",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "each-omitted-member-present-in-complete",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "omitted_members",
          "member_role": "omitted_member"
        },
        "proposition_template": {
          "subject_role": "omitted_member",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_result_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "each-omitted-member-heavy",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "omitted_members",
          "member_role": "omitted_member"
        },
        "proposition_template": {
          "subject_role": "omitted_member",
          "operator": "reference:classifies_as",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "heavy_member_class"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "projection-actually-omits",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "omission_population",
          "operator": "reference:not_subset_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "complete-result-lossless",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "complete_result_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "disclosure-population-complete",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "disclosed_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "verification-reads-projection-partition",
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
              "role": "compact_population"
            },
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "verification-builds-accounted-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:returns",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "accounted_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "projection-accounting-complete",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "accounted_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "reason-selected-from-closed-catalog",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "omission_reason",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "reason_catalog"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "disclosure-records-omissions",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "disclosure_signal",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosed_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "disclosure-names-reason",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "disclosure_signal",
          "operator": "reference:classifies_as",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "omission_reason"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "disclosure-names-recovery-path",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "disclosure_signal",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "complete_mode"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "compact-result-emits-disclosure",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "disclosure_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "constraint": {
        "pattern_id": "total-count-complete",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "total_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "source_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "constraint": {
        "pattern_id": "omission-count-complete",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "omission_count_signal",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "omission_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "constraint": {
        "pattern_id": "compact-result-emits-counts",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "compact_result",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "total_count_signal"
            },
            {
              "kind": "reference",
              "role": "omission_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "constraint": {
        "pattern_id": "verification-reads-proof-subjects",
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
              "role": "compact_result"
            },
            {
              "kind": "reference",
              "role": "complete_result"
            },
            {
              "kind": "reference",
              "role": "source_population"
            },
            {
              "kind": "reference",
              "role": "omission_population"
            },
            {
              "kind": "reference",
              "role": "disclosed_population"
            },
            {
              "kind": "reference",
              "role": "disclosure_signal"
            },
            {
              "kind": "reference",
              "role": "total_count_signal"
            },
            {
              "kind": "reference",
              "role": "omission_count_signal"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "constraint": {
        "pattern_id": "projection-omission-verification",
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
              "role": "compact_mode"
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
          "subject_role": "omission_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "no_compact_omission_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "compact_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "constraint": {
        "pattern_id": "lossless-recovery-verification",
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
              "role": "complete_mode"
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
          "subject_role": "complete_result_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unrecoverable_loss_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "constraint": {
        "pattern_id": "disclosure-completeness-verification",
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
              "role": "disclosure_signal"
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
          "subject_role": "disclosed_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "silent_omission_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "omission_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "constraint": {
        "pattern_id": "projection-accounting-verification",
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
              "role": "accounted_population"
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
          "subject_role": "accounted_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "unaccounted_source_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "constraint": {
        "pattern_id": "total-count-verification",
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
              "role": "total_count_signal"
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
          "subject_role": "total_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "incomplete_total_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "source_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "constraint": {
        "pattern_id": "omission-count-verification",
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
              "role": "omission_count_signal"
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
          "subject_role": "omission_count_signal",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "incomplete_omission_count_condition"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "omission_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-projection-omission",
        "role": "verifies",
        "source_claim_pattern_id": "projection-omission-verification",
        "target_claim_pattern_id": "projection-actually-omits"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-target-lossless-recovery",
        "role": "verifies",
        "source_claim_pattern_id": "lossless-recovery-verification",
        "target_claim_pattern_id": "complete-result-lossless"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "verification-target-disclosure-completeness",
        "role": "verifies",
        "source_claim_pattern_id": "disclosure-completeness-verification",
        "target_claim_pattern_id": "disclosure-population-complete"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "verification-target-projection-accounting",
        "role": "verifies",
        "source_claim_pattern_id": "projection-accounting-verification",
        "target_claim_pattern_id": "projection-accounting-complete"
      }
    },
    {
      "ref": "/relation_patterns/4",
      "constraint": {
        "pattern_id": "verification-target-total-count",
        "role": "verifies",
        "source_claim_pattern_id": "total-count-verification",
        "target_claim_pattern_id": "total-count-complete"
      }
    },
    {
      "ref": "/relation_patterns/5",
      "constraint": {
        "pattern_id": "verification-target-omission-count",
        "role": "verifies",
        "source_claim_pattern_id": "omission-count-verification",
        "target_claim_pattern_id": "omission-count-complete"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-projection-omission",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "no_compact_omission_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-target-lossless-recovery",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "unrecoverable_loss_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "verification-target-disclosure-completeness",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "silent_omission_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "verification-target-projection-accounting",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "unaccounted_source_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/4",
      "constraint": {
        "relation_pattern_id": "verification-target-total-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "incomplete_total_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/5",
      "constraint": {
        "relation_pattern_id": "verification-target-omission-count",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "incomplete_omission_count_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-mode-population"
          },
          {
            "pattern": "complete-source-population"
          },
          {
            "pattern": "complete-compact-population"
          },
          {
            "pattern": "complete-omission-population"
          },
          {
            "pattern": "complete-result-population-binding"
          },
          {
            "pattern": "complete-disclosed-population"
          },
          {
            "pattern": "complete-accounted-population"
          },
          {
            "pattern": "complete-reason-catalog"
          },
          {
            "pattern": "tool-declares-modes"
          },
          {
            "pattern": "compact-mode-in-mode-population"
          },
          {
            "pattern": "complete-mode-in-mode-population"
          },
          {
            "pattern": "compact-mode-returns-result"
          },
          {
            "pattern": "complete-mode-returns-result"
          },
          {
            "pattern": "compact-result-names-complete-path"
          },
          {
            "pattern": "compact-result-carries-population"
          },
          {
            "pattern": "complete-result-carries-population"
          },
          {
            "pattern": "compact-population-within-source"
          },
          {
            "pattern": "omission-population-within-source"
          },
          {
            "pattern": "each-omitted-member-absent-from-compact"
          },
          {
            "pattern": "each-omitted-member-present-in-complete"
          },
          {
            "pattern": "each-omitted-member-heavy"
          },
          {
            "pattern": "projection-actually-omits"
          },
          {
            "pattern": "complete-result-lossless"
          },
          {
            "pattern": "disclosure-population-complete"
          },
          {
            "pattern": "verification-reads-projection-partition"
          },
          {
            "pattern": "verification-builds-accounted-population"
          },
          {
            "pattern": "projection-accounting-complete"
          },
          {
            "pattern": "reason-selected-from-closed-catalog"
          },
          {
            "pattern": "disclosure-records-omissions"
          },
          {
            "pattern": "disclosure-names-reason"
          },
          {
            "pattern": "disclosure-names-recovery-path"
          },
          {
            "pattern": "compact-result-emits-disclosure"
          },
          {
            "pattern": "total-count-complete"
          },
          {
            "pattern": "omission-count-complete"
          },
          {
            "pattern": "compact-result-emits-counts"
          },
          {
            "pattern": "verification-reads-proof-subjects"
          },
          {
            "pattern": "projection-omission-verification"
          },
          {
            "pattern": "lossless-recovery-verification"
          },
          {
            "pattern": "disclosure-completeness-verification"
          },
          {
            "pattern": "projection-accounting-verification"
          },
          {
            "pattern": "total-count-verification"
          },
          {
            "pattern": "omission-count-verification"
          },
          {
            "pattern": "verification-target-projection-omission"
          },
          {
            "pattern": "verification-target-lossless-recovery"
          },
          {
            "pattern": "verification-target-disclosure-completeness"
          },
          {
            "pattern": "verification-target-projection-accounting"
          },
          {
            "pattern": "verification-target-total-count"
          },
          {
            "pattern": "verification-target-omission-count"
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
      "tool",
      "compact_mode",
      "complete_mode",
      "mode_population",
      "tool_modes",
      "compact_result",
      "complete_result",
      "source_population",
      "source_members",
      "compact_population",
      "compact_members",
      "omission_population",
      "omitted_members",
      "complete_result_population",
      "complete_result_members",
      "disclosed_population",
      "disclosed_members",
      "accounted_population",
      "accounted_members",
      "reason_catalog",
      "allowed_reasons",
      "omission_reason",
      "heavy_member_class",
      "verification",
      "unrecoverable_loss_condition",
      "no_compact_omission_condition",
      "silent_omission_condition",
      "unaccounted_source_condition",
      "incomplete_total_condition",
      "incomplete_omission_count_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "disclosure_signal",
      "total_count_signal",
      "omission_count_signal"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.completeness.lossless-projection.",
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
        "missing": "No named proof.completeness.lossless-projection constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.completeness.lossless-projection.",
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
