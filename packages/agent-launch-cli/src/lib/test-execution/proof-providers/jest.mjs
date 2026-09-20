

import integration from "../runner-integrations/jest.mjs";
import { CHANNEL_ASSET, JAVASCRIPT_INSTRUMENTATION_ASSET, JSON_TITLE_PATH,
  instrumentJavaScriptAttempt, javascriptLayout, observerAsset } from "./javascript-support.mjs";
import { nativeProviderImplementation } from "./native-lifecycle.mjs";

const ENTRY = observerAsset("jest-entry.cjs");

export default nativeProviderImplementation({
  family_id: "jest",
  selector_kind: "jest_title_path",
  runtime_runner: "jest",
  identity_format: JSON_TITLE_PATH,
  completion: "session_end",
  assets: [ENTRY, observerAsset("jest-setup.cjs"), CHANNEL_ASSET, JAVASCRIPT_INSTRUMENTATION_ASSET],
  runner_options: (attempt) => ({ cache_directory: `${attempt.runtime.scratchRoot}/jest-cache` }),
  layout: javascriptLayout,
  instrument: instrumentJavaScriptAttempt,
  invocation: (attempt) => integration.invocation({ runtime: attempt.runtime,
    projectDir: attempt.workProject, entry: ENTRY, entryArgs: [attempt.configPath] })
});
