

export default Object.freeze({
  runner_id: "runner.node-test",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.node,
    args: ["--version"], cwd: projectDir })
});
