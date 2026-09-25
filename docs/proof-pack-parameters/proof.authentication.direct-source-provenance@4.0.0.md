# proof.authentication.direct-source-provenance@4.0.0

<!-- Generated from validated package metadata. -->

For one exact directly captured evidence occurrence E, target T, provenance source S, and observation attempt A, the captured evidence bytes authenticate T during A, E originates from S during A, T has S as its singular source of record during A, E was observed in A, the selected target and source populations are complete singletons, and four independent verification claims with exact controlled-complement falsifiers verify those same-occurrence behaviors.

Profile digest: 4c54447eaf003dd075263596f590769c4740af17477c8a8d1659bc98c4cf4d7a. Parameter digest: 69d065dc8e1ea57808d9a02f90a8764f9c937a7dcb36b74fc397171ee6d028fe.

Admission digest: 1511c59cf6e08ede8fbc4aeefbbf91728e361dfa43ec83e1f1df7da817e51fca.

Roles: 17/17 accounted; 8 owned gaps. Semantic parameters: 9; internal roles: 8.

## Guarantee and exclusions

For one exact directly captured evidence occurrence E, target T, provenance source S, and observation attempt A, the captured evidence bytes authenticate T during A, E originates from S during A, T has S as its singular source of record during A, E was observed in A, the selected target and source populations are complete singletons, and four independent verification claims with exact controlled-complement falsifiers verify those same-occurrence behaviors.

- authorship-issuance-or-authorization
- caller-honesty-or-source-discovery-completeness
- derived-copied-or-transformed-evidence
- freshness-beyond-the-bound-observation-attempt
- generic-integrity-or-runtime-truth
- ownership-containment-or-decision-authority
- provenance-outside-the-complete-selected-source-population
- runtime-evidence-cce-or-publication-authority

## Parameters

### target

Declare target for proof.authentication.direct-source-provenance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "target",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:event",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "evidence-authenticates-target",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "evidence_occurrence",
          "operator": "reference:authenticates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "verify-evidence-authenticates-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authentication_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "evidence_occurrence",
          "operator": "reference:does_not_authenticate",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "target-has-source-of-record",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "target",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verify-target-has-source-of-record",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "source_record_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "target",
          "operator": "reference:does_not_have_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "target",
          "source",
          "observation_attempt"
        ],
        "applicability_contexts": [
          {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          }
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-selected-target-population",
        "comparison": "complete_population",
        "roles": [
          "target_population",
          "target"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### source

Declare source for proof.authentication.direct-source-provenance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "source",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity",
          "cc:process",
          "cc:resource",
          "cc:runtime_component"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "evidence-originates-from-source",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "evidence_occurrence",
          "operator": "reference:originates_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "verify-evidence-originates-from-source",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "provenance_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "evidence_occurrence",
          "operator": "reference:does_not_originate_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "target-has-source-of-record",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "target",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verify-target-has-source-of-record",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "source_record_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "target",
          "operator": "reference:does_not_have_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "evidence_occurrence",
          "source",
          "observation_attempt"
        ],
        "applicability_contexts": [
          {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          }
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "target",
          "source",
          "observation_attempt"
        ],
        "applicability_contexts": [
          {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          }
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-selected-source-population",
        "comparison": "complete_population",
        "roles": [
          "source_population",
          "source"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### observation_attempt

Declare observation attempt for proof.authentication.direct-source-provenance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "observation_attempt",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "evidence-authenticates-target",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "evidence_occurrence",
          "operator": "reference:authenticates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "verify-evidence-authenticates-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authentication_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "evidence_occurrence",
          "operator": "reference:does_not_authenticate",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "evidence-originates-from-source",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "evidence_occurrence",
          "operator": "reference:originates_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "verify-evidence-originates-from-source",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "provenance_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "evidence_occurrence",
          "operator": "reference:does_not_originate_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "target-has-source-of-record",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "target",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verify-target-has-source-of-record",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "source_record_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "target",
          "operator": "reference:does_not_have_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "evidence-observed-in-attempt",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "evidence_occurrence",
          "operator": "reference:observed_in",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "verify-evidence-observed-in-attempt",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "evidence_occurrence",
          "operator": "reference:not_observed_in",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "evidence_occurrence",
          "source",
          "observation_attempt"
        ],
        "applicability_contexts": [
          {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          }
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "target",
          "source",
          "observation_attempt"
        ],
        "applicability_contexts": [
          {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          }
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-evidence-authenticates-target",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-targets-evidence-originates-from-source",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "verification-targets-target-has-source-of-record",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-selected-target-population",
        "comparison": "complete_population",
        "roles": [
          "target_population",
          "target"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-selected-source-population",
        "comparison": "complete_population",
        "roles": [
          "source_population",
          "source"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### target_population

Declare target population for proof.authentication.direct-source-provenance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "target_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-selected-target-population",
        "comparison": "complete_population",
        "roles": [
          "target_population",
          "target"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### source_population

Declare source population for proof.authentication.direct-source-provenance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "source_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-selected-source-population",
        "comparison": "complete_population",
        "roles": [
          "source_population",
          "source"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    }
  ]
}
```

### authentication_verification

Declare authentication verification for proof.authentication.direct-source-provenance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authentication_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "verify-evidence-authenticates-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authentication_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "evidence_occurrence",
          "operator": "reference:does_not_authenticate",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    }
  ]
}
```

### provenance_verification

Declare provenance verification for proof.authentication.direct-source-provenance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "provenance_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "verify-evidence-originates-from-source",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "provenance_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "evidence_occurrence",
          "operator": "reference:does_not_originate_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    }
  ]
}
```

### source_record_verification

Declare source record verification for proof.authentication.direct-source-provenance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "source_record_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "verify-target-has-source-of-record",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "source_record_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "target",
          "operator": "reference:does_not_have_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    }
  ]
}
```

### observation_verification

Declare observation verification for proof.authentication.direct-source-provenance. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "observation_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "verify-evidence-observed-in-attempt",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "evidence_occurrence",
          "operator": "reference:not_observed_in",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
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
| evidence_occurrence | observation_requirement |  | Acquire evidence_occurrence for the exact subject, attempt and applicability in this profile. |
| target | semantic_parameter | target |  |
| source | semantic_parameter | source |  |
| observation_attempt | semantic_parameter | observation_attempt |  |
| target_population | semantic_parameter | target_population |  |
| source_population | semantic_parameter | source_population |  |
| evidence_content | observation_requirement |  | Acquire evidence_content for the exact subject, attempt and applicability in this profile. |
| target_resolution_witness | observation_requirement |  | Acquire target_resolution_witness for the exact subject, attempt and applicability in this profile. |
| source_authentication_witness | observation_requirement |  | Acquire source_authentication_witness for the exact subject, attempt and applicability in this profile. |
| source_of_record_witness | observation_requirement |  | Acquire source_of_record_witness for the exact subject, attempt and applicability in this profile. |
| attempt_binding_witness | observation_requirement |  | Acquire attempt_binding_witness for the exact subject, attempt and applicability in this profile. |
| authentication_witness | observation_requirement |  | Acquire authentication_witness for the exact subject, attempt and applicability in this profile. |
| occurrence_capture | observation_requirement |  | Acquire occurrence_capture for the exact subject, attempt and applicability in this profile. |
| authentication_verification | semantic_parameter | authentication_verification |  |
| provenance_verification | semantic_parameter | provenance_verification |  |
| source_record_verification | semantic_parameter | source_record_verification |  |
| observation_verification | semantic_parameter | observation_verification |  |

```json
{
  "roles": [
    {
      "role": "evidence_occurrence",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire evidence_occurrence for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authentication.direct-source-provenance/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "evidence_occurrence",
        "allowed_type_terms": [
          "cc:evidence_occurrence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "target",
      "kind": "semantic_parameter",
      "parameter": "target",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "target",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:configuration",
          "cc:entity",
          "cc:event",
          "cc:resource",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "source",
      "kind": "semantic_parameter",
      "parameter": "source",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/0",
        "/distinct_reference_role_sets/1",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "source",
        "allowed_type_terms": [
          "cc:actor",
          "cc:entity",
          "cc:process",
          "cc:resource",
          "cc:runtime_component"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_attempt",
      "kind": "semantic_parameter",
      "parameter": "observation_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/0",
        "/distinct_reference_role_sets/1",
        "/falsifier_condition_bindings/0",
        "/falsifier_condition_bindings/1",
        "/falsifier_condition_bindings/2",
        "/reference_binding_patterns/0",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observation_attempt",
        "allowed_type_terms": [
          "cc:event",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "target_population",
      "kind": "semantic_parameter",
      "parameter": "target_population",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "target_population",
        "allowed_type_terms": [
          "cc:population"
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
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "source_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "evidence_content",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire evidence_content for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authentication.direct-source-provenance/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "evidence_content",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
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
        "/claim_patterns/1",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire target_resolution_witness for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authentication.direct-source-provenance/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "target_resolution_witness",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
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
        "/claim_patterns/1",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire source_authentication_witness for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authentication.direct-source-provenance/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "source_authentication_witness",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
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
        "/claim_patterns/1",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire source_of_record_witness for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authentication.direct-source-provenance/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "source_of_record_witness",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
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
        "/claim_patterns/1",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire attempt_binding_witness for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authentication.direct-source-provenance/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "attempt_binding_witness",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
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
        "/claim_patterns/1",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire authentication_witness for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authentication.direct-source-provenance/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "authentication_witness",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "occurrence_capture",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/3",
        "/claim_patterns/5",
        "/claim_patterns/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire occurrence_capture for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.authentication.direct-source-provenance/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "occurrence_capture",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authentication_verification",
      "kind": "semantic_parameter",
      "parameter": "authentication_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authentication_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "provenance_verification",
      "kind": "semantic_parameter",
      "parameter": "provenance_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "provenance_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "source_record_verification",
      "kind": "semantic_parameter",
      "parameter": "source_record_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "source_record_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_verification",
      "kind": "semantic_parameter",
      "parameter": "observation_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observation_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
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
          "evidence_occurrence",
          "source",
          "observation_attempt"
        ],
        "applicability_contexts": [
          {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          }
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "target",
          "source",
          "observation_attempt"
        ],
        "applicability_contexts": [
          {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          }
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-selected-target-population",
        "comparison": "complete_population",
        "roles": [
          "target_population",
          "target"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "constraint": {
        "pattern_id": "complete-selected-source-population",
        "comparison": "complete_population",
        "roles": [
          "source_population",
          "source"
        ],
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "evidence-authenticates-target",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "evidence_occurrence",
          "operator": "reference:authenticates",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "verify-evidence-authenticates-target",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authentication_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "evidence_occurrence",
          "operator": "reference:does_not_authenticate",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "target"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "evidence-originates-from-source",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "evidence_occurrence",
          "operator": "reference:originates_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "verify-evidence-originates-from-source",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "provenance_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "evidence_occurrence",
          "operator": "reference:does_not_originate_from",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "target-has-source-of-record",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "target",
          "operator": "reference:has_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "verify-target-has-source-of-record",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "source_record_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "target",
          "operator": "reference:does_not_have_source_of_record",
          "applicability_context": {
            "mode": "during",
            "operand_roles": [
              "observation_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "source"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "evidence-observed-in-attempt",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "evidence_occurrence",
          "operator": "reference:observed_in",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "verify-evidence-observed-in-attempt",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "evidence_content"
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
              "role": "occurrence_capture"
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
          "subject_role": "evidence_occurrence",
          "operator": "reference:not_observed_in",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-evidence-authenticates-target",
        "role": "verifies",
        "source_claim_pattern_id": "verify-evidence-authenticates-target",
        "target_claim_pattern_id": "evidence-authenticates-target"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-targets-evidence-originates-from-source",
        "role": "verifies",
        "source_claim_pattern_id": "verify-evidence-originates-from-source",
        "target_claim_pattern_id": "evidence-originates-from-source"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "verification-targets-target-has-source-of-record",
        "role": "verifies",
        "source_claim_pattern_id": "verify-target-has-source-of-record",
        "target_claim_pattern_id": "target-has-source-of-record"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "verification-targets-evidence-observed-in-attempt",
        "role": "verifies",
        "source_claim_pattern_id": "verify-evidence-observed-in-attempt",
        "target_claim_pattern_id": "evidence-observed-in-attempt"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-evidence-authenticates-target",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-targets-evidence-originates-from-source",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "verification-targets-target-has-source-of-record",
        "applicability_context": {
          "mode": "during",
          "operand_roles": [
            "observation_attempt"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "verification-targets-evidence-observed-in-attempt",
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-selected-target-population"
          },
          {
            "pattern": "complete-selected-source-population"
          },
          {
            "pattern": "evidence-authenticates-target"
          },
          {
            "pattern": "verify-evidence-authenticates-target"
          },
          {
            "pattern": "evidence-originates-from-source"
          },
          {
            "pattern": "verify-evidence-originates-from-source"
          },
          {
            "pattern": "target-has-source-of-record"
          },
          {
            "pattern": "verify-target-has-source-of-record"
          },
          {
            "pattern": "evidence-observed-in-attempt"
          },
          {
            "pattern": "verify-evidence-observed-in-attempt"
          },
          {
            "pattern": "verification-targets-evidence-authenticates-target"
          },
          {
            "pattern": "verification-targets-evidence-originates-from-source"
          },
          {
            "pattern": "verification-targets-target-has-source-of-record"
          },
          {
            "pattern": "verification-targets-evidence-observed-in-attempt"
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
      "target",
      "source",
      "observation_attempt",
      "target_population",
      "source_population",
      "authentication_verification",
      "provenance_verification",
      "source_record_verification",
      "observation_verification"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "evidence_occurrence",
      "evidence_content",
      "target_resolution_witness",
      "source_authentication_witness",
      "source_of_record_witness",
      "attempt_binding_witness",
      "authentication_witness",
      "occurrence_capture"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.authentication.direct-source-provenance.",
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
        "missing": "No named proof.authentication.direct-source-provenance constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.authentication.direct-source-provenance.",
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
