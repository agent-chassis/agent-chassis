

import path from "node:path";

function stestr(runtime) {
  return path.join(runtime.values.venv, "bin", "stestr");
}

export default Object.freeze({
  runner_id: "runner.stestr",
  setupProbe: ({ runtime, projectDir }) => ({ command: stestr(runtime), args: ["--version"],
    cwd: projectDir }),
  invocation: ({ runtime, projectDir, filter, workerPython }) => ({
    command: stestr(runtime),
    args: ["--repo-url", `${runtime.scratchRoot}/stestr`, "run", "--concurrency", "1", filter],
    cwd: projectDir,
    directories: [`${runtime.scratchRoot}/stestr`],
    env: { PYTHON: workerPython }
  })
});
