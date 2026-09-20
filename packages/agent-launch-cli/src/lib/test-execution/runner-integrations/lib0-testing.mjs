

export default Object.freeze({
  runner_id: "runner.lib0-testing",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.node,
    args: ["--input-type=module", "--eval", "await import('lib0/testing')"], cwd: projectDir }),
  invocation: ({ runtime, projectDir, module, nodeArguments }) => ({
    command: runtime.executables.node,
    args: [...nodeArguments, module],
    cwd: projectDir,
    env: { NO_COLOR: "1" }
  })
});
