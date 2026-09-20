# proof.readiness.before-success@4.0.0

<!-- Generated from validated package metadata. -->

One grounded capability initialized by one attempt is exercised by a distinct readiness operation after initialization; the readiness result accepts the probe and its observed complete state equals a criterion-conforming expected ready state; and the declared completion report does not precede that readiness result.

Profile digest: 37b911f302572e3a5382c888dfc01d316afa2c5aa1f8ff90e6368fdf352a0fe0. Parameter digest: b8c96e54d244d21692f3d9d8ed7219642f62135fa9a8d05088f30cc82e911116.

Admission digest: c08f9aa2da1dc5ccc3780d89b3e744b0f8f1cb3cd4f9e064fada915894f7273f.

Roles: 15/15 accounted; 1 owned gaps. Semantic parameters: 14; internal roles: 1.

## Guarantee and exclusions

One grounded capability initialized by one attempt is exercised by a distinct readiness operation after initialization; the readiness result accepts the probe and its observed complete state equals a criterion-conforming expected ready state; and the declared completion report does not precede that readiness result.

- concurrent-readiness-transitions
- continued-usability-after-completion
- identity-existence-beyond-kind
- initialization-failure-cleanup
- pack-applicability
- readiness-operation-completeness
- regression-after-successful-probe

## Parameters

### initialization_operation

Declare initialization operation for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "initialization_operation",
        "allowed_type_terms": [
          "cc:command",
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
        "pattern_id": "initialization-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "initialization_operation",
          "readiness_operation"
        ]
      }
    }
  ]
}
```

### readiness_operation

Declare readiness operation for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "readiness_operation",
        "allowed_type_terms": [
          "cc:command",
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
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "readiness-probe-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_probe",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "initialization_operation",
          "readiness_operation"
        ]
      }
    }
  ]
}
```

### capability

Declare capability for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "capability",
        "allowed_type_terms": [
          "cc:capability",
          "cc:resource",
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
        "pattern_id": "initialization-attempt-targets-capability",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "state-verification-reads-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_state_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            },
            {
              "kind": "reference",
              "role": "readiness_probe"
            },
            {
              "kind": "reference",
              "role": "readiness_result"
            },
            {
              "kind": "reference",
              "role": "readiness_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "readiness-probe-targets-capability",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_probe",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            }
          ]
        }
      }
    }
  ]
}
```

### initialization_attempt

Declare initialization attempt for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "initialization_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "initialization-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "initialization-attempt-targets-capability",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "order-verification-reads-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_order_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_attempt"
            },
            {
              "kind": "reference",
              "role": "readiness_probe"
            },
            {
              "kind": "reference",
              "role": "readiness_result"
            },
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "initialization-precedes-readiness-probe",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_probe"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "readiness-probe-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_probe",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "readiness-probe-targets-capability",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_probe",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "completion-report-completes-initialization",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "completion_report",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "initialization-precedes-completion-report",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "initialization_attempt",
          "readiness_probe",
          "readiness_result"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "initialization_attempt",
          "readiness_probe",
          "completion_report"
        ]
      }
    }
  ]
}
```

### readiness_probe

Declare readiness probe for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "readiness_probe",
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
        "pattern_id": "readiness-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "readiness-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "state-verification-reads-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_state_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            },
            {
              "kind": "reference",
              "role": "readiness_probe"
            },
            {
              "kind": "reference",
              "role": "readiness_result"
            },
            {
              "kind": "reference",
              "role": "readiness_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "readiness-result-matches-expected-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_ready_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "order-verification-reads-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_order_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_attempt"
            },
            {
              "kind": "reference",
              "role": "readiness_probe"
            },
            {
              "kind": "reference",
              "role": "readiness_result"
            },
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "initialization-precedes-readiness-probe",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_probe"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "readiness-probe-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_probe",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "readiness-probe-targets-capability",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_probe",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "readiness-result-accepts-probe",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_probe"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "readiness-probe-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_probe",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "initialization_attempt",
          "readiness_probe",
          "readiness_result"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "initialization_attempt",
          "readiness_probe",
          "completion_report"
        ]
      }
    }
  ]
}
```

### readiness_result

Declare readiness result for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "readiness_result",
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
        "pattern_id": "readiness-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "state-verification-reads-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_state_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            },
            {
              "kind": "reference",
              "role": "readiness_probe"
            },
            {
              "kind": "reference",
              "role": "readiness_result"
            },
            {
              "kind": "reference",
              "role": "readiness_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "readiness-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "proposition_template": {
          "subject_role": "readiness_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_ready_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "not_ready_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "completion-does-not-precede-readiness-result",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "completion_report",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "order-verification-reads-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_order_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_attempt"
            },
            {
              "kind": "reference",
              "role": "readiness_probe"
            },
            {
              "kind": "reference",
              "role": "readiness_result"
            },
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "readiness-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "proposition_template": {
          "subject_role": "readiness_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "completion_report",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_completion_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "readiness-result-accepts-probe",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_probe"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "readiness-probe-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_probe",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "initialization_attempt",
          "readiness_probe",
          "readiness_result"
        ]
      }
    }
  ]
}
```

### completion_report

Declare completion report for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "completion_report",
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
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "completion-does-not-precede-readiness-result",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "completion_report",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "order-verification-reads-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_order_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_attempt"
            },
            {
              "kind": "reference",
              "role": "readiness_probe"
            },
            {
              "kind": "reference",
              "role": "readiness_result"
            },
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "readiness-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "proposition_template": {
          "subject_role": "readiness_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "completion_report",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_completion_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "completion-report-completes-initialization",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "completion_report",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "initialization-precedes-completion-report",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "value": {
        "roles": [
          "initialization_attempt",
          "readiness_probe",
          "completion_report"
        ]
      }
    }
  ]
}
```

### expected_ready_state

Declare expected ready state for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "expected_ready_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "readiness-result-matches-expected-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_ready_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "readiness-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "proposition_template": {
          "subject_role": "readiness_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_ready_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "not_ready_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "expected-ready-state-conforms-to-criterion",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_ready_state",
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
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "expected_ready_state",
          "observed_ready_state"
        ]
      }
    }
  ]
}
```

### observed_ready_state

Declare observed ready state for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "observed_ready_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "readiness-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "readiness-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "readiness-result-matches-expected-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_ready_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "readiness-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "proposition_template": {
          "subject_role": "readiness_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_ready_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "not_ready_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "expected_ready_state",
          "observed_ready_state"
        ]
      }
    }
  ]
}
```

### readiness_state_verification

Declare readiness state verification for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "readiness_state_verification",
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
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "state-verification-reads-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_state_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            },
            {
              "kind": "reference",
              "role": "readiness_probe"
            },
            {
              "kind": "reference",
              "role": "readiness_result"
            },
            {
              "kind": "reference",
              "role": "readiness_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "readiness-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "proposition_template": {
          "subject_role": "readiness_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_ready_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "not_ready_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "readiness_state_verification",
          "readiness_order_verification"
        ]
      }
    }
  ]
}
```

### readiness_order_verification

Declare readiness order verification for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "readiness_order_verification",
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
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "order-verification-reads-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_order_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_attempt"
            },
            {
              "kind": "reference",
              "role": "readiness_probe"
            },
            {
              "kind": "reference",
              "role": "readiness_result"
            },
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "readiness-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "proposition_template": {
          "subject_role": "readiness_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "completion_report",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_completion_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "readiness_state_verification",
          "readiness_order_verification"
        ]
      }
    }
  ]
}
```

### success_criterion

Declare success criterion for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "expected-ready-state-conforms-to-criterion",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_ready_state",
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
    }
  ]
}
```

### not_ready_condition

Declare not ready condition for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "not_ready_condition",
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
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "readiness-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "proposition_template": {
          "subject_role": "readiness_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_ready_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "not_ready_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "not_ready_condition",
          "premature_completion_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "verification-target-ready-state",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "not_ready_condition"
          ]
        }
      }
    }
  ]
}
```

### premature_completion_condition

Declare premature completion condition for proof.readiness.before-success. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "premature_completion_condition",
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
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "readiness-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "proposition_template": {
          "subject_role": "readiness_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "completion_report",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_completion_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "value": {
        "roles": [
          "not_ready_condition",
          "premature_completion_condition"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "verification-target-readiness-order",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "premature_completion_condition"
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
| initialization_operation | semantic_parameter | initialization_operation |  |
| readiness_operation | semantic_parameter | readiness_operation |  |
| capability | semantic_parameter | capability |  |
| initialization_attempt | semantic_parameter | initialization_attempt |  |
| readiness_probe | semantic_parameter | readiness_probe |  |
| readiness_result | semantic_parameter | readiness_result |  |
| completion_report | semantic_parameter | completion_report |  |
| expected_ready_state | semantic_parameter | expected_ready_state |  |
| observed_ready_state | semantic_parameter | observed_ready_state |  |
| readiness_observation | observation_requirement |  | Acquire readiness_observation for the exact subject, attempt and applicability in this profile. |
| readiness_state_verification | semantic_parameter | readiness_state_verification |  |
| readiness_order_verification | semantic_parameter | readiness_order_verification |  |
| success_criterion | semantic_parameter | success_criterion |  |
| not_ready_condition | semantic_parameter | not_ready_condition |  |
| premature_completion_condition | semantic_parameter | premature_completion_condition |  |

```json
{
  "roles": [
    {
      "role": "initialization_operation",
      "kind": "semantic_parameter",
      "parameter": "initialization_operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "initialization_operation",
        "allowed_type_terms": [
          "cc:command",
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
      "role": "readiness_operation",
      "kind": "semantic_parameter",
      "parameter": "readiness_operation",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/3",
        "/distinct_reference_role_sets/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "readiness_operation",
        "allowed_type_terms": [
          "cc:command",
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
      "role": "capability",
      "kind": "semantic_parameter",
      "parameter": "capability",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/12",
        "/claim_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "capability",
        "allowed_type_terms": [
          "cc:capability",
          "cc:resource",
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
      "role": "initialization_attempt",
      "kind": "semantic_parameter",
      "parameter": "initialization_attempt",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/16",
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/1",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "initialization_attempt",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "readiness_probe",
      "kind": "semantic_parameter",
      "parameter": "readiness_probe",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/claim_patterns/13",
        "/claim_patterns/16",
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/1",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "readiness_probe",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "readiness_result",
      "kind": "semantic_parameter",
      "parameter": "readiness_result",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/12",
        "/claim_patterns/14",
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/5",
        "/claim_patterns/6",
        "/distinct_reference_role_sets/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "readiness_result",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "completion_report",
      "kind": "semantic_parameter",
      "parameter": "completion_report",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/distinct_reference_role_sets/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "completion_report",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "expected_ready_state",
      "kind": "semantic_parameter",
      "parameter": "expected_ready_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/claim_patterns/9",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "expected_ready_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "observed_ready_state",
      "kind": "semantic_parameter",
      "parameter": "observed_ready_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/distinct_reference_role_sets/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "observed_ready_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "readiness_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/12"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire readiness_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.readiness.before-success/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "readiness_observation",
        "allowed_type_terms": [
          "cc:artifact",
          "cc:evidence"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "readiness_state_verification",
      "kind": "semantic_parameter",
      "parameter": "readiness_state_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/12",
        "/claim_patterns/14",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "readiness_state_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "readiness_order_verification",
      "kind": "semantic_parameter",
      "parameter": "readiness_order_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/16",
        "/claim_patterns/17",
        "/distinct_reference_role_sets/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "readiness_order_verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
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
        "/claim_patterns/9"
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
      "role": "not_ready_condition",
      "kind": "semantic_parameter",
      "parameter": "not_ready_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/14",
        "/distinct_reference_role_sets/5",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "not_ready_condition",
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
      "role": "premature_completion_condition",
      "kind": "semantic_parameter",
      "parameter": "premature_completion_condition",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/distinct_reference_role_sets/5",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "premature_completion_condition",
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
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "initialization_operation",
          "readiness_operation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "initialization_attempt",
          "readiness_probe",
          "readiness_result"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "initialization_attempt",
          "readiness_probe",
          "completion_report"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "expected_ready_state",
          "observed_ready_state"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "constraint": {
        "roles": [
          "readiness_state_verification",
          "readiness_order_verification"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "constraint": {
        "roles": [
          "not_ready_condition",
          "premature_completion_condition"
        ]
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "initialization-attempt-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "initialization-attempt-targets-capability",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "initialization-precedes-readiness-probe",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_probe"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "readiness-probe-performs-operation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_probe",
          "operator": "reference:performs",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_operation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "readiness-probe-targets-capability",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_probe",
          "operator": "reference:targets",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "readiness-result-accepts-probe",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_result",
          "operator": "reference:accepts",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_probe"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "readiness-probe-precedes-result",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_probe",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "completion-report-completes-initialization",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "completion_report",
          "operator": "reference:completes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "initialization-precedes-completion-report",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "initialization_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "expected-ready-state-conforms-to-criterion",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "expected_ready_state",
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
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "readiness-result-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_result",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "readiness-observation-records-state",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "observed_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "state-verification-reads-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_state_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "capability"
            },
            {
              "kind": "reference",
              "role": "readiness_probe"
            },
            {
              "kind": "reference",
              "role": "readiness_result"
            },
            {
              "kind": "reference",
              "role": "readiness_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "readiness-result-matches-expected-state",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "observed_ready_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "readiness_probe"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "readiness-state-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "proposition_template": {
          "subject_role": "readiness_state_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "observed_ready_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "not_ready_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "expected_ready_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "completion-does-not-precede-readiness-result",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "proposition_template": {
          "subject_role": "completion_report",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "order-verification-reads-proof-subjects",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "readiness_order_verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "initialization_attempt"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "initialization_attempt"
            },
            {
              "kind": "reference",
              "role": "readiness_probe"
            },
            {
              "kind": "reference",
              "role": "readiness_result"
            },
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "readiness-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "verification_methods": [
          "analysis",
          "audit",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "proposition_template": {
          "subject_role": "readiness_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "completion_report"
            }
          ]
        },
        "falsifying_proposition_template": {
          "subject_role": "completion_report",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "premature_completion_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "readiness_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-ready-state",
        "role": "verifies",
        "source_claim_pattern_id": "readiness-state-verification",
        "target_claim_pattern_id": "readiness-result-matches-expected-state"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "verification-target-readiness-order",
        "role": "verifies",
        "source_claim_pattern_id": "readiness-order-verification",
        "target_claim_pattern_id": "completion-does-not-precede-readiness-result"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-ready-state",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "not_ready_condition"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "verification-target-readiness-order",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "premature_completion_condition"
          ]
        }
      }
    },
    {
      "ref": "/collection_patterns/0",
      "constraint": {
        "pattern_id": "proof-population",
        "collection_kind": "closed_set",
        "match_mode": "exact",
        "candidate_quantifier": "all_covering",
        "collection_purpose": "proof_readiness_before_success_population",
        "member_claim_pattern_ids": [
          "initialization-attempt-performs-operation",
          "initialization-attempt-targets-capability",
          "initialization-precedes-readiness-probe",
          "readiness-probe-performs-operation",
          "readiness-probe-targets-capability",
          "readiness-result-accepts-probe",
          "readiness-probe-precedes-result",
          "completion-report-completes-initialization",
          "initialization-precedes-completion-report",
          "expected-ready-state-conforms-to-criterion",
          "readiness-result-state",
          "readiness-observation-records-state",
          "state-verification-reads-proof-subjects",
          "readiness-result-matches-expected-state",
          "readiness-state-verification",
          "completion-does-not-precede-readiness-result",
          "order-verification-reads-proof-subjects",
          "readiness-order-verification"
        ]
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "initialization-attempt-performs-operation"
          },
          {
            "pattern": "initialization-attempt-targets-capability"
          },
          {
            "pattern": "initialization-precedes-readiness-probe"
          },
          {
            "pattern": "readiness-probe-performs-operation"
          },
          {
            "pattern": "readiness-probe-targets-capability"
          },
          {
            "pattern": "readiness-result-accepts-probe"
          },
          {
            "pattern": "readiness-probe-precedes-result"
          },
          {
            "pattern": "completion-report-completes-initialization"
          },
          {
            "pattern": "initialization-precedes-completion-report"
          },
          {
            "pattern": "expected-ready-state-conforms-to-criterion"
          },
          {
            "pattern": "readiness-result-state"
          },
          {
            "pattern": "readiness-observation-records-state"
          },
          {
            "pattern": "state-verification-reads-proof-subjects"
          },
          {
            "pattern": "readiness-result-matches-expected-state"
          },
          {
            "pattern": "readiness-state-verification"
          },
          {
            "pattern": "verification-target-ready-state"
          },
          {
            "pattern": "completion-does-not-precede-readiness-result"
          },
          {
            "pattern": "order-verification-reads-proof-subjects"
          },
          {
            "pattern": "readiness-order-verification"
          },
          {
            "pattern": "verification-target-readiness-order"
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
      "initialization_operation",
      "readiness_operation",
      "capability",
      "initialization_attempt",
      "readiness_probe",
      "readiness_result",
      "completion_report",
      "expected_ready_state",
      "observed_ready_state",
      "readiness_state_verification",
      "readiness_order_verification",
      "success_criterion",
      "not_ready_condition",
      "premature_completion_condition"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "readiness_observation"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.readiness.before-success.",
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
        "missing": "No named proof.readiness.before-success constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.readiness.before-success.",
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
