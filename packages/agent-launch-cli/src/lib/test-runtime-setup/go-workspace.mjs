

import { describeGoWorkspace } from "@agent-chassis/wiki-core/src/lib/runtime-inputs/go-workspace.mjs";
export { GO_WORKSPACE_REFERENCE_REASONS } from "@agent-chassis/wiki-core/src/lib/runtime-inputs/go-workspace.mjs";

export function selectGoWorkspace(projectDir, checkoutRoot = projectDir) {
  const { file, files, invalid } = describeGoWorkspace(projectDir, checkoutRoot);
  return file === null ? Object.freeze({ file: null, files: Object.freeze({}), invalid: Object.freeze([]) })
    : Object.freeze({ file, files, invalid });
}
