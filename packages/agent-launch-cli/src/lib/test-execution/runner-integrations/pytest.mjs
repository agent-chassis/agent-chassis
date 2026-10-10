

export default Object.freeze({
  runner_id: "runner.pytest",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.python,
    args: ["-m", "pytest", "--version"], cwd: projectDir }),
  ordinaryInvocation: ({ runtime, projectDir, file, selector, proof = null }) => ({
    harness: Object.freeze(proof === null ? { kind: "pytest" } : { kind: "pytest_launcher_entry" }),
    invocation: { command: runtime.executables.python,
      args: proof !== null ? [...proof.args]
        : ["-m", "pytest", selector === null ? file : `${file}::${selector}`], cwd: projectDir }
  })
});
