# JUnit test result parser

`@agent-chassis/agent-launch-core` publishes one shared JUnit/XUnit XML report
parser at the explicit subpath
`@agent-chassis/agent-launch-core/src/lib/junit-test-result-parser.mjs`.
`parseJUnitReport(xmlText)` always returns a Promise. The package declares
`xml2js` `0.6.2` as a runtime dependency, so a normal installation of the package
provides it. xml2js is the only XML syntax owner: strict parsing, ordered
children, separate attributes, and no trimming, normalization, or value
coercion. The parser only interprets the resulting element tree.

A resolved result has exactly this shape:

```json
{
  "schema_version": "junit-test-results.v1",
  "suites": [
    { "name": "…", "suite_path": ["…"], "duration_seconds": 0.5,
      "stdout": [], "stderr": [] }
  ],
  "tests": [
    { "suite_path": ["…"], "name": "…", "classname": null, "file": null,
      "duration_seconds": null, "status": "failed",
      "diagnostics": [
        { "kind": "failure", "message": null, "type": null, "text": "" }
      ],
      "stdout": [], "stderr": [] }
  ],
  "counts": { "total": 1, "passed": 0, "failed": 1, "errored": 0, "skipped": 0 }
}
```

- The root is `testsuites` or `testsuite`. A `testsuites` element is a
  container, not a suite. `testsuite` elements may nest, and `testcase`
  elements may appear directly under the root container, as Node's reporter
  emits them.
- `suites` lists every `testsuite` in document order, parents before children.
  A suite's `suite_path` ends with its own name. `tests` lists every `testcase`
  occurrence in document order, and its `suite_path` names every enclosing
  suite. Duplicate occurrences stay separate. The parser adds no identifiers
  and does no de-duplication.
- Names, class names, file paths, messages, and types are decoded XML attribute
  strings, kept literally. Empty and numeric-looking values stay strings, and
  paths are not normalized. A missing suite name, `classname`, `file`,
  `message`, or `type` is `null`.
- `time` is the only converted value. An unsigned decimal or scientific literal
  with a finite value becomes seconds. A missing, blank, signed, malformed, or
  non-finite value becomes `null`.
- Each `failure`, `error`, and `skipped` child becomes a diagnostic, in
  document order. Its `text` is the element's decoded direct text, including
  CDATA and untrimmed whitespace, or `""` when it has none. The status is
  `errored` if any error is present, otherwise `failed` if any failure is
  present, otherwise `skipped` if any skip is present, otherwise `passed`.
- `stdout` and `stderr` are ordered lists, one entry per direct `system-out` or
  `system-err` child of that suite or test. Output is never inherited from a
  suite by its tests or child suites, or passed upward.
- `counts` are computed only from the parsed `testcase` records. Summary
  attributes such as `tests` or `failures` are ignored. A valid report with no
  test cases has zero counts and yields no pass.
- Other elements are ignored as metadata when they contain no `testsuites`,
  `testsuite`, or `testcase` element. Otherwise the report is rejected, so no
  suite or test occurrence is silently dropped.

Rejections are `JUnitParserError` values with a stable `code`, a `detail`
object, and the underlying `cause` when one exists:

| Code | Condition | `detail` |
| --- | --- | --- |
| `junit_parser.invalid_input.v1` | input is not a string | `received_type` |
| `junit_parser.invalid_xml.v1` | malformed XML, no root, or more than one root | `reason`, `line`, `column` (1-based line; `null` when no position applies) |
| `junit_parser.invalid_report.v1` | non-report root, or a report element in an unsupported position | `reason`, `element`, `path` |
| `junit_parser.missing_test_name.v1` | a `testcase` without a `name` attribute | `suite_path`, `test_index`, `path` |

The module exports these codes as `JUNIT_PARSER_ERROR_CODES`.

Malformed XML is rejected with one exception, a known limit of xml2js and its
sax tokenizer. An element that repeats an attribute name is accepted, and the
first value is kept while later values are ignored. For example,
`<testcase name="a" name="b"/>` yields a test named `a`. This does not make
duplicate attributes well-formed XML. Multiple roots, text after the root,
undeclared entities, and every other malformed input are still rejected.

A parse does no filesystem, network, or process work. Document type declarations,
external DTDs, and entity declarations are never loaded or fetched. A reference
to a general entity other than the predefined XML entities is rejected as
malformed XML. Each call has
its own parser state, so calls do not affect one another.

A parsed report is only data. It is not authenticated proof evidence and carries
no execution provenance, runtime identity, or authority. Selected-test proof
execution and evidence remain owned by `verify_proof` (see
[Test-proof runtime identity](test-proof-runtime-identity.md)).
