# proof.ownership.fenced-handoff@4.0.0

<!-- Generated from validated package metadata. -->

For one declared resource and fence, complete declared predecessor attempt and effect populations precede the fence under one predecessor authority and epoch; successor activation and complete declared successor attempt and effect populations follow the fence under one distinct successor authority and epoch; every complete declared post-fence predecessor attempt is refused and writes or mutates no declared protected resource; the complete post-fence predecessor protected-effect and dual-active observation populations are empty; and distinct observations ordered around the fence record the corresponding predecessor and successor authority, epoch, and resource.

Profile digest: 3368966e7361114d579e71715061bd9111b3a81b31e6fe605df4f5e4ee818d25. Parameter digest: 5a53b2bf17fdc5cc660746eac2c0dc5fb099e6c4a00f06958d0974a35999e650.

Admission digest: 3fe0e51f478be2a51315e187e27ac606da7b6617adb73af80d1c786c71e48da9.

Roles: 42/42 accounted; 6 owned gaps. Semantic parameters: 28; internal roles: 14.

## Guarantee and exclusions

For one declared resource and fence, complete declared predecessor attempt and effect populations precede the fence under one predecessor authority and epoch; successor activation and complete declared successor attempt and effect populations follow the fence under one distinct successor authority and epoch; every complete declared post-fence predecessor attempt is refused and writes or mutates no declared protected resource; the complete post-fence predecessor protected-effect and dual-active observation populations are empty; and distinct observations ordered around the fence record the corresponding predecessor and successor authority, epoch, and resource.

- delivered-evidence-authenticity-or-plan-implementation
- dishonest-authority-epoch-resource-fence-attempt-effect-and-observation-grounding
- distributed-clock-agreement-or-a-total-order-beyond-the-declared-graph
- liveness-eventual-takeover-or-bounded-handoff-duration
- repeated-nested-or-unbounded-ownership-histories
- runtime-events-actors-resources-and-effects-outside-declared-populations
- wall-clock-or-real-time-truth

## Parameters

### resource

Declare resource for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "resource",
        "allowed_type_terms": [
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-no-mutation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "each-successor-post-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_post_fence_attempts",
          "member_role": "successor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "successor_post_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "each-predecessor-effect-uses-authority-epoch-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_effects",
          "member_role": "predecessor_effect"
        },
        "proposition_template": {
          "subject_role": "predecessor_effect",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "each-successor-effect-uses-authority-epoch-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_effects",
          "member_role": "successor_effect"
        },
        "proposition_template": {
          "subject_role": "successor_effect",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "predecessor-authorizes-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "predecessor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "pre-fence-observation-records-active-side",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "pre_fence_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "post-fence-observation-records-active-side",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "predecessor-effects-before-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "successor-activation-and-effects-after-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "successor-authorizes-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "successor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "predecessor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "successor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            },
            {
              "kind": "reference",
              "role": "successor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "successor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "post-fence-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_post_fence_attempt_population"
            },
            {
              "kind": "reference",
              "role": "post_fence_predecessor_protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "post_fence_predecessor_protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "dual-active-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "dual_active_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "active_authority_observation_population"
            },
            {
              "kind": "reference",
              "role": "dual_active_observation_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "dual_active_observation_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "dual_active_observation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "each-predecessor-pre-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_pre_fence_attempts",
          "member_role": "predecessor_pre_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_pre_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-no-write",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "predecessor-order-verification-target",
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "resource",
            "predecessor_authority",
            "predecessor_epoch",
            "fence_event"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "successor-order-verification-target",
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "resource",
            "successor_authority",
            "successor_epoch",
            "fence_event"
          ]
        }
      }
    }
  ]
}
```

### predecessor_authority

Declare predecessor authority for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "predecessor_authority",
        "allowed_type_terms": [
          "cc:authority"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "predecessor-authority-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "each-predecessor-effect-uses-authority-epoch-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_effects",
          "member_role": "predecessor_effect"
        },
        "proposition_template": {
          "subject_role": "predecessor_effect",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "predecessor-authorizes-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "predecessor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "pre-fence-observation-records-active-side",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "pre_fence_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "predecessor-effects-before-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "predecessor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "post-fence-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_post_fence_attempt_population"
            },
            {
              "kind": "reference",
              "role": "post_fence_predecessor_protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "post_fence_predecessor_protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "dual-active-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "dual_active_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "active_authority_observation_population"
            },
            {
              "kind": "reference",
              "role": "dual_active_observation_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "dual_active_observation_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "dual_active_observation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "each-predecessor-pre-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_pre_fence_attempts",
          "member_role": "predecessor_pre_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_pre_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "predecessor_authority",
          "successor_authority"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "predecessor-order-verification-target",
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "resource",
            "predecessor_authority",
            "predecessor_epoch",
            "fence_event"
          ]
        }
      }
    }
  ]
}
```

### successor_authority

Declare successor authority for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "successor_authority",
        "allowed_type_terms": [
          "cc:authority"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "successor-authority-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "each-successor-post-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_post_fence_attempts",
          "member_role": "successor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "successor_post_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "successor-activation-starts-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_activation_event",
          "operator": "reference:starts",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "successor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "each-successor-effect-uses-authority-epoch-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_effects",
          "member_role": "successor_effect"
        },
        "proposition_template": {
          "subject_role": "successor_effect",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "post-fence-observation-records-active-side",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "successor-activation-and-effects-after-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "successor-authorizes-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "successor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "successor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            },
            {
              "kind": "reference",
              "role": "successor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "successor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "dual-active-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "dual_active_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "active_authority_observation_population"
            },
            {
              "kind": "reference",
              "role": "dual_active_observation_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "dual_active_observation_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "dual_active_observation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "predecessor_authority",
          "successor_authority"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "successor-order-verification-target",
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "resource",
            "successor_authority",
            "successor_epoch",
            "fence_event"
          ]
        }
      }
    }
  ]
}
```

### predecessor_epoch

Declare predecessor epoch for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "predecessor_epoch",
        "allowed_type_terms": [
          "cc:state",
          "cc:configuration"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "predecessor-authority-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "each-predecessor-effect-uses-authority-epoch-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_effects",
          "member_role": "predecessor_effect"
        },
        "proposition_template": {
          "subject_role": "predecessor_effect",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "value": {
        "pattern_id": "predecessor-authorizes-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "predecessor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "value": {
        "pattern_id": "pre-fence-observation-records-active-side",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "pre_fence_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "predecessor-effects-before-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "predecessor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "post-fence-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_post_fence_attempt_population"
            },
            {
              "kind": "reference",
              "role": "post_fence_predecessor_protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "post_fence_predecessor_protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "each-predecessor-pre-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_pre_fence_attempts",
          "member_role": "predecessor_pre_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_pre_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "predecessor_epoch",
          "successor_epoch"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "predecessor-order-verification-target",
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "resource",
            "predecessor_authority",
            "predecessor_epoch",
            "fence_event"
          ]
        }
      }
    }
  ]
}
```

### successor_epoch

Declare successor epoch for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "successor_epoch",
        "allowed_type_terms": [
          "cc:state",
          "cc:configuration"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "successor-authority-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "each-successor-post-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_post_fence_attempts",
          "member_role": "successor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "successor_post_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "successor-activation-starts-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_activation_event",
          "operator": "reference:starts",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "successor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "each-successor-effect-uses-authority-epoch-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_effects",
          "member_role": "successor_effect"
        },
        "proposition_template": {
          "subject_role": "successor_effect",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "value": {
        "pattern_id": "post-fence-observation-records-active-side",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "successor-activation-and-effects-after-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "value": {
        "pattern_id": "successor-authorizes-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "successor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "successor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            },
            {
              "kind": "reference",
              "role": "successor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "successor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "value": {
        "roles": [
          "predecessor_epoch",
          "successor_epoch"
        ]
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "successor-order-verification-target",
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "resource",
            "successor_authority",
            "successor_epoch",
            "fence_event"
          ]
        }
      }
    }
  ]
}
```

### fence_event

Declare fence event for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "fence_event",
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
        "pattern_id": "predecessor-authority-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "successor-authority-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-no-mutation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "each-successor-post-fence-attempt-after-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_post_fence_attempts",
          "member_role": "successor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_post_fence_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "each-predecessor-effect-before-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_effects",
          "member_role": "predecessor_effect"
        },
        "proposition_template": {
          "subject_role": "predecessor_effect",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fence_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "value": {
        "pattern_id": "fence-precedes-successor-activation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "each-successor-effect-after-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_effects",
          "member_role": "successor_effect"
        },
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "post-fence-predecessor-effects-subset",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "value": {
        "pattern_id": "pre-fence-observation-before-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "pre_fence_observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fence_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "value": {
        "pattern_id": "post-fence-observation-after-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "post_fence_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "predecessor-effects-before-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "value": {
        "pattern_id": "successor-activation-and-effects-after-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "post-fence-predecessor-protected-effects-zero",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "post_fence_predecessor_protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "predecessor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "successor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            },
            {
              "kind": "reference",
              "role": "successor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "successor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "post-fence-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_post_fence_attempt_population"
            },
            {
              "kind": "reference",
              "role": "post_fence_predecessor_protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "post_fence_predecessor_protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "dual-active-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "dual_active_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "active_authority_observation_population"
            },
            {
              "kind": "reference",
              "role": "dual_active_observation_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "dual_active_observation_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "dual_active_observation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-predecessor-pre-fence-attempt-before-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_pre_fence_attempts",
          "member_role": "predecessor_pre_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_pre_fence_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fence_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-after-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_post_fence_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-refused",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refused_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-no-write",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "value": {
        "relation_pattern_id": "predecessor-order-verification-target",
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "resource",
            "predecessor_authority",
            "predecessor_epoch",
            "fence_event"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "value": {
        "relation_pattern_id": "successor-order-verification-target",
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "resource",
            "successor_authority",
            "successor_epoch",
            "fence_event"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "value": {
        "relation_pattern_id": "post-fence-refusal-verification-target",
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "fence_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-post-fence-predecessor-protected-effect-population",
        "comparison": "complete_population",
        "roles": [
          "post_fence_predecessor_protected_effect_population",
          "post_fence_predecessor_protected_effects"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "fence_event"
          ]
        }
      }
    }
  ]
}
```

### successor_activation_event

Declare successor activation event for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "successor_activation_event",
        "allowed_type_terms": [
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
        "pattern_id": "fence-precedes-successor-activation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "value": {
        "pattern_id": "successor-activation-starts-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_activation_event",
          "operator": "reference:starts",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "successor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "successor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            },
            {
              "kind": "reference",
              "role": "successor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "successor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    }
  ]
}
```

### predecessor_pre_fence_attempt_population

Declare predecessor pre fence attempt population for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "predecessor_pre_fence_attempt_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "predecessor_pre_fence_attempt_population",
          "predecessor_post_fence_attempt_population",
          "successor_post_fence_attempt_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-predecessor-pre-fence-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "predecessor_pre_fence_attempt_population",
          "predecessor_pre_fence_attempts"
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

### predecessor_pre_fence_attempts

Declare predecessor pre fence attempts for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "predecessor_pre_fence_attempts",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/4",
      "value": {
        "pattern_id": "each-predecessor-pre-fence-attempt-before-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_pre_fence_attempts",
          "member_role": "predecessor_pre_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_pre_fence_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fence_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "value": {
        "pattern_id": "each-predecessor-pre-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_pre_fence_attempts",
          "member_role": "predecessor_pre_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_pre_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "value": {
        "pattern_id": "complete-predecessor-pre-fence-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "predecessor_pre_fence_attempt_population",
          "predecessor_pre_fence_attempts"
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
        "reference_role": "predecessor_pre_fence_attempts",
        "number_role": "predecessor_pre_fence_attempt_count"
      }
    }
  ]
}
```

### predecessor_post_fence_attempt_population

Declare predecessor post fence attempt population for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "predecessor_post_fence_attempt_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "post-fence-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_post_fence_attempt_population"
            },
            {
              "kind": "reference",
              "role": "post_fence_predecessor_protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "post_fence_predecessor_protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "predecessor_pre_fence_attempt_population",
          "predecessor_post_fence_attempt_population",
          "successor_post_fence_attempt_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-predecessor-post-fence-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "predecessor_post_fence_attempt_population",
          "predecessor_post_fence_attempts"
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

### predecessor_post_fence_attempts

Declare predecessor post fence attempts for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "predecessor_post_fence_attempts",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/10",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-no-mutation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-after-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_post_fence_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-refused",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refused_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-no-write",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/1",
      "value": {
        "pattern_id": "complete-predecessor-post-fence-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "predecessor_post_fence_attempt_population",
          "predecessor_post_fence_attempts"
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
        "reference_role": "predecessor_post_fence_attempts",
        "number_role": "predecessor_post_fence_attempt_count"
      }
    }
  ]
}
```

### successor_post_fence_attempt_population

Declare successor post fence attempt population for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "successor_post_fence_attempt_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/3",
      "value": {
        "roles": [
          "predecessor_pre_fence_attempt_population",
          "predecessor_post_fence_attempt_population",
          "successor_post_fence_attempt_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-successor-post-fence-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "successor_post_fence_attempt_population",
          "successor_post_fence_attempts"
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

### successor_post_fence_attempts

Declare successor post fence attempts for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "successor_post_fence_attempts",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/11",
      "value": {
        "pattern_id": "each-successor-post-fence-attempt-after-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_post_fence_attempts",
          "member_role": "successor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_post_fence_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "value": {
        "pattern_id": "each-successor-post-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_post_fence_attempts",
          "member_role": "successor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "successor_post_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/2",
      "value": {
        "pattern_id": "complete-successor-post-fence-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "successor_post_fence_attempt_population",
          "successor_post_fence_attempts"
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
        "reference_role": "successor_post_fence_attempts",
        "number_role": "successor_post_fence_attempt_count"
      }
    }
  ]
}
```

### predecessor_effect_population

Declare predecessor effect population for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "predecessor_effect_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "post-fence-predecessor-effects-subset",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "predecessor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "predecessor_effect_population",
          "successor_effect_population",
          "post_fence_predecessor_protected_effect_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-predecessor-effect-population",
        "comparison": "complete_population",
        "roles": [
          "predecessor_effect_population",
          "predecessor_effects"
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

### predecessor_effects

Declare predecessor effects for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "predecessor_effects",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/13",
      "value": {
        "pattern_id": "each-predecessor-effect-before-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_effects",
          "member_role": "predecessor_effect"
        },
        "proposition_template": {
          "subject_role": "predecessor_effect",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fence_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "value": {
        "pattern_id": "each-predecessor-effect-uses-authority-epoch-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_effects",
          "member_role": "predecessor_effect"
        },
        "proposition_template": {
          "subject_role": "predecessor_effect",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/3",
      "value": {
        "pattern_id": "complete-predecessor-effect-population",
        "comparison": "complete_population",
        "roles": [
          "predecessor_effect_population",
          "predecessor_effects"
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
        "reference_role": "predecessor_effects",
        "number_role": "predecessor_effect_count"
      }
    }
  ]
}
```

### successor_effect_population

Declare successor effect population for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "successor_effect_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "successor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            },
            {
              "kind": "reference",
              "role": "successor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "successor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "predecessor_effect_population",
          "successor_effect_population",
          "post_fence_predecessor_protected_effect_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-successor-effect-population",
        "comparison": "complete_population",
        "roles": [
          "successor_effect_population",
          "successor_effects"
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

### successor_effects

Declare successor effects for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "successor_effects",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "cardinality": "one_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/17",
      "value": {
        "pattern_id": "each-successor-effect-after-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_effects",
          "member_role": "successor_effect"
        },
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "value": {
        "pattern_id": "each-successor-effect-uses-authority-epoch-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_effects",
          "member_role": "successor_effect"
        },
        "proposition_template": {
          "subject_role": "successor_effect",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/4",
      "value": {
        "pattern_id": "complete-successor-effect-population",
        "comparison": "complete_population",
        "roles": [
          "successor_effect_population",
          "successor_effects"
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
        "reference_role": "successor_effects",
        "number_role": "successor_effect_count"
      }
    }
  ]
}
```

### post_fence_predecessor_protected_effect_population

Declare post fence predecessor protected effect population for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "post_fence_predecessor_protected_effect_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/19",
      "value": {
        "pattern_id": "post-fence-predecessor-effects-subset",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "value": {
        "pattern_id": "post-fence-predecessor-protected-effects-zero",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "post_fence_predecessor_protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "post-fence-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_post_fence_attempt_population"
            },
            {
              "kind": "reference",
              "role": "post_fence_predecessor_protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "post_fence_predecessor_protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "value": {
        "roles": [
          "predecessor_effect_population",
          "successor_effect_population",
          "post_fence_predecessor_protected_effect_population"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-post-fence-predecessor-protected-effect-population",
        "comparison": "complete_population",
        "roles": [
          "post_fence_predecessor_protected_effect_population",
          "post_fence_predecessor_protected_effects"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "fence_event"
          ]
        }
      }
    }
  ]
}
```

### post_fence_predecessor_protected_effects

Declare post fence predecessor protected effects for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "post_fence_predecessor_protected_effects",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "cardinality": "zero_or_more"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/reference_binding_patterns/5",
      "value": {
        "pattern_id": "complete-post-fence-predecessor-protected-effect-population",
        "comparison": "complete_population",
        "roles": [
          "post_fence_predecessor_protected_effect_population",
          "post_fence_predecessor_protected_effects"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "fence_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "value": {
        "reference_role": "post_fence_predecessor_protected_effects",
        "number_role": "post_fence_predecessor_protected_effect_count"
      }
    }
  ]
}
```

### refused_state

Declare refused state for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "refused_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/8",
      "value": {
        "pattern_id": "each-predecessor-post-fence-attempt-refused",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refused_state"
            }
          ]
        }
      }
    }
  ]
}
```

### predecessor_effect_window_state

Declare predecessor effect window state for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "predecessor_effect_window_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "predecessor-effects-before-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "predecessor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    }
  ]
}
```

### before_fence_state

Declare before fence state for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "before_fence_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/27",
      "value": {
        "pattern_id": "predecessor-effects-before-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "predecessor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    }
  ]
}
```

### successor_effect_window_state

Declare successor effect window state for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "successor_effect_window_state",
        "allowed_type_terms": [
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
        "pattern_id": "successor-activation-and-effects-after-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "successor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            },
            {
              "kind": "reference",
              "role": "successor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "successor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    }
  ]
}
```

### after_fence_state

Declare after fence state for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "after_fence_state",
        "allowed_type_terms": [
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
        "pattern_id": "successor-activation-and-effects-after-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "successor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            },
            {
              "kind": "reference",
              "role": "successor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "successor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    }
  ]
}
```

### predecessor_order_verification

Declare predecessor order verification for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "predecessor_order_verification",
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
      "ref": "/claim_patterns/31",
      "value": {
        "pattern_id": "predecessor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "predecessor_order_verification",
          "successor_order_verification",
          "post_fence_refusal_verification",
          "dual_active_verification"
        ]
      }
    }
  ]
}
```

### successor_order_verification

Declare successor order verification for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "successor_order_verification",
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
      "ref": "/claim_patterns/32",
      "value": {
        "pattern_id": "successor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            },
            {
              "kind": "reference",
              "role": "successor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "successor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "predecessor_order_verification",
          "successor_order_verification",
          "post_fence_refusal_verification",
          "dual_active_verification"
        ]
      }
    }
  ]
}
```

### post_fence_refusal_verification

Declare post fence refusal verification for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "post_fence_refusal_verification",
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
      "ref": "/claim_patterns/33",
      "value": {
        "pattern_id": "post-fence-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_post_fence_attempt_population"
            },
            {
              "kind": "reference",
              "role": "post_fence_predecessor_protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "post_fence_predecessor_protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "predecessor_order_verification",
          "successor_order_verification",
          "post_fence_refusal_verification",
          "dual_active_verification"
        ]
      }
    }
  ]
}
```

### dual_active_verification

Declare dual active verification for proof.ownership.fenced-handoff. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

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
        "role": "dual_active_verification",
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
      "ref": "/claim_patterns/34",
      "value": {
        "pattern_id": "dual-active-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "dual_active_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "active_authority_observation_population"
            },
            {
              "kind": "reference",
              "role": "dual_active_observation_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "dual_active_observation_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "dual_active_observation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "value": {
        "roles": [
          "predecessor_order_verification",
          "successor_order_verification",
          "post_fence_refusal_verification",
          "dual_active_verification"
        ]
      }
    }
  ]
}
```

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |
| resource | semantic_parameter | resource |  |
| predecessor_authority | semantic_parameter | predecessor_authority |  |
| successor_authority | semantic_parameter | successor_authority |  |
| predecessor_epoch | semantic_parameter | predecessor_epoch |  |
| successor_epoch | semantic_parameter | successor_epoch |  |
| fence_event | semantic_parameter | fence_event |  |
| successor_activation_event | semantic_parameter | successor_activation_event |  |
| predecessor_pre_fence_attempt_population | semantic_parameter | predecessor_pre_fence_attempt_population |  |
| predecessor_pre_fence_attempts | semantic_parameter | predecessor_pre_fence_attempts |  |
| predecessor_post_fence_attempt_population | semantic_parameter | predecessor_post_fence_attempt_population |  |
| predecessor_post_fence_attempts | semantic_parameter | predecessor_post_fence_attempts |  |
| successor_post_fence_attempt_population | semantic_parameter | successor_post_fence_attempt_population |  |
| successor_post_fence_attempts | semantic_parameter | successor_post_fence_attempts |  |
| predecessor_effect_population | semantic_parameter | predecessor_effect_population |  |
| predecessor_effects | semantic_parameter | predecessor_effects |  |
| successor_effect_population | semantic_parameter | successor_effect_population |  |
| successor_effects | semantic_parameter | successor_effects |  |
| post_fence_predecessor_protected_effect_population | semantic_parameter | post_fence_predecessor_protected_effect_population |  |
| post_fence_predecessor_protected_effects | semantic_parameter | post_fence_predecessor_protected_effects |  |
| active_authority_observation_population | observation_requirement |  | Acquire active_authority_observation_population for the exact subject, attempt and applicability in this profile. |
| active_authority_observations | observation_requirement |  | Acquire active_authority_observations for the exact subject, attempt and applicability in this profile. |
| dual_active_observation_population | observation_requirement |  | Acquire dual_active_observation_population for the exact subject, attempt and applicability in this profile. |
| dual_active_observations | observation_requirement |  | Acquire dual_active_observations for the exact subject, attempt and applicability in this profile. |
| pre_fence_observation | observation_requirement |  | Acquire pre_fence_observation for the exact subject, attempt and applicability in this profile. |
| post_fence_observation | observation_requirement |  | Acquire post_fence_observation for the exact subject, attempt and applicability in this profile. |
| refused_state | semantic_parameter | refused_state |  |
| predecessor_effect_window_state | semantic_parameter | predecessor_effect_window_state |  |
| before_fence_state | semantic_parameter | before_fence_state |  |
| successor_effect_window_state | semantic_parameter | successor_effect_window_state |  |
| after_fence_state | semantic_parameter | after_fence_state |  |
| predecessor_order_verification | semantic_parameter | predecessor_order_verification |  |
| successor_order_verification | semantic_parameter | successor_order_verification |  |
| post_fence_refusal_verification | semantic_parameter | post_fence_refusal_verification |  |
| dual_active_verification | semantic_parameter | dual_active_verification |  |
| predecessor_pre_fence_attempt_count | complete_population_count | predecessor_pre_fence_attempts |  |
| predecessor_post_fence_attempt_count | complete_population_count | predecessor_post_fence_attempts |  |
| successor_post_fence_attempt_count | complete_population_count | successor_post_fence_attempts |  |
| predecessor_effect_count | complete_population_count | predecessor_effects |  |
| successor_effect_count | complete_population_count | successor_effects |  |
| post_fence_predecessor_protected_effect_count | definition_constant |  |  |
| active_authority_observation_count | complete_population_count | active_authority_observations |  |
| dual_active_observation_count | definition_constant |  |  |

```json
{
  "roles": [
    {
      "role": "resource",
      "kind": "semantic_parameter",
      "parameter": "resource",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/12",
        "/claim_patterns/14",
        "/claim_patterns/18",
        "/claim_patterns/2",
        "/claim_patterns/24",
        "/claim_patterns/25",
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/claim_patterns/3",
        "/claim_patterns/31",
        "/claim_patterns/32",
        "/claim_patterns/33",
        "/claim_patterns/34",
        "/claim_patterns/5",
        "/claim_patterns/7",
        "/claim_patterns/9",
        "/falsifier_condition_bindings/0",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "resource",
        "allowed_type_terms": [
          "cc:resource"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "predecessor_authority",
      "kind": "semantic_parameter",
      "parameter": "predecessor_authority",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/14",
        "/claim_patterns/2",
        "/claim_patterns/24",
        "/claim_patterns/27",
        "/claim_patterns/31",
        "/claim_patterns/33",
        "/claim_patterns/34",
        "/claim_patterns/5",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/0",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_authority",
        "allowed_type_terms": [
          "cc:authority"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "successor_authority",
      "kind": "semantic_parameter",
      "parameter": "successor_authority",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/12",
        "/claim_patterns/16",
        "/claim_patterns/18",
        "/claim_patterns/25",
        "/claim_patterns/28",
        "/claim_patterns/3",
        "/claim_patterns/32",
        "/claim_patterns/34",
        "/distinct_reference_role_sets/0",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "successor_authority",
        "allowed_type_terms": [
          "cc:authority"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "predecessor_epoch",
      "kind": "semantic_parameter",
      "parameter": "predecessor_epoch",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/14",
        "/claim_patterns/2",
        "/claim_patterns/24",
        "/claim_patterns/27",
        "/claim_patterns/31",
        "/claim_patterns/33",
        "/claim_patterns/5",
        "/claim_patterns/7",
        "/distinct_reference_role_sets/1",
        "/falsifier_condition_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_epoch",
        "allowed_type_terms": [
          "cc:state",
          "cc:configuration"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "successor_epoch",
      "kind": "semantic_parameter",
      "parameter": "successor_epoch",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/12",
        "/claim_patterns/16",
        "/claim_patterns/18",
        "/claim_patterns/25",
        "/claim_patterns/28",
        "/claim_patterns/3",
        "/claim_patterns/32",
        "/distinct_reference_role_sets/1",
        "/falsifier_condition_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "successor_epoch",
        "allowed_type_terms": [
          "cc:state",
          "cc:configuration"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "fence_event",
      "kind": "semantic_parameter",
      "parameter": "fence_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/claim_patterns/10",
        "/claim_patterns/11",
        "/claim_patterns/13",
        "/claim_patterns/15",
        "/claim_patterns/17",
        "/claim_patterns/19",
        "/claim_patterns/22",
        "/claim_patterns/23",
        "/claim_patterns/27",
        "/claim_patterns/28",
        "/claim_patterns/29",
        "/claim_patterns/31",
        "/claim_patterns/32",
        "/claim_patterns/33",
        "/claim_patterns/34",
        "/claim_patterns/4",
        "/claim_patterns/6",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/falsifier_condition_bindings/0",
        "/falsifier_condition_bindings/1",
        "/falsifier_condition_bindings/2",
        "/reference_binding_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "fence_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "successor_activation_event",
      "kind": "semantic_parameter",
      "parameter": "successor_activation_event",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/15",
        "/claim_patterns/16",
        "/claim_patterns/32"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "successor_activation_event",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "predecessor_pre_fence_attempt_population",
      "kind": "semantic_parameter",
      "parameter": "predecessor_pre_fence_attempt_population",
      "inputs": [],
      "rule_refs": [
        "/distinct_reference_role_sets/3",
        "/reference_binding_patterns/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_pre_fence_attempt_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "predecessor_pre_fence_attempts",
      "kind": "semantic_parameter",
      "parameter": "predecessor_pre_fence_attempts",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_pre_fence_attempts",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "predecessor_post_fence_attempt_population",
      "kind": "semantic_parameter",
      "parameter": "predecessor_post_fence_attempt_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/33",
        "/distinct_reference_role_sets/3",
        "/reference_binding_patterns/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_post_fence_attempt_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "predecessor_post_fence_attempts",
      "kind": "semantic_parameter",
      "parameter": "predecessor_post_fence_attempts",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/10",
        "/claim_patterns/6",
        "/claim_patterns/7",
        "/claim_patterns/8",
        "/claim_patterns/9",
        "/reference_binding_patterns/1",
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_post_fence_attempts",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "successor_post_fence_attempt_population",
      "kind": "semantic_parameter",
      "parameter": "successor_post_fence_attempt_population",
      "inputs": [],
      "rule_refs": [
        "/distinct_reference_role_sets/3",
        "/reference_binding_patterns/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "successor_post_fence_attempt_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "successor_post_fence_attempts",
      "kind": "semantic_parameter",
      "parameter": "successor_post_fence_attempts",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/11",
        "/claim_patterns/12",
        "/reference_binding_patterns/2",
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "successor_post_fence_attempts",
        "allowed_type_terms": [
          "cc:event"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "predecessor_effect_population",
      "kind": "semantic_parameter",
      "parameter": "predecessor_effect_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/claim_patterns/31",
        "/distinct_reference_role_sets/4",
        "/reference_binding_patterns/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_effect_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "predecessor_effects",
      "kind": "semantic_parameter",
      "parameter": "predecessor_effects",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/13",
        "/claim_patterns/14",
        "/reference_binding_patterns/3",
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_effects",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "successor_effect_population",
      "kind": "semantic_parameter",
      "parameter": "successor_effect_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/32",
        "/distinct_reference_role_sets/4",
        "/reference_binding_patterns/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "successor_effect_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "successor_effects",
      "kind": "semantic_parameter",
      "parameter": "successor_effects",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/17",
        "/claim_patterns/18",
        "/reference_binding_patterns/4",
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "successor_effects",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "post_fence_predecessor_protected_effect_population",
      "kind": "semantic_parameter",
      "parameter": "post_fence_predecessor_protected_effect_population",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/19",
        "/claim_patterns/29",
        "/claim_patterns/33",
        "/distinct_reference_role_sets/4",
        "/reference_binding_patterns/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "post_fence_predecessor_protected_effect_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "post_fence_predecessor_protected_effects",
      "kind": "semantic_parameter",
      "parameter": "post_fence_predecessor_protected_effects",
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/5",
        "/reference_role_count_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "post_fence_predecessor_protected_effects",
        "allowed_type_terms": [
          "cc:event",
          "cc:artifact"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "active_authority_observation_population",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/claim_patterns/21",
        "/claim_patterns/34",
        "/distinct_reference_role_sets/5",
        "/reference_binding_patterns/6"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire active_authority_observation_population for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ownership.fenced-handoff/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "active_authority_observation_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "active_authority_observations",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/26",
        "/reference_binding_patterns/6",
        "/reference_role_count_bindings/6"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire active_authority_observations for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ownership.fenced-handoff/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "active_authority_observations",
        "allowed_type_terms": [
          "cc:evidence",
          "cc:event"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "dual_active_observation_population",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/26",
        "/claim_patterns/30",
        "/claim_patterns/34",
        "/distinct_reference_role_sets/5",
        "/reference_binding_patterns/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire dual_active_observation_population for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ownership.fenced-handoff/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "dual_active_observation_population",
        "allowed_type_terms": [
          "cc:scope"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "dual_active_observations",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_binding_patterns/7",
        "/reference_role_count_bindings/7"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire dual_active_observations for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ownership.fenced-handoff/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "dual_active_observations",
        "allowed_type_terms": [
          "cc:evidence",
          "cc:event"
        ],
        "cardinality": "zero_or_more"
      }
    },
    {
      "role": "pre_fence_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/20",
        "/claim_patterns/22",
        "/claim_patterns/24",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire pre_fence_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ownership.fenced-handoff/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "pre_fence_observation",
        "allowed_type_terms": [
          "cc:evidence",
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "post_fence_observation",
      "kind": "observation_requirement",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/21",
        "/claim_patterns/23",
        "/claim_patterns/25",
        "/distinct_reference_role_sets/2"
      ],
      "capability": "observation",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "Acquire post_fence_observation for the exact subject, attempt and applicability in this profile.",
        "source": "profiles/proof.ownership.fenced-handoff/4.0.0/profile.json",
        "consequence": "A reference or expected assertion cannot stand in for the required observation."
      },
      "refinement": {
        "role": "post_fence_observation",
        "allowed_type_terms": [
          "cc:evidence",
          "cc:event"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "refused_state",
      "kind": "semantic_parameter",
      "parameter": "refused_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/8"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "refused_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "predecessor_effect_window_state",
      "kind": "semantic_parameter",
      "parameter": "predecessor_effect_window_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/27",
        "/claim_patterns/31"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_effect_window_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "before_fence_state",
      "kind": "semantic_parameter",
      "parameter": "before_fence_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/27",
        "/claim_patterns/31"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "before_fence_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "successor_effect_window_state",
      "kind": "semantic_parameter",
      "parameter": "successor_effect_window_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/28",
        "/claim_patterns/32"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "successor_effect_window_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "after_fence_state",
      "kind": "semantic_parameter",
      "parameter": "after_fence_state",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/28",
        "/claim_patterns/32"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "after_fence_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "predecessor_order_verification",
      "kind": "semantic_parameter",
      "parameter": "predecessor_order_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/31",
        "/distinct_reference_role_sets/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_order_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "successor_order_verification",
      "kind": "semantic_parameter",
      "parameter": "successor_order_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/32",
        "/distinct_reference_role_sets/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "successor_order_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "post_fence_refusal_verification",
      "kind": "semantic_parameter",
      "parameter": "post_fence_refusal_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/33",
        "/distinct_reference_role_sets/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "post_fence_refusal_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "dual_active_verification",
      "kind": "semantic_parameter",
      "parameter": "dual_active_verification",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/34",
        "/distinct_reference_role_sets/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "dual_active_verification",
        "allowed_type_terms": [
          "cc:test",
          "cc:process"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "predecessor_pre_fence_attempt_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "predecessor_pre_fence_attempts"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/0"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_pre_fence_attempt_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "predecessor_post_fence_attempt_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "predecessor_post_fence_attempts"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/1"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_post_fence_attempt_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "successor_post_fence_attempt_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "successor_post_fence_attempts"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/2"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "successor_post_fence_attempt_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "predecessor_effect_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "predecessor_effects"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/3"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "predecessor_effect_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "successor_effect_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "successor_effects"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/4"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "successor_effect_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    },
    {
      "role": "post_fence_predecessor_protected_effect_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/29",
        "/claim_patterns/33",
        "/reference_role_count_bindings/5"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "post_fence_predecessor_protected_effect_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0,
        "maximum": 0
      }
    },
    {
      "role": "active_authority_observation_count",
      "kind": "complete_population_count",
      "parameter": null,
      "inputs": [
        "active_authority_observations"
      ],
      "rule_refs": [
        "/reference_role_count_bindings/6"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "active_authority_observation_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 2
      }
    },
    {
      "role": "dual_active_observation_count",
      "kind": "definition_constant",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/30",
        "/claim_patterns/34",
        "/reference_role_count_bindings/7"
      ],
      "capability": null,
      "gap": null,
      "refinement": {
        "role": "dual_active_observation_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 0,
        "maximum": 0
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "predecessor_authority",
          "successor_authority"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/1",
      "constraint": {
        "roles": [
          "predecessor_epoch",
          "successor_epoch"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/2",
      "constraint": {
        "roles": [
          "pre_fence_observation",
          "post_fence_observation"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/3",
      "constraint": {
        "roles": [
          "predecessor_pre_fence_attempt_population",
          "predecessor_post_fence_attempt_population",
          "successor_post_fence_attempt_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/4",
      "constraint": {
        "roles": [
          "predecessor_effect_population",
          "successor_effect_population",
          "post_fence_predecessor_protected_effect_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/5",
      "constraint": {
        "roles": [
          "active_authority_observation_population",
          "dual_active_observation_population"
        ]
      }
    },
    {
      "ref": "/distinct_reference_role_sets/6",
      "constraint": {
        "roles": [
          "predecessor_order_verification",
          "successor_order_verification",
          "post_fence_refusal_verification",
          "dual_active_verification"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-predecessor-pre-fence-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "predecessor_pre_fence_attempt_population",
          "predecessor_pre_fence_attempts"
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
        "pattern_id": "complete-predecessor-post-fence-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "predecessor_post_fence_attempt_population",
          "predecessor_post_fence_attempts"
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
        "pattern_id": "complete-successor-post-fence-attempt-population",
        "comparison": "complete_population",
        "roles": [
          "successor_post_fence_attempt_population",
          "successor_post_fence_attempts"
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
        "pattern_id": "complete-predecessor-effect-population",
        "comparison": "complete_population",
        "roles": [
          "predecessor_effect_population",
          "predecessor_effects"
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
        "pattern_id": "complete-successor-effect-population",
        "comparison": "complete_population",
        "roles": [
          "successor_effect_population",
          "successor_effects"
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
        "pattern_id": "complete-post-fence-predecessor-protected-effect-population",
        "comparison": "complete_population",
        "roles": [
          "post_fence_predecessor_protected_effect_population",
          "post_fence_predecessor_protected_effects"
        ],
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "fence_event"
          ]
        }
      }
    },
    {
      "ref": "/reference_binding_patterns/6",
      "constraint": {
        "pattern_id": "complete-active-authority-observation-population",
        "comparison": "complete_population",
        "roles": [
          "active_authority_observation_population",
          "active_authority_observations"
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
        "pattern_id": "complete-dual-active-observation-population",
        "comparison": "complete_population",
        "roles": [
          "dual_active_observation_population",
          "dual_active_observations"
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
        "reference_role": "predecessor_pre_fence_attempts",
        "number_role": "predecessor_pre_fence_attempt_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/1",
      "constraint": {
        "reference_role": "predecessor_post_fence_attempts",
        "number_role": "predecessor_post_fence_attempt_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/2",
      "constraint": {
        "reference_role": "successor_post_fence_attempts",
        "number_role": "successor_post_fence_attempt_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/3",
      "constraint": {
        "reference_role": "predecessor_effects",
        "number_role": "predecessor_effect_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/4",
      "constraint": {
        "reference_role": "successor_effects",
        "number_role": "successor_effect_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/5",
      "constraint": {
        "reference_role": "post_fence_predecessor_protected_effects",
        "number_role": "post_fence_predecessor_protected_effect_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/6",
      "constraint": {
        "reference_role": "active_authority_observations",
        "number_role": "active_authority_observation_count"
      }
    },
    {
      "ref": "/reference_role_count_bindings/7",
      "constraint": {
        "reference_role": "dual_active_observations",
        "number_role": "dual_active_observation_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "predecessor-authority-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "before",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "successor-authority-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_authority",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "predecessor-authorizes-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "predecessor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "successor-authorizes-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_authority",
          "operator": "reference:authorizes",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "successor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "each-predecessor-pre-fence-attempt-before-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_pre_fence_attempts",
          "member_role": "predecessor_pre_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_pre_fence_attempt",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fence_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "each-predecessor-pre-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_pre_fence_attempts",
          "member_role": "predecessor_pre_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_pre_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/6",
      "constraint": {
        "pattern_id": "each-predecessor-post-fence-attempt-after-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_post_fence_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/7",
      "constraint": {
        "pattern_id": "each-predecessor-post-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/8",
      "constraint": {
        "pattern_id": "each-predecessor-post-fence-attempt-refused",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:has_status",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "refused_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/9",
      "constraint": {
        "pattern_id": "each-predecessor-post-fence-attempt-no-write",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:writes",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/10",
      "constraint": {
        "pattern_id": "each-predecessor-post-fence-attempt-no-mutation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST_NOT"
        ],
        "for_each": {
          "population_role": "predecessor_post_fence_attempts",
          "member_role": "predecessor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "predecessor_post_fence_attempt",
          "operator": "reference:mutates",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/11",
      "constraint": {
        "pattern_id": "each-successor-post-fence-attempt-after-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_post_fence_attempts",
          "member_role": "successor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_post_fence_attempt"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/12",
      "constraint": {
        "pattern_id": "each-successor-post-fence-attempt-uses-authority-and-epoch",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_post_fence_attempts",
          "member_role": "successor_post_fence_attempt"
        },
        "proposition_template": {
          "subject_role": "successor_post_fence_attempt",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/13",
      "constraint": {
        "pattern_id": "each-predecessor-effect-before-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_effects",
          "member_role": "predecessor_effect"
        },
        "proposition_template": {
          "subject_role": "predecessor_effect",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fence_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/14",
      "constraint": {
        "pattern_id": "each-predecessor-effect-uses-authority-epoch-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "predecessor_effects",
          "member_role": "predecessor_effect"
        },
        "proposition_template": {
          "subject_role": "predecessor_effect",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/15",
      "constraint": {
        "pattern_id": "fence-precedes-successor-activation",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/16",
      "constraint": {
        "pattern_id": "successor-activation-starts-authority",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_activation_event",
          "operator": "reference:starts",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "successor_epoch"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/17",
      "constraint": {
        "pattern_id": "each-successor-effect-after-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_effects",
          "member_role": "successor_effect"
        },
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_effect"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/18",
      "constraint": {
        "pattern_id": "each-successor-effect-uses-authority-epoch-resource",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "successor_effects",
          "member_role": "successor_effect"
        },
        "proposition_template": {
          "subject_role": "successor_effect",
          "operator": "reference:uses",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "resource"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/19",
      "constraint": {
        "pattern_id": "post-fence-predecessor-effects-subset",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "reference:subset_of",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/20",
      "constraint": {
        "pattern_id": "pre-fence-observation-in-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "pre_fence_observation",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "active_authority_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/21",
      "constraint": {
        "pattern_id": "post-fence-observation-in-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_observation",
          "operator": "reference:member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "active_authority_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/22",
      "constraint": {
        "pattern_id": "pre-fence-observation-before-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "pre_fence_observation",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "fence_event"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/23",
      "constraint": {
        "pattern_id": "post-fence-observation-after-fence",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "fence_event",
          "operator": "reference:precedes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "post_fence_observation"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/24",
      "constraint": {
        "pattern_id": "pre-fence-observation-records-active-side",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "pre_fence_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/25",
      "constraint": {
        "pattern_id": "post-fence-observation-records-active-side",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_observation",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/26",
      "constraint": {
        "pattern_id": "each-observation-not-dual-active",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "active_authority_observations",
          "member_role": "active_authority_observation"
        },
        "proposition_template": {
          "subject_role": "active_authority_observation",
          "operator": "reference:not_member_of",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "dual_active_observation_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/27",
      "constraint": {
        "pattern_id": "predecessor-effects-before-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/28",
      "constraint": {
        "pattern_id": "successor-activation-and-effects-after-fence",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_effect_window_state",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/29",
      "constraint": {
        "pattern_id": "post-fence-predecessor-protected-effects-zero",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "post_fence_predecessor_protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/30",
      "constraint": {
        "pattern_id": "dual-active-observations-zero",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "dual_active_observation_population",
          "operator": "number:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "dual_active_observation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/31",
      "constraint": {
        "pattern_id": "predecessor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "predecessor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "predecessor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "predecessor_authority",
              "predecessor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "before_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/32",
      "constraint": {
        "pattern_id": "successor-order-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "successor_order_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "successor_activation_event"
            },
            {
              "kind": "reference",
              "role": "successor_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "successor_effect_window_state",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "where",
            "operand_roles": [
              "resource",
              "successor_authority",
              "successor_epoch",
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "after_fence_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/33",
      "constraint": {
        "pattern_id": "post-fence-refusal-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "post_fence_refusal_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "predecessor_post_fence_attempt_population"
            },
            {
              "kind": "reference",
              "role": "post_fence_predecessor_protected_effect_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "predecessor_epoch"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "post_fence_predecessor_protected_effect_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "after",
            "operand_roles": [
              "fence_event"
            ]
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "post_fence_predecessor_protected_effect_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/34",
      "constraint": {
        "pattern_id": "dual-active-verification",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "dual_active_verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "active_authority_observation_population"
            },
            {
              "kind": "reference",
              "role": "dual_active_observation_population"
            },
            {
              "kind": "reference",
              "role": "resource"
            },
            {
              "kind": "reference",
              "role": "predecessor_authority"
            },
            {
              "kind": "reference",
              "role": "successor_authority"
            },
            {
              "kind": "reference",
              "role": "fence_event"
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
          "subject_role": "dual_active_observation_population",
          "operator": "number:not_equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "number",
              "value_role": "dual_active_observation_count"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "predecessor-order-verification-target",
        "role": "verifies",
        "source_claim_pattern_id": "predecessor-order-verification",
        "target_claim_pattern_id": "predecessor-effects-before-fence"
      }
    },
    {
      "ref": "/relation_patterns/1",
      "constraint": {
        "pattern_id": "successor-order-verification-target",
        "role": "verifies",
        "source_claim_pattern_id": "successor-order-verification",
        "target_claim_pattern_id": "successor-activation-and-effects-after-fence"
      }
    },
    {
      "ref": "/relation_patterns/2",
      "constraint": {
        "pattern_id": "post-fence-refusal-verification-target",
        "role": "verifies",
        "source_claim_pattern_id": "post-fence-refusal-verification",
        "target_claim_pattern_id": "post-fence-predecessor-protected-effects-zero"
      }
    },
    {
      "ref": "/relation_patterns/3",
      "constraint": {
        "pattern_id": "dual-active-verification-target",
        "role": "verifies",
        "source_claim_pattern_id": "dual-active-verification",
        "target_claim_pattern_id": "dual-active-observations-zero"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "predecessor-order-verification-target",
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "resource",
            "predecessor_authority",
            "predecessor_epoch",
            "fence_event"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/1",
      "constraint": {
        "relation_pattern_id": "successor-order-verification-target",
        "applicability_context": {
          "mode": "where",
          "operand_roles": [
            "resource",
            "successor_authority",
            "successor_epoch",
            "fence_event"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/2",
      "constraint": {
        "relation_pattern_id": "post-fence-refusal-verification-target",
        "applicability_context": {
          "mode": "after",
          "operand_roles": [
            "fence_event"
          ]
        }
      }
    },
    {
      "ref": "/falsifier_condition_bindings/3",
      "constraint": {
        "relation_pattern_id": "dual-active-verification-target",
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
            "pattern": "predecessor-authority-epoch"
          },
          {
            "pattern": "successor-authority-epoch"
          },
          {
            "pattern": "predecessor-authorizes-resource"
          },
          {
            "pattern": "successor-authorizes-resource"
          },
          {
            "pattern": "complete-predecessor-pre-fence-attempt-population"
          },
          {
            "pattern": "complete-predecessor-post-fence-attempt-population"
          },
          {
            "pattern": "complete-successor-post-fence-attempt-population"
          },
          {
            "pattern": "complete-predecessor-effect-population"
          },
          {
            "pattern": "complete-successor-effect-population"
          },
          {
            "pattern": "complete-post-fence-predecessor-protected-effect-population"
          },
          {
            "pattern": "complete-active-authority-observation-population"
          },
          {
            "pattern": "complete-dual-active-observation-population"
          },
          {
            "pattern": "each-predecessor-pre-fence-attempt-before-fence"
          },
          {
            "pattern": "each-predecessor-pre-fence-attempt-uses-authority-and-epoch"
          },
          {
            "pattern": "each-predecessor-post-fence-attempt-after-fence"
          },
          {
            "pattern": "each-predecessor-post-fence-attempt-uses-authority-and-epoch"
          },
          {
            "pattern": "each-predecessor-post-fence-attempt-refused"
          },
          {
            "pattern": "each-predecessor-post-fence-attempt-no-write"
          },
          {
            "pattern": "each-predecessor-post-fence-attempt-no-mutation"
          },
          {
            "pattern": "each-successor-post-fence-attempt-after-fence"
          },
          {
            "pattern": "each-successor-post-fence-attempt-uses-authority-and-epoch"
          },
          {
            "pattern": "each-predecessor-effect-before-fence"
          },
          {
            "pattern": "each-predecessor-effect-uses-authority-epoch-resource"
          },
          {
            "pattern": "fence-precedes-successor-activation"
          },
          {
            "pattern": "successor-activation-starts-authority"
          },
          {
            "pattern": "each-successor-effect-after-fence"
          },
          {
            "pattern": "each-successor-effect-uses-authority-epoch-resource"
          },
          {
            "pattern": "post-fence-predecessor-effects-subset"
          },
          {
            "pattern": "pre-fence-observation-in-population"
          },
          {
            "pattern": "post-fence-observation-in-population"
          },
          {
            "pattern": "pre-fence-observation-before-fence"
          },
          {
            "pattern": "post-fence-observation-after-fence"
          },
          {
            "pattern": "pre-fence-observation-records-active-side"
          },
          {
            "pattern": "post-fence-observation-records-active-side"
          },
          {
            "pattern": "each-observation-not-dual-active"
          },
          {
            "pattern": "predecessor-effects-before-fence"
          },
          {
            "pattern": "successor-activation-and-effects-after-fence"
          },
          {
            "pattern": "post-fence-predecessor-protected-effects-zero"
          },
          {
            "pattern": "dual-active-observations-zero"
          },
          {
            "pattern": "predecessor-order-verification"
          },
          {
            "pattern": "successor-order-verification"
          },
          {
            "pattern": "post-fence-refusal-verification"
          },
          {
            "pattern": "dual-active-verification"
          },
          {
            "pattern": "predecessor-order-verification-target"
          },
          {
            "pattern": "successor-order-verification-target"
          },
          {
            "pattern": "post-fence-refusal-verification-target"
          },
          {
            "pattern": "dual-active-verification-target"
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
      "resource",
      "predecessor_authority",
      "successor_authority",
      "predecessor_epoch",
      "successor_epoch",
      "fence_event",
      "successor_activation_event",
      "predecessor_pre_fence_attempt_population",
      "predecessor_pre_fence_attempts",
      "predecessor_post_fence_attempt_population",
      "predecessor_post_fence_attempts",
      "successor_post_fence_attempt_population",
      "successor_post_fence_attempts",
      "predecessor_effect_population",
      "predecessor_effects",
      "successor_effect_population",
      "successor_effects",
      "post_fence_predecessor_protected_effect_population",
      "post_fence_predecessor_protected_effects",
      "refused_state",
      "predecessor_effect_window_state",
      "before_fence_state",
      "successor_effect_window_state",
      "after_fence_state",
      "predecessor_order_verification",
      "successor_order_verification",
      "post_fence_refusal_verification",
      "dual_active_verification"
    ],
    "declaration_outputs": [],
    "required_observations": [
      "active_authority_observation_population",
      "active_authority_observations",
      "dual_active_observation_population",
      "dual_active_observations",
      "pre_fence_observation",
      "post_fence_observation"
    ],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.ownership.fenced-handoff.",
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
        "missing": "No named proof.ownership.fenced-handoff constructor maps semantic inputs to the complete native graph.",
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
        "missing": "No general observation acquisition mapping for proof.ownership.fenced-handoff.",
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
