

import { executionTimeoutInputSchema, parseExecutionTimeout } from
  "../../../wiki-core/src/lib/execution-timeout.mjs";
import { TEST_RUNTIME_ENVIRONMENT_ID_RE } from "@agent-chassis/controlled-contract/test-proof";

import { selectedResponseDetailSchema } from "./selected-response-snapshot.mjs";

export const RUN_TEST_TOOL_NAME = "workspace_run_test";

export const RUN_TEST_INPUT_CODES = Object.freeze({
  INVALID: "run_test.request_invalid.v1"
});

export const RUN_TEST_STRUCTURED_VIEWS = Object.freeze(["outcome", "source", "comparison", "failure"]);
export const RUN_TEST_STREAM_VIEWS = Object.freeze(["candidate_stdout", "candidate_stderr", "baseline_stdout",
  "baseline_stderr"]);
export const RUN_TEST_VIEWS = Object.freeze([...RUN_TEST_STRUCTURED_VIEWS, ...RUN_TEST_STREAM_VIEWS]);

export const RUN_TEST_EXECUTION_FIELDS = Object.freeze(["file", "runner", "environment", "selector", "timeout",
  "compare_parent", "source"]);

export const RUN_TEST_CLEARABLE_FIELDS = Object.freeze(["environment", "selector", "timeout", "compare_parent",
  "source"]);
const MODE_FIELDS = Object.freeze(["read", "continue", "retry"]);
const COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

const FILE_DESCRIPTION = "Required for an execution. One literal repository-relative file, as the runner names " +
  "it (for example \"tests/unit/a.test.mjs\"). The runner executes its normal unit for that file, which may " +
  "include neighboring tests. Not a glob, directory or path outside the checkout.";
const RUNNER_DESCRIPTION = "Required for an execution. The runtime runner, for example node-test, jest, vitest, " +
  "pytest, go-test or cargo-test.";
const ENVIRONMENT_DESCRIPTION = "Optional prepared environment <ecosystem>@<installation root> that local " +
  "test-runtime setup published (for example \"npm@.\"). Omitted, the environment owning the file is used.";

const SELECTOR_DESCRIPTION = "Optional native test-name selector the runner applies itself (one line, not " +
  "starting with -). For stestr it is a Python regular expression matched after the file's dotted module " +
  "prefix, taken as given: with file \"unit/test_clamp.py\" the prefix is \"unit.test_clamp.\", so native ID " +
  "unit.test_clamp.ClampTests.test_preserves is selected by \"ClampTests\\.test_preserves\". The full native " +
  "ID or a saved-proof target (unit/test_clamp.py::ClampTests.test_preserves) is a different representation " +
  "and matches nothing here.";
const TIMEOUT_DESCRIPTION = "short (30s), medium (300s, default), long (1800s) or { seconds }; one budget shared " +
  "by the run and any comparison.";
const COMPARE_DESCRIPTION = "Default false. When the run exits normally with a nonzero code, run the same request " +
  "once against the source's parent if an owned checkout of it already exists, and report both outcomes.";
const SOURCE_DESCRIPTION = "Required for an orchestrator execution: {kind:\"current_main\"}, " +
  "{kind:\"exact_sha\", value:<full commit>} or {kind:\"branch\", value:<WK ID, WK#SLICE ID or canonical WK or " +
  "slice branch name>}, which runs the commit that branch names now; the commit is held by an existing owned " +
  "clean checkout. Workers and reviewers run their bound source and must omit it.";
const MODE_RULE = "A request is exactly one mode: execution fields, read, continue or retry.";
const READ_DESCRIPTION = `Read-only: one view of a retained result an earlier answer named; executes nothing. ${
  MODE_RULE}`;
const CONTINUE_DESCRIPTION = `Read-only: a continuation copied unchanged from an earlier answer's next call. ${
  MODE_RULE}`;
const RETRY_DESCRIPTION = "A new explicit execution of the retained request a refusal named. changes sets " +
  "execution fields to non-null values; clear removes distinct optional fields; a field is in at most one of " +
  `them. ${MODE_RULE}`;

function invalid(message, facts = {}) {
  const envelope = { code: RUN_TEST_INPUT_CODES.INVALID, accepted: false, executed: false, message,
    ...facts };
  return Object.assign(new Error(message), { code: envelope.code, envelope });
}

function executionFieldSchemas(z, { described = true } = {}) {
  const field = (schema, description) => described ? schema.optional().describe(description) : schema.optional();
  return {
    file: field(z.string().min(1).max(4096), FILE_DESCRIPTION),
    runner: field(z.string().min(1).max(64), RUNNER_DESCRIPTION),
    environment: field(z.string().min(3).max(512).regex(TEST_RUNTIME_ENVIRONMENT_ID_RE), ENVIRONMENT_DESCRIPTION),
    selector: field(z.string().min(1).max(1024), SELECTOR_DESCRIPTION),
    timeout: executionTimeoutInputSchema(z, TIMEOUT_DESCRIPTION),
    compare_parent: field(z.boolean(), COMPARE_DESCRIPTION),
    source: field(z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("current_main") }).strict(),
      z.object({ kind: z.literal("exact_sha"), value: z.string().regex(COMMIT_RE) }).strict(),
      z.object({ kind: z.literal("branch"), value: z.string().min(1).max(128) }).strict()
    ]), SOURCE_DESCRIPTION)
  };
}

export function runTestInputSchema(z) {

  const continuation = selectedResponseDetailSchema(z);
  const locator = continuation.shape.source;
  return z.object({
    ...executionFieldSchemas(z),
    read: z.object({ result: locator, view: z.enum(RUN_TEST_VIEWS) }).strict().optional()
      .describe(READ_DESCRIPTION),
    continue: continuation.optional().describe(CONTINUE_DESCRIPTION),
    retry: z.object({
      request: locator,
      changes: z.object(executionFieldSchemas(z, { described: false })).strict().optional(),
      clear: z.array(z.enum(RUN_TEST_CLEARABLE_FIELDS)).min(1).optional()
    }).strict().optional().describe(RETRY_DESCRIPTION)
  }).strict().superRefine((args, context) => {
    const clear = args.retry?.clear ?? [];
    const repeated = clear.filter((field, at) => clear.indexOf(field) !== at);
    const overlapping = clear.filter((field) => args.retry?.changes?.[field] !== undefined);
    for (const [fields, reason] of [[repeated, "is named more than once"], [overlapping, "is also changed"]]) {
      if (fields.length > 0) {
        context.addIssue({ code: "custom", path: ["retry", "clear"],
          message: `a cleared field ${reason}: ${[...new Set(fields)].join(", ")}` });
      }
    }
    const execution = RUN_TEST_EXECUTION_FIELDS.filter((field) => args[field] !== undefined);
    const modes = MODE_FIELDS.filter((field) => args[field] !== undefined);
    if (modes.length > 1 || (modes.length === 1 && execution.length > 0)) {
      context.addIssue({ code: "custom", path: [modes[0]],
        message: `a request is exactly one mode; ${modes[0]} was mixed with ${
          [...modes.slice(1), ...execution].join(", ")}` });
      return;
    }
    if (modes.length === 1) return;
    for (const field of ["file", "runner"]) {
      if (args[field] === undefined) {
        context.addIssue({ code: "custom", path: [field],
          message: `an execution names ${field}; a read, continuation or retry names its own mode instead` });
      }
    }
  });
}

export function parseRunTestRequest(args) {
  if (args.read !== undefined) return Object.freeze({ mode: "read", read: args.read });
  if (args.continue !== undefined) {
    return Object.freeze({ mode: "continue", selection: args.continue });
  }
  if (args.retry !== undefined) {
    return Object.freeze({ mode: "retry", seed: args.retry.request,
      changes: args.retry.changes ?? {}, clear: args.retry.clear ?? [] });
  }
  const timeout = parseExecutionTimeout(args.timeout, (message, facts) => invalid(message,
    { field: "timeout", ...facts }));
  return Object.freeze({
    mode: "execute",
    file: args.file,
    runner: args.runner,
    environment: args.environment ?? null,
    selector: args.selector ?? null,
    timeout,
    compareParent: args.compare_parent === true,
    source: args.source ?? null
  });
}

export function runTestRequestSeed(args) {
  return Object.fromEntries(RUN_TEST_EXECUTION_FIELDS
    .filter((field) => args[field] !== undefined).map((field) => [field, args[field]]));
}

export function applyRunTestRetry(seed, { changes = {}, clear = [] } = {}) {
  const merged = { ...seed, ...changes };
  for (const field of clear) delete merged[field];
  return merged;
}

export function runTestInputRefusal(validationError) {
  const issues = validationError?.issues ?? [];
  const field = ({ path, keys }) => [path.map(String).join("."), ...(Array.isArray(keys) ? keys : [])]
    .filter((part) => part !== "").join(".") || "(request)";
  return invalid("the workspace_run_test request is not one closed execution, read, continuation or retry", {
    rejected_fields: [...new Set(issues.map(field))].join(", "),
    issue_count: issues.length,
    first_issue: issues[0]?.message ?? null
  });
}
