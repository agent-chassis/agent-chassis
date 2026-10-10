

import path from "node:path";

import { RunnerIntegrationPreconditionError } from "./common.mjs";

const namePattern = (selector) => selector === null ? [] : [`--test-name-pattern=${selector}`];

function wrapperModes(text) {
  const modes = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const section = /^([a-z][a-z0-9-]*) \(\d+\) \[[^\]]*\]:$/u.exec(line);
    if (section !== null) {
      current = section[1];
      modes.set(current, []);
    } else if (current !== null && line.startsWith("  ") && line.trim() !== "") {
      modes.get(current).push(line.trim());
    }
  }
  return modes;
}

export default Object.freeze({
  runner_id: "runner.node-test",
  setupProbe: ({ runtime }) => ({ command: runtime.executables.node,
    args: ["--version"], cwd: runtime.env.HOME }),
  ordinaryInvocation: async ({ runtime, checkout, projectDir, target, file, selector, entrypoints, metadata,
    proof = null }) => {
    const node = runtime.executables.node;
    const options = proof === null ? namePattern(selector) : [...proof.options];
    const wrapper = entrypoints.find((entry) => entry.adapter === "node-test-wrapper") ?? null;
    if (wrapper === null) {
      return { harness: Object.freeze({ kind: "node_test" }),
        invocation: { command: node, args: ["--test", ...options, file], cwd: projectDir } };
    }
    const entry = path.join(checkout, wrapper.entrypoint);
    const listed = await metadata({ command: node, args: [entry, "list"], cwd: projectDir });
    const modes = wrapperModes(listed.stdout);
    const mode = [...modes].find(([, files]) => files.includes(file))?.[0] ?? null;
    if (mode === null) {
      throw new RunnerIntegrationPreconditionError("ordinary_test_selection_unsupported",
        `the node-test wrapper ${wrapper.entrypoint} does not list ${target} in any of its modes`,
        { reason: "wrapper_does_not_list_target", entrypoint: wrapper.entrypoint, target,
          modes: [...modes.keys()] });
    }
    return {
      harness: Object.freeze({ kind: "node_test_wrapper", adapter: wrapper.adapter, entrypoint: wrapper.entrypoint }),
      selection: Object.freeze({ wrapper_mode: mode }),
      invocation: { command: node, args: [entry, mode, ...options, file], cwd: projectDir }
    };
  }
});
