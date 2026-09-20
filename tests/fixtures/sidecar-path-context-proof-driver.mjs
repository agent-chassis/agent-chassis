import { deriveSidecarPathContext } from
  "../../packages/wiki-core/src/lib/sidecar-path-context.mjs";
import { createPathContextExpectations } from
  "./sidecar-path-context-proof-state.mjs";

const INPUT_MJS = "packages/app/src/widget.mjs";
const INPUT_JS = "packages/app/src/widget.js";

const SOURCE_PATHS = Object.freeze([
  INPUT_MJS,
  INPUT_JS,
  "packages/app/src/widget.test.mjs",
  "packages/app/src/widget.spec.js",
  "tests/widget.test.mjs",
  "packages/app/src/related-01.mjs",
  "packages/app/src/related-02.mjs",
  "packages/app/src/related-03.mjs",
  "packages/app/src/related-04.mjs",
  "packages/app/src/related-05.mjs",
  "packages/app/src/related-06.mjs",
  "packages/app/src/related-07.mjs",
  "packages/app/src/related-08.mjs",
  "packages/app/src/related-09.mjs",
  "packages/app/src/related-10.mjs",
  "packages/app/src/related-10.mjs",
  "packages/app/src/related-11.mjs",
  "packages/app/src/related-12.mjs",
  "packages/app/src/related-13.mjs",
  "packages/app/src/related-14.mjs",
  "packages/app/src/related-15.mjs",
  "packages/app/src/related-16.mjs",
  "packages/app/src/related-17.mjs",
  "packages/app/src/related-18.mjs",
  "packages/app/src/related-19.mjs",
  "packages/app/src/related-20.mjs",
  "packages/app/src/related-21.mjs",
  "packages/app/src/related-22.mjs",
  "packages/app/other/outside.mjs",
  "tests/other.test.mjs"
]);

export function runPathContextContract() {
  return {
    expected: createPathContextExpectations(),
    observed: {
      empty: deriveSidecarPathContext({ inputPaths: [], sourcePaths: SOURCE_PATHS }),
      complete: deriveSidecarPathContext({
        inputPaths: [INPUT_MJS, INPUT_MJS, INPUT_JS, INPUT_MJS],
        sourcePaths: SOURCE_PATHS
      }),
      source_order_permutation: deriveSidecarPathContext({
        inputPaths: [INPUT_MJS, INPUT_JS],
        sourcePaths: [...SOURCE_PATHS].reverse()
      }),
      input_order_permutation: deriveSidecarPathContext({
        inputPaths: [INPUT_JS, INPUT_JS, INPUT_MJS],
        sourcePaths: SOURCE_PATHS
      })
    }
  };
}
