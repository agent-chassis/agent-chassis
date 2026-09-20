

import integration from "../runner-integrations/mocha.mjs";
import { CHANNEL_ASSET, JAVASCRIPT_INSTRUMENTATION_ASSET, JSON_TITLE_PATH,
  instrumentJavaScriptAttempt, javascriptLayout, observerAsset } from "./javascript-support.mjs";
import { nativeProviderImplementation } from "./native-lifecycle.mjs";

const REPORTER = observerAsset("mocha-reporter.cjs");

export default nativeProviderImplementation({
  family_id: "mocha",
  selector_kind: "mocha_title_path",
  runtime_runner: "mocha",
  identity_format: JSON_TITLE_PATH,
  completion: "session_end",
  assets: [REPORTER, CHANNEL_ASSET, JAVASCRIPT_INSTRUMENTATION_ASSET],
  layout: javascriptLayout,
  instrument: instrumentJavaScriptAttempt,
  invocation: (attempt, layout) => integration.invocation({ runtime: attempt.runtime,
    projectDir: attempt.workProject, file: layout.testFileInProject, reporter: REPORTER })
});
