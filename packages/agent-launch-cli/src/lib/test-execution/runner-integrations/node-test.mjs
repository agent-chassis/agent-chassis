

export default Object.freeze({
  runner_id: "runner.node-test",
  setupProbe: ({ runtime }) => ({ command: runtime.executables.node,
    args: ["--version"], cwd: runtime.env.HOME })
});
