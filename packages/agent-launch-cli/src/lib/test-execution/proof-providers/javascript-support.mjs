

import path from "node:path";
import { fileURLToPath } from "node:url";

import { instrumentJavaScriptModule } from "../source-instrumentation/javascript.mjs";

export const OBSERVER_ROOT = fileURLToPath(new URL("../observers/", import.meta.url));
export const observerAsset = (name) => path.join(OBSERVER_ROOT, name);

export const DIAGNOSTIC_GRAPH_ASSET = fileURLToPath(
  new URL("../../workspace-agent-test-proof-diagnostic-graph.cjs", import.meta.url));

export const CHANNEL_ASSETS = Object.freeze([observerAsset("native-channel.cjs"), DIAGNOSTIC_GRAPH_ASSET]);
export const JAVASCRIPT_INSTRUMENTATION_ASSET = fileURLToPath(
  new URL("../source-instrumentation/javascript.mjs", import.meta.url));

export function javascriptLayout(attempt) {
  attempt.read(attempt.testFile);
  return { testFileInProject: path.relative(attempt.workProject, attempt.testFileWork) };
}

export async function instrumentJavaScriptAttempt(attempt) {
  if (attempt.module === null) return { writes: [] };
  const { source, digest } = attempt.read(attempt.module);
  const result = await instrumentJavaScriptModule({ source, modulePath: attempt.module,
    mutation: attempt.mutation });
  return {
    writes: [{ path: attempt.moduleWork, content: result.source }],
    module: { module_path: attempt.module, source_digest: digest, functions: result.functions, probes: result.probes,
      ...(result.mutation ?? {}) }
  };
}

export const JSON_TITLE_PATH = Object.freeze({ kind: "json_title_path" });
