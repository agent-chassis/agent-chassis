# From a user request to a worker assignment

The user asks:

> `readRetryConfig` must reject a negative numeric `retryLimit` with `retry_limit_negative`. Zero must still be accepted.

The orchestrator authors a parent `WK-*` and its worker slice. The operator is the directing user; a unit is the parent or slice.

Save written criteria and native validation instructions. Written acceptance does not replace required controlled acceptance.
Inspect the delivered tests against the full request.

The example repository is `example/retry-service`. The user has selected its existing initiative `initiative`. The selected base branch is `main`. Assume source search has located `readRetryConfig` in `src/retry-config.mjs`; this vignette calls it the reader function. Treat the stated policy and acceptance choices as premises of the example.

This example covers two assignments when controlled requirements cannot be authored. In the first, controlled acceptance is required. In the second, assume the operator has explicitly selected ordinary acceptance under applicable repository policy, independently of the authoring limitation. Both authoring paths stop before dispatch.

Request blocks contain complete arguments. Substitute `<name>` from earlier responses. Response blocks are hypothetical excerpts. Follow actual returned calls for omitted reads and recovery. The delivery example is a separate journey.

## Inspect the code before choosing files

Use your session's repository read and search tools to inspect the reader, callers, dependencies and tests. Open the matching source; a text search does not establish complete caller coverage. State what remains unknown.

Take the following inspected repository facts as premises of this example; the inspection calls are not shown:

- `src/retry-config.mjs` defines `readRetryConfig`. It returns a rejection object with `ok: false` and a `code`, or an acceptance with `ok: true` and the input `retryLimit`. It does not throw. Its current negative-input rejection uses code `invalid`.
- `src/config-result.mjs` supplies the `reject` helper and the definitions below. The worker needs to read this file to use the API, but does not need to change it.
- `tests/unit/retry-config.test.mjs` contains two top-level tests. `rejects negative retry limits` checks only that the result for -1 has `ok: false`; it does not check the rejection code or a negative fraction. `accepts a valid retry limit` checks only 3. Extend the first to check `ok` and the exact rejection code for negative integers and fractions. Extend the second to check zero.
- `tests/unit/config-result.test.mjs` covers the unchanged helper. Select it as a regression test.

The committed helper and input predicate used in this ordinary example are:

```js example:helper-predicates
export function reject(code) { return { ok: false, code }; }
export function negativeInput({ retryLimit }) {
  return typeof retryLimit === "number" && retryLimit < 0;
}
```

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

Read the selected initiative:

```json request:read-initiative workspace_read_wiki
{
  "subject": "initiative"
}
```

```json response:read-initiative
{
  "subject": "<initiative>"
}
```

Use the returned identity, shown here as `<initiative>`, in `changes.initiative`.

## Save written acceptance, then follow the selected branch

Follow the assignment's acceptance requirements. For this example, assume the authoring guidance reports that structured requirements cannot be authored here. Save the complete written request, criteria, validation and planned scopes before following the applicable branch.

### Shared setup

```json request:create workspace_create_record
{
  "kind": "work_item",
  "title": "Reject negative retry limits and preserve zero",
  "initial": {
    "base_branch": "main",
    "user_requirements": "readRetryConfig must reject a negative numeric retryLimit with retry_limit_negative. Zero must still be accepted."
  }
}
```

```json response:create
{
  "outcome": "created",
  "unit": "<unit>"
}
```

Read the `ordinary_authoring` guidance before saving. Follow the returned topic read to get its complete instructions:

```json request:ordinary-guidance workspace_read_wiki
{
  "subject": {
    "requirement_guidance": true
  }
}
```

Read the created unit for its current revision and reference:

```json request:read-ordinary workspace_read_wiki
{
  "subject": "<unit>"
}
```

```json response:read-ordinary
{
  "subject": "<unit>",
  "revision": "<revision>",
  "reference": {
    "ref_id": "<ordinary-ref>"
  }
}
```

Read the schemas for the shared written acceptance, both branch saves and the later slice:

```json request:ordinary-inputs workspace_read_wiki
{
  "reference": {
    "ref_id": "<ordinary-ref>"
  },
  "select": {
    "input_contract": {
      "tool": "save_record",
      "members": [
        "user_requirements",
        "initiative",
        "controlled_acceptance",
        "entries",
        "criteria",
        "validation",
        "read_scope",
        "write_scope",
        "repo_paths",
        "ready_slices"
      ]
    }
  }
}
```

Save the full criteria, validation and planned scopes on the parent. Retain these file boundaries even when the work cannot yet be dispatched:

```json request:save-written save_record
{
  "unit": "<unit>",
  "revision": "<revision>",
  "changes": {
    "initiative": "<initiative>",
    "criteria": [
      {
        "key": "negative",
        "text": "Negative numeric retryLimit returns ok=false and code=retry_limit_negative, without throwing."
      },
      {
        "key": "zero",
        "text": "retryLimit=0 returns ok=true and retryLimit=0."
      }
    ],
    "read_scope": [
      "AGENTS.md",
      "src/config-result.mjs"
    ],
    "write_scope": [
      "src/retry-config.mjs",
      "tests/unit/retry-config.test.mjs"
    ],
    "repo_paths": [
      "src/retry-config.mjs",
      "tests/unit/retry-config.test.mjs"
    ],
    "validation": [
      "Run tests/unit/retry-config.test.mjs with workspace_run_test. Negative values must reject with the exact code and zero must be accepted. Passing positives alone proves neither."
    ]
  }
}
```

```json response:save-written
{
  "outcome": "saved"
}
```

Read the current unit before saving either branch:

```json request:read-acceptance workspace_read_wiki
{
  "subject": "<unit>"
}
```

```json response:read-acceptance
{
  "revision": "<current-revision>",
  "reference": {
    "ref_id": "<acceptance-ref>"
  }
}
```

### If controlled acceptance remains required

Save the required disposition and the authoring blocker through the schemas read above:

```json request:save-compilation-blocker save_record
{
  "unit": "<unit>",
  "revision": "<current-revision>",
  "changes": {
    "controlled_acceptance": {
      "disposition": "required"
    },
    "entries": [
      {
        "key": "compilation-blocker",
        "title": "Required controlled acceptance is incomplete",
        "content": {
          "text": "Structured requirements cannot be authored in this session. The full written request, criteria, validation and scopes are saved, but the required controlled contract is incomplete and is not ready for dispatch."
        }
      }
    ]
  }
}
```

```json response:save-compilation-blocker
{
  "outcome": "saved"
}
```

Confirm that the save succeeded. Do not remove or replace any existing slices when recording this blocker. Report the saved blocker to the operator and stop before dispatch.

### If ordinary acceptance was explicitly selected for this assignment

This branch records the operator's selection stated in the example's premises. It does not offer an alternative for the blocked assignment above. Record the reason for the selection; a successful save establishes neither authorization nor satisfaction of requirements. Complete the required native validation and review.

Read the exception schema through the shared setup's current reference:

```json request:ordinary-exception-inputs workspace_read_wiki
{
  "reference": {
    "ref_id": "<acceptance-ref>"
  },
  "select": {
    "input_contract": {
      "tool": "save_record",
      "operation": "exception",
      "kind": "controlled_acceptance"
    }
  }
}
```

Apply the exception to this unit with the current revision. Put the reason for the operator's selection in `rationale`:

```json request:explicit-author-choice save_record
{
  "unit": "<unit>",
  "revision": "<current-revision>",
  "exception": {
    "kind": "controlled_acceptance",
    "action": "apply",
    "subject": "<unit>",
    "rationale": "The operator selected native test results and direct assertion review as this unit's acceptance method, independently of structured-authoring availability. Native tests, required review and comparison with the complete request remain required."
  }
}
```

```json response:explicit-author-choice
{
  "outcome": "saved"
}
```

Read back the saved parent before creating the slice:

```json request:read-ordinary-saved workspace_read_wiki
{
  "subject": "<unit>"
}
```

```json response:read-ordinary-saved
{
  "revision": "<ordinary-revision>",
  "reference": {
    "ref_id": "<ordinary-saved-ref>"
  }
}
```

```json request:ordinary-user-requirements workspace_read_wiki
{
  "reference": {
    "ref_id": "<ordinary-saved-ref>"
  },
  "select": {
    "field": "sections.user_requirements"
  }
}
```

```json request:ordinary-coverage workspace_read_wiki
{
  "reference": {
    "ref_id": "<ordinary-saved-ref>"
  },
  "select": {
    "contract": "coverage"
  }
}
```

```json response:ordinary-coverage
{
  "members": {
    "controlled_acceptance": {
      "disposition": "opted_out"
    },
    "acceptance_criteria": [
      {
        "text": "Negative numeric retryLimit returns ok=false and code=retry_limit_negative, without throwing."
      },
      {
        "text": "retryLimit=0 returns ok=true and retryLimit=0."
      }
    ],
    "obligations": [],
    "cases": []
  }
}
```

```json request:ordinary-validation workspace_read_wiki
{
  "reference": {
    "ref_id": "<ordinary-saved-ref>"
  },
  "select": {
    "field": "acceptance.validation"
  }
}
```

Check that the saved request retains the original wording and the disposition records the explicit choice. Compare the saved criteria and validation with all three requirements. Correct any omitted or changed meaning at the current revision before continuing.

After a corrective save, read the parent again. Use the newly returned revision and reference in place of `<ordinary-revision>` and `<ordinary-saved-ref>` in subsequent calls.

Save a complete slice using the `ready_slices` schema already read. Include the instructions the worker needs without this conversation. Set scopes on the slice; the parent's planned scopes do not give the worker access. Require a negative integer, a negative fraction and zero; the worker chooses the remaining test data, assertions and structure. Put the unchanged helper, `package.json` and regression file in `read_scope`. Put the reader and its test file in `write_scope` and `repo_paths`.

```json request:save-slice save_record
{
  "unit": "<unit>",
  "revision": "<ordinary-revision>",
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
  "bindings": {
    "slice": {
      "reject-negative-limit": "<slice-id>"
    }
  }
}
```

Read the slice by the identity returned from the save. Its revision and reference belong to the slice, not the parent:

```json request:read-slice workspace_read_wiki
{
  "subject": "<unit>#<slice-id>"
}
```

```json response:read-slice
{
  "subject": "<unit>#<slice-id>",
  "revision": "<slice-revision>",
  "reference": {
    "ref_id": "<slice-ref>"
  }
}
```

```json request:slice-fields workspace_read_wiki
{
  "reference": {
    "ref_id": "<slice-ref>"
  },
  "select": {
    "inventory": "fields"
  }
}
```

Use the returned field names to read the saved assignment, validation and scopes:

```json request:slice-assignment workspace_read_wiki
{
  "reference": {
    "ref_id": "<slice-ref>"
  },
  "select": {
    "field": "sections.summary"
  }
}
```

```json request:slice-validation workspace_read_wiki
{
  "reference": {
    "ref_id": "<slice-ref>"
  },
  "select": {
    "field": "acceptance.validation"
  }
}
```

```json response:slice-validation
{
  "value": [
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
```

The worker uses `retry-tests` as `entrypoint` and `focused` as `selection`. `cwd` is the working directory. `argv` contains the program and its arguments. `definition_paths` lists the files that define the command. No default selection is saved, so the worker must supply both names:

```json unsent:worker-validation workspace_run_test
{
  "entrypoint": "retry-tests",
  "selection": "focused"
}
```

```json request:slice-read-scope workspace_read_wiki
{
  "reference": {
    "ref_id": "<slice-ref>"
  },
  "select": {
    "field": "read_scope"
  }
}
```

```json request:slice-repo-paths workspace_read_wiki
{
  "reference": {
    "ref_id": "<slice-ref>"
  },
  "select": {
    "field": "repo_paths"
  }
}
```

```json request:slice-write-scope workspace_read_wiki
{
  "reference": {
    "ref_id": "<slice-ref>"
  },
  "select": {
    "field": "write_scope"
  }
}
```

```json request:slice-coverage workspace_read_wiki
{
  "reference": {
    "ref_id": "<slice-ref>"
  },
  "select": {
    "contract": "coverage"
  }
}
```

```json response:slice-coverage
{
  "members": {
    "controlled_acceptance": {
      "disposition": "opted_out"
    },
    "acceptance_criteria": [
      {
        "text": "The extended test \"rejects negative retry limits\" demonstrates that readRetryConfig returns a rejection with ok=false and code=retry_limit_negative for negative numeric retryLimit."
      },
      {
        "text": "The extended test \"accepts a valid retry limit\" demonstrates that readRetryConfig returns an acceptance with ok=true and retryLimit=0 for retryLimit 0."
      }
    ],
    "obligations": [],
    "cases": []
  }
}
```

Check that the slice retains the complete assignment and both criteria. Check that ordinary acceptance is recorded for the slice, that the helper is readable, and that only the reader and test file are writable. Include the write targets when checking readable files.

Before dispatch, check that the worker has the instructions, files and validation context to carry out the assignment. Resolve missing prerequisites.

Complete any design redteam required by repository policy or the assignment before dispatch. Supply the complete request, relevant source and saved assignment for a findings-only review.

For example, suppose an earlier draft asked only for a test of nonnegative inputs. The redteam could identify that testing 3 would satisfy that instruction while leaving zero unchecked. Correct that draft to require exactly zero and an assertion that it is accepted, as the saved assignment above does.

Check each finding against the request and source. Correct confirmed problems in the assignment and planned checks. Record why you reject other findings. Resolve consequential unanswered questions before dispatch. If they cannot be resolved, record the blocker and do not dispatch the affected implementation.

Follow repository design, implementation and review policy. This example does not send:

```json unsent:dispatch start_agent
{
  "subject": "<unit>#<slice-id>"
}
```

The authoring example stops here. The later delivery example shows how to inspect assertions after native validation. Do not report the written acceptance or exception as evidence that tests or proofs passed.

## After delivery: inspect the assertions

Use the delivery's returned validation and file-read calls. Check that the results and files refer to the delivery being evaluated. Complete required reviews before integration or publication.

Run the saved test command against the delivered source with `workspace_run_test`. Check the results for both test files, including failures and skipped tests. A failed check or one that could not run is not a pass. Suppose both named retry-config tests ran and passed, and the helper regression passed.

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

Record the native validation outcomes and missing zero evidence in an entry on the parent work record through `changes.entries` in `save_record`.

The shown assertions do not establish preservation of nonnumeric handling. Compare the delivered reader's changes and retained assertions with the inspected behavior before reporting that scope check as supported.

Read the delivered implementation. If it rejects zero, R3 is unmet.

Assign any needed implementation repair and the missing zero assertion to a worker under repository policy. Include the missing evidence, required behavior and necessary files.

Check that the repaired test asserts that zero is accepted. Run it. Report R3 as supported only if it passes. Report supported, unmet and unverified requirements separately.

Rerun repaired checks, other failures and required regressions on the repaired candidate.

Follow repository limits on repairs and reviews. If repair or testing cannot be completed, report the affected requirement and why it remains unresolved. Do not substitute tests that miss the required behavior. An exemption from review does not cancel required repairs.
