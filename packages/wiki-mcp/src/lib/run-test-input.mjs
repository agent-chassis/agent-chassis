

import { executionTimeoutInputSchema, parseExecutionTimeout } from
  "../../../wiki-core/src/lib/execution-timeout.mjs";
import { TEST_RUNTIME_ENVIRONMENT_ID_RE } from "@agent-chassis/controlled-contract/test-proof";

import { selectedResponseLocatorSchema } from "./selected-response-snapshot.mjs";

export const RUN_TEST_TOOL_NAME = "workspace_run_test";

export const RUN_TEST_INPUT_CODES = Object.freeze({
  INVALID: "run_test.request_invalid.v1"
});

export const RUN_TEST_STRUCTURED_VIEWS = Object.freeze(["outcome", "source", "comparison", "failure"]);
export const RUN_TEST_STREAM_VIEWS = Object.freeze(["candidate_stdout", "candidate_stderr", "baseline_stdout",
  "baseline_stderr"]);
export const RUN_TEST_VIEWS = Object.freeze([...RUN_TEST_STRUCTURED_VIEWS, ...RUN_TEST_STREAM_VIEWS]);

export const RUN_TEST_EXECUTION_FIELDS = Object.freeze(["entrypoint", "selection", "harness", "environment", "timeout", "source"]);

export const RUN_TEST_CLEARABLE_FIELDS = Object.freeze(["environment", "selection", "timeout", "source"]);
const MODE_FIELDS = Object.freeze(["read", "retry"]);
const COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

const HARNESS_DESCRIPTION = "Orchestrator/reviewer repository-owned command; workers use entrypoint and selection. " +
  "cwd is a repository-relative directory (including .) inside the authenticated checkout; argv is the " +
  "executable followed by literal arguments, executed once without shell parsing or appended flags. The " +
  "script or wrapper owns configuration, hooks and selection. No test counts or exact selection are inferred.";
const ENVIRONMENT_DESCRIPTION = "Optional environment <ecosystem>@<installation root> (for example npm@.). " +
  "Resolved through the runtime owner independently of harness.cwd. Omitted, the unambiguous containing environment of harness.cwd is used; a harness without one uses the host.";
const TIMEOUT_DESCRIPTION = "short (30s), medium (300s, default), long (1800s) or { seconds }; one budget shared " +
  "by the run and any comparison.";
const SOURCE_DESCRIPTION = "Required for an orchestrator execution: {kind:\"current_main\"}, " +
  "{kind:\"exact_sha\", value:<full commit>} or {kind:\"branch\", value:<WK ID, WK#SLICE ID or canonical WK or " +
  "slice branch name>}, which runs the commit that branch names now; the commit is held by an existing owned " +
  "clean checkout. Workers and reviewers run their bound source and must omit it.";
const MODE_RULE = "A request is exactly one mode: execution fields, read or retry.";
const READ_DESCRIPTION = "Read-only: one view of a retained result an earlier answer named; executes nothing. " +
  `failure selects one failed result of the failure view, as a returned call names it. ${MODE_RULE}`;
const RETRY_DESCRIPTION = "A new explicit execution of the retained request a refusal named. changes sets " +
  "execution fields to non-null values; clear removes distinct optional fields; a field is in at most one of " +
  `them. ${MODE_RULE}`;

function invalid(message, facts = {}) {
  const envelope = { code: RUN_TEST_INPUT_CODES.INVALID, accepted: false, executed: false, message,
    ...facts };
  return Object.assign(new Error(message), { code: envelope.code, envelope });
}

function executionFieldSchemas(z, { described = true, role = null } = {}) {
  const field = (schema, description) => described ? schema.optional().describe(description) : schema.optional();
  const fields = {
    harness: field(z.object({
      cwd: z.string().min(1).max(4096),
      argv: z.array(z.string().max(32768).regex(/^[^\0]*$/u)).min(1).max(1024)
    }).strict(), HARNESS_DESCRIPTION),
    entrypoint: field(z.string().min(1).max(128), "Worker only: assigned repository_test id. No caller executable controls."),
    selection: field(z.string().min(1).max(128), "Worker only: exact declared selection id. Omit only for an explicit default."),
    environment: field(z.string().min(3).max(512).regex(TEST_RUNTIME_ENVIRONMENT_ID_RE), ENVIRONMENT_DESCRIPTION),
    timeout: executionTimeoutInputSchema(z, TIMEOUT_DESCRIPTION),
    source: field(z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("current_main") }).strict(),
      z.object({ kind: z.literal("exact_sha"), value: z.string().regex(COMMIT_RE) }).strict(),
      z.object({ kind: z.literal("branch"), value: z.string().min(1).max(128) }).strict()
    ]), SOURCE_DESCRIPTION)
  };
  const allowed = role === 'worker' ? ['entrypoint', 'selection', 'timeout'] :
    role === 'reviewer' ? ['harness', 'environment', 'timeout'] :
      role === 'orchestrator' ? ['harness', 'environment', 'timeout', 'source'] : Object.keys(fields);
  return Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.includes(key)));
}

export function runTestInputSchema(z, { role = null } = {}) {

  const locator = selectedResponseLocatorSchema(z);
  return z.object({
    ...executionFieldSchemas(z, { role }),
    read: z.object({ result: locator, view: z.enum(RUN_TEST_VIEWS),
      failure: z.number().int().min(1).optional() }).strict().optional()
      .describe(READ_DESCRIPTION),
    retry: z.object({
      request: locator,
      changes: z.object(executionFieldSchemas(z, { described: false, role })).strict().optional(),
      clear: z.array(z.enum(RUN_TEST_CLEARABLE_FIELDS.filter(field =>
        role === 'worker' ? ['selection', 'timeout'].includes(field) :
          role === 'reviewer' ? ['environment', 'timeout'].includes(field) :
            role === 'orchestrator' ? field !== 'selection' : true))).min(1).optional()
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
    if (args.read?.failure !== undefined && args.read.view !== "failure") {
      context.addIssue({ code: "custom", path: ["read", "failure"],
        message: "a failed result is selected in the failure view only" });
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
    if (args.entrypoint !== undefined) {
      const mixed = ["harness", "environment", "source"].filter(field => args[field] !== undefined);
      if (mixed.length) context.addIssue({ code: "custom", path: ["entrypoint"],
        message: `entrypoint cannot carry caller executable controls: ${mixed.join(", ")}` });
      return;
    }
    if (args.harness !== undefined) {
      if (args.harness.argv[0] === "") context.addIssue({ code: "custom", path: ["harness", "argv", 0],
        message: "the executable must be nonempty" });
      if (args.selection !== undefined) context.addIssue({ code: "custom", path: ["selection"],
        message: "selection belongs to a worker entrypoint" });
      return;
    }
    context.addIssue({ code: "custom", path: ["entrypoint"], message: "execution requires entrypoint or harness" });
  });
}

export function parseRunTestRequest(args) {
  if (args.read !== undefined) return Object.freeze({ mode: "read", read: args.read });
  if (args.retry !== undefined) {
    return Object.freeze({ mode: "retry", seed: args.retry.request,
      changes: args.retry.changes ?? {}, clear: args.retry.clear ?? [] });
  }
  const timeout = parseExecutionTimeout(args.timeout, (message, facts) => invalid(message,
    { field: "timeout", ...facts }));
  return Object.freeze({
    mode: "execute",
    ...(args.harness === undefined ? {} : { harness: args.harness }),
    ...(args.entrypoint === undefined ? {} : { entrypoint: args.entrypoint, selection: args.selection }),
    environment: args.environment ?? null,
    timeout,
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

export function runTestReadCorrection(args, schema) {
  if (args?.read === null || typeof args?.read !== "object" || Array.isArray(args.read)) return {};
  const read = { ...args.read };
  const replacement = { ...args, read };
  let changed = false;
  if (Object.hasOwn(args, "view")) {
    if (read.view !== undefined && read.view !== args.view) {
      return { requiredChoice: "choose one intended read.view; view and read.view disagree" };
    }
    read.view = args.view;
    delete replacement.view;
    changed = true;
  }
  if (!RUN_TEST_VIEWS.includes(read.view)) {
    return { requiredChoice: `set read.view to the intended view: ${RUN_TEST_VIEWS.join(", ")}` };
  }
  if (read.failure === 0 && read.view === "failure") {
    read.failure = 1;
    changed = true;
  } else if (read.failure !== undefined && (read.view !== "failure" ||
      !Number.isSafeInteger(read.failure) || read.failure < 1)) {
    return { requiredChoice: "choose read.failure as a positive one-based index in the failure view only" };
  }
  if (!changed) return {};
  const parsed = schema.safeParse(replacement);
  return parsed.success ? { read: parsed.data.read } : {};
}

export function runTestInputRefusal(validationError) {
  const issues = validationError?.issues ?? [];
  const field = ({ path, keys }) => [path.map(String).join("."), ...(Array.isArray(keys) ? keys : [])]
    .filter((part) => part !== "").join(".") || "(request)";
  return invalid("the workspace_run_test request is not one closed execution, read or retry", {
    rejected_fields: [...new Set(issues.map(field))].join(", "),
    issue_count: issues.length,
    first_issue: issues[0]?.message ?? null
  });
}
