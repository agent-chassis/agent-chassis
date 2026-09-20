

import path from "node:path";
import { fileURLToPath } from "node:url";

import integration from "../runner-integrations/cargo-test.mjs";
import { finishRustFile, instrumentRustModule, instrumentRustTestFile }
  from "../source-instrumentation/rust.mjs";
import { nativeProviderImplementation, refuseAttempt } from "./native-lifecycle.mjs";

const RUST_INSTRUMENTATION_ASSET = fileURLToPath(new URL("../source-instrumentation/rust.mjs",
  import.meta.url));
const CUSTOM_LAYOUT_RE = /^\s*(?:\[lib\]|\[\[test\]\]|\[\[bin\]\]|autotests\s*=|autolib\s*=)/mu;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function libraryModulePath(relative) {
  const inner = relative.slice("src/".length, -".rs".length).split("/");
  if (inner.at(-1) === "lib" && inner.length === 1) return [];
  if (inner.at(-1) === "mod") inner.pop();
  return inner.every((part) => IDENTIFIER_RE.test(part)) ? inner : null;
}

function layout(attempt) {
  const projectRoot = attempt.project === "." ? "" : attempt.project;
  const inProject = (repositoryPath) => path.posix.relative(projectRoot, repositoryPath);
  const manifest = attempt.read(path.posix.join(projectRoot, "Cargo.toml")).source;
  if (CUSTOM_LAYOUT_RE.test(manifest)) {
    refuseAttempt("test_proof_native_selection_unsupported",
      "cargo proofs support only Cargo's default target layout", {});
  }
  const libRoot = path.posix.join(projectRoot, "src/lib.rs");
  const test = inProject(attempt.testFile);
  let target;
  let testRoot;
  let prefix;
  const integrationTest = /^tests\/([A-Za-z0-9_-]+)\.rs$/u.exec(test);
  if (integrationTest !== null) {
    target = { kind: "test", name: integrationTest[1] };
    testRoot = attempt.testFile;
    prefix = [];
  } else if (test.startsWith("src/") && libraryModulePath(test) !== null) {
    attempt.read(libRoot);
    target = { kind: "lib" };
    testRoot = libRoot;
    prefix = libraryModulePath(test);
  } else {
    refuseAttempt("test_proof_native_selection_unsupported",
      "the selected Rust test must be in tests/<name>.rs or a library module under src/", {});
  }
  if (attempt.module !== null && (!inProject(attempt.module).startsWith("src/") ||
      libraryModulePath(inProject(attempt.module)) === null)) {
    refuseAttempt("test_proof_native_selection_unsupported",
      "the declared Rust module must be a library module under src/", { path: attempt.module });
  }
  return { target, testRoot, libRoot, exactName: [...prefix, ...attempt.test].join("::") };
}

async function instrument(attempt, { testRoot, libRoot }) {
  const files = new Map();
  const entry = (relative) => {
    if (!files.has(relative)) files.set(relative, { ...attempt.read(relative), edits: [] });
    return files.get(relative);
  };
  const test = entry(attempt.testFile);
  const guarded = await instrumentRustTestFile({ source: test.source, selected: attempt.test,
    file: attempt.testFile });
  test.edits.push(...guarded.edits);
  const roots = new Set([testRoot]);
  let module = null;
  if (attempt.module !== null) {
    const declared = entry(attempt.module);
    const probed = await instrumentRustModule({ source: declared.source, modulePath: attempt.module,
      mutation: attempt.mutation });
    declared.edits.push(...probed.edits);
    roots.add(libRoot);
    module = { module_path: attempt.module, source_digest: declared.digest,
      functions: probed.functions, probes: probed.probes, ...(probed.mutation ?? {}) };
  }
  for (const root of roots) entry(root);
  const writes = [...files.entries()].map(([relative, file]) => ({
    path: attempt.workPath(relative),
    content: finishRustFile({ source: file.source, edits: file.edits, crateRoot: roots.has(relative),
      channel: attempt.channelPath, nonce: attempt.nonce,
      sourceId: relative === libRoot ? "rust.lib" : "rust.test" })
  }));
  return { writes, declared_tests: guarded.tests, ...(module === null ? {} : { module }) };
}

export default nativeProviderImplementation({
  family_id: "cargo-test",
  selector_kind: "cargo_test_path",
  runtime_runner: "cargo-test",
  identity_format: Object.freeze({ kind: "joined", separator: "::" }),
  completion: "selected_result",
  assets: [RUST_INSTRUMENTATION_ASSET],
  layout,
  instrument,
  invocation: (attempt, { target, exactName }) => integration.invocation({
    runtime: attempt.runtime, projectDir: attempt.workProject, target, exactName })
});
