

import { pathToFileURL } from "node:url";

import { CHANNEL_ASSETS, JAVASCRIPT_INSTRUMENTATION_ASSET, JSON_TITLE_PATH,
  instrumentJavaScriptAttempt, javascriptLayout, observerAsset } from "./javascript-support.mjs";
import { nativeProviderImplementation } from "./native-lifecycle.mjs";

const OBSERVER = observerAsset("lib0-observer.mjs");

export default nativeProviderImplementation({
  family_id: "lib0-testing",
  selector_kind: "lib0_test_function",
  runtime_runner: "lib0-testing",
  identity_format: JSON_TITLE_PATH,
  completion: "session_end",
  assets: [OBSERVER, ...CHANNEL_ASSETS, JAVASCRIPT_INSTRUMENTATION_ASSET],
  layout: javascriptLayout,
  instrument: instrumentJavaScriptAttempt,
  proof: () => ({ nodeArguments: [`--import=${pathToFileURL(OBSERVER).href}`] })
});
