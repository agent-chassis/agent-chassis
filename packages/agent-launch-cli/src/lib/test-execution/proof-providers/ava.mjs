

import { pathToFileURL } from "node:url";

import integration, { AVA_ATTEMPT_CONFIG } from "../runner-integrations/ava.mjs";
import { CHANNEL_ASSETS, JAVASCRIPT_INSTRUMENTATION_ASSET, JSON_TITLE_PATH,
  instrumentJavaScriptAttempt, javascriptLayout, observerAsset } from "./javascript-support.mjs";
import { nativeProviderImplementation } from "./native-lifecycle.mjs";

const OBSERVER = observerAsset("ava-observer.mjs");

export default nativeProviderImplementation({
  family_id: "ava",
  selector_kind: "ava_test_title",
  runtime_runner: "ava",
  identity_format: JSON_TITLE_PATH,
  completion: "session_end",
  assets: [OBSERVER, AVA_ATTEMPT_CONFIG, ...CHANNEL_ASSETS, JAVASCRIPT_INSTRUMENTATION_ASSET],
  layout: javascriptLayout,
  instrument: instrumentJavaScriptAttempt,
  invocation: (attempt, layout) => integration.invocation({ runtime: attempt.runtime,
    projectDir: attempt.workProject, file: layout.testFileInProject,
    nodeArguments: [`--import=${pathToFileURL(OBSERVER).href}`] })
});
