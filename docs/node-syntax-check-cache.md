# Node syntax-check reuse

Snapshot construction reuses successful per-file `node --check` results through
`packages/agent-launch-core/src/lib/node-syntax-check-cache.mjs`. Ordinary tooling
can use the same cache:

```sh
node tools/node-check.mjs file.mjs other.js
node tools/node-check.mjs --fresh file.mjs
```

The default cache is `.cache/node-syntax-check` in the tooling's repository.
It persists across worker and test-runner commands sharing that checkout. For
separate worktrees, pass the same private directory with `--cache-dir PATH`.
This caches syntax validity only. Prepared pack/install fixtures still have
their existing runner-invocation lifetime, and test results are never cached.

Every check reads the current file and its nearest package scope. The key binds
source bytes, resolved extension, package.json contents or absence,
node_modules context, the Node executable's content digest, platform,
architecture, and the cache implementation actually loaded. Equivalent copied
files can reuse a result. A source edit invalidates that file; a package-scope
edit invalidates files using that scope. The Node checksum is reused while its
resolved path, device, inode, size, nanosecond modification time and change time
agree. A replacement or observed edit requires a new content hash. Each checker
also pins those kernel stamps and refuses observed runtime changes during its
lifetime. Source identities always hash actual bytes, regardless of timestamps.

On a miss, the checker writes the captured bytes and package scope privately,
runs native Node against that capture, and verifies the live input identity
again. An observed input change fails instead of automatically retrying.
Parsing the capture prevents a concurrent edit-and-restore from certifying
different source bytes. Native failure diagnostics retain the caller's path.
Only quiet success with no spawn error or signal is published. Publication is
atomic; concurrent misses can perform duplicate work but never share partial
records. Each native check has a 30-second timeout and a 1 MiB output bound.
Cache corruption or unsafe ownership/permissions fail explicitly. The cache
assumes the same local user is trusted to maintain its private runtime files;
it is not authenticated execution evidence.

`NODE_OPTIONS` and executable-library overrides (`LD_*`, `DYLD_*`) keep native,
uncached execution. These can introduce preloads or other execution beyond
parsing. `--fresh` also runs native checks against the original paths.
The wrapper reports actual native-check and reuse counts. It accepts `.js`,
`.mjs`, and `.cjs` files; it does not change the Node executable or intercept
bare `node --check` commands.

`buildSnapshotTree` returns `syntaxChecks` with native-check, runtime-hash, hit
and miss counts and hash/check milliseconds. Its `freshSyntaxChecks: true` option, also exposed
as `--fresh-syntax-checks` by the snapshot command, exercises the existing native
syntax gate for every file. Cold snapshot scrub and evaluator-integrity tests
use this option. All other snapshot construction and verification gates still
run on every build, including directory enumeration and post-scrub checks.

The worker and terminal-candidate validators retain fresh confined execution
and their existing execution-evidence contracts. Isolation-plan and runner-root
witnesses also exercise native checks. `tests/run-tests.mjs` has no separate
syntax-check stage; it continues to execute all selected tests.

The cache contains small success and runtime-checksum records and removes each
private capture on orderly completion. Interrupted captures or publications
can remain until manual removal of the cache directory. No eviction policy or automatic recovery rebuild is
provided. The first check of each identity still pays capture and native-parser
costs; later checks pay source/package reads, hashing and entry verification.
Native-check counts alone do not establish wall-time savings.

Validate the behavior through the supported runner:

```sh
node tests/run-tests.mjs integration tests/integration/node-syntax-check-cache.test.mjs
node tests/run-tests.mjs integration tests/integration/agent-chassis-snapshot-scrub.test.mjs
```
