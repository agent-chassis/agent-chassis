# proof.lifecycle.bounded-state-stability@4.0.0

<!-- Generated from validated package metadata. -->

For one subject, without asserting terminality, with one elected baseline state at a start boundary and a distinct later end boundary, the complete nonempty observation population lies strictly inside the bounded interval; every observation reads that same subject and records the baseline state, and the complete observed-state population equals the complete singleton baseline-state population.

Profile digest: b4eb7cd57b344d8dec861f7231ae4b0e4b39917581078aec6ea5651378aa5cae. Parameter digest: 07485182dab6b90eb077ca3b91268e58d0552f4246db4dd3f8bced76f64bd023.

Admission digest: 0a858ea5e4c3cbddd50337910bcd304e2d365c3f762eb7499ef6bed9e4746e2b.

Roles: 15/15 accounted; 2 owned gaps. Semantic parameters: 10; internal roles: 5.

## Guarantee and exclusions

For one subject, without asserting terminality, with one elected baseline state at a start boundary and a distinct later end boundary, the complete nonempty observation population lies strictly inside the bounded interval; every observation reads that same subject and records the baseline state, and the complete observed-state population equals the complete singleton baseline-state population.

- behavior-before-start-or-after-end
- dishonest-identity-role-population-boundary-state-or-evidence-grounding
- external-actor-noninterference
- forever-after-stability-or-liveness
- observations-or-behavior-outside-the-complete-declared-population
- real-time-truth-or-clock-accuracy
- transient-state-between-declared-observations

## Parameters

### subject

Declare subject for proof.lifecycle.bounded-state-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "subject",
        "allowed_type_terms": [
          "cc:capability",
          "cc:entity",
          "cc:lifecycle_entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
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
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "subject-has-baseline-state-at-start",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "start_boundary"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "each-observation-reads-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-bounded-state-proof",
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
              "role": "subject"
            },
            {
              "kind": "reference",
              "role": "baseline_state"
            },
            {
              "kind": "reference",
              "role": "start_boundary"
            },
            {
              "kind": "reference",
              "role": "end_boundary"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observations"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "subject",
          "verification",
          "state_regression_condition"
        ]
      }
    }
  ]
}
```

### baseline_state

Declare baseline state for proof.lifecycle.bounded-state-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "baseline_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "subject-has-baseline-state-at-start",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "start_boundary"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "baseline-state-is-complete-member",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "baseline_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "each-observation-records-baseline-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-bounded-state-proof",
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
              "role": "subject"
            },
            {
              "kind": "reference",
              "role": "baseline_state"
            },
            {
              "kind": "reference",
              "role": "start_boundary"
            },
            {
              "kind": "reference",
              "role": "end_boundary"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observations"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            }
          ]
        }
      }
    }
  ]
}
```

### start_boundary

Declare start boundary for proof.lifecycle.bounded-state-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "start_boundary",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "start-precedes-end",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "start_boundary",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "end_boundary"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "subject-has-baseline-state-at-start",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "start_boundary"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "start-before-each-observation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "start_boundary",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-bounded-state-proof",
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
              "role": "subject"
            },
            {
              "kind": "reference",
              "role": "baseline_state"
            },
            {
              "kind": "reference",
              "role": "start_boundary"
            },
            {
              "kind": "reference",
              "role": "end_boundary"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observations"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "start_boundary",
          "end_boundary"
        ]
      }
    }
  ]
}
```

### end_boundary

Declare end boundary for proof.lifecycle.bounded-state-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "end_boundary",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "start-precedes-end",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "start_boundary",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "end_boundary"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-observation-before-end",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "end_boundary"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-bounded-state-proof",
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
              "role": "subject"
            },
            {
              "kind": "reference",
              "role": "baseline_state"
            },
            {
              "kind": "reference",
              "role": "start_boundary"
            },
            {
              "kind": "reference",
              "role": "end_boundary"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observations"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "start_boundary",
          "end_boundary"
        ]
      }
    }
  ]
}
```

### baseline_state_population

Declare baseline state population for proof.lifecycle.bounded-state-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "baseline_state_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "baseline-state-is-complete-member",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "baseline_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "observed-states-equal-baseline-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_state_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-bounded-state-proof",
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
              "role": "subject"
            },
            {
              "kind": "reference",
              "role": "baseline_state"
            },
            {
              "kind": "reference",
              "role": "start_boundary"
            },
            {
              "kind": "reference",
              "role": "end_boundary"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observations"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "bounded-state-stability-verification",
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
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_regression_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-baseline-state-population",
        "comparison": "complete_population",
        "roles": [
          "baseline_state_population",
          "baseline_states"
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

### baseline_states

Declare baseline states for proof.lifecycle.bounded-state-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "baseline_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
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
        "pattern_id": "complete-baseline-state-population",
        "comparison": "complete_population",
        "roles": [
          "baseline_state_population",
          "baseline_states"
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
        "reference_role": "baseline_states",
        "number_role": "baseline_state_count"
      }
    }
  ]
}
```

### observed_state_population

Declare observed state population for proof.lifecycle.bounded-state-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "observed_state_population",
        "allowed_type_terms": [
          "cc:population"
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
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "observed-states-equal-baseline-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_state_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "verification-reads-bounded-state-proof",
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
              "role": "subject"
            },
            {
              "kind": "reference",
              "role": "baseline_state"
            },
            {
              "kind": "reference",
              "role": "start_boundary"
            },
            {
              "kind": "reference",
              "role": "end_boundary"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observations"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "bounded-state-stability-verification",
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
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_regression_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-observed-state-population",
        "comparison": "complete_population",
        "roles": [
          "observed_state_population",
          "observed_states"
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

### observed_states

Declare observed states for proof.lifecycle.bounded-state-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "observed_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-observed-state-population",
        "comparison": "complete_population",
        "roles": [
          "observed_state_population",
          "observed_states"
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
        "reference_role": "observed_states",
        "number_role": "observed_state_count"
      }
    }
  ]
}
```

### verification

Declare verification for proof.lifecycle.bounded-state-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "pattern_id": "verification-reads-bounded-state-proof",
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
              "role": "subject"
            },
            {
              "kind": "reference",
              "role": "baseline_state"
            },
            {
              "kind": "reference",
              "role": "start_boundary"
            },
            {
              "kind": "reference",
              "role": "end_boundary"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observations"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "bounded-state-stability-verification",
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
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_regression_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "subject",
          "verification",
          "state_regression_condition"
        ]
      }
    }
  ]
}
```

### state_regression_condition

Declare state regression condition for proof.lifecycle.bounded-state-stability. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "state_regression_condition",
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
        "pattern_id": "bounded-state-stability-verification",
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
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_regression_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "subject",
          "verification",
          "state_regression_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-targets-bounded-state-stability",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "state_regression_condition"
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
| subject | semantic_parameter | subject |  |
| baseline_state | semantic_parameter | baseline_state |  |
| start_boundary | semantic_parameter | start_boundary |  |
| end_boundary | semantic_parameter | end_boundary |  |
| observation_population | observation_requirement |  | Acquire observation_population for the exact subject, attempt and applicability in this profile. |
| observations | observation_requirement |  | Acquire observations for the exact subject, attempt and applicability in this profile. |
| baseline_state_population | semantic_parameter | baseline_state_population |  |
| baseline_states | semantic_parameter | baseline_states |  |
| observed_state_population | semantic_parameter | observed_state_population |  |
| observed_states | semantic_parameter | observed_states |  |
| verification | semantic_parameter | verification |  |
| state_regression_condition | semantic_parameter | state_regression_condition |  |
| observation_count | complete_population_count | observations |  |
| baseline_state_count | definition_constant |  |  |
| observed_state_count | complete_population_count | observed_states |  |

```json
{
  "roles": [
    {
      "role": "subject",
      "kind": "semantic_parameter",
      "parameter": "subject",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/5",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "subject",
        "allowed_type_terms": [
          "cc:capability",
          "cc:entity",
          "cc:lifecycle_entity",
          "cc:resource"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "baseline_state",
      "kind": "semantic_parameter",
      "parameter": "baseline_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/2",
        "/claim_patterns/6",
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "baseline_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "start_boundary",
      "kind": "semantic_parameter",
      "parameter": "start_boundary",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/3",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "start_boundary",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "end_boundary",
      "kind": "semantic_parameter",
      "parameter": "end_boundary",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/4",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "end_boundary",
        "allowed_type_terms": [
          "cc:event"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_population",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/reference_binding_patterns/0"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observation_population for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.lifecycle.bounded-state-stability/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observation_population",
        "allowed_type_terms": [
          "cc:population"
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
      "role": "observations",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/8",
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire observations for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.lifecycle.bounded-state-stability/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "observations",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "baseline_state_population",
      "kind": "semantic_parameter",
      "parameter": "baseline_state_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "baseline_state_population",
        "allowed_type_terms": [
          "cc:population"
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
      "role": "baseline_states",
      "kind": "semantic_parameter",
      "parameter": "baseline_states",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "baseline_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "observed_state_population",
      "kind": "semantic_parameter",
      "parameter": "observed_state_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_state_population",
        "allowed_type_terms": [
          "cc:population"
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
      "role": "observed_states",
      "kind": "semantic_parameter",
      "parameter": "observed_states",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_states",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "one_or_more"
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
        "/distinct_reference_role_sets/1"
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
      "role": "state_regression_condition",
      "kind": "semantic_parameter",
      "parameter": "state_regression_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/9",
        "/distinct_reference_role_sets/1",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "state_regression_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observation_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "observations"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observation_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "baseline_state_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "baseline_state_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1,
        "maximum": 1
      }
    },
    {
      "role": "observed_state_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "observed_states"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_state_count",
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
          "start_boundary",
          "end_boundary"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "subject",
          "verification",
          "state_regression_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-observation-population",
        "comparison": "complete_population",
        "roles": [
          "observation_population",
          "observations"
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
        "pattern_id": "complete-baseline-state-population",
        "comparison": "complete_population",
        "roles": [
          "baseline_state_population",
          "baseline_states"
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
        "pattern_id": "complete-observed-state-population",
        "comparison": "complete_population",
        "roles": [
          "observed_state_population",
          "observed_states"
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
        "reference_role": "observations",
        "number_role": "observation_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "baseline_states",
        "number_role": "baseline_state_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "observed_states",
        "number_role": "observed_state_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "start-precedes-end",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "start_boundary",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "end_boundary"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "subject-has-baseline-state-at-start",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "subject",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "start_boundary"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "baseline-state-is-complete-member",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "baseline_state",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "start-before-each-observation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "start_boundary",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "each-observation-before-end",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "end_boundary"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "each-observation-reads-subject",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "subject"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "each-observation-records-baseline-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "observations",
          "member_role": "observation"
        },
        "proposition_template": {
          "subject_role": "observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "observed-states-equal-baseline-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_state_population",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "verification-reads-bounded-state-proof",
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
              "role": "subject"
            },
            {
              "kind": "reference",
              "role": "baseline_state"
            },
            {
              "kind": "reference",
              "role": "start_boundary"
            },
            {
              "kind": "reference",
              "role": "end_boundary"
            },
            {
              "kind": "reference",
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observations"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "bounded-state-stability-verification",
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
              "role": "observation_population"
            },
            {
              "kind": "reference",
              "role": "observed_state_population"
            },
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_state_population",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_regression_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "baseline_state_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-targets-bounded-state-stability",
        "role": "verifies",
        "source_claim_pattern_id": "bounded-state-stability-verification",
        "target_claim_pattern_id": "observed-states-equal-baseline-state"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-targets-bounded-state-stability",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "state_regression_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-observation-population"
          },
          {
            "pattern": "complete-baseline-state-population"
          },
          {
            "pattern": "complete-observed-state-population"
          },
          {
            "pattern": "start-precedes-end"
          },
          {
            "pattern": "subject-has-baseline-state-at-start"
          },
          {
            "pattern": "baseline-state-is-complete-member"
          },
          {
            "pattern": "start-before-each-observation"
          },
          {
            "pattern": "each-observation-before-end"
          },
          {
            "pattern": "each-observation-reads-subject"
          },
          {
            "pattern": "each-observation-records-baseline-state"
          },
          {
            "pattern": "observed-states-equal-baseline-state"
          },
          {
            "pattern": "verification-reads-bounded-state-proof"
          },
          {
            "pattern": "bounded-state-stability-verification"
          },
          {
            "pattern": "verification-targets-bounded-state-stability"
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
      "subject",
      "baseline_state",
      "start_boundary",
      "end_boundary",
      "baseline_state_population",
      "baseline_states",
      "observed_state_population",
      "observed_states",
      "verification",
      "state_regression_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "observation_population",
      "observations"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.lifecycle.bounded-state-stability.",
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
        "missing": "No named proof.lifecycle.bounded-state-stability constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.lifecycle.bounded-state-stability.",
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
