

import integration from "../runner-integrations/vitest.mjs";
import { CHANNEL_ASSET, JAVASCRIPT_INSTRUMENTATION_ASSET, JSON_TITLE_PATH,
  instrumentJavaScriptAttempt, javascriptLayout, observerAsset } from "./javascript-support.mjs";
import { nativeProviderImplementation } from "./native-lifecycle.mjs";

const ENTRY = observerAsset("vitest-entry.mjs");

export default nativeProviderImplementation({
  family_id: "vitest",
  selector_kind: "vitest_title_path",
  runtime_runner: "vitest",
  identity_format: JSON_TITLE_PATH,
  completion: "session_end",
  assets: [ENTRY, observerAsset("vitest-runner.mjs"), CHANNEL_ASSET,
    JAVASCRIPT_INSTRUMENTATION_ASSET],
  layout: javascriptLayout,
  instrument: instrumentJavaScriptAttempt,
  invocation: (attempt) => integration.invocation({ runtime: attempt.runtime,
    projectDir: attempt.workProject, entry: ENTRY, entryArgs: [attempt.configPath] })
});
