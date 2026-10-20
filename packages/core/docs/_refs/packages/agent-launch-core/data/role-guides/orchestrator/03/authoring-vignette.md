# From a user request to a worker assignment

The user asks:

> `readRetryConfig` must reject a negative numeric `retryLimit` with `retry_limit_negative`. Zero must still be accepted.

The orchestrator authors a parent `WK-*` and its worker slice. The operator is the directing user; a unit is the parent or slice.

Save written criteria and native validation instructions. Written acceptance does not replace required controlled acceptance.
Inspect the delivered tests against the full request.

The example repository is `example/retry-service`. The user has selected its existing initiative `initiative`. The selected base branch is `main`. Assume source search has located `readRetryConfig` in `src/retry-config.mjs`; this vignette calls it the reader function. Treat the stated policy and acceptance choices as premises of the example.

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
  "unit": "<unit>",
  "revision": "<revision>"
}
```

Use the revision returned by creation. Read the ordinary-authoring guidance and the schemas for the shared save, branch saves and later slice together:

```json request:ordinary-inputs workspace_read_wiki
{
  "reads": [
    {
      "subject": {
        "requirement_guidance": true,
        "topic": [
          "ordinary_authoring"
        ]
      }
    },
    {
      "subject": "<unit>",
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
  ]
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
  "outcome": "saved",
  "unit": "<unit>",
  "revision": "<current-revision>"
}
```

Reuse the revision returned by `save-written` in the selected branch. A separate context read is unnecessary while that revision remains current.

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
  "outcome": "saved",
  "unit": "<unit>",
  "revision": "<blocked-revision>"
}
```

Confirm that the save succeeded. Do not remove or replace any existing slices when recording this blocker. Report the saved blocker to the operator and stop before dispatch.

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
