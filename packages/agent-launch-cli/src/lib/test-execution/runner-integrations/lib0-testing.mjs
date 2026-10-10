

import path from "node:path";

function invocation({ runtime, projectDir, module, nodeArguments, moduleArgs = [] }) {
  return {
    command: runtime.executables.node,
    args: [...nodeArguments, module, ...moduleArgs],
    cwd: projectDir,
    env: { NO_COLOR: "1" }
  };
}

export default Object.freeze({
  runner_id: "runner.lib0-testing",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.node,
    args: ["--input-type=module", "--eval", "await import('lib0/testing')"], cwd: projectDir }),
  ordinaryInvocation: ({ runtime, checkout, projectDir, target, selector, entrypoints, proof = null }) => {
    const association = entrypoints.find((entry) => entry.target === target) ?? null;
    const module = path.join(checkout, association?.entrypoint ?? target);
    return {
      harness: association === null ? Object.freeze({ kind: "lib0_self_running", entrypoint: target })
        : Object.freeze({ kind: "lib0_separate_harness", entrypoint: association.entrypoint }),
      invocation: invocation({ runtime, projectDir, module, nodeArguments: proof?.nodeArguments ?? [],
        moduleArgs: selector === null ? [] : ["--filter", selector] })
    };
  }
});
