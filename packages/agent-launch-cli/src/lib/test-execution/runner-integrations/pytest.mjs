

import { bindPythonInvocation } from '../python-source-binding.mjs';
import { pythonDependencyPreparation } from './python-preparation.mjs';

export default Object.freeze({
  runner_id: "runner.pytest",
  dependencyPreparation: pythonDependencyPreparation,
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.python,
    args: ["-m", "pytest", "--version"], cwd: projectDir }),
  ordinaryInvocation: ({ runtime, repositoryRoot, checkout, projectDir, file, selector, proof = null }) => ({
    harness: Object.freeze(proof === null ? { kind: "pytest" } : { kind: "pytest_launcher_entry" }),
    invocation: { command: runtime.executables.python,
      args: bindPythonInvocation(proof !== null ? [...proof.args]
        : ["-m", "pytest", selector === null ? file : `${file}::${selector}`],
      { repositoryRoot, checkoutRoot: checkout }), cwd: projectDir }
  })
});
