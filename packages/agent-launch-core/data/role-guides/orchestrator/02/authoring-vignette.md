# From a user request to a worker assignment

The user asks:

> `readRetryConfig` must reject a negative numeric `retryLimit` with `retry_limit_negative`. Zero must still be accepted.

The orchestrator authors a parent `WK-*` and its worker slice. The operator is the directing user; a unit is the parent or slice.

Controlled acceptance is required. Save structured requirements, select proofs and link them to the criteria. Save and assess the parent and implementation slice and correct gaps before any required design redteam. Correct confirmed redteam findings in those saved assignments before dispatching implementation. Use each proof only for its stated assertion.
Inspect the delivered tests against the full request.

The example repository is `example/retry-service`. The user has selected its existing initiative `initiative`. The selected base branch is `main`. Assume source search has located `readRetryConfig` in `src/retry-config.mjs`; this vignette calls it the reader function. Treat the stated policy and acceptance choices as premises of the example.

The authoring procedure ends with an assessed slice before implementation dispatch.

We will compare the required result fields with their expected values. The first save leaves those expected values undefined so step 4 can show how to add them. In real work, include known values in the first save.

Request blocks contain complete arguments. Substitute `<name>` from earlier responses. Response blocks are hypothetical excerpts. Follow actual returned calls for omitted reads and recovery. The delivery example is a separate journey.

## Inspect the code before choosing files

Start with `query_code_index({"paths":["src/retry-config.mjs"]})` to investigate change impact. Follow the returned reads for relevant source, callers and tests. If coverage is incomplete, use permitted source searches and report what remains unknown.

Assume the inspection found this implementation:

```js example:current-reader
import { reject } from "./config-result.mjs";
export function readRetryConfig({ retryLimit }) {
  if (typeof retryLimit === "number" && retryLimit < 0) return reject("invalid");
  return { ok: true, retryLimit };
}
```

Read `src/config-result.mjs` and the two test files listed below before choosing readable and writable files. Assume these reads and searches establish the facts below. No other callers were found. Complete caller coverage remains unverified.

Use these inspection results to prepare the assignment:

- `src/retry-config.mjs` defines `readRetryConfig`. It returns a rejection object with `ok: false` and a `code`, or an acceptance with `ok: true` and the input `retryLimit`. It does not throw. Its current negative-input rejection uses code `invalid`.
- `src/config-result.mjs` supplies the `reject` helper and the definitions below. The worker needs to read this file to use the API, but does not need to change it.
- `tests/unit/retry-config.test.mjs` contains two top-level tests. `rejects negative retry limits` checks only that the result for -1 has `ok: false`; it does not check the rejection code or a negative fraction. `accepts a valid retry limit` checks only 3. Extend the first to check `ok` and the exact rejection code for negative integers and fractions. Extend the second to check zero.
- `tests/unit/config-result.test.mjs` covers the unchanged helper. Select it as a regression test.

These predicates already exist. Neither expected field record has a committed definition; step 4 authors those values. Define missing meanings from the request and inspected API through the authoring guidance. Symbol names alone supply no meaning.

```js example:helper-predicates
export function reject(code) { return { ok: false, code }; }
export function negativeInput({ retryLimit }) {
  return typeof retryLimit === "number" && retryLimit < 0;
}
export function zeroInput({ retryLimit }) { return retryLimit === 0; }
export function negativeFailure({ retryLimit, result, threw }) {
  return negativeInput({ retryLimit }) &&
    (threw || result?.ok !== false || result?.code !== "retry_limit_negative");
}
export function zeroFailure({ retryLimit, result, threw }) {
  return zeroInput({ retryLimit }) &&
    (threw || result?.ok !== true || result?.retryLimit !== 0);
}
```

Use the condition predicates to specify the inputs and the failure predicates to specify contrary results, including throws. Read their definitions before referring to them.

The repository uses Node’s built-in test runner directly, with no wrapper or dependencies. Its committed `package.json` is exactly `{"type":"module"}`. From the repository root, `node --test tests/unit/retry-config.test.mjs tests/unit/config-result.test.mjs` runs the inspected validation and regression files; `package.json` is this command’s listed definition file.

## Map the request to evidence

| Requirement | Evidence needed | Incorrect behavior the evidence must reject |
| --- | --- | --- |
| R1: Reject a negative numeric limit. | Inspect the returned result for negative inputs. | A negative value is accepted or throws. |
| R2: Return exactly `retry_limit_negative`. | Compare the rejection code. | A generic or different code is returned. |
| R3: Accept zero. | Pass exactly 0 and inspect its result. | Zero is rejected or throws. |
| Scope: preserve positive and nonnumeric handling. | Compare the reader's changes and retained assertions with the inspected behavior. | Behavior changes outside negative rejection and zero acceptance. |

R1 and R2 share an assertion: generic rejection fails R2. The test of 3 establishes nothing about zero. This incorrect implementation passes the existing tests and the extended negative check:

```js
export function readRetryConfig({ retryLimit }) {
  if (typeof retryLimit === "number" && retryLimit <= 0) return reject("retry_limit_negative");
  return { ok: true, retryLimit };
}
```

A passing test does not show that zero was tested. Check for a call with zero and an assertion that its result is accepted.

Compare `ok` and `code` for negatives; `ok` and `retryLimit` for zero. Extra properties remain unconstrained: `{ok:false, code:"retry_limit_negative", extra:true}` satisfies R1 and R2. Whole-object equality would wrongly forbid them.

This example interprets “numeric” as a JavaScript number. The inspected input predicate supports that interpretation because it checks `typeof retryLimit === "number"`. Existing code alone does not establish user intent.

Preserve numeric strings, other nonnumeric inputs and positive limits; check source changes and retained assertions against that boundary.

Use live schemas. Ask the operator about differences affecting behavior, scope or authority. Store the opening quotation without its display backticks in `initial.user_requirements`.

Set each `user_requirement` source link to the exact saved passage it supports.

Read the selected initiative:

```json request:read-initiative workspace_read_wiki
{
  "reads": [
    {
      "subject": "initiative"
    }
  ]
}
```

```json response:read-initiative
{
  "results": [
    {
      "status": "ok",
      "value": {
        "subject": "<initiative>"
      }
    }
  ]
}
```

Use `results[0].value.subject`, shown here as `<initiative>`, in `changes.initiative`.

| Record | Purpose in this example |
| --- | --- |
| Criterion | State the two accepted outcomes: the specified negative rejection and zero acceptance. |
| Requirement | State each outcome's condition and required behavior. R1 and R2 share one requirement; R3 has another. |
| Claim | A behavioral statement within a requirement. Select the whole requirement when all its statements apply, or select the specific claim by its authored meaning. |
| Verification | Identify the check, what it observes and what contradicts the requirement. It belongs to the requirement. |
| Obligation | Link a criterion to its requirement and select its proof. |
| Case | Identify the production component, concrete test, observation and falsifier for a verification. A falsifier introduces a deliberate fault to check whether the test detects it. |
| Slice | Give the worker the change, context, access, acceptance and validation. |

In each obligation, name the criterion and requirement claims it supports. Check the actual test separately; linking it to a requirement does not show that it tests the required behavior.

## 1. Record the request

```json request:create workspace_create_record
{
  "kind": "work_item",
  "title": "Reject negative retry limits",
  "initial": {
    "base_branch": "main",
    "user_requirements": "readRetryConfig must reject a negative numeric retryLimit with retry_limit_negative. Zero must still be accepted."
  }
}
```

```json response:create
{
  "outcome": "created",
  "unit": "<unit>",
  "revision": "<parent-revision>"
}
```

Use the revision returned by creation in the first save. Read the schemas for the parent save and later slice assignment directly through the known unit:

```json request:parent-inputs workspace_read_wiki
{
  "reads": [
    {
      "subject": "<unit>",
      "select": {
        "input_contract": {
          "tool": "save_record",
          "members": [
            "initiative",
            "controlled_acceptance",
            "entries",
            "criteria",
            "validation",
            "requirements",
            "obligations",
            "ready_slices"
          ]
        }
      }
    }
  ]
}
```

## 2. Read the guidance and select a proof

Read authoring guidance before writing the requirements:

```json request:guidance workspace_read_wiki
{
  "reads": [
    {
      "subject": {
        "requirement_guidance": true
      }
    }
  ]
}
```

Read the returned `authoring_vocabulary`, `fields` and `save_record_inputs` selections together. After choosing a test family, follow its returned `case_authoring` selection. Use the schemas for exact syntax.

Find candidate proofs:

```json request:proofs workspace_find_proofs
{}
```

Follow returned calls for plausible proofs' assertions, exclusions and authoring. Choose `proof.verification.test-validity`, family `node-test`. It does not judge whether delivered assertions demonstrate the requirement; inspect them.

Choose the published `dependency_failure` strategy, `module_path: "src/retry-config.mjs"`. Both tests call the reader and encounter the injected throw; importing alone would not.

The deliberate fault check is optional. To omit it, save `"falsification":{"support":"registry_unsupported"}`. A passing test still does not show that it detects faults or checks the required behavior. Correct invalid fields you supplied; do not hide them by declaring the check unsupported. Do not change production code or tests just to fit a falsifier.

Selecting a proof needs no execution case; omit an unknown case rather than supply an incomplete one. A supplied incomplete case is still an authored defect. A complete case may name a planned test before it exists; verification checks test existence and target support at execution.

## 3. Save requirements and the evidence plan

For each invocation, select the two result fields the requirement constrains. Compare those fields with the expected values. Leave other returned fields unconstrained.

Decide these meanings before filling the fields:

| Field | Negative-limit requirement |
| --- | --- |
| `subject` | The record constructed from the observed negative-result fields. |
| `behavior` | For a numeric limit below zero, the observed field record equals the expected field record. |
| `verification.verifier` | The test file. |
| `verification.observes` | The reader, negative input, observed properties and expected record. |
| `verification.fails_when` | The reader accepts the input, returns a different code or throws. |

Require a negative integer, negative fraction and exactly zero, with the stated outcomes and contrary results. The worker chooses other data, assertions and structure.

Use `entities` keys as IDs. Explicitly define conditions, results and failure predicates; names and types supply no behavior.

Define the observed `ok` and `code` fields for a negative-input call, and `ok` and `retryLimit` for a zero-input call, with `value:observed_at`. Use the same `occurrence` for fields from the same call: `negative-call` or `zero-call`. Select each field through `path` under `root: "completion"`, using its declared `bool`, `string` or `int` type.

Construct each observed field record with `value:equals`, then compare it with the expected field record. In this example only, leave the expected field records without value definitions so step 4 can demonstrate their repair. In real work, include known definitions in the first save.

Use `negativeInput` and `zeroInput` as the requirement conditions. Use `negativeFailure` and `zeroFailure` as the corresponding verification failure conditions. In each `boolean:fails_when`, set `applies.context` to that failure predicate before using `{ "boolean": true }`.

Inspect delivered assertions for same-call input/results, rejection of throws and comparison of required fields. Saved declarations do not execute those checks.

Cases name the component and test; `selector.nesting:0` selects a top-level test. In `criteria`, `"$negative-rejected"` refers to the criterion created in this save. In `claims`, `"$reject-negative"` refers to the claims created for that requirement. These `$key` names apply only within that save. In later saves, select saved requirements and criteria by their authored meaning. Reuse returned obligation and case IDs where those fields call for them.

Set each `user_requirement` to the exact passage the requirement represents. For each passage, check that its linked requirements together describe everything it asks for. A link alone does not show that the requested behavior has been described. Check that no part of the request is left out.

Save the requirements, criteria and obligations together:

```json request:save-parent save_record
{
  "unit": "<unit>",
  "revision": "<parent-revision>",
  "changes": {
    "initiative": "<initiative>",
    "controlled_acceptance": {
      "disposition": "required"
    },
    "criteria": [
      {
        "key": "negative-rejected",
        "text": "For numeric retryLimit < 0, readRetryConfig returns a rejection with ok=false and code=retry_limit_negative."
      },
      {
        "key": "zero-accepted",
        "text": "For retryLimit = 0, readRetryConfig returns an acceptance with ok=true and retryLimit=0."
      }
    ],
    "validation": [
      "Run tests/unit/retry-config.test.mjs with workspace_run_test."
    ],
    "requirements": {
      "entities": {
        "negative-call": "cc:event",
        "zero-call": "cc:event",
        "negative result ok": "cc:state",
        "negative result code": "cc:state",
        "zero result ok": "cc:state",
        "zero result retryLimit": "cc:state",
        "readRetryConfig": {
          "type_term": "cc:operation",
          "identity": {
            "kind": "code_symbol",
            "repository": "example/retry-service",
            "path": "src/retry-config.mjs",
            "symbol": "readRetryConfig"
          }
        },
        "numeric retryLimit < 0": {
          "type_term": "cc:configuration",
          "identity": {
            "kind": "code_symbol",
            "repository": "example/retry-service",
            "path": "src/config-result.mjs",
            "symbol": "negativeInput"
          }
        },
        "observed negative result fields": "cc:state",
        "expected negative result fields": "cc:state",
        "tests/unit/retry-config.test.mjs": {
          "type_term": "cc:test",
          "identity": {
            "kind": "repository_path",
            "repository": "example/retry-service",
            "path": "tests/unit/retry-config.test.mjs"
          }
        },
        "negative numeric retryLimit is accepted, returns a different code, or throws instead of returning the specified rejection": {
          "type_term": "cc:operation",
          "identity": {
            "kind": "code_symbol",
            "repository": "example/retry-service",
            "path": "src/config-result.mjs",
            "symbol": "negativeFailure"
          }
        },
        "retryLimit = 0": {
          "type_term": "cc:configuration",
          "identity": {
            "kind": "code_symbol",
            "repository": "example/retry-service",
            "path": "src/config-result.mjs",
            "symbol": "zeroInput"
          }
        },
        "observed zero result fields": "cc:state",
        "expected zero result fields": "cc:state",
        "retryLimit 0 is rejected, or throws instead of returning the specified acceptance": {
          "type_term": "cc:operation",
          "identity": {
            "kind": "code_symbol",
            "repository": "example/retry-service",
            "path": "src/config-result.mjs",
            "symbol": "zeroFailure"
          }
        }
      },
      "requirements": [
        {
          "key": "observe-negative-ok",
          "subject": "negative result ok",
          "definition": true,
          "behavior": {
            "relation": "value:observed_at",
            "objects": [
              {
                "observation": {
                  "operation": "readRetryConfig",
                  "occurrence": "negative-call",
                  "root": "completion",
                  "path": [
                    {
                      "field": "ok"
                    }
                  ],
                  "type": "bool"
                }
              }
            ]
          },
          "user_requirement": "readRetryConfig must reject a negative numeric retryLimit with retry_limit_negative."
        },
        {
          "key": "observe-negative-code",
          "subject": "negative result code",
          "definition": true,
          "behavior": {
            "relation": "value:observed_at",
            "objects": [
              {
                "observation": {
                  "operation": "readRetryConfig",
                  "occurrence": "negative-call",
                  "root": "completion",
                  "path": [
                    {
                      "field": "code"
                    }
                  ],
                  "type": "string"
                }
              }
            ]
          },
          "user_requirement": "readRetryConfig must reject a negative numeric retryLimit with retry_limit_negative."
        },
        {
          "key": "observe-zero-ok",
          "subject": "zero result ok",
          "definition": true,
          "behavior": {
            "relation": "value:observed_at",
            "objects": [
              {
                "observation": {
                  "operation": "readRetryConfig",
                  "occurrence": "zero-call",
                  "root": "completion",
                  "path": [
                    {
                      "field": "ok"
                    }
                  ],
                  "type": "bool"
                }
              }
            ]
          },
          "user_requirement": "Zero must still be accepted."
        },
        {
          "key": "observe-zero-limit",
          "subject": "zero result retryLimit",
          "definition": true,
          "behavior": {
            "relation": "value:observed_at",
            "objects": [
              {
                "observation": {
                  "operation": "readRetryConfig",
                  "occurrence": "zero-call",
                  "root": "completion",
                  "path": [
                    {
                      "field": "retryLimit"
                    }
                  ],
                  "type": "int"
                }
              }
            ]
          },
          "user_requirement": "Zero must still be accepted."
        },
        {
          "key": "project-negative-result",
          "subject": "observed negative result fields",
          "definition": true,
          "behavior": {
            "relation": "value:equals",
            "objects": [
              {
                "value": {
                  "record": {
                    "fields": [
                      {
                        "name": "ok",
                        "value": {
                          "referent": "negative result ok"
                        }
                      },
                      {
                        "name": "code",
                        "value": {
                          "referent": "negative result code"
                        }
                      }
                    ]
                  }
                }
              }
            ]
          },
          "user_requirement": "readRetryConfig must reject a negative numeric retryLimit with retry_limit_negative."
        },
        {
          "key": "project-zero-result",
          "subject": "observed zero result fields",
          "definition": true,
          "behavior": {
            "relation": "value:equals",
            "objects": [
              {
                "value": {
                  "record": {
                    "fields": [
                      {
                        "name": "ok",
                        "value": {
                          "referent": "zero result ok"
                        }
                      },
                      {
                        "name": "retryLimit",
                        "value": {
                          "referent": "zero result retryLimit"
                        }
                      }
                    ]
                  }
                }
              }
            ]
          },
          "user_requirement": "Zero must still be accepted."
        },
        {
          "key": "reject-negative",
          "nature": "behavior",
          "modality": "MUST",
          "subject": "observed negative result fields",
          "behavior": {
            "relation": "value:equals",
            "applies": {
              "mode": "when",
              "context": [
                "numeric retryLimit < 0"
              ]
            },
            "objects": [
              {
                "value": {
                  "referent": "expected negative result fields"
                }
              }
            ]
          },
          "verification": {
            "key": "negative-test",
            "method": "test_execution",
            "verifier": "tests/unit/retry-config.test.mjs",
            "observes": {
              "relation": "reference:covers",
              "objects": [
                {
                  "referent": "readRetryConfig"
                },
                {
                  "referent": "numeric retryLimit < 0"
                },
                {
                  "referent": "negative result ok"
                },
                {
                  "referent": "negative result code"
                },
                {
                  "referent": "expected negative result fields"
                }
              ]
            },
            "fails_when": {
              "relation": "boolean:fails_when",
              "applies": {
                "mode": "when",
                "context": [
                  "negative numeric retryLimit is accepted, returns a different code, or throws instead of returning the specified rejection"
                ]
              },
              "objects": [
                {
                  "boolean": true
                }
              ]
            }
          },
          "user_requirement": "readRetryConfig must reject a negative numeric retryLimit with retry_limit_negative."
        },
        {
          "key": "accept-zero",
          "nature": "behavior",
          "modality": "MUST",
          "subject": "observed zero result fields",
          "behavior": {
            "relation": "value:equals",
            "applies": {
              "mode": "when",
              "context": [
                "retryLimit = 0"
              ]
            },
            "objects": [
              {
                "value": {
                  "referent": "expected zero result fields"
                }
              }
            ]
          },
          "verification": {
            "key": "zero-test",
            "method": "test_execution",
            "verifier": "tests/unit/retry-config.test.mjs",
            "observes": {
              "relation": "reference:covers",
              "objects": [
                {
                  "referent": "readRetryConfig"
                },
                {
                  "referent": "retryLimit = 0"
                },
                {
                  "referent": "zero result ok"
                },
                {
                  "referent": "zero result retryLimit"
                },
                {
                  "referent": "expected zero result fields"
                }
              ]
            },
            "fails_when": {
              "relation": "boolean:fails_when",
              "applies": {
                "mode": "when",
                "context": [
                  "retryLimit 0 is rejected, or throws instead of returning the specified acceptance"
                ]
              },
              "objects": [
                {
                  "boolean": true
                }
              ]
            }
          },
          "user_requirement": "Zero must still be accepted."
        }
      ]
    },
    "obligations": [
      {
        "key": "negative-rejection",
        "statement": "For numeric retryLimit < 0, readRetryConfig returns a rejection with ok=false and code=retry_limit_negative.",
        "criteria": [
          "$negative-rejected"
        ],
        "claims": [
          "$reject-negative"
        ],
        "proof": {
          "name": "proof.verification.test-validity"
        },
        "case": {
          "key": "negative-case",
          "component": {
            "type_term": "cc:runtime_component",
            "identity": {
              "kind": "repository_path",
              "repository": "example/retry-service",
              "path": "src/retry-config.mjs"
            }
          },
          "target": {
            "path": "tests/unit/retry-config.test.mjs",
            "selector": {
              "name": "rejects negative retry limits",
              "nesting": 0
            }
          },
          "observation": {
            "kind": "return_value"
          },
          "falsification": {
            "strategy": "dependency_failure",
            "module_path": "src/retry-config.mjs"
          }
        }
      },
      {
        "key": "zero-acceptance",
        "statement": "For retryLimit = 0, readRetryConfig returns an acceptance with ok=true and retryLimit=0.",
        "criteria": [
          "$zero-accepted"
        ],
        "claims": [
          "$accept-zero"
        ],
        "proof": {
          "name": "proof.verification.test-validity"
        },
        "case": {
          "key": "zero-case",
          "component": {
            "type_term": "cc:runtime_component",
            "identity": {
              "kind": "repository_path",
              "repository": "example/retry-service",
              "path": "src/retry-config.mjs"
            }
          },
          "target": {
            "path": "tests/unit/retry-config.test.mjs",
            "selector": {
              "name": "accepts a valid retry limit",
              "nesting": 0
            }
          },
          "observation": {
            "kind": "return_value"
          },
          "falsification": {
            "strategy": "dependency_failure",
            "module_path": "src/retry-config.mjs"
          }
        }
      }
    ]
  }
}
```

Check that the negative obligation links R1 and R2 to the negative test, and the zero obligation links R3 to the zero test.

```json response:save-parent
{
  "outcome": "saved",
  "unit": "<unit>",
  "revision": "<parent-revision-saved>",
  "bindings": {
    "obligation": {
      "negative-rejection": "<negative-obligation-id>",
      "zero-acceptance": "<zero-obligation-id>"
    },
    "case": {
      "negative-case": "<negative-case-id>",
      "zero-case": "<zero-case-id>"
    }
  }
}
```

Reuse the returned revision for the next parent save. The save response returns public obligation and case IDs; saved requirements and criteria are selected by meaning.

## 4. Inspect the saved meaning, assess and supply missing definitions

Read the saved requirements and their verifications together with the original request and obligation links:

```json request:read-parent-saved workspace_read_wiki
{
  "reads": [
    {
      "subject": "<unit>",
      "select": {
        "field": "sections.user_requirements"
      }
    },
    {
      "subject": "<unit>",
      "select": {
        "contract": "requirements",
        "include": [
          "verifications"
        ]
      }
    },
    {
      "subject": "<unit>",
      "select": {
        "contract": "obligations"
      }
    }
  ]
}
```

Check each result's `status`. Requirements appear in `results[1].value.members`; each requirement's `declaration` contains its authored behavior and `user_requirement` passage. Compare both outcome requirements with the complete saved request. Check that the obligations link the intended requirements, criteria and tests. Then assess the parent:

```json request:assess-parent workspace_assess_contract
{
  "unit": "<unit>"
}
```

```json response:assess-parent
{
  "unit": "<unit>",
  "assessment": {
    "authored": "valid",
    "specification": "incomplete"
  }
}
```

Here `authored` is valid but `specification` is incomplete. Follow the returned diagnosis reads for both expected field records. The diagnoses identify `description_definition_missing`: neither expected field record has a value definition. `criterion_coverage` is returned when criterion coverage is incomplete; complete coverage does not make the specification complete.

Use the revision returned by `save-parent` for the definition save. If a correction read has already supplied a newer `contexts[unit].revision`, use that revision instead. Do not repeat a read merely to refresh a revision that is still current.

Keep the outcome comparisons, conditions, exact source links and verification/case associations. Define the two expected field records using their existing entities in the specification, rather than identities of implementation symbols. Choose values from the request and inspected API, not from a convenient symbol.

Use typed literals from the requirements input schema read in step 1 to define these expected field records. Here `int64Value: "0"` represents integer zero, not the string input `"0"`.

New keyed rows append to the saved requirement rows. This save adds the two definitions; it does not replace the earlier requirements or their associations. To correct an existing requirement, put its semantic selector in `target` rather than appending a duplicate.

```json request:specification-save save_record
{
  "unit": "<unit>",
  "revision": "<parent-revision-saved>",
  "changes": {
    "requirements": {
      "requirements": [
        {
          "key": "define-rejection",
          "subject": "expected negative result fields",
          "definition": true,
          "behavior": {
            "relation": "value:equals",
            "objects": [
              {
                "value": {
                  "record": {
                    "fields": [
                      {
                        "name": "ok",
                        "value": {
                          "literal": {
                            "boolValue": false
                          }
                        }
                      },
                      {
                        "name": "code",
                        "value": {
                          "literal": {
                            "stringValue": "retry_limit_negative"
                          }
                        }
                      }
                    ]
                  }
                }
              }
            ]
          },
          "user_requirement": "readRetryConfig must reject a negative numeric retryLimit with retry_limit_negative."
        },
        {
          "key": "define-acceptance",
          "subject": "expected zero result fields",
          "definition": true,
          "behavior": {
            "relation": "value:equals",
            "objects": [
              {
                "value": {
                  "record": {
                    "fields": [
                      {
                        "name": "ok",
                        "value": {
                          "literal": {
                            "boolValue": true
                          }
                        }
                      },
                      {
                        "name": "retryLimit",
                        "value": {
                          "literal": {
                            "int64Value": "0"
                          }
                        }
                      }
                    ]
                  }
                }
              }
            ]
          },
          "user_requirement": "Zero must still be accepted."
        }
      ]
    }
  }
}
```

```json response:specification-save
{
  "outcome": "saved",
  "unit": "<unit>",
  "revision": "<parent-revision-defined>"
}
```

Reassess after the save:

```json request:specification-reassess workspace_assess_contract
{
  "unit": "<unit>"
}
```

```json response:specification-reassess
{
  "unit": "<unit>",
  "assessment": {
    "authored": "valid",
    "specification": "complete"
  }
}
```

For this example, inspect the saved requirements again to check the two new definitions and the retained outcome comparisons and verifications:

```json request:read-defined-parent workspace_read_wiki
{
  "reads": [
    {
      "subject": "<unit>",
      "select": {
        "contract": "requirements",
        "include": [
          "verifications"
        ]
      }
    }
  ]
}
```

Use the revision from `specification-save` for the next save. Assessment does not supply a write revision, and a successful save does not require a revision-refresh read.

Check expected field values and unchanged criterion links. Report any undefined value or condition and its affected requirement; it blocks readiness.

Compare saved meaning with all three requested outcomes even after a gap-free assessment. Preserve positive and nonnumeric handling. Returning rather than throwing comes from the inspected API.

## 5. Prepare the worker's slice

Save the full change, exclusions, context, dependencies, evidence and validation in the assignment.

Include the helper, repository instructions, command definition and regression file in `read_scope`; write targets are already readable. Limit `write_scope`/`repo_paths` to the reader and test. Name the function and two tests in `expected_edit_targets`; check these saved scopes before dispatch.

The helper regression is `tests/unit/config-result.test.mjs`, outside write scope. Its declaration grants no access or protection.

```json request:save-slice save_record
{
  "unit": "<unit>",
  "revision": "<parent-revision-defined>",
  "changes": {
    "ready_slices": [
      {
        "key": "reject-negative-limit",
        "title": "Reject negative retry limits in readRetryConfig and keep zero accepted",
        "depends_on": [],
        "summary": {
          "text": "Behavior: In src/retry-config.mjs, make readRetryConfig reject negative numeric retryLimit values with ok=false and code=retry_limit_negative. Keep zero accepted with ok=true and retryLimit=0. Use reject from src/config-result.mjs and return the rejection object; do not throw. Read the helper file but do not change it. An accepted result returns the input retryLimit. Compare only the named result properties; additional properties are allowed.\n\nInterpretation: This example treats numeric as a JavaScript number. The inspected negativeInput predicate checks typeof retryLimit === \"number\", which supports that reading. Existing code alone does not establish user intent.\n\nNegative-input evidence: Extend the existing top-level test \"rejects negative retry limits\" in tests/unit/retry-config.test.mjs. Check ok=false and the exact code for a negative integer and a negative fraction. Compare those properties, not the whole returned object. The test must fail if a negative value is accepted, the code differs, or the reader throws.\n\nZero-input evidence: Extend the existing top-level test \"accepts a valid retry limit\" in the same file. Check that exactly 0 returns ok=true and retryLimit=0. This must catch a reader that rejects every limit at or below zero. Positive inputs alone do not establish zero acceptance. For both tests, choose the remaining test data, assertions and structure.\n\nScope: Preserve positive-limit and nonnumeric handling, including numeric strings. Compare the reader's changes and retained assertions to check that this handling is preserved. Follow AGENTS.md, the repository's agent instructions.\n\nValidation: Use workspace_run_test with entrypoint retry-tests and selection focused. Report results or blockers."
        },
        "read_scope": [
          "AGENTS.md",
          "src/config-result.mjs",
          "package.json",
          "tests/unit/config-result.test.mjs"
        ],
        "repo_paths": [
          "src/retry-config.mjs",
          "tests/unit/retry-config.test.mjs"
        ],
        "write_scope": [
          "src/retry-config.mjs",
          "tests/unit/retry-config.test.mjs"
        ],
        "regression_tests": [
          "tests/unit/config-result.test.mjs"
        ],
        "acceptance": {
          "criteria": [
            "The extended test \"rejects negative retry limits\" demonstrates that readRetryConfig returns a rejection with ok=false and code=retry_limit_negative for negative numeric retryLimit.",
            "The extended test \"accepts a valid retry limit\" demonstrates that readRetryConfig returns an acceptance with ok=true and retryLimit=0 for retryLimit 0."
          ],
          "validation": {
            "repository_tests": [
              {
                "operation": "repository_test",
                "id": "retry-tests",
                "purpose": "Validate retry limits and the unchanged helper",
                "selections": [
                  {
                    "id": "focused",
                    "harness": {
                      "cwd": ".",
                      "argv": [
                        "node",
                        "--test",
                        "tests/unit/retry-config.test.mjs",
                        "tests/unit/config-result.test.mjs"
                      ]
                    },
                    "definition_paths": [
                      "package.json"
                    ]
                  }
                ]
              }
            ]
          }
        },
        "expected_edit_targets": [
          {
            "path": "src/retry-config.mjs",
            "name": "readRetryConfig",
            "kind": "function",
            "operation": "modify"
          },
          {
            "path": "tests/unit/retry-config.test.mjs",
            "name": "rejects negative retry limits",
            "kind": "test_case",
            "operation": "modify"
          },
          {
            "path": "tests/unit/retry-config.test.mjs",
            "name": "accepts a valid retry limit",
            "kind": "test_case",
            "operation": "modify"
          }
        ]
      }
    ]
  }
}
```

```json response:save-slice
{
  "outcome": "saved",
  "unit": "<unit>",
  "revision": "<parent-revision-sliced>",
  "bindings": {
    "slice": {
      "reject-negative-limit": "<slice-id>"
    }
  }
}
```

## 6. Give the slice its own coverage

The slice address is `<unit>#<slice-id>`. Read its saved assignment, validation, scopes and coverage in one call. Request its write context for `obligations` in that same call:

```json request:read-slice workspace_read_wiki
{
  "reads": [
    {
      "subject": "<unit>#<slice-id>",
      "select": {
        "field": "sections.summary"
      },
      "for_changes": [
        "obligations"
      ]
    },
    {
      "subject": "<unit>#<slice-id>",
      "select": {
        "field": "acceptance.validation"
      }
    },
    {
      "subject": "<unit>#<slice-id>",
      "select": {
        "field": "read_scope"
      }
    },
    {
      "subject": "<unit>#<slice-id>",
      "select": {
        "field": "repo_paths"
      }
    },
    {
      "subject": "<unit>#<slice-id>",
      "select": {
        "field": "write_scope"
      }
    },
    {
      "subject": "<unit>#<slice-id>",
      "select": {
        "contract": "coverage"
      }
    }
  ]
}
```

The response excerpt shows only the write context:

```json response:read-slice
{
  "contexts": {
    "<unit>#<slice-id>": {
      "revision": "<slice-revision>"
    }
  }
}
```

The first five results contain the assignment, validation and scopes in request order. `summary.text` is read as `sections.summary`; saved validation is read as `acceptance.validation`. The last result contains the semantic contract members and `controlled_acceptance`. Check every result's status before using its value. In coverage, criteria have `kind: "criterion"`; obligations and cases have their own member kinds.

The saved command uses `retry-tests` as `entrypoint` and `focused` as `selection`. `cwd` is the working directory. `argv` contains the program and its arguments. `definition_paths` lists the files that define the command. No default selection is saved, so the worker must supply both names:

```json unsent:worker-validation workspace_run_test
{
  "entrypoint": "retry-tests",
  "selection": "focused"
}
```

Confirm that controlled acceptance is required for the slice. Create obligations for its own criteria. The selectors below match the saved criterion text and each parent requirement's subject and source passage. Reuse the parent case IDs because these obligations describe the same behavior and tests:

```json request:save-slice-coverage save_record
{
  "unit": "<unit>#<slice-id>",
  "revision": "<slice-revision>",
  "changes": {
    "obligations": [
      {
        "key": "slice-negative-rejection",
        "statement": "For numeric retryLimit < 0, readRetryConfig returns a rejection with ok=false and code=retry_limit_negative.",
        "criteria": [
          {
            "kind": "criterion",
            "match": {
              "text": "The extended test \"rejects negative retry limits\" demonstrates that readRetryConfig returns a rejection with ok=false and code=retry_limit_negative for negative numeric retryLimit."
            }
          }
        ],
        "claims": [
          {
            "kind": "requirement",
            "match": {
              "subject": {
                "identity": {
                  "kind": "profile_term",
                  "term": "observed negative result fields"
                }
              },
              "modality": "MUST",
              "user_requirement": "readRetryConfig must reject a negative numeric retryLimit with retry_limit_negative."
            }
          }
        ],
        "proof": {
          "name": "proof.verification.test-validity"
        },
        "case": {
          "id": "<negative-case-id>"
        }
      },
      {
        "key": "slice-zero-acceptance",
        "statement": "For retryLimit = 0, readRetryConfig returns an acceptance with ok=true and retryLimit=0.",
        "criteria": [
          {
            "kind": "criterion",
            "match": {
              "text": "The extended test \"accepts a valid retry limit\" demonstrates that readRetryConfig returns an acceptance with ok=true and retryLimit=0 for retryLimit 0."
            }
          }
        ],
        "claims": [
          {
            "kind": "requirement",
            "match": {
              "subject": {
                "identity": {
                  "kind": "profile_term",
                  "term": "observed zero result fields"
                }
              },
              "modality": "MUST",
              "user_requirement": "Zero must still be accepted."
            }
          }
        ],
        "proof": {
          "name": "proof.verification.test-validity"
        },
        "case": {
          "id": "<zero-case-id>"
        }
      }
    ]
  }
}
```

```json response:save-slice-coverage
{
  "outcome": "saved",
  "bindings": {
    "obligation": {
      "slice-negative-rejection": "<slice-negative-obligation-id>",
      "slice-zero-acceptance": "<slice-zero-obligation-id>"
    }
  },
  "unit": "<unit>#<slice-id>",
  "revision": "<slice-revision-covered>"
}
```

## 7. Assess the slice, then complete any required design redteam

```json request:assess-slice workspace_assess_contract
{
  "unit": "<unit>#<slice-id>"
}
```

```json response:assess-slice
{
  "unit": "<unit>#<slice-id>",
  "assessment": {
    "authored": "valid",
    "specification": "complete"
  }
}
```

If assessment returns diagnoses, follow their correction calls and reassess. Report any unresolved diagnosis and the affected requirement before dispatch.

Compare the saved assignment with the complete request. Check that the worker can read the files it needs and edit every file that requires a change. Check that the assigned tests would fail for the incorrect behavior described in the evidence table.

After saving and assessing the parent and slice and correcting gaps, complete any design redteam required by repository policy or the assignment. Supply the complete request, relevant source and saved assignment for a findings-only review.

For example, suppose an earlier draft asked only for a test of nonnegative inputs. The redteam could identify that testing 3 would satisfy that instruction while leaving zero unchecked. Correct that draft to require exactly zero and an assertion that it is accepted, as the saved assignment above does.

Check each finding against the request and source. Correct confirmed problems in the assignment and planned checks. Record why you reject other findings. Resolve consequential unanswered questions before dispatch. If they cannot be resolved, record the blocker and do not dispatch the affected implementation.

Follow repository policy and operator authorization before dispatch. This example does not send:

```json unsent:dispatch start_agent
{
  "subject": "<unit>#<slice-id>"
}
```

The authoring example stops here. The later delivery example shows why passing execution still needs an assertion review.

## After delivery: inspect the assertions

Use the delivery's returned validation and file-read calls. Check that the results and files refer to the delivery being evaluated. Complete required reviews before integration or publication.

Suppose `verify_proof` reports both tests ran unskipped, passed and detected the injected throw. Both call the reader; detecting that fault does not establish a check on zero.

Inspect the declared regression result returned with `verify_proof` as well. Suppose it passed. Do not count that helper check as evidence that the reader accepts zero.

Read the delivered tests:

```js
test("rejects negative retry limits", () => {
  for (const retryLimit of [-1, -0.5]) {
    const result = readRetryConfig({ retryLimit });
    assert.deepEqual({ ok: result.ok, code: result.code }, { ok: false, code: "retry_limit_negative" });
  }
});

test("accepts a valid retry limit", () => {
  assert.equal(readRetryConfig({ retryLimit: 3 }).ok, true);
  assert.equal(readRetryConfig({ retryLimit: 1 }).retryLimit, 1);
});
```

| Requirement | Delivered evidence | Status |
| --- | --- | --- |
| R1: Reject negatives. | The results for -1 and -0.5 have `ok: false`. | Supported |
| R2: Use the exact code. | The same comparisons include `retry_limit_negative`. | Supported |
| R3: Accept zero. | None: the acceptance test checks 3 and 1. | Unverified |

Record the reported proof outcome and the missing zero evidence separately in an entry on the parent work record through `changes.entries` in `save_record`. The proof result does not establish R3.

The shown assertions do not establish preservation of nonnumeric handling. Compare the delivered reader's changes and retained assertions with the inspected behavior before reporting that scope check as supported.

Read the delivered implementation. If it rejects zero, R3 is unmet.

Assign any needed implementation repair and the missing zero assertion to a worker under repository policy. Include the missing evidence, required behavior and necessary files.

Check that the repaired test asserts that zero is accepted. Run it. Report R3 as supported only if it passes. Report supported, unmet and unverified requirements separately.

Rerun repaired checks, other failures and required regressions on the repaired candidate.

Follow repository limits on repairs and reviews. If repair or testing cannot be completed, report the affected requirement and why it remains unresolved. Do not substitute tests that miss the required behavior. An exemption from review does not cancel required repairs.

## Repair an incomplete saved case

This alternative branches after step 3; it is not a continuation after dispatch. Suppose the step 3 save was submitted before the negative test was identified. Only its first case differs:

```json fragment:incomplete-case
{
  "key": "negative-case",
  "component": {
    "type_term": "cc:runtime_component",
    "identity": {
      "kind": "repository_path",
      "repository": "example/retry-service",
      "path": "src/retry-config.mjs"
    }
  },
  "observation": {
    "kind": "return_value"
  }
}
```

```json response:repair-draft
{
  "outcome": "saved",
  "bindings": {
    "obligation": {
      "negative-rejection": "<draft-obligation-id>"
    },
    "case": {
      "negative-case": "<draft-case-id>"
    }
  },
  "unit": "<unit>",
  "revision": "<draft-revision>"
}
```

Use the obligation and case IDs returned by the saved draft. Keep the other records, including the zero obligation. If the save was refused instead, follow its recovery; do not attempt to repair an unsaved case.

A successful save reports persistence, not validity. Assess this saved draft and follow its diagnosis:

```json request:repair-assess-draft workspace_assess_contract
{
  "unit": "<unit>"
}
```

```json response:repair-assess-draft
{
  "unit": "<unit>",
  "assessment": {
    "authored": "invalid",
    "specification": "incomplete"
  }
}
```

The case diagnosis identifies the missing test target and falsification input. Use the revision returned by the draft save for the repair. If the unit has changed, follow the returned current-context read and use its `contexts[unit].revision` instead.

Update the existing obligation by its returned ID. A `case` with neither `key` nor `id` updates that obligation's own case. Supply the missing target and falsifier; omitted component and observation are retained:

```json request:repair-save save_record
{
  "unit": "<unit>",
  "revision": "<draft-revision>",
  "changes": {
    "obligations": [
      {
        "id": "<draft-obligation-id>",
        "case": {
          "target": {
            "path": "tests/unit/retry-config.test.mjs",
            "selector": {
              "name": "rejects negative retry limits",
              "nesting": 0
            }
          },
          "falsification": {
            "strategy": "dependency_failure",
            "module_path": "src/retry-config.mjs"
          }
        }
      }
    ]
  }
}
```

```json response:repair-save
{
  "outcome": "saved",
  "unit": "<unit>",
  "revision": "<repaired-revision>"
}
```

Confirm that the save succeeded, then reassess:

```json request:repair-assess workspace_assess_contract
{
  "unit": "<unit>"
}
```

```json response:repair-assess
{
  "unit": "<unit>",
  "assessment": {
    "authored": "valid",
    "specification": "incomplete"
  }
}
```

The case is now valid; the expected field records still need the definitions from step 4. Read the repaired obligation and case together to check that their identities, statement, links, component and observation remain intact, and that the case now has its target and falsifier:

```json request:repair-saved-coverage workspace_read_wiki
{
  "reads": [
    {
      "subject": "<unit>",
      "select": {
        "contract": "obligations",
        "where": {
          "kind": "obligation",
          "id": "<draft-obligation-id>"
        }
      }
    },
    {
      "subject": "<unit>",
      "select": {
        "contract": "cases",
        "where": {
          "kind": "case",
          "id": "<draft-case-id>"
        }
      }
    }
  ]
}
```

If the expected field records still need definitions, complete step 4 before preparing dispatch. For a stale revision or refused save, follow the tool's returned recovery.
