

import assert from "node:assert/strict";
import test from "node:test";

import stestr from "../../packages/agent-launch-cli/src/lib/test-execution/runner-integrations/stestr.mjs";

const PROJECT = "/agent-validation-tmp/work/python-stestr";
const SCRATCH = "/agent-validation-tmp/.launcher-test-proof/scratch";
const FILTER = "^unit\\.test_answer\\.AnswerTests\\.test_returns_42$";
const WORKER = "/usr/bin/python3.12 -B /launcher/observers/stestr_observer.py /agent-validation-tmp/config.json";
const MODULE = ["-I", "-B", "-m", "stestr"];

const MODES = [
  { name: "interpreter mode", runtime: { executables: { python: "/usr/bin/python3.12" }, values: {} } },
  { name: "a selected virtual environment's interpreter", runtime: {
    executables: { python: "/srv/envs/stestr/bin/python" },
    values: { python: "/srv/envs/stestr/bin/python", venv: "/srv/envs/stestr" } } },
  { name: "a misleading virtual environment value", runtime: {
    executables: { python: "/usr/bin/python3.12" }, values: { venv: "/srv/envs/unrelated" } } }
];

for (const { name, runtime } of MODES) {
  test(`the stestr plans run the selected interpreter's stestr module for ${name}`, () => {
    const withScratch = { ...runtime, scratchRoot: SCRATCH };
    assert.deepEqual(stestr.setupProbe({ runtime: withScratch, projectDir: PROJECT }), {
      command: runtime.executables.python,
      args: [...MODULE, "--version"],
      cwd: PROJECT
    });
    assert.deepEqual(stestr.invocation({ runtime: withScratch, projectDir: PROJECT, filter: FILTER,
      workerPython: WORKER }), {
      command: runtime.executables.python,
      args: [...MODULE, "--repo-url", `${SCRATCH}/stestr`, "run", "--concurrency", "1", FILTER],
      cwd: PROJECT,
      directories: [`${SCRATCH}/stestr`],
      env: { PYTHON: WORKER }
    });
  });
}
