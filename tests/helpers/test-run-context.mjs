

import path from "node:path";

export const TEST_RUN_CONTEXT_ENV = "PORTFOLIO_WIKI_TOOLS_TEST_RUN_CONTEXT";
const TEST_RUN_CONTEXT_SCHEMA = "test-run-context.v1";
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const TEST_RUN_EVENTS_FILE = "events.jsonl";
export const TEST_RUN_COMPONENTS_DIR = "components";
export const TEST_RUN_METADATA_FILE = "run.json";

export function encodeTestRunContext({ runId, runDir }) {
  return JSON.stringify({ schema: TEST_RUN_CONTEXT_SCHEMA, run_id: runId, run_dir: runDir });
}

export function readTestRunContext(env = process.env) {
  const text = env[TEST_RUN_CONTEXT_ENV];
  if (text === undefined || text === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { problem: "run context is not JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
      parsed.schema !== TEST_RUN_CONTEXT_SCHEMA || Object.keys(parsed).length !== 3 ||
      typeof parsed.run_id !== "string" || !RUN_ID_PATTERN.test(parsed.run_id) ||
      typeof parsed.run_dir !== "string" || !path.isAbsolute(parsed.run_dir) ||
      path.resolve(parsed.run_dir) !== parsed.run_dir) {
    return { problem: "run context has an invalid shape" };
  }
  return { context: Object.freeze({ runId: parsed.run_id, runDir: parsed.run_dir }) };
}

export function isTestRunId(value) {
  return typeof value === "string" && RUN_ID_PATTERN.test(value);
}
