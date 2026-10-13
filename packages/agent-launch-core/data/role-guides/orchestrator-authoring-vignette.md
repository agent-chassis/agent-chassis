# From a user request to a worker assignment

This page follows one user request from the moment it arrives to a worker assignment that is ready for an authorized dispatch. It is for an orchestrator who has not used AgentChassis before and should not have to read its implementation or test fixtures to assemble the calls.

Tool discovery explains each field. This page shows how the pieces connect: which call produces the value the next call needs, and which record links to which.

The live tool schemas define request syntax: where a request shown here differs from the schema your session serves, follow the schema. A difference that would change meaning, scope or authority is not a syntax matter. Surface it instead of resolving it yourself.

## Contents

- [Workflow and responsibilities](#workflow-and-responsibilities)
- [The example](#the-example)
- [1. Record the request](#1-record-the-request)
- [2. Find the authoring guidance and the proof](#2-find-the-authoring-guidance-and-the-proof)
- [3. Save the requirements and their evidence plan](#3-save-the-requirements-and-their-evidence-plan)
- [4. Read back and assess the work item](#4-read-back-and-assess-the-work-item)
- [5. Prepare the worker's slice](#5-prepare-the-workers-slice)
- [6. Give the slice its own coverage](#6-give-the-slice-its-own-coverage)
- [7. Assess the slice and stop at dispatch](#7-assess-the-slice-and-stop-at-dispatch)
- [After delivery: check the assertions before accepting](#after-delivery-check-the-assertions-before-accepting)
- [Repairing an incomplete saved case](#repairing-an-incomplete-saved-case)
- [Common gotchas](#common-gotchas)

## Workflow and responsibilities

You decide what must be true and what evidence would show it. The worker implements the change and writes the tests. The tools store your decisions, check that they are complete and connected, and return the identities you need for the next call.

| Stage | Your responsibility | Tools |
| --- | --- | --- |
| Record | Capture the user's request and scope in a work item. | `workspace_create_record`, `workspace_read_wiki` |
| Discover | Read the authoring guidance; choose a proof and read it completely. | `workspace_read_wiki`, `workspace_find_proofs` |
| Specify | Decompose the request into checkable requirements; save each outcome, required behavior, how it is checked, and the test that checks it. | `save_record` |
| Assign | Shape one bounded slice with the context a worker needs, and give it its own coverage. | `save_record`, `workspace_read_wiki` |
| Assess | Check that the saved inputs are complete, then judge yourself whether they cover the request. | `workspace_assess_contract` |
| Dispatch | Start the worker, when the operator and repository policy authorize it. | `start_agent` |

This page sends nothing after the slice is assessed. The design work and design reviews that the repository requires for a unit come before any implementation dispatch; this page assumes they are done. Proof execution, delivery review, integration and landing follow the repository's own policy and are not shown as calls; the [last check before acceptance](#after-delivery-check-the-assertions-before-accepting) is described without them.

Four results are separate, and none implies the next:

- **Authored validity.** `workspace_assess_contract` reports that the saved inputs are complete and consistent, and that every criterion is named by an obligation. Those associations are the ones you declared.
- **Semantic coverage.** The saved criteria, requirements and tests actually cover everything the user asked for. Only you judge this.
- **Executed evidence.** A saved proof ran against delivered source. Nothing on this page executes a proof or earns credit.
- **Assertion adequacy.** The delivered assertions would fail for the incorrect behavior you specified. A passing run does not show it. Only reading them does.

## The example

The user asks:

> `readRetryConfig` must reject a negative numeric `retryLimit` with `retry_limit_negative`. Zero must still be accepted.

The rest is what the orchestrator learned by inspecting the fictional repository `example/retry-service`, before fixing scope or choosing evidence. Investigation began with `query_code_index` and the arguments `{"path": "src/retry-config.mjs"}`: a path alone asks for that file's committed context. The compact answer carries bounded code-graph paths; the related code and tests the index inferred stay in the retained answer, read through the calls the answer returns. The index answers from its last published commit and may not cover every file, so its answer is a list of candidates to read completely, not the whole picture. These are facts about this example, not requirements of the tools:

- `readRetryConfig` lives in `src/retry-config.mjs`. It reports a rejection by returning an object with `ok: false` and a `code`; it does not throw. An accepted read returns an object with `ok: true` and the `retryLimit` it read.
- The retained related code included `src/config-result.mjs`, whose `reject` helper builds that object. The change does not edit it, but a worker cannot write the rejection correctly without reading it, so it belongs in `read_scope` and not in `write_scope`.
- `tests/unit/retry-config.test.mjs` has two top-level tests. `accepts a valid retry limit` asserts only that a `retryLimit` of 3 is accepted: it passes whether or not a negative limit is rejected, so it cannot show the rejection or its code. `rejects negative retry limits` asserts on the result returned for a negative limit. The evidence plan selects both, and the worker will extend them.
- `tests/unit/config-result.test.mjs` already tests the `reject` helper. The change does not edit the helper or that test, and must not break either: it is an existing regression test for this slice.
- The repository's tests run under Node's built-in runner. Its native command is `node --test tests/unit/retry-config.test.mjs`.

That command names what must run, not how a session runs it. Each role runs tests through the tooling its session supports; a managed session uses `workspace_run_test`, not a direct shell.

### Decompose the request and map it to evidence

Before anything is saved, split the request into requirements that can each be checked on their own, and name the evidence that would establish each. Take every clause that bears on behavior, including a default, exception, option or interaction the request states or necessarily implies:

| | Requirement | From the request | Evidence that would establish it |
| --- | --- | --- | --- |
| R1 | A negative numeric `retryLimit` is rejected. | "must reject a negative numeric `retryLimit`" | `rejects negative retry limits` asserts on the result returned for negative values. |
| R2 | That rejection carries exactly `retry_limit_negative`. | "with `retry_limit_negative`" | The same assertion compares the code. |
| R3 | A `retryLimit` of zero is accepted. | "Zero must still be accepted." | An assertion on the result returned for exactly zero. |

R1 and R2 share one test, because one assertion on the returned result establishes both; a generic rejection satisfies R1 and not R2, so the assertion must compare the code. R3 is a different input and a different result, so that test establishes nothing about it. This is a judgment about what each piece of evidence shows. It is not a rule of one record or one test per clause, and it does not ask for every combination of inputs.

The first draft of this mapping got R3 wrong. It mapped R3 to `accepts a valid retry limit` as that test stands: it exists, it is about acceptance, and it passes. But its only input is 3. This reader passes both existing tests, and would pass the extended negative test too:

```js
export function readRetryConfig({ retryLimit }) {
  if (typeof retryLimit === "number" && retryLimit <= 0) return reject("retry_limit_negative");
  return { ok: true, retryLimit };
}
```

It rejects zero. A test that never passes zero cannot fail for it, so a passing `accepts a valid retry limit` leaves R3 unestablished. The corrected plan, the one in the table, requires an assertion on zero itself and names the rejection of zero as a result that contradicts the requirement.

One thing the request leaves open: whether a numeric string such as `"-1"` counts as numeric. Neither reading is the user's stated wish, so the plan does not choose one. The orchestrator asks the user, and until the answer arrives the question is recorded as open and non-numeric handling is left unchanged. Positive limits are outside the request.

The plan is saved as connected records:

| Record | What it states | In this example |
| --- | --- | --- |
| Criterion | A readable outcome the unit accepts. | Two: negative limits receive the specified rejection; zero is accepted. |
| Requirement | The behavior the software must have. | Two: `readRetryConfig` returns that rejection when the numeric limit is below zero (R1 and R2), and an acceptance when it is zero (R3). |
| Verification | What a check observes and what result contradicts the requirement. It belongs to its requirement. | One each. A test observes the returned result; acceptance or a wrong code contradicts the first, a rejected zero the second. |
| Obligation | The link from criteria to requirements, with the proof that checks it. | One each. Ties a criterion to its requirement and selects the proof. |
| Case | The concrete test of one verification. | One each. The reader module, the named test, what it inspects. |
| Slice | The bounded assignment a worker receives. | One. Change the reader and extend both tests. |

Similar wording connects nothing. A criterion is covered only when an obligation names it, and an obligation naming it shows only that you declared the link.

Each request block below is labelled with its step and its tool, and holds that tool's complete arguments. `<name>` marks a value an earlier response returned. Everything else is your own decision or a term the guidance in step 2 publishes. Response blocks are illustrative excerpts: they show only the fields this page uses, and real answers carry more.

## 1. Record the request

Create the work item with the user's words:

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

## 3. Save the requirements and their evidence plan

Decide the meaning first. The fields only carry it. Each requirement from the mapping answers the same five questions; the table shows the first, and the zero requirement answers them in the request below.

| Decision | This example | Field |
| --- | --- | --- |
| What must behave this way? | The function `readRetryConfig`. | `subject` |
| Under what condition, with what result? | When numeric `retryLimit` is below zero, it returns a rejection with `ok: false` and code `retry_limit_negative`. | `behavior` |
| What checks it? | The test file. | `verification.verifier` |
| What does the check examine? | The reader, the negative input, and the returned rejection. | `verification.observes` |
| What observable result contradicts the requirement? | The negative value is accepted, a different code is returned, or the reader throws. | `verification.fails_when` |

The last row is your specification of the incorrect behavior the test must reject. You do not write the test, pick its inputs or choose its assertions; the worker does. In the request, `reference:returns`, `reference:covers` and `reference:has_state` are relation terms from the vocabulary, and `applies` with mode `when` carries the condition.

The requirements are one batch. Everything a requirement is about is declared once under `entities` and then named by its id wherever it is used. The function and test file have explicit code-symbol or repository-path identities; the condition and result rows below carry names and types. Those identities and types do not supply a missing description. `fails_when` is a statement about the requirement's own subject.

The controlled grammar is closed within the declared subject, relation and applicability. `MUST returns x` requires x whenever its condition applies. Without an explicitly declared alternative, neither y nor x plus y is permitted, and authors need not add `only`. `MAY returns x` permits x without requiring occurrence: it does not require occasional occurrence or permit an undeclared y. For this example, each applicable invocation must return the described rejection or acceptance for its condition; finding that result alongside an undeclared result is insufficient.

A referenced object such as `correct-result` must resolve to a described object: an existing code-bound object using explicit references (including SCIP where available), or an object defined within the specification through the existing grammar. The prose here describes the intended conditions and results, but the sample's type-only entity rows do not establish that their descriptions are resolved in the saved specification. Treat missing grounding as unresolved before claiming semantic completeness. Missing meaning does not create permission, and a descriptive name is not a substitute for the object's definition.

Preserve the existing grammar and compiler; generated CEL remains compiler output, not a directly authored replacement. Saved/read descriptions resolve each reference according to its use and scope. A condition needs a defined Boolean predicate; a returned object needs its value, structure, population, callable behavior or exact value source. An unrelated statement or an inactive definition supplies neither. Do not add redundant existence assertions: reference resolution already needs a definition, and missing meaning remains incomplete. Requirements whose actual subject is existence retain their existing meaning. Unsupported qualifiers remain explicit and withhold conformance credit.

`number:returns` governs a singular result. Its list observation preserves absence and extra values for evaluation: MUST accepts exactly the declared value, MAY accepts absence or that value, and MUST_NOT prohibits its value. Closure and singularity are enforced in conformance. Set-valued relations retain their own semantics. The request syntax below illustrates authoring; a successful save or assessment supplies no implementation or proof credit.

A condition's Boolean statement defines when it holds independently of its modality. A MAY definition can resolve a condition without requiring it to be true; a false resolved condition makes an `if` requirement inactive. Referencing a statement as a condition does not remove its independently authored MUST/MUST_NOT obligation. Whole and selected compilation retain these obligations on necessary condition dependencies; missing or ambiguous predicates remain incomplete.

Two distinctions matter in this request:

- **Component and target.** In the case, `component` is the production code under test (`src/retry-config.mjs`). `target` is the test that exercises it: the file, the test's name and its nesting depth, the fields the family listed in step 2. They are never the same file.
- **Labels and identities.** Each new row carries a `key`, a label that exists only inside this one request. `$negative-rejected` and `$reject-negative`, like `$zero-accepted` and `$accept-zero`, point at rows created in the same request. The response replaces every label with a durable identity, and later requests use the identity.

Save everything together so the links resolve in one change:

```json request:save-parent save_record
{
  "unit": "<unit>",
  "revision": "<parent-revision>",
  "changes": {
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
      "Run tests/unit/retry-config.test.mjs with the Node test runner."
    ],
    "requirements": {
      "entities": {
        "readRetryConfig": {
          "type_term": "cc:operation",
          "identity": {
            "kind": "code_symbol",
            "repository": "example/retry-service",
            "path": "src/retry-config.mjs",
            "symbol": "readRetryConfig"
          }
        },
        "numeric retryLimit < 0": "cc:configuration",
        "returned rejection with ok=false and code=retry_limit_negative": "cc:state",
        "tests/unit/retry-config.test.mjs": {
          "type_term": "cc:test",
          "identity": {
            "kind": "repository_path",
            "repository": "example/retry-service",
            "path": "tests/unit/retry-config.test.mjs"
          }
        },
        "negative numeric retryLimit is accepted, returns a different code, or throws instead of returning the specified rejection": "cc:state",
        "retryLimit = 0": "cc:configuration",
        "returned acceptance with ok=true and retryLimit=0": "cc:state",
        "retryLimit 0 is rejected, or throws instead of returning the specified acceptance": "cc:state"
      },
      "requirements": [
        {
          "key": "reject-negative",
          "nature": "behavior",
          "modality": "MUST",
          "subject": "readRetryConfig",
          "behavior": {
            "relation": "reference:returns",
            "applies": {
              "mode": "when",
              "context": [
                "numeric retryLimit < 0"
              ]
            },
            "objects": [
              {
                "referent": "returned rejection with ok=false and code=retry_limit_negative"
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
                  "referent": "returned rejection with ok=false and code=retry_limit_negative"
                }
              ]
            },
            "fails_when": {
              "relation": "reference:has_state",
              "objects": [
                {
                  "referent": "negative numeric retryLimit is accepted, returns a different code, or throws instead of returning the specified rejection"
                }
              ]
            }
          }
        },
        {
          "key": "accept-zero",
          "nature": "behavior",
          "modality": "MUST",
          "subject": "readRetryConfig",
          "behavior": {
            "relation": "reference:returns",
            "applies": {
              "mode": "when",
              "context": [
                "retryLimit = 0"
              ]
            },
            "objects": [
              {
                "referent": "returned acceptance with ok=true and retryLimit=0"
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
                  "referent": "returned acceptance with ok=true and retryLimit=0"
                }
              ]
            },
            "fails_when": {
              "relation": "reference:has_state",
              "objects": [
                {
                  "referent": "retryLimit 0 is rejected, or throws instead of returning the specified acceptance"
                }
              ]
            }
          }
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

How the parts connect:

- `controlled_acceptance: required` states that this work has implementation obligations. It is authored once, on the work item.
- Each obligation's `criteria` names the criterion it covers and its `claims` names the requirement it supports.
- Naming the requirement makes its one verification eligible, so the obligation's case adopts that verification without naming it.
- The two cases name different tests. R1 and R2 are one requirement with one case; nothing was added to give each clause a row.
- `proof.name` selects the proof read in step 2. `case` supplies the test details that proof requires.

```json response:save-parent
{
  "outcome": "saved",
  "bindings": {
    "criterion": {"negative-rejected": "<parent-criterion-id>", "zero-accepted": "<zero-criterion-id>"},
    "requirement": {
      "reject-negative": {"state": "complete", "claim_ids": ["<requirement-id>"]},
      "accept-zero": {"state": "complete", "claim_ids": ["<zero-requirement-id>"]}
    },
    "verification": {"negative-test": "<verification-id>", "zero-test": "<zero-verification-id>"},
    "obligation": {"negative-rejection": "<parent-obligation-id>", "zero-acceptance": "<zero-obligation-id>"},
    "case": {"negative-case": "<case-id>", "zero-case": "<zero-case-id>"}
  }
}
```

A requirement label answers with its saved row: the row's own identity, its state, and every claim identity it emits, one here. Keep both requirement claim identities and both case identities; step 6 reuses them. If a save answers `complete: false`, follow the read call it returns to obtain the whole receipt.

Current requirement modalities are MUST, MUST_NOT and MAY; recommendations
are refused. The named rejection/acceptance objects in this example do not,
by their names or types, define their fields. Saved description reads require
operative defining statements or exact committed definition source, including
necessary conditions and subobjects. Unsupported field/value meaning remains
incomplete; coverage associations and passing tests cannot fill it. Description
completeness is separate from the association counts below.

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
    "acceptance_coverage": {"status": "complete", "criteria": 2, "covered": 2, "uncovered": 0},
    "execution": {"status": "not_started", "proofs_executed": 0, "credit_granted": 0}
  }
}
```

`valid` and `complete` describe the saved inputs: every criterion has an obligation, and every obligation is complete. `complete` counts the associations you declared. Had the first-draft mapping been saved, with R3 left to a test that never passes zero, this answer would read the same, 2 of 2. They say nothing about whether the code works, whether the right thing was asked for, or whether the selected test can establish its requirement. When the status is not valid, follow the diagnosis and read call the answer returns; it supplies no replacement meaning.

Now check semantic coverage yourself. Reread the user's request beside what you saved, one decomposed requirement at a time, and look for anything omitted, narrowed or added:

- R1, is rejection still required? Yes: the behavior returns a rejection with `ok: false`.
- R2, is the exact code still required? Yes: it appears in the behavior, and a different code appears in `fails_when`.
- R3, is zero still accepted? Yes: it has its own requirement, and a rejected zero appears in its `fails_when`.
- Was anything narrowed? The numeric-string question is still open with the user, and nothing saved answers it.
- Was anything added? Returning rather than throwing comes from the repository's API, not from the user. That is a legitimate inspected fact, and worth knowing you introduced.

## 5. Prepare the worker's slice

A slice is the exact unit a worker receives. A managed worker sees its frozen assignment and the files in its scope. It does not see this conversation or changes you make after dispatch, so the slice must carry everything it needs:

- what to change and where,
- what its tests must demonstrate and which incorrect behavior they must reject,
- what is out of scope,
- which files it may read and write, and what validation must run.

Slices are created on the parent work item. `read_scope` is built from what the worker must read to understand and make the change, so it is wider than `write_scope`: it adds `src/config-result.mjs`, the supporting file found during investigation. `expected_edit_targets` names each symbol the worker is expected to touch; an implementation slice requires it.

`regression_tests` is optional. It lists existing test files, as literal repository-relative paths, that must still pass after the change. Here it names `tests/unit/config-result.test.mjs`, found during investigation. Choosing a test outside the slice's `write_scope` is advice, because the worker is not asked to change it; nothing enforces that, and the list does not protect the file. The list adds nothing to `read_scope` or `write_scope`: a declared file runs on the host even when the worker cannot read it. It names files only, never a runner or a command.

```json request:save-slice save_record
{
  "unit": "<unit>",
  "revision": "<parent-revision-saved>",
  "changes": {
    "ready_slices": [
      {
        "key": "reject-negative-limit",
        "title": "Reject negative retry limits in readRetryConfig and keep zero accepted",
        "depends_on": [],
        "summary": {
          "text": "Make readRetryConfig in src/retry-config.mjs reject a negative numeric retryLimit while still accepting zero. It reports rejections by returning an object with ok=false and a code, built by reject in src/config-result.mjs, which you read but do not change; return code retry_limit_negative. An accepted read returns ok=true and the retryLimit it read. Extend the two existing top-level tests in tests/unit/retry-config.test.mjs. rejects negative retry limits must demonstrate, for representative negative numeric values including an integer and a fraction, that the result is a rejection carrying exactly that code; it must fail if a negative value is accepted, if a different or generic code is returned, or if the reader throws instead of returning the rejection. accepts a valid retry limit must demonstrate that a retryLimit of exactly 0 is accepted and returned as 0; it must fail if zero is rejected, which a reader that rejects every limit at or below zero would do. An assertion on a positive limit does not show this. You choose the other inputs and the assertions. Whether a numeric string such as \"-1\" counts as numeric is an open question with the user: do not change how non-numeric limits are handled. Positive limits are out of scope; preserve their behavior. Follow AGENTS.md. Run tests/unit/retry-config.test.mjs under the Node test runner through your session's supported test tooling, and report results or blockers."
        },
        "read_scope": ["AGENTS.md", "src/retry-config.mjs", "src/config-result.mjs", "tests/unit/retry-config.test.mjs"],
        "repo_paths": ["src/retry-config.mjs", "tests/unit/retry-config.test.mjs"],
        "write_scope": ["src/retry-config.mjs", "tests/unit/retry-config.test.mjs"],
        "regression_tests": ["tests/unit/config-result.test.mjs"],
        "acceptance": {
          "criteria": [
            "The extended test rejects negative retry limits demonstrates that readRetryConfig returns a rejection with ok=false and code=retry_limit_negative for negative numeric retryLimit.",
            "The extended test accepts a valid retry limit demonstrates that readRetryConfig returns an acceptance with ok=true and retryLimit=0 for retryLimit 0."
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
          },
          {"path": "tests/unit/retry-config.test.mjs", "name": "accepts a valid retry limit", "kind": "test_case", "operation": "modify"}
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
      },
      {
        "identity": "<slice-zero-criterion-id>",
        "text": "The extended test accepts a valid retry limit demonstrates that readRetryConfig returns an acceptance with ok=true and retryLimit=0 for retryLimit 0."
      }
    ],
    "obligations": [],
    "cases": []
  }
}
```

This answer shows the difference between parent and slice coverage:

- The slice **inherits** the `required` disposition saved on `<unit>`.
- The slice **does not inherit** coverage. Its criteria are the slice's own outcomes, stated in step 5, with the identities this read returns. It has no obligations, although the parent is fully covered.

Give the slice its own obligations. Where you judge that a parent requirement and its test apply to a slice criterion, reuse their identities and restate neither:

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
      },
      {
        "key": "slice-zero-acceptance",
        "statement": "For retryLimit = 0, readRetryConfig returns an acceptance with ok=true and retryLimit=0.",
        "criteria": ["<slice-zero-criterion-id>"],
        "claims": ["<zero-requirement-id>"],
        "proof": {"name": "proof.verification.test-validity"},
        "case": {"id": "<zero-case-id>"}
      }
    ]
  }
}
```

```json response:save-slice-coverage
{
  "outcome": "saved",
  "bindings": {"obligation": {"slice-negative-rejection": "<slice-obligation-id>", "slice-zero-acceptance": "<slice-zero-obligation-id>"}}
}
```

Where each value came from:

| Value | Returned by |
| --- | --- |
| `<slice-revision>`, `<slice-criterion-id>`, `<slice-zero-criterion-id>` | The slice reads in this step. |
| `<requirement-id>`, `<case-id>`, `<zero-requirement-id>`, `<zero-case-id>` | The parent save in step 3. |

The proof is selected again on each obligation. `case.id` reuses a saved case, so no further case is created.

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
    "acceptance_coverage": {"status": "complete", "criteria": 2, "covered": 2, "uncovered": 0},
    "execution": {"status": "not_started", "proofs_executed": 0, "credit_granted": 0}
  }
}
```

Resolve any reported gap through the diagnosis and read call the answer returns. Then make the checks the assessment cannot:

- Could a worker with only the slice text and its scoped files do the work?
- Does the slice still carry every decomposed requirement: the rejection, the exact code, and the accepted zero?
- Does it state, for each, the incorrect behavior its test must reject?
- Did the slice narrow the request or add anything the user did not ask for?

When the operator and the repository's policy authorize a managed worker for this slice, the dispatch call is `start_agent` with:

```json unsent:dispatch start_agent
{"subject": "<unit>#<slice-id>"}
```

This page stops before that call. A valid assessment describes the saved inputs; it is not permission to dispatch. After delivery, you obtain the executed evidence and reviews the repository requires, and make the check below before accepting.

## After delivery: check the assertions before accepting

This section sends no call. Suppose the worker delivers and `verify_proof` reports that both selected tests ran unskipped, passed, and had their falsifier detected. That is executed evidence about the tests. The falsifier breaks the reader module, and any test that loads it then fails, so detection shows that each test can fail. It does not show that either would fail for the incorrect behavior you specified.

Because the slice declares `regression_tests`, the same `verify_proof` call on the slice also ran `tests/unit/config-result.test.mjs`: each declared file runs once per call, whatever proofs the subject selects. Its outcome is reported beside the proofs as a native test result. It is not a proof and earns no proof credit, and the call is reported as verified only when the proofs and every declared file passed. Read both. A regression that failed, or that could not run, is not a pass: when the file's project configures no runner, or more than one, the call reports that and does not guess one. A slice that declares no list runs no regression, and its result claims no regression pass.

Open the delivered tests and go back through the mapping against the assertions actually written:

```js
test("rejects negative retry limits", () => {
  for (const retryLimit of [-1, -0.5]) {
    assert.deepEqual(readRetryConfig({ retryLimit }), { ok: false, code: "retry_limit_negative" });
  }
});

test("accepts a valid retry limit", () => {
  assert.equal(readRetryConfig({ retryLimit: 3 }).ok, true);
  assert.equal(readRetryConfig({ retryLimit: 1 }).retryLimit, 1);
});
```

| | Delivered assertion | Standing |
| --- | --- | --- |
| R1 | The result for -1 and -0.5 is compared with a rejection. | Supported |
| R2 | The same comparison includes the exact code. | Supported |
| R3 | None. The test was extended with 1, never 0. | Unverified |

The proof passed and R3 has no evidence. Unverified is not unmet: nothing yet shows that zero is rejected. Reading the delivered reader settles it. If it tests `retryLimit <= 0`, R3 is unmet; if it tests `retryLimit < 0`, R3 stays unverified until an assertion on zero exists.

Either way the delivery is not accepted as complete. The accurate claim is that negative limits are rejected with the exact code, and that acceptance of zero is unverified or unmet. Report that, and return the gap through the remediation the repository's review policy provides.

## Repairing an incomplete saved case

A save that is well formed but incomplete is stored, not refused. Suppose the step 3 request had been sent before the negative test was identified, identical except that its first obligation's case was only:

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
  "assessment": {"authored": {"status": "invalid", "obligations": 2, "valid": 1, "invalid": 1}}
}
```

The obligation and its case exist and have identities. Its requirement, criterion and verification were saved too, as was the complete zero obligation. Repair that same obligation; do not delete and recreate it. First read the current revision:

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
    "authored": {"status": "valid", "obligations": 2, "valid": 2, "invalid": 0},
    "acceptance_coverage": {"status": "complete", "criteria": 2, "covered": 2, "uncovered": 0}
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
- **"Valid" is not "covered", and neither is "passed".** Assessment checks the saved inputs and counts the associations you declared. You check meaning. Only execution against delivered source produces evidence.
- **A passing test can still accept the wrong result.** A test that only checks for some rejection, or never passes zero, passes when the code is wrong. Compare the delivered assertions with the incorrect behavior you specified.
- **Decompose by behavior, not by sentence.** One clause can hold several requirements and one test can establish several. Each requirement needs evidence that would fail without it; it does not need its own record.
- **Claim what the evidence supports.** A requirement with no assertion is unverified, not met. Say so.
- **Unknown support is not absent support.** Inspect the family's falsifier strategies before declaring `registry_unsupported`, and never guess a strategy, reshape code to fit one, or drop the proof to make the assessment pass.
- **Specify evidence; do not write the test.** State what the test must demonstrate and reject. Inputs, assertions and structure are the worker's.
- **A regression list is files, not protection.** `regression_tests` names existing test files that a slice `verify_proof` runs once each. It grants no scope, selects no runner, and does not stop anyone editing those files; a passing regression is not proof of the change.
- **A native test command is not a tool.** Name what must run; each session runs it through its own supported test tooling.
