

function stestr(runtime, args) {
  return { command: runtime.executables.python, args: ["-I", "-B", "-m", "stestr", ...args] };
}

export default Object.freeze({
  runner_id: "runner.stestr",
  setupProbe: ({ runtime, projectDir }) => ({ ...stestr(runtime, ["--version"]), cwd: projectDir }),
  invocation: ({ runtime, projectDir, filter, workerPython }) => ({
    ...stestr(runtime, ["--repo-url", `${runtime.scratchRoot}/stestr`, "run", "--concurrency", "1", filter]),
    cwd: projectDir,
    directories: [`${runtime.scratchRoot}/stestr`],
    env: { PYTHON: workerPython }
  })
});
