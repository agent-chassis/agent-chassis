# From a user request to a worker assignment

This page follows one user request from the moment it arrives to a worker assignment that is ready for an authorized dispatch. It is for an orchestrator who has not used AgentChassis before and should not have to read its implementation or test fixtures to assemble the calls.

Tool discovery explains each field. This page shows how the pieces connect: which call produces the value the next call needs, and which record links to which.

The live tool schemas define request syntax: where a request shown here differs from the schema your session serves, follow the schema. A difference that would change meaning, scope or authority is not a syntax matter. Surface it instead of resolving it yourself.

## Contents

- [Workflow and responsibilities](#workflow-and-responsibilities)
- [The example](#the-example)
- [1. Record the request](#1-record-the-request)
- [2. Find the authoring guidance and the proof](#2-find-the-authoring-guidance-and-the-proof)
- [3. Save the requirement and its evidence plan](#3-save-the-requirement-and-its-evidence-plan)
- [4. Read back and assess the work item](#4-read-back-and-assess-the-work-item)
- [5. Prepare the worker's slice](#5-prepare-the-workers-slice)
- [6. Give the slice its own coverage](#6-give-the-slice-its-own-coverage)
- [7. Assess the slice and stop at dispatch](#7-assess-the-slice-and-stop-at-dispatch)
- [Repairing an incomplete saved case](#repairing-an-incomplete-saved-case)
- [Common gotchas](#common-gotchas)

## Workflow and responsibilities

You decide what must be true and what evidence would show it. The worker implements the change and writes the tests. The tools store your decisions, check that they are complete and connected, and return the identities you need for the next call.

| Stage | Your responsibility | Tools |
| --- | --- | --- |
| Record | Capture the user's request and scope in a work item. | `workspace_create_record`, `workspace_read_wiki` |
| Discover | Read the authoring guidance; choose a proof and read it completely. | `workspace_read_wiki`, `workspace_find_proofs` |
| Specify | Save the outcome, the required behavior, how it is checked, and the test that checks it. | `save_record` |
| Assign | Shape one bounded slice with the context a worker needs, and give it its own coverage. | `save_record`, `workspace_read_wiki` |
| Assess | Check that the saved inputs are complete, then judge yourself whether they cover the request. | `workspace_assess_contract` |
| Dispatch | Start the worker, when the operator and repository policy authorize it. | `start_agent` |

This page stops before dispatch. The design work and design reviews that the repository requires for a unit come before any implementation dispatch; this page assumes they are done. Proof execution, delivery review, integration and landing follow the repository's own policy and are not shown.

Three results are separate, and none implies the next:

- **Authored validity.** `workspace_assess_contract` reports that the saved inputs are complete and consistent.
- **Semantic coverage.** The saved criteria, requirements and tests actually cover what the user asked for. Only you judge this.
- **Executed evidence.** A saved proof ran against delivered source. Nothing on this page executes a proof or earns credit.

## The example

The user asks:

> `readRetryConfig` must reject a negative numeric `retryLimit` with `retry_limit_negative`.

The rest is what the orchestrator learned by inspecting the fictional repository `example/retry-service`. These are facts about this example, not requirements of the tools:

- `readRetryConfig` lives in `src/retry-config.mjs`. It reports a rejection by returning an object with `ok: false` and a `code`; it does not throw.
- A test named `rejects negative retry limits` already exists at the top level of `tests/unit/retry-config.test.mjs`. The worker will extend it.
- The repository's tests run under Node's built-in runner. Its native command is `node --test tests/unit/retry-config.test.mjs`.

That command names what must run, not how a session runs it. Each role runs tests through the tooling its session supports; a managed session uses `workspace_run_test`, not a direct shell.

The request has two parts, and both must survive authoring: the input is **rejected**, and the rejection carries the **exact code**. A generic rejection does not satisfy it. Zero, positive and non-numeric limits are outside the request.

The plan is saved as six connected records:

| Record | What it states | In this example |
| --- | --- | --- |
| Criterion | A readable outcome the unit accepts. | Negative limits receive the specified rejection. |
| Requirement | The behavior the software must have. | `readRetryConfig` returns that rejection when the numeric limit is below zero. |
| Verification | What a check observes and what result contradicts the requirement. It belongs to its requirement. | The test observes the returned result; acceptance or a wrong code contradicts it. |
| Obligation | The link from criteria to requirements, with the proof that checks it. | Ties the criterion to the requirement and selects the proof. |
| Case | The concrete test of one verification. | The reader module, the named test, what it inspects. |
| Slice | The bounded assignment a worker receives. | Change the reader and extend its test. |

Similar wording connects nothing. A criterion is covered only when an obligation names it.

Each request block below is labelled with its step and its tool, and holds that tool's complete arguments. `<name>` marks a value an earlier response returned. Everything else is your own decision or a term the guidance in step 2 publishes. Response blocks are illustrative excerpts: they show only the fields this page uses, and real answers carry more.

## 1. Record the request

Create the work item with the user's words:

```json request:create workspace_create_record
{
  "kind": "work_item",
  "title": "Reject negative retry limits",
  "initial": {
    "base_branch": "main",
    "user_requirements": "readRetryConfig must reject a negative numeric retryLimit with retry_limit_negative."
  }
}
```

```json response:create
{"outcome": "created", "unit": "<unit>"}
```

`<unit>` is the work item's identity. Every save names the revision it was written against, so read the unit now:

```json request:read-parent workspace_read_wiki
{"subject": "<unit>"}
```

```json response:read-parent
{"subject": "<unit>", "revision": "<parent-revision>"}
```

## 2. Find the authoring guidance and the proof

**Guidance.** The requirement fields in step 3 use a fixed vocabulary. Read it before writing them. The first call returns a compact context, not the guidance itself:

```json request:guidance workspace_read_wiki
{"subject": {"requirement_guidance": true}}
```

```json response:guidance
{"source_kind": "requirement_guidance", "reference": {"ref_id": "<guidance-ref>"}}
```

That context lists the available topics and returns a reference. Adding a `topic` to the subject narrows the same compact context; it still does not return the topic's content. Read a topic completely by selecting it through the reference:

```json request:guidance-vocabulary workspace_read_wiki
{"reference": {"ref_id": "<guidance-ref>"}, "select": {"guidance": ["vocabulary"]}}
```

This returns every accepted type term, identity kind, relation term and applicability mode. Reuse the same reference with a different topic name for the others this example needs:

- `fields`: what subject, behavior, observes and fails_when each state.
- `save_record_inputs`: how obligations, criteria, proofs and cases associate, and where a label may be used.
- `case_authoring`: the members of a test case, including falsification support.

**Proof.** A proof is the supported mechanism that will later check the evidence. Browse the catalogue, then read the candidate completely before selecting it:

```json request:proofs workspace_find_proofs
{}
```

```json response:proofs
{"answer": "catalogue", "next_calls": {"select": {"arguments": {"result": {"ref_id": "<catalogue-ref>"}}}}}
```

The catalogue returns one selection call as a pattern. Keep its `result` and name the proof to read:

```json request:proof workspace_find_proofs
{"result": {"ref_id": "<catalogue-ref>"}, "selection": {"proof_name": "proof.verification.test-validity"}}
```

Read its assertion and its exclusions. This proof establishes facts about one identified test: it is the declared test, it ran unskipped and passed against authenticated source, and its declared falsifier was detected. It explicitly does not decide whether that test covers the requirement. That judgment stays with you.

The proof's answer lists, under `next_calls.choose_family.choices`, each test family it supports with its runner and its exact call. Choose the one that runs this repository's tests and read its authoring requirements:

```json request:proof-family workspace_find_proofs
{"proof_name": "proof.verification.test-validity", "target_family": "node-test", "part": {"kind": "authoring"}}
```

```json response:proof-family
{
  "authoring": {
    "family": {
      "selected": "node-test",
      "runner": "node-test",
      "target": {"fields": ["path", "selector.name", "selector.nesting"]}
    }
  }
}
```

The same answer lists, under `authoring.save.missing_inputs`, what you must still supply, and under `authoring.family.falsification.strategies`, each supported falsifier with its required fields. A falsifier deliberately breaks something to confirm the test notices. Whether a strategy actually fits a test is checked only when the proof later runs, not when you save.

Falsifier support for a test is in one of three states, and they are authored differently:

- **Established.** You inspected the family's strategies and the test, and one fits. Author that strategy. Here, `dependency_failure` makes one JavaScript module loaded by the selected test fail, and reading the existing test showed that it loads `src/retry-config.mjs`.
- **Unknown.** You have not inspected both. Inspect them. Do not guess a strategy, and do not declare support absent to move on.
- **Established as absent.** You inspected the family's strategies and none accepts this test's shape. Author `"falsification": {"support": "registry_unsupported"}`. The proof then runs the test and reports the absent falsifier as a disclosed limitation. It earns no detection credit: nothing has shown that the test can fail.

In no state do you tell the worker to restructure tests or production code to fit a strategy.

## 3. Save the requirement and its evidence plan

Decide the meaning first. The fields only carry it.

| Decision | This example | Field |
| --- | --- | --- |
| What must behave this way? | The function `readRetryConfig`. | `subject` |
| Under what condition, with what result? | When numeric `retryLimit` is below zero, it returns a rejection with `ok: false` and code `retry_limit_negative`. | `behavior` |
| What checks it? | The test file. | `verification.verifier` |
| What does the check examine? | The reader, the negative input, and the returned rejection. | `verification.observes` |
| What observable result contradicts the requirement? | The negative value is accepted, a different code is returned, or the reader throws. | `verification.fails_when` |

The last row is your specification of the incorrect behavior the test must reject. You do not write the test, pick its inputs or choose its assertions; the worker does. In the request, `reference:returns`, `reference:covers` and `reference:has_state` are relation terms from the vocabulary, and `applies` with mode `when` carries the condition.

Two distinctions matter in this request:

- **Component and target.** In the case, `component` is the production code under test (`src/retry-config.mjs`). `target` is the test that exercises it: the file, the test's name and its nesting depth, the fields the family listed in step 2. They are never the same file.
- **Labels and identities.** Each new row carries a `key`, a label that exists only inside this one request. `$negative-rejected` and `$reject-negative` point at rows created in the same request. The response replaces every label with a durable identity, and later requests use the identity.

Save everything together so the links resolve in one change:

```json request:save-parent save_record
{
  "unit": "<unit>",
  "revision": "<parent-revision>",
  "changes": {
    "controlled_acceptance": {"disposition": "required"},
    "criteria": [
      {
        "key": "negative-rejected",
        "text": "For numeric retryLimit < 0, readRetryConfig returns a rejection with ok=false and code=retry_limit_negative."
      }
    ],
    "validation": ["Run tests/unit/retry-config.test.mjs with the Node test runner."],
    "requirements": [
      {
        "key": "reject-negative",
        "nature": "behavior",
        "modality": "MUST",
        "subject": {
          "declare": {
            "type_term": "cc:operation",
            "identity": {
              "kind": "code_symbol",
              "repository": "example/retry-service",
              "path": "src/retry-config.mjs",
              "symbol": "readRetryConfig"
            }
          }
        },
        "behavior": {
          "relation": "reference:returns",
          "applies": {
            "mode": "when",
            "context": [
              {
                "declare": {
                  "type_term": "cc:configuration",
                  "identity": {"kind": "profile_term", "term": "numeric retryLimit < 0"}
                }
              }
            ]
          },
          "objects": [
            {
              "referent": {
                "declare": {
                  "type_term": "cc:state",
                  "identity": {
                    "kind": "profile_term",
                    "term": "returned rejection with ok=false and code=retry_limit_negative"
                  }
                }
              }
            }
          ]
        },
        "verification": {
          "key": "negative-test",
          "method": "test_execution",
          "verifier": {
            "declare": {
              "type_term": "cc:test",
              "identity": {
                "kind": "repository_path",
                "repository": "example/retry-service",
                "path": "tests/unit/retry-config.test.mjs"
              }
            }
          },
          "observes": {
            "relation": "reference:covers",
            "objects": [
              {
                "referent": {
                  "declare": {
                    "type_term": "cc:operation",
                    "identity": {
                      "kind": "code_symbol",
                      "repository": "example/retry-service",
                      "path": "src/retry-config.mjs",
                      "symbol": "readRetryConfig"
                    }
                  }
                }
              },
              {
                "referent": {
                  "declare": {
                    "type_term": "cc:configuration",
                    "identity": {"kind": "profile_term", "term": "numeric retryLimit < 0"}
                  }
                }
              },
              {
                "referent": {
                  "declare": {
                    "type_term": "cc:state",
                    "identity": {
                      "kind": "profile_term",
                      "term": "returned rejection with ok=false and code=retry_limit_negative"
                    }
                  }
                }
              }
            ]
          },
          "fails_when": {
            "relation": "reference:has_state",
            "objects": [
              {
                "referent": {
                  "declare": {
                    "type_term": "cc:state",
                    "identity": {
                      "kind": "profile_term",
                      "term": "negative numeric retryLimit is accepted, returns a different code, or throws instead of returning the specified rejection"
                    }
                  }
                }
              }
            ]
          }
        }
      }
    ],
    "obligations": [
      {
        "key": "negative-rejection",
        "statement": "For numeric retryLimit < 0, readRetryConfig returns a rejection with ok=false and code=retry_limit_negative.",
        "criteria": ["$negative-rejected"],
        "claims": ["$reject-negative"],
        "proof": {"name": "proof.verification.test-validity"},
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
            "selector": {"name": "rejects negative retry limits", "nesting": 0}
          },
          "observation": {"kind": "return_value"},
          "falsification": {"strategy": "dependency_failure", "module_path": "src/retry-config.mjs"}
        }
      }
    ]
  }
}
```

How the parts connect:

- `controlled_acceptance: required` states that this work has implementation obligations. It is authored once, on the work item.
- The obligation's `criteria` names the criterion it covers and its `claims` names the requirement it supports.
- Naming the requirement makes its one verification eligible, so the case adopts that verification without naming it.
- `proof.name` selects the proof read in step 2. `case` supplies the test details that proof requires.

```json response:save-parent
{
  "outcome": "saved",
  "bindings": {
    "criterion": {"negative-rejected": "<parent-criterion-id>"},
    "requirement": {"reject-negative": "<requirement-id>"},
    "verification": {"negative-test": "<verification-id>"},
    "obligation": {"negative-rejection": "<parent-obligation-id>"},
    "case": {"negative-case": "<case-id>"}
  }
}
```

Keep `<requirement-id>` and `<case-id>`; step 6 reuses them. If a save answers `complete: false`, follow the read call it returns to obtain the whole receipt.

## 4. Read back and assess the work item

The save changed the revision. Read the unit again and keep the new one:

```json request:read-parent-saved workspace_read_wiki
{"subject": "<unit>"}
```

```json response:read-parent-saved
{"subject": "<unit>", "revision": "<parent-revision-saved>"}
```

Then assess what was saved:

```json request:assess-parent workspace_assess_contract
{"unit": "<unit>"}
```

```json response:assess-parent
{
  "unit": "<unit>",
  "assessment": {
    "authored": {"status": "valid"},
    "acceptance_coverage": {"status": "complete", "criteria": 1, "covered": 1, "uncovered": 0},
    "execution": {"status": "not_started", "proofs_executed": 0, "credit_granted": 0}
  }
}
```

`valid` and `complete` describe the saved inputs: every criterion has an obligation, and every obligation is complete. They say nothing about whether the code works or whether the right thing was asked for. When the status is not valid, follow the diagnosis and read call the answer returns; it supplies no replacement meaning.

Now check semantic coverage yourself. Reread the user's request beside what you saved and look for anything omitted, narrowed or added:

- Is rejection still required? Yes: the behavior returns a rejection with `ok: false`.
- Is the exact code still required? Yes: it appears in the behavior, and a different code appears in `fails_when`.
- Was anything added? Returning rather than throwing comes from the repository's API, not from the user. That is a legitimate inspected fact, and worth knowing you introduced.

## 5. Prepare the worker's slice

A slice is the exact unit a worker receives. A managed worker sees its frozen assignment and the files in its scope. It does not see this conversation or changes you make after dispatch, so the slice must carry everything it needs:

- what to change and where,
- what its tests must demonstrate and which incorrect behavior they must reject,
- what is out of scope,
- which files it may read and write, and what validation must run.

Slices are created on the parent work item. `expected_edit_targets` names each symbol the worker is expected to touch; an implementation slice requires it.

```json request:save-slice save_record
{
  "unit": "<unit>",
  "revision": "<parent-revision-saved>",
  "changes": {
    "ready_slices": [
      {
        "key": "reject-negative-limit",
        "title": "Reject negative retry limits in readRetryConfig",
        "depends_on": [],
        "summary": {
          "text": "Make readRetryConfig in src/retry-config.mjs reject a negative numeric retryLimit. It reports rejections by returning an object with ok=false and a code; return code retry_limit_negative. Extend the existing top-level test rejects negative retry limits in tests/unit/retry-config.test.mjs. The test must demonstrate, for representative negative numeric values including an integer and a fraction, that the result is a rejection carrying exactly that code. It must fail if a negative value is accepted, if a different or generic code is returned, or if the reader throws instead of returning the rejection. You choose the inputs and assertions. Zero, positive and non-numeric limits are out of scope; preserve their behavior. Follow AGENTS.md. Run tests/unit/retry-config.test.mjs under the Node test runner through your session's supported test tooling, and report results or blockers."
        },
        "read_scope": ["AGENTS.md", "src/retry-config.mjs", "tests/unit/retry-config.test.mjs"],
        "repo_paths": ["src/retry-config.mjs", "tests/unit/retry-config.test.mjs"],
        "write_scope": ["src/retry-config.mjs", "tests/unit/retry-config.test.mjs"],
        "acceptance": {
          "criteria": [
            "The extended test rejects negative retry limits demonstrates that readRetryConfig returns a rejection with ok=false and code=retry_limit_negative for negative numeric retryLimit."
          ],
          "validation": ["Run tests/unit/retry-config.test.mjs with the Node test runner."]
        },
        "expected_edit_targets": [
          {"path": "src/retry-config.mjs", "name": "readRetryConfig", "kind": "function", "operation": "modify"},
          {
            "path": "tests/unit/retry-config.test.mjs",
            "name": "rejects negative retry limits",
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
{"outcome": "saved", "bindings": {"slice": {"reject-negative-limit": "<slice-id>"}}}
```

The slice's address is `<unit>#<slice-id>`. From here on it is read, saved and assessed as its own unit.

## 6. Give the slice its own coverage

Read the slice for its own revision:

```json request:read-slice workspace_read_wiki
{"subject": "<unit>#<slice-id>"}
```

```json response:read-slice
{"subject": "<unit>#<slice-id>", "revision": "<slice-revision>", "reference": {"ref_id": "<slice-ref>"}}
```

Then read its saved coverage through the returned reference:

```json request:slice-coverage workspace_read_wiki
{"reference": {"ref_id": "<slice-ref>"}, "select": {"contract": "coverage"}}
```

```json response:slice-coverage
{
  "members": {
    "controlled_acceptance": {"status": "required", "proof_posture": {"record_id": "<unit>"}},
    "acceptance_criteria": [
      {
        "identity": "<slice-criterion-id>",
        "text": "The extended test rejects negative retry limits demonstrates that readRetryConfig returns a rejection with ok=false and code=retry_limit_negative for negative numeric retryLimit."
      }
    ],
    "obligations": [],
    "cases": []
  }
}
```

This answer shows the difference between parent and slice coverage:

- The slice **inherits** the `required` disposition saved on `<unit>`.
- The slice **does not inherit** coverage. Its criterion is the slice's own outcome, stated in step 5, with the identity this read returns, `<slice-criterion-id>`. It has no obligations, although the parent is fully covered.

Give the slice its own obligation. Where you judge that the parent's requirement and test apply to the slice's criterion, reuse their identities and restate neither:

```json request:save-slice-coverage save_record
{
  "unit": "<unit>#<slice-id>",
  "revision": "<slice-revision>",
  "changes": {
    "obligations": [
      {
        "key": "slice-negative-rejection",
        "statement": "For numeric retryLimit < 0, readRetryConfig returns a rejection with ok=false and code=retry_limit_negative.",
        "criteria": ["<slice-criterion-id>"],
        "claims": ["<requirement-id>"],
        "proof": {"name": "proof.verification.test-validity"},
        "case": {"id": "<case-id>"}
      }
    ]
  }
}
```

```json response:save-slice-coverage
{"outcome": "saved", "bindings": {"obligation": {"slice-negative-rejection": "<slice-obligation-id>"}}}
```

Where each value came from:

| Value | Returned by |
| --- | --- |
| `<slice-revision>`, `<slice-criterion-id>` | The slice reads in this step. |
| `<requirement-id>`, `<case-id>` | The parent save in step 3. |

The proof is selected again on this obligation. `case.id` reuses the saved case, so no second case is created.

## 7. Assess the slice and stop at dispatch

Assess the exact slice:

```json request:assess-slice workspace_assess_contract
{"unit": "<unit>#<slice-id>"}
```

```json response:assess-slice
{
  "unit": "<unit>#<slice-id>",
  "assessment": {
    "authored": {"status": "valid"},
    "acceptance_coverage": {"status": "complete", "criteria": 1, "covered": 1, "uncovered": 0},
    "execution": {"status": "not_started", "proofs_executed": 0, "credit_granted": 0}
  }
}
```

Resolve any reported gap through the diagnosis and read call the answer returns. Then make the checks the assessment cannot:

- Could a worker with only the slice text and its scoped files do the work?
- Does the slice still require both the rejection and the exact code?
- Does it state the incorrect behavior the test must reject?
- Did the slice narrow the request or add anything the user did not ask for?

When the operator and the repository's policy authorize a managed worker for this slice, the dispatch call is `start_agent` with:

```json unsent:dispatch start_agent
{"subject": "<unit>#<slice-id>"}
```

This page stops before that call. A valid assessment describes the saved inputs; it is not permission to dispatch. After delivery, you compare the worker's actual implementation and test against the same request, and obtain the executed evidence and reviews the repository requires.

## Repairing an incomplete saved case

A save that is well formed but incomplete is stored, not refused. Suppose the step 3 request had been sent before the test was identified, identical except that its case was only:

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
  "observation": {"kind": "return_value"}
}
```

```json response:repair-draft
{
  "outcome": "saved",
  "bindings": {
    "obligation": {"negative-rejection": "<draft-obligation-id>"},
    "case": {"negative-case": "<draft-case-id>"}
  },
  "assessment": {"authored": {"status": "invalid", "obligations": 1, "valid": 0, "invalid": 1}}
}
```

The obligation and its case exist and have identities. The requirement, criterion and verification were saved too. Repair that same obligation; do not delete and recreate it. First read the current revision:

```json request:repair-read workspace_read_wiki
{"subject": "<unit>"}
```

```json response:repair-read
{"subject": "<unit>", "revision": "<draft-revision>"}
```

Address the existing obligation by its returned identity and supply only the missing case members. A `case` with neither `key` nor `id` is that obligation's own case, and every member you omit is kept:

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
            "selector": {"name": "rejects negative retry limits", "nesting": 0}
          },
          "falsification": {"strategy": "dependency_failure", "module_path": "src/retry-config.mjs"}
        }
      }
    ]
  }
}
```

```json response:repair-save
{"outcome": "saved", "bindings": {}}
```

No new identity is returned because nothing was created. Reassess:

```json request:repair-assess workspace_assess_contract
{"unit": "<unit>"}
```

```json response:repair-assess
{
  "unit": "<unit>",
  "assessment": {
    "authored": {"status": "valid", "obligations": 1, "valid": 1, "invalid": 0},
    "acceptance_coverage": {"status": "complete", "criteria": 1, "covered": 1, "uncovered": 0}
  }
}
```

The same obligation and case are now complete, and their statement, links, component and observation are unchanged. A request the schema refuses is different: it answers `outcome: "refused"` and stores nothing, so there is nothing to repair.

## Common gotchas

- **A label is not an identity.** `$label` works only inside the request that creates the row. Afterwards, use the identity from that save's `bindings`.
- **Identities belong to the answer that issued them.** Never guess one, and never use a parent's revision or criterion identity on a slice.
- **Parent coverage does not reach a slice.** Save obligations on the slice, against the criterion identities the slice's own read returns.
- **Reuse a case; do not copy it.** A second obligation checked by the same test names `case: {"id": "<case-id>"}`. One verification belongs to one case.
- **Component is production code; target is the test.** Swapping them, or naming the test file for both, misdescribes the case.
- **A compact context is not the guidance.** Read a guidance topic through the returned reference and `select.guidance`.
- **"Valid" is not "covered", and neither is "passed".** Assessment checks the saved inputs. You check meaning. Only execution against delivered source produces evidence.
- **A passing test can still accept the wrong result.** A test that only checks for some rejection passes when the code is wrong. Compare the delivered assertions with the incorrect behavior you specified.
- **Unknown support is not absent support.** Inspect the family's falsifier strategies before declaring `registry_unsupported`, and never guess a strategy, reshape code to fit one, or drop the proof to make the assessment pass.
- **Specify evidence; do not write the test.** State what the test must demonstrate and reject. Inputs, assertions and structure are the worker's.
- **A native test command is not a tool.** Name what must run; each session runs it through its own supported test tooling.
