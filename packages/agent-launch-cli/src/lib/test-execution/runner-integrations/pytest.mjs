

export default Object.freeze({
  runner_id: "runner.pytest",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.python,
    args: ["-m", "pytest", "--version"], cwd: projectDir })
});
