# proof.cancellation.isolation@4.0.0

<!-- Generated from validated package metadata. -->

Two distinct grounded generations are exercised by two distinct grounded attempts of one grounded operation before a grounded cancellation operation targets one generation; after its cancellation result establishes that generation's criterion-conforming cancelled state, the other generation's selected resource state and authority remain preserved and that other attempt later produces a successful result equal to its criterion-conforming expected state.

Profile digest: a9c6a53a8c9923d7959d44fba9c2c11ec858bb218a2bf43708df383597af2fc4. Parameter digest: 02a763c9fbef48325944af7ddd324ec897852ce0f639e1213ca062e0131d3d4d.

Admission digest: 62ed19a490fb9c0566e8d7a8920d42187004a01c672ca44e819503a132643117.

Roles: 31/31 accounted; 4 owned gaps. Semantic parameters: 27; internal roles: 4.

## Guarantee and exclusions

Two distinct grounded generations are exercised by two distinct grounded attempts of one grounded operation before a grounded cancellation operation targets one generation; after its cancellation result establishes that generation's criterion-conforming cancelled state, the other generation's selected resource state and authority remain preserved and that other attempt later produces a successful result equal to its criterion-conforming expected state.

- authority-beyond-selected-surviving-authority
- cancellation-propagation-outside-elected-generations
- concurrent-interleavings-and-linearizability
- delivered-evidence-authenticity
- identity-existence-beyond-grounding-kind
- pack-applicability
- resources-outside-selected-protected-resource
- subsequent-results-after-elected-success
- transient-interference-between-observations

## Parameters

### operation

Declare operation for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "operation",
        "allowed_type_terms": [
          "cc:command",
          "cc:operation"
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "cancelled-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "surviving-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation",
          "cancellation_operation"
        ]
      }
    }
  ]
}
```

### cancellation_operation

Declare cancellation operation for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cancellation_operation",
        "allowed_type_terms": [
          "cc:command",
          "cc:operation"
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
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "cancellation-request-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancelled_attempt",
              "surviving_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "operation",
          "cancellation_operation"
        ]
      }
    }
  ]
}
```

### cancelled_generation

Declare cancelled generation for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cancelled_generation",
        "allowed_type_terms": [
          "cc:lifecycle_entity",
          "cc:runtime_component"
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
        "pattern_id": "cancelled-attempt-targets-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "cancelled-generation-state-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_generation",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_observed_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "cancellation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            },
            {
              "kind": "reference",
              "role": "cancellation_request"
            },
            {
              "kind": "reference",
              "role": "cancellation_result"
            },
            {
              "kind": "reference",
              "role": "cancellation_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "cancellation-request-targets-cancelled-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancelled_attempt",
              "surviving_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "cancelled_generation",
          "surviving_generation"
        ]
      }
    }
  ]
}
```

### surviving_generation

Declare surviving generation for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "surviving_generation",
        "allowed_type_terms": [
          "cc:lifecycle_entity",
          "cc:runtime_component"
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
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "surviving-generation-uses-protected-resource-before-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_generation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "surviving-generation-uses-protected-resource-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_generation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "state-isolation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_isolation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "protected_resource"
            },
            {
              "kind": "reference",
              "role": "state_before_observation"
            },
            {
              "kind": "reference",
              "role": "state_after_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "authority-authorizes-surviving-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "authority-authorizes-surviving-generation-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "authority-isolation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_isolation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "surviving_authority"
            },
            {
              "kind": "reference",
              "role": "cancellation_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "surviving-attempt-targets-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/37",
      "value": {
        "pattern_id": "success-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "surviving_attempt"
            },
            {
              "kind": "reference",
              "role": "surviving_result"
            },
            {
              "kind": "reference",
              "role": "success_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "cancelled_generation",
          "surviving_generation"
        ]
      }
    }
  ]
}
```

### cancelled_attempt

Declare cancelled attempt for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cancelled_attempt",
        "allowed_type_terms": [
          "cc:event"
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
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "cancelled-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "cancelled-attempt-targets-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "cancelled-attempt-precedes-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "cancellation-request-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancelled_attempt",
              "surviving_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "cancellation-request-targets-cancelled-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancelled_attempt",
              "surviving_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "cancelled_attempt",
          "surviving_attempt"
        ]
      }
    }
  ]
}
```

### surviving_attempt

Declare surviving attempt for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "surviving_attempt",
        "allowed_type_terms": [
          "cc:event"
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
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "surviving-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "surviving-attempt-targets-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "surviving-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/37",
      "value": {
        "pattern_id": "success-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "surviving_attempt"
            },
            {
              "kind": "reference",
              "role": "surviving_result"
            },
            {
              "kind": "reference",
              "role": "success_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "surviving-attempt-uses-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "surviving-attempt-precedes-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "cancellation-request-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancelled_attempt",
              "surviving_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "cancellation-request-targets-cancelled-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancelled_attempt",
              "surviving_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "cancelled_attempt",
          "surviving_attempt"
        ]
      }
    }
  ]
}
```

### cancellation_request

Declare cancellation request for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cancellation_request",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "cancellation-result-accepts-request",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "cancellation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            },
            {
              "kind": "reference",
              "role": "cancellation_request"
            },
            {
              "kind": "reference",
              "role": "cancellation_result"
            },
            {
              "kind": "reference",
              "role": "cancellation_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "protected-resource-state-before-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_resource",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "surviving-generation-uses-protected-resource-before-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_generation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "state-before-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_before_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "authority-authorizes-surviving-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "surviving-authority-not-invalidated",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "cancellation_result",
          "operator": "reference:invalidates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "cancelled-attempt-precedes-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "surviving-attempt-precedes-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "cancellation-request-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancelled_attempt",
              "surviving_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "cancellation-request-targets-cancelled-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancelled_attempt",
              "surviving_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "cancellation-request-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "cancellation_request",
          "cancellation_result",
          "surviving_result"
        ]
      }
    }
  ]
}
```

### cancellation_result

Declare cancellation result for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cancellation_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "cancellation-result-accepts-request",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "cancelled-generation-state-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_generation",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_observed_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "cancellation-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_observed_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "cancelled-generation-reaches-cancelled-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_observed_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_expected_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "cancellation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            },
            {
              "kind": "reference",
              "role": "cancellation_request"
            },
            {
              "kind": "reference",
              "role": "cancellation_result"
            },
            {
              "kind": "reference",
              "role": "cancellation_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "cancellation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_result"
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
          "subject_role": "cancelled_observed_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cancellation_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_expected_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "protected-resource-state-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_resource",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "surviving-generation-uses-protected-resource-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_generation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "state-after-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_after_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "surviving-state-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "survivor_state_after",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "state-isolation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_isolation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "protected_resource"
            },
            {
              "kind": "reference",
              "role": "state_before_observation"
            },
            {
              "kind": "reference",
              "role": "state_after_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "surviving-authority-not-invalidated",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "cancellation_result",
          "operator": "reference:invalidates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "authority-authorizes-surviving-generation-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "authority-isolation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_isolation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "surviving_authority"
            },
            {
              "kind": "reference",
              "role": "cancellation_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "authority-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_isolation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
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
          "subject_role": "cancellation_result",
          "operator": "reference:invalidates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_interference_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "cancellation-result-precedes-surviving-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_result",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "surviving-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "surviving-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "cancellation-request-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "cancellation_request",
          "cancellation_result",
          "surviving_result"
        ]
      }
    }
  ]
}
```

### surviving_result

Declare surviving result for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "surviving_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "cancellation-result-precedes-surviving-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_result",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "surviving-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "surviving-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/35",
      "value": {
        "pattern_id": "success-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/36",
      "value": {
        "pattern_id": "surviving-result-matches-success-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_success_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/37",
      "value": {
        "pattern_id": "success-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "surviving_attempt"
            },
            {
              "kind": "reference",
              "role": "surviving_result"
            },
            {
              "kind": "reference",
              "role": "success_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/38",
      "value": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_result"
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
          "subject_role": "observed_success_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "survivor_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "cancellation_request",
          "cancellation_result",
          "surviving_result"
        ]
      }
    }
  ]
}
```

### protected_resource

Declare protected resource for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "protected_resource",
        "allowed_type_terms": [
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "protected-resource-state-before-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_resource",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "surviving-generation-uses-protected-resource-before-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_generation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "value": {
        "pattern_id": "protected-resource-state-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_resource",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "value": {
        "pattern_id": "surviving-generation-uses-protected-resource-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_generation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "state-isolation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_isolation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "protected_resource"
            },
            {
              "kind": "reference",
              "role": "state_before_observation"
            },
            {
              "kind": "reference",
              "role": "state_after_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "state-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_isolation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
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
          "subject_role": "survivor_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_interference_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    }
  ]
}
```

### surviving_authority

Declare surviving authority for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "surviving_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability",
          "cc:configuration"
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
      "ref": "/claim_patterns/26",
      "value": {
        "pattern_id": "authority-authorizes-surviving-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "surviving-authority-not-invalidated",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "cancellation_result",
          "operator": "reference:invalidates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "authority-authorizes-surviving-generation-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "authority-isolation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_isolation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "surviving_authority"
            },
            {
              "kind": "reference",
              "role": "cancellation_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "authority-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_isolation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
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
          "subject_role": "cancellation_result",
          "operator": "reference:invalidates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_interference_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "surviving-attempt-uses-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    }
  ]
}
```

### cancelled_expected_state

Declare cancelled expected state for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cancelled_expected_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "cancelled-state-conforms-to-criterion",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_expected_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_criterion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "cancelled-generation-reaches-cancelled-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_observed_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_expected_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "cancellation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_result"
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
          "subject_role": "cancelled_observed_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cancellation_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_expected_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "cancelled_expected_state",
          "cancelled_observed_state"
        ]
      }
    }
  ]
}
```

### cancelled_observed_state

Declare cancelled observed state for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cancelled_observed_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "cancelled-generation-state-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_generation",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_observed_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "cancellation-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_observed_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "cancelled-generation-reaches-cancelled-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_observed_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_expected_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "cancellation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_result"
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
          "subject_role": "cancelled_observed_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cancellation_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_expected_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "cancelled_expected_state",
          "cancelled_observed_state"
        ]
      }
    }
  ]
}
```

### survivor_state_before

Declare survivor state before for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "survivor_state_before",
        "allowed_type_terms": [
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
        "pattern_id": "protected-resource-state-before-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_resource",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "state-before-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_before_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "surviving-state-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "survivor_state_after",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "state-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_isolation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
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
          "subject_role": "survivor_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_interference_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "survivor_state_before",
          "survivor_state_after"
        ]
      }
    }
  ]
}
```

### survivor_state_after

Declare survivor state after for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "survivor_state_after",
        "allowed_type_terms": [
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
        "pattern_id": "protected-resource-state-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_resource",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "state-after-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_after_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "surviving-state-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "survivor_state_after",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "state-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_isolation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
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
          "subject_role": "survivor_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_interference_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "survivor_state_before",
          "survivor_state_after"
        ]
      }
    }
  ]
}
```

### expected_success_state

Declare expected success state for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "expected_success_state",
        "allowed_type_terms": [
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
        "pattern_id": "expected-success-state-conforms-to-criterion",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_success_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "success_criterion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/36",
      "value": {
        "pattern_id": "surviving-result-matches-success-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_success_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/38",
      "value": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_result"
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
          "subject_role": "observed_success_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "survivor_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "expected_success_state",
          "observed_success_state"
        ]
      }
    }
  ]
}
```

### observed_success_state

Declare observed success state for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "observed_success_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "surviving-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/35",
      "value": {
        "pattern_id": "success-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/36",
      "value": {
        "pattern_id": "surviving-result-matches-success-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_success_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/38",
      "value": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_result"
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
          "subject_role": "observed_success_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "survivor_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "expected_success_state",
          "observed_success_state"
        ]
      }
    }
  ]
}
```

### cancellation_verification

Declare cancellation verification for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cancellation_verification",
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "cancellation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            },
            {
              "kind": "reference",
              "role": "cancellation_request"
            },
            {
              "kind": "reference",
              "role": "cancellation_result"
            },
            {
              "kind": "reference",
              "role": "cancellation_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "cancellation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_result"
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
          "subject_role": "cancelled_observed_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cancellation_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_expected_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/8",
      "value": {
        "roles": [
          "cancellation_verification",
          "state_isolation_verification",
          "authority_isolation_verification",
          "success_verification"
        ]
      }
    }
  ]
}
```

### state_isolation_verification

Declare state isolation verification for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "state_isolation_verification",
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
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "state-isolation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_isolation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "protected_resource"
            },
            {
              "kind": "reference",
              "role": "state_before_observation"
            },
            {
              "kind": "reference",
              "role": "state_after_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "state-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_isolation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
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
          "subject_role": "survivor_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_interference_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/8",
      "value": {
        "roles": [
          "cancellation_verification",
          "state_isolation_verification",
          "authority_isolation_verification",
          "success_verification"
        ]
      }
    }
  ]
}
```

### authority_isolation_verification

Declare authority isolation verification for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authority_isolation_verification",
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
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "authority-isolation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_isolation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "surviving_authority"
            },
            {
              "kind": "reference",
              "role": "cancellation_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "value": {
        "pattern_id": "authority-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_isolation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
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
          "subject_role": "cancellation_result",
          "operator": "reference:invalidates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_interference_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/8",
      "value": {
        "roles": [
          "cancellation_verification",
          "state_isolation_verification",
          "authority_isolation_verification",
          "success_verification"
        ]
      }
    }
  ]
}
```

### success_verification

Declare success verification for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "success_verification",
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
      "ref": "/claim_patterns/37",
      "value": {
        "pattern_id": "success-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "surviving_attempt"
            },
            {
              "kind": "reference",
              "role": "surviving_result"
            },
            {
              "kind": "reference",
              "role": "success_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/38",
      "value": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_result"
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
          "subject_role": "observed_success_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "survivor_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/8",
      "value": {
        "roles": [
          "cancellation_verification",
          "state_isolation_verification",
          "authority_isolation_verification",
          "success_verification"
        ]
      }
    }
  ]
}
```

### cancellation_criterion

Declare cancellation criterion for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cancellation_criterion",
        "allowed_type_terms": [
          "cc:criterion",
          "cc:invariant"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "cancelled-state-conforms-to-criterion",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_expected_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_criterion"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/9",
      "value": {
        "roles": [
          "cancellation_criterion",
          "success_criterion"
        ]
      }
    }
  ]
}
```

### success_criterion

Declare success criterion for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "success_criterion",
        "allowed_type_terms": [
          "cc:criterion",
          "cc:invariant"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "expected-success-state-conforms-to-criterion",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_success_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "success_criterion"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/9",
      "value": {
        "roles": [
          "cancellation_criterion",
          "success_criterion"
        ]
      }
    }
  ]
}
```

### cancellation_failed_condition

Declare cancellation failed condition for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "cancellation_failed_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:invariant",
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
        "pattern_id": "cancellation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_result"
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
          "subject_role": "cancelled_observed_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cancellation_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_expected_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/10",
      "value": {
        "roles": [
          "cancellation_failed_condition",
          "state_interference_condition",
          "authority_interference_condition",
          "survivor_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-target-cancellation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "cancellation_failed_condition"
          ]
        }
      }
    }
  ]
}
```

### state_interference_condition

Declare state interference condition for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "state_interference_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:invariant",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "state-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_isolation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
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
          "subject_role": "survivor_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_interference_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/10",
      "value": {
        "roles": [
          "cancellation_failed_condition",
          "state_interference_condition",
          "authority_interference_condition",
          "survivor_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-target-state-isolation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "state_interference_condition"
          ]
        }
      }
    }
  ]
}
```

### authority_interference_condition

Declare authority interference condition for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "authority_interference_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:invariant",
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
        "pattern_id": "authority-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_isolation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
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
          "subject_role": "cancellation_result",
          "operator": "reference:invalidates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_interference_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/10",
      "value": {
        "roles": [
          "cancellation_failed_condition",
          "state_interference_condition",
          "authority_interference_condition",
          "survivor_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "verification-target-authority-isolation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "authority_interference_condition"
          ]
        }
      }
    }
  ]
}
```

### survivor_failure_condition

Declare survivor failure condition for proof.cancellation.isolation. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "survivor_failure_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:invariant",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/38",
      "value": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_result"
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
          "subject_role": "observed_success_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "survivor_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/10",
      "value": {
        "roles": [
          "cancellation_failed_condition",
          "state_interference_condition",
          "authority_interference_condition",
          "survivor_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "value": {
        "relation_pattern_id": "verification-target-surviving-success",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "survivor_failure_condition"
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
| operation | semantic_parameter | operation |  |
| cancellation_operation | semantic_parameter | cancellation_operation |  |
| cancelled_generation | semantic_parameter | cancelled_generation |  |
| surviving_generation | semantic_parameter | surviving_generation |  |
| cancelled_attempt | semantic_parameter | cancelled_attempt |  |
| surviving_attempt | semantic_parameter | surviving_attempt |  |
| cancellation_request | semantic_parameter | cancellation_request |  |
| cancellation_result | semantic_parameter | cancellation_result |  |
| surviving_result | semantic_parameter | surviving_result |  |
| protected_resource | semantic_parameter | protected_resource |  |
| surviving_authority | semantic_parameter | surviving_authority |  |
| cancelled_expected_state | semantic_parameter | cancelled_expected_state |  |
| cancelled_observed_state | semantic_parameter | cancelled_observed_state |  |
| survivor_state_before | semantic_parameter | survivor_state_before |  |
| survivor_state_after | semantic_parameter | survivor_state_after |  |
| expected_success_state | semantic_parameter | expected_success_state |  |
| observed_success_state | semantic_parameter | observed_success_state |  |
| cancellation_observation | observation_requirement |  | Acquire cancellation_observation for the exact subject, attempt and applicability in this profile. |
| state_before_observation | observation_requirement |  | Acquire state_before_observation for the exact subject, attempt and applicability in this profile. |
| state_after_observation | observation_requirement |  | Acquire state_after_observation for the exact subject, attempt and applicability in this profile. |
| success_observation | observation_requirement |  | Acquire success_observation for the exact subject, attempt and applicability in this profile. |
| cancellation_verification | semantic_parameter | cancellation_verification |  |
| state_isolation_verification | semantic_parameter | state_isolation_verification |  |
| authority_isolation_verification | semantic_parameter | authority_isolation_verification |  |
| success_verification | semantic_parameter | success_verification |  |
| cancellation_criterion | semantic_parameter | cancellation_criterion |  |
| success_criterion | semantic_parameter | success_criterion |  |
| cancellation_failed_condition | semantic_parameter | cancellation_failed_condition |  |
| state_interference_condition | semantic_parameter | state_interference_condition |  |
| authority_interference_condition | semantic_parameter | authority_interference_condition |  |
| survivor_failure_condition | semantic_parameter | survivor_failure_condition |  |

```json
{
  "roles": [
    {
      "role": "operation",
      "kind": "semantic_parameter",
      "parameter": "operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/2",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "operation",
        "allowed_type_terms": [
          "cc:command",
          "cc:operation"
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
      "role": "cancellation_operation",
      "kind": "semantic_parameter",
      "parameter": "cancellation_operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/7",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cancellation_operation",
        "allowed_type_terms": [
          "cc:command",
          "cc:operation"
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
      "role": "cancelled_generation",
      "kind": "semantic_parameter",
      "parameter": "cancelled_generation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/12",
        "/claim_patterns/15",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cancelled_generation",
        "allowed_type_terms": [
          "cc:lifecycle_entity",
          "cc:runtime_component"
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
      "role": "surviving_generation",
      "kind": "semantic_parameter",
      "parameter": "surviving_generation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/18",
        "/claim_patterns/21",
        "/claim_patterns/24",
        "/claim_patterns/26",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/claim_patterns/3",
        "/claim_patterns/37",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "surviving_generation",
        "allowed_type_terms": [
          "cc:lifecycle_entity",
          "cc:runtime_component"
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
      "role": "cancelled_attempt",
      "kind": "semantic_parameter",
      "parameter": "cancelled_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/5",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cancelled_attempt",
        "allowed_type_terms": [
          "cc:event"
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
      "role": "surviving_attempt",
      "kind": "semantic_parameter",
      "parameter": "surviving_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/32",
        "/claim_patterns/37",
        "/claim_patterns/4",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "surviving_attempt",
        "allowed_type_terms": [
          "cc:event"
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
      "role": "cancellation_request",
      "kind": "semantic_parameter",
      "parameter": "cancellation_request",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/15",
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/19",
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cancellation_request",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cancellation_result",
      "kind": "semantic_parameter",
      "parameter": "cancellation_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/20",
        "/claim_patterns/21",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/24",
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/claim_patterns/30",
        "/claim_patterns/31",
        "/claim_patterns/32",
        "/claim_patterns/34",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cancellation_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "surviving_result",
      "kind": "semantic_parameter",
      "parameter": "surviving_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/31",
        "/claim_patterns/32",
        "/claim_patterns/34",
        "/claim_patterns/35",
        "/claim_patterns/36",
        "/claim_patterns/37",
        "/claim_patterns/38",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "surviving_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "protected_resource",
      "kind": "semantic_parameter",
      "parameter": "protected_resource",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/claim_patterns/20",
        "/claim_patterns/21",
        "/claim_patterns/24",
        "/claim_patterns/25"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "protected_resource",
        "allowed_type_terms": [
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
      "role": "surviving_authority",
      "kind": "semantic_parameter",
      "parameter": "surviving_authority",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/26",
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/claim_patterns/30",
        "/claim_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "surviving_authority",
        "allowed_type_terms": [
          "cc:authority",
          "cc:capability",
          "cc:configuration"
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
      "role": "cancelled_expected_state",
      "kind": "semantic_parameter",
      "parameter": "cancelled_expected_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/14",
        "/claim_patterns/16",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cancelled_expected_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cancelled_observed_state",
      "kind": "semantic_parameter",
      "parameter": "cancelled_observed_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/16",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cancelled_observed_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "survivor_state_before",
      "kind": "semantic_parameter",
      "parameter": "survivor_state_before",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/claim_patterns/19",
        "/claim_patterns/23",
        "/claim_patterns/25",
        "/distinct_reference_role_sets/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "survivor_state_before",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "survivor_state_after",
      "kind": "semantic_parameter",
      "parameter": "survivor_state_after",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/25",
        "/distinct_reference_role_sets/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "survivor_state_after",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "expected_success_state",
      "kind": "semantic_parameter",
      "parameter": "expected_success_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/33",
        "/claim_patterns/36",
        "/claim_patterns/38",
        "/distinct_reference_role_sets/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "expected_success_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observed_success_state",
      "kind": "semantic_parameter",
      "parameter": "observed_success_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/34",
        "/claim_patterns/35",
        "/claim_patterns/36",
        "/claim_patterns/38",
        "/distinct_reference_role_sets/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_success_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cancellation_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/15",
        "/distinct_reference_role_sets/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire cancellation_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.cancellation.isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "cancellation_observation",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "state_before_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/claim_patterns/24",
        "/distinct_reference_role_sets/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire state_before_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.cancellation.isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "state_before_observation",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "state_after_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/22",
        "/claim_patterns/24",
        "/distinct_reference_role_sets/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire state_after_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.cancellation.isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "state_after_observation",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "success_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/35",
        "/claim_patterns/37",
        "/distinct_reference_role_sets/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire success_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.cancellation.isolation/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "success_observation",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cancellation_verification",
      "kind": "semantic_parameter",
      "parameter": "cancellation_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/distinct_reference_role_sets/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cancellation_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "state_isolation_verification",
      "kind": "semantic_parameter",
      "parameter": "state_isolation_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/distinct_reference_role_sets/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "state_isolation_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority_isolation_verification",
      "kind": "semantic_parameter",
      "parameter": "authority_isolation_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/29",
        "/claim_patterns/30",
        "/distinct_reference_role_sets/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_isolation_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "success_verification",
      "kind": "semantic_parameter",
      "parameter": "success_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/37",
        "/claim_patterns/38",
        "/distinct_reference_role_sets/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "success_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cancellation_criterion",
      "kind": "semantic_parameter",
      "parameter": "cancellation_criterion",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/distinct_reference_role_sets/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cancellation_criterion",
        "allowed_type_terms": [
          "cc:criterion",
          "cc:invariant"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "success_criterion",
      "kind": "semantic_parameter",
      "parameter": "success_criterion",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/33",
        "/distinct_reference_role_sets/9"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "success_criterion",
        "allowed_type_terms": [
          "cc:criterion",
          "cc:invariant"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "cancellation_failed_condition",
      "kind": "semantic_parameter",
      "parameter": "cancellation_failed_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/distinct_reference_role_sets/10",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "cancellation_failed_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:invariant",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "state_interference_condition",
      "kind": "semantic_parameter",
      "parameter": "state_interference_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/25",
        "/distinct_reference_role_sets/10",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "state_interference_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:invariant",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "authority_interference_condition",
      "kind": "semantic_parameter",
      "parameter": "authority_interference_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/30",
        "/distinct_reference_role_sets/10",
        "/falsifier_condition_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "authority_interference_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:invariant",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "survivor_failure_condition",
      "kind": "semantic_parameter",
      "parameter": "survivor_failure_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/38",
        "/distinct_reference_role_sets/10",
        "/falsifier_condition_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "survivor_failure_condition",
        "allowed_type_terms": [
          "cc:configuration",
          "cc:criterion",
          "cc:invariant",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "cancelled-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "cancelled-attempt-targets-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "surviving-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "surviving-attempt-targets-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "surviving-attempt-uses-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "cancelled-attempt-precedes-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "surviving-attempt-precedes-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "cancellation-request-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancelled_attempt",
              "surviving_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "cancellation-request-targets-cancelled-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancelled_attempt",
              "surviving_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "cancellation-request-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_request",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "cancellation-result-accepts-request",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_request"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "cancelled-state-conforms-to-criterion",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_expected_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_criterion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "cancelled-generation-state-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_generation",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_observed_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "cancellation-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_observed_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "cancelled-generation-reaches-cancelled-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancelled_observed_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_expected_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "cancellation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_generation"
            },
            {
              "kind": "reference",
              "role": "cancellation_request"
            },
            {
              "kind": "reference",
              "role": "cancellation_result"
            },
            {
              "kind": "reference",
              "role": "cancellation_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "cancellation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancellation_result"
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
          "subject_role": "cancelled_observed_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "cancellation_failed_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "cancelled_expected_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "protected-resource-state-before-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_resource",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "surviving-generation-uses-protected-resource-before-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_generation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "state-before-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_before_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "protected-resource-state-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "protected_resource",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "surviving-generation-uses-protected-resource-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_generation",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "state-after-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_after_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_after"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "surviving-state-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "survivor_state_after",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "constraint": {
        "pattern_id": "state-isolation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_isolation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "protected_resource"
            },
            {
              "kind": "reference",
              "role": "state_before_observation"
            },
            {
              "kind": "reference",
              "role": "state_after_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "constraint": {
        "pattern_id": "state-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "state_isolation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "protected_resource"
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
          "subject_role": "survivor_state_after",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "state_interference_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "survivor_state_before"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "constraint": {
        "pattern_id": "authority-authorizes-surviving-generation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "constraint": {
        "pattern_id": "surviving-authority-not-invalidated",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "cancellation_result",
          "operator": "reference:invalidates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_request"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "constraint": {
        "pattern_id": "authority-authorizes-surviving-generation-after-cancellation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "constraint": {
        "pattern_id": "authority-isolation-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_isolation_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "surviving_authority"
            },
            {
              "kind": "reference",
              "role": "cancellation_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "constraint": {
        "pattern_id": "authority-isolation-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "authority_isolation_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
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
          "subject_role": "cancellation_result",
          "operator": "reference:invalidates",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "authority_interference_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "constraint": {
        "pattern_id": "cancellation-result-precedes-surviving-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "cancellation_result",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "constraint": {
        "pattern_id": "surviving-result-accepts-attempt",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "constraint": {
        "pattern_id": "expected-success-state-conforms-to-criterion",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_success_state",
          "operator": "reference:conforms_to",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "success_criterion"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "constraint": {
        "pattern_id": "surviving-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "surviving_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "cancellation_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/35",
      "constraint": {
        "pattern_id": "success-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/36",
      "constraint": {
        "pattern_id": "surviving-result-matches-success-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_success_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/37",
      "constraint": {
        "pattern_id": "success-verification-reads-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "surviving_result"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_generation"
            },
            {
              "kind": "reference",
              "role": "surviving_attempt"
            },
            {
              "kind": "reference",
              "role": "surviving_result"
            },
            {
              "kind": "reference",
              "role": "success_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/38",
      "constraint": {
        "pattern_id": "success-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "success_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "surviving_result"
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
          "subject_role": "observed_success_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "survivor_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_success_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-cancellation",
        "role": "verifies",
        "source_claim_pattern_id": "cancellation-verification",
        "target_claim_pattern_id": "cancelled-generation-reaches-cancelled-state"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-target-state-isolation",
        "role": "verifies",
        "source_claim_pattern_id": "state-isolation-verification",
        "target_claim_pattern_id": "surviving-state-preserved"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "verification-target-authority-isolation",
        "role": "verifies",
        "source_claim_pattern_id": "authority-isolation-verification",
        "target_claim_pattern_id": "surviving-authority-not-invalidated"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "verification-target-surviving-success",
        "role": "verifies",
        "source_claim_pattern_id": "success-verification",
        "target_claim_pattern_id": "surviving-result-matches-success-state"
      }
    },
    {
      "ref": "/collection_patterns/0",
      "constraint": {
        "pattern_id": "proof-population",
        "collection_kind": "closed_set",
        "match_mode": "exact",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "proof_cancellation_isolation_population",
        "member_claim_pattern_ids": [
          "cancelled-attempt-performs-operation",
          "cancelled-attempt-targets-generation",
          "surviving-attempt-performs-operation",
          "surviving-attempt-targets-generation",
          "surviving-attempt-uses-authority",
          "cancelled-attempt-precedes-cancellation",
          "surviving-attempt-precedes-cancellation",
          "cancellation-request-performs-operation",
          "cancellation-request-targets-cancelled-generation",
          "cancellation-request-precedes-result",
          "cancellation-result-accepts-request",
          "cancelled-state-conforms-to-criterion",
          "cancelled-generation-state-after-cancellation",
          "cancellation-observation-records-state",
          "cancelled-generation-reaches-cancelled-state",
          "cancellation-verification-reads-subjects",
          "cancellation-verification",
          "protected-resource-state-before-cancellation",
          "surviving-generation-uses-protected-resource-before-cancellation",
          "state-before-observation-records-state",
          "protected-resource-state-after-cancellation",
          "surviving-generation-uses-protected-resource-after-cancellation",
          "state-after-observation-records-state",
          "surviving-state-preserved",
          "state-isolation-verification-reads-subjects",
          "state-isolation-verification",
          "authority-authorizes-surviving-generation",
          "surviving-authority-not-invalidated",
          "authority-authorizes-surviving-generation-after-cancellation",
          "authority-isolation-verification-reads-subjects",
          "authority-isolation-verification",
          "cancellation-result-precedes-surviving-result",
          "surviving-result-accepts-attempt",
          "expected-success-state-conforms-to-criterion",
          "surviving-result-state",
          "success-observation-records-state",
          "surviving-result-matches-success-state",
          "success-verification-reads-subjects",
          "success-verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "operation",
          "cancellation_operation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "cancelled_generation",
          "surviving_generation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "cancelled_attempt",
          "surviving_attempt"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "cancellation_request",
          "cancellation_result",
          "surviving_result"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "constraint": {
        "roles": [
          "cancelled_expected_state",
          "cancelled_observed_state"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "constraint": {
        "roles": [
          "survivor_state_before",
          "survivor_state_after"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "constraint": {
        "roles": [
          "expected_success_state",
          "observed_success_state"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/7",
      "constraint": {
        "roles": [
          "cancellation_observation",
          "state_before_observation",
          "state_after_observation",
          "success_observation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/8",
      "constraint": {
        "roles": [
          "cancellation_verification",
          "state_isolation_verification",
          "authority_isolation_verification",
          "success_verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/9",
      "constraint": {
        "roles": [
          "cancellation_criterion",
          "success_criterion"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/10",
      "constraint": {
        "roles": [
          "cancellation_failed_condition",
          "state_interference_condition",
          "authority_interference_condition",
          "survivor_failure_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-cancellation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "cancellation_failed_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-target-state-isolation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "state_interference_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "verification-target-authority-isolation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "authority_interference_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "verification-target-surviving-success",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "survivor_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "cancelled-attempt-performs-operation"
          },
          {
            "pattern": "cancelled-attempt-targets-generation"
          },
          {
            "pattern": "surviving-attempt-performs-operation"
          },
          {
            "pattern": "surviving-attempt-targets-generation"
          },
          {
            "pattern": "surviving-attempt-uses-authority"
          },
          {
            "pattern": "cancelled-attempt-precedes-cancellation"
          },
          {
            "pattern": "surviving-attempt-precedes-cancellation"
          },
          {
            "pattern": "cancellation-request-performs-operation"
          },
          {
            "pattern": "cancellation-request-targets-cancelled-generation"
          },
          {
            "pattern": "cancellation-request-precedes-result"
          },
          {
            "pattern": "cancellation-result-accepts-request"
          },
          {
            "pattern": "cancelled-state-conforms-to-criterion"
          },
          {
            "pattern": "cancelled-generation-state-after-cancellation"
          },
          {
            "pattern": "cancellation-observation-records-state"
          },
          {
            "pattern": "cancelled-generation-reaches-cancelled-state"
          },
          {
            "pattern": "cancellation-verification-reads-subjects"
          },
          {
            "pattern": "cancellation-verification"
          },
          {
            "pattern": "protected-resource-state-before-cancellation"
          },
          {
            "pattern": "surviving-generation-uses-protected-resource-before-cancellation"
          },
          {
            "pattern": "state-before-observation-records-state"
          },
          {
            "pattern": "protected-resource-state-after-cancellation"
          },
          {
            "pattern": "surviving-generation-uses-protected-resource-after-cancellation"
          },
          {
            "pattern": "state-after-observation-records-state"
          },
          {
            "pattern": "surviving-state-preserved"
          },
          {
            "pattern": "state-isolation-verification-reads-subjects"
          },
          {
            "pattern": "state-isolation-verification"
          },
          {
            "pattern": "authority-authorizes-surviving-generation"
          },
          {
            "pattern": "surviving-authority-not-invalidated"
          },
          {
            "pattern": "authority-authorizes-surviving-generation-after-cancellation"
          },
          {
            "pattern": "authority-isolation-verification-reads-subjects"
          },
          {
            "pattern": "authority-isolation-verification"
          },
          {
            "pattern": "cancellation-result-precedes-surviving-result"
          },
          {
            "pattern": "surviving-result-accepts-attempt"
          },
          {
            "pattern": "expected-success-state-conforms-to-criterion"
          },
          {
            "pattern": "surviving-result-state"
          },
          {
            "pattern": "success-observation-records-state"
          },
          {
            "pattern": "surviving-result-matches-success-state"
          },
          {
            "pattern": "success-verification-reads-subjects"
          },
          {
            "pattern": "success-verification"
          },
          {
            "pattern": "verification-target-cancellation"
          },
          {
            "pattern": "verification-target-state-isolation"
          },
          {
            "pattern": "verification-target-authority-isolation"
          },
          {
            "pattern": "verification-target-surviving-success"
          },
          {
            "pattern": "proof-population"
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
      "operation",
      "cancellation_operation",
      "cancelled_generation",
      "surviving_generation",
      "cancelled_attempt",
      "surviving_attempt",
      "cancellation_request",
      "cancellation_result",
      "surviving_result",
      "protected_resource",
      "surviving_authority",
      "cancelled_expected_state",
      "cancelled_observed_state",
      "survivor_state_before",
      "survivor_state_after",
      "expected_success_state",
      "observed_success_state",
      "cancellation_verification",
      "state_isolation_verification",
      "authority_isolation_verification",
      "success_verification",
      "cancellation_criterion",
      "success_criterion",
      "cancellation_failed_condition",
      "state_interference_condition",
      "authority_interference_condition",
      "survivor_failure_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "cancellation_observation",
      "state_before_observation",
      "state_after_observation",
      "success_observation"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.cancellation.isolation.",
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
        "missing": "No named proof.cancellation.isolation constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.cancellation.isolation.",
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
