# Prepared test fixture cache

Snapshot syntax checks have a separate [per-file syntax cache](node-syntax-check-cache.md)
that persists across commands. This does not extend the prepared-fixture cache's
invocation lifetime or cache consumer test outcomes.

`tests/helpers/prepared-test-fixture-cache.mjs` lets test helpers prepare an
expensive fixture tree once per runner invocation and hand every caller its own
private copy. It is the shared owner for that reuse: a helper that prepares the
same tree for many tests or test files describes the preparation as a recipe and
calls this helper instead of keeping a process-local cache.

This page is the contract for that helper. It has two consumers:

- `tests/helpers/committed-slice-review-fixture.mjs` prepares its Git base
  repository through it; see
  [Git preparation measurement](test-suite-classification.md#git-preparation-measurement).
- `tests/helpers/prepared-publishing-fixtures.mjs` packs the publishing packages
  and installs packed tarballs through it; see
  [Publishing preparations](#publishing-preparations).

Reuse lasts one runner invocation and every call still gets a private copy.
[Matched consumer comparison](#matched-consumer-comparison) describes how the
two consumers are measured together. This page states no measured result and
makes no claim about the runtime of a suite.

## API

```js
import { prepareTestFixture, prepareTestFixtureSync } from "../helpers/prepared-test-fixture-cache.mjs";

const result = await prepareTestFixture({
  recipe: "my-helper/packed-tree@1",
  inputs: [{ name: "package", path: packageDir }],
  options: { production: true },
  destination: path.join(fixture.rootPath, "tree"),
  waitTimeoutMs: 60_000,
  copyMode: "ordinary",
  prepare: async ({ artifactDir, inputs }) => { /* write into artifactDir */ }
});
```

Both entry points take the same descriptor and share one implementation. They
differ only in how they wait and how they call `prepare`:
`prepareTestFixture` accepts a synchronous or asynchronous callback;
`prepareTestFixtureSync` refuses a callback that returns a promise. Filesystem
work is synchronous in both.

| Field | Meaning |
| --- | --- |
| `recipe` | Required `<namespace>/<name>@<version>` string. Change the version when the preparation code changes. |
| `inputs` | Required array of `{ name, path }`. Every file, directory or link the preparation reads belongs here, including recipe and dependency sources that affect the result. Labels are unique. |
| `options` | JSON-compatible value that changes the result. Key order does not matter. Non-finite numbers and non-JSON values are refused. |
| `destination` | Caller-owned path that is absent or an empty directory. Acquire its parent through the caller's fixture or resource scope. |
| `prepare` | Callback given `{ artifactDir, inputs }`. `inputs` maps each label to a private capture of that input. It writes only into `artifactDir` and may return JSON metadata. |
| `waitTimeoutMs` | Required finite positive budget for waiting on another builder. There is no default: choose a value below the enclosing test and file deadlines. |
| `copyMode` | Required: `"ordinary"` or `"clone"` (`COPYFILE_FICLONE`). |
| `fresh` | Optional. `true` runs the same preparation without the shared cache. |

The result is frozen: `destination`, `metadata`, `key`, `outcome` (`"built"`,
`"hit"` or `"fresh"`) and `work` (see [Measurement](#measurement)). The shared
tree is never returned.

## Identity

The key is a SHA-256 over the recipe string, the canonical options JSON, the
Node version, platform and architecture, and the named content digest of the
inputs. `measureNamedPopulationContent` in
`packages/wiki-core/src/lib/runtime-inputs/population-identity.mjs` computes that
digest with the same walker and record grammar as `measurePopulationContent`,
with each label in place of its root's location. It covers relative names, entry
types, file bytes, the executable bit and link targets. It refuses sockets, FIFOs
and devices, which the absolute-root functions skip.

Consequences:

- Equal labelled content at different locations shares an entry.
- A changed byte, name, addition, removal, executable bit, link target, label,
  recipe string or option is a different key, even when size and mtime are
  unchanged.
- Modification times, inode numbers and Git `HEAD` never take part.
- An input the recipe does not declare cannot invalidate an entry. Declaring
  inputs completely is the recipe owner's responsibility.

Every call hashes its declared inputs, hit or miss. Declare the input population
the preparation needs, not a whole checkout.

## Building and publishing

The cache is the fixed directory `prepared-test-fixture-cache` under the
runner-owned `TMPDIR` root created by `tests/run-tests.mjs`. Each key owns one
directory there.

1. Creating the key directory is the exclusive build claim.
2. The builder copies the inputs into the claim, then checks that the source
   before the copy, the source after it and the capture all have the identity the
   key was computed from. A difference fails with `input_moved` and publishes
   nothing; there is no retry.
3. `prepare` runs against the capture and writes the artifact.
4. The artifact is validated and digested, and a completion manifest is
   published by rename inside the claim.

An entry is usable only once that manifest exists. A hit requires a manifest
that parses, matches the key and recipe, and whose recorded digest equals the
artifact as read during the copy.

Every caller, including the builder, receives a copy: the artifact is copied to
a private sibling of `destination`, the copy is digested against the manifest,
and it is renamed into place. An occupied destination is refused; nothing is
merged or deleted.

Trees the helper captures, publishes or returns are private:

- files are copied, never hard-linked, and a tree holding a hard-linked file is
  refused;
- relative links are copied with their literal target; an absolute link, a link
  that resolves outside its tree, or an input root that is itself a link is
  refused;
- file modes and directory modes are preserved.

Source, destination and cache paths must not overlap. Paths are compared after
`partialRealpathSync` (`tests/helpers/test-path-containment.mjs`), so a
destination reached through a link into a source is refused too.

## Failures

Errors are `PreparedTestFixtureError` with a `code` from
`PREPARED_TEST_FIXTURE_ERROR_CODES`, the original error as `cause`, and a
`detail` holding `recipe`, `key`, `phase`, `root`, `path`, `elapsedMs` and
`budgetMs`. Nothing falls back to an uncached build, and nothing is rebuilt
implicitly.

| Code suffix | Cause | What to do |
| --- | --- | --- |
| `invalid_recipe` | Malformed descriptor, duplicate label, non-JSON options or metadata | Fix the recipe. |
| `unsupported_root` | No valid run context, `TMPDIR` outside a runner-owned root, or a cache root that is not a private directory | Run through `node tests/run-tests.mjs`. A direct `node --test` run is refused with the test-fixture entrypoint code. |
| `path_overlap`, `destination_occupied` | Path rules above | Choose a separate, empty destination. |
| `unsafe_entry` | Unsupported entry type, hard link, or absolute or escaping link | Fix the input or the preparation. |
| `input_moved` | Inputs changed during capture | Stop mutating the inputs, then call again. |
| `build_failed` | `prepare` threw | The claim is released; a later call builds again. |
| `async_callback_in_sync_entry` | Promise from `prepare` in the synchronous entry | Use `prepareTestFixture`. |
| `same_process_build` | A call for a key from inside that key's own `prepare`, or a synchronous call while this process is building the key asynchronously | Remove the nested or blocking request. |
| `wait_timeout` | The builder did not publish within `waitTimeoutMs` | See below. |
| `corrupt_entry` | Unreadable or mismatched manifest, or an artifact that no longer matches it | Start a new runner invocation. |
| `copy_failed` | The private copy failed or did not match | The published entry stays; fix the destination. |

A builder that fails normally renames its claim away and deletes it, leaving the
key free. A caller already waiting then contends for the claim within what is
left of its own budget, and reports `outcome: "built"` with a nonzero wait.

A builder that is killed leaves a claim with no manifest. Nothing reclaims it
during that runner invocation: there is no process-liveness check and no
background deletion. Waiters fail with `wait_timeout` once their budget is spent,
and the supported recovery is a new runner invocation. A file
that is not the completion manifest, including a partial one, is never readiness.

A call removes only the unpublished state it owns: its input capture, its staging
directory, or its own failed claim. A capture keeps its source's modes, so
removal first makes each directory of that owned tree writable, without following
links. Source inputs, published entries, other keys and destinations are never
changed. If
that removal fails as well, the original error is still the one thrown and the
removal failure is attached as `cleanupFailure`.

## Lifetime

Entries belong to one runner invocation. The runner's existing root cleanup and
abandoned-root recovery remove the cache with the `TMPDIR` root; the helper adds
no marker, sweep or persistence of its own. Two runner invocations never share
an entry, including a nested runner started from a test. Disposing a consumer's
fixture removes its copy and leaves the published entry in place.

## Fresh mode

`fresh: true` captures the inputs, runs `prepare` and validates the artifact
exactly as a build does, in a private staging directory beside `destination`,
then renames the artifact into place. It neither reads nor publishes the shared
key. It is an explicit cold-preparation mode chosen by the caller, not a recovery
from a timeout or a corrupt entry.

## Measurement

Each phase is a `measureComponentPhase` span owned by
`prepared-test-fixture-cache` and labelled `<phase> <recipe>`:
`input_identity`, `wait`, `input_capture`, `build`, `artifact_verification` and
`materialization`. They appear in the run's component journals; see
[Retained run artifacts and live timing](test-suite-classification.md#retained-run-artifacts-and-live-timing).
A build that fails ends its `build` span as failed.

`result.work` reports what that one call did:

| Field | Meaning |
| --- | --- |
| `builds`, `hits` | 1 when this call ran `prepare` to completion, or reused a published entry |
| `waits`, `wait_ms` | wait episodes on another builder, and their total time |
| `build_ms` | time inside `prepare` |
| `hash_passes`, `hashed_bytes`, `hash_ms` | tree measurements, bytes hashed, and time spent measuring |
| `captures` | 1 when the inputs were captured |
| `copies`, `copied_bytes`, `copy_ms` | private artifact copies made; bytes and time include the input capture |

A hit makes three measurement passes (inputs, artifact while copying, copy). A
build makes seven and a fresh preparation five.

## Publishing preparations

`tests/helpers/prepared-publishing-fixtures.mjs` owns the published package
population (`PUBLISHING_PACKAGES`, from `PACKAGES` in
`tools/agent-chassis-release.mjs`), its selection
(`resolvePublishingSelection`), and two recipes. `tests/helpers/publish-smoke-fixtures.mjs`
re-exports these four names unchanged, so existing callers reuse automatically.

```js
const byPackage = await packPublishingPackages(tarballDir, packagesRoot,
  { packages, fresh: false, cacheWaitTimeoutMs: 30_000, npmTimeoutMs: 120_000 });
await installConsumer(consumerDir, tarballsFor(byPackage, [...byPackage.keys()]),
  { fresh: false, cacheWaitTimeoutMs: 30_000, npmTimeoutMs: 120_000 });
```

`packPublishingPackages` still returns a map from package directory name to a
tarball inside `tarballDir`, and `installConsumer` still returns nothing.
`tarballDir` and `consumerDir` are cache destinations: absent or empty, never
merged into. `fresh: true` runs the same real npm work without reading or
publishing a shared entry. `cacheWaitTimeoutMs` bounds the wait for another
builder and `npmTimeoutMs` bounds each npm subprocess; neither is part of the
key.

### Packing

The selection is resolved first, so a refused selection starts no npm and writes
nothing. The recipe's inputs are then:

- every regular file below each selected package directory. npm never packs a
  symbolic link, so a link is not an input and is not captured;
- each of `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `.npmrc`,
  `.npmignore` and `.gitignore` that exists beside the packages root. A root
  without them, such as a snapshot or a synthetic tree, keeps that shape;
- the helper's own source.

The key also covers the resolved selection in order, the name of the packages
directory, the `npm` executable a bare `npm` resolves to, and npm's effective
configuration. That configuration is what `npm config list --json` reports for
the calling environment (defaults, built-in, global, user and `npm_config_*`
layers) without the keys that only locate npm's own state: `cache`,
`globalconfig`, `init-module`, `init.module`, `prefix` and `userconfig`. npm does
not list credentials, and only a digest of the listing enters the key. The
contents of npm's download cache are not identity.

npm derives its global configuration file from its prefix, so a command given a
project `--prefix` reads `<project>/etc/npmrc` instead of the environment's own
file. Each request therefore first asks `npm config get globalconfig` in an
empty private project, and passes that one path as `--globalconfig` to the
configuration listing and to every `npm pack` and `npm install` it starts. The
global layer that is keyed is the global layer those commands read.

A build lays the cache's verified capture out as a private project with the same
relative layout, resolves the selection again from the captured manifests, and
runs `npm pack --ignore-scripts` on each captured package with that project as
`--prefix` and the resolved `--globalconfig`. Nothing is packed from the live tree, so an edit made after a
coherent capture cannot reach the tarball. A file added or removed while the
inputs were captured, or captured manifests that select something else, fail
with `input_moved`.

Refused before any npm: a root packaging file that is not a regular file, a root
`.npmrc` holding a literal credential rather than an environment reference, and
an entry in a selected package that is neither a file, a directory nor a link.

### Installing

The inputs are the tarballs' bytes under labels for their position, so equal
tarballs in the same order share one installation whatever their paths or file
names. A build copies the captured tarballs to private `.tgz` files and installs
them in one `npm install` with `--prefer-offline --no-audit --no-fund
--ignore-scripts --loglevel=error` into a project holding the smoke's minimal
`package.json` and `.npmrc`.

npm records where each local tarball was. Before the baseline is published those
fields, and only those, are set to a neutral value, and after every
materialization, shared or fresh, they are set to the caller's own tarball
paths in the form npm writes (`file:` and the path relative to the consumer):

- the dependency spec in the consumer's `package.json`;
- the same spec in the root record of `package-lock.json`;
- `resolved` in `package-lock.json` and in `node_modules/.package-lock.json`.

Each field must hold exactly the expected value, the lock files must be
`lockfileVersion` 3, each file must already be in npm's two-space JSON form, and
no other local reference may appear. Names, versions, integrities and every
other byte are kept. Anything else fails with
`prepared_publishing.unsupported_relocation.v1`; two tarballs of one package are
an example. `.bin` links are relative and stay inside the tree, so a consumer
keeps working after its builder's tarballs, the source, or another consumer are
removed.

### Failures and records

Every npm subprocess runs through `managed-test-process` in its own process
group, registered with the call's resource scope when it starts, with bounded
output. A failed preparation is thrown as itself, with a
`PreparedPublishingError` code:

| Code suffix | Cause |
| --- | --- |
| `npm_failed` | npm exited nonzero; the message keeps the step, the package or consumer, and npm's output |
| `npm_spawn_failed` | npm could not be started; the spawn error is the `cause` |
| `npm_timeout` | a subprocess exceeded `npmTimeoutMs` and its process group was stopped |
| `unsupported_configuration`, `unsupported_input` | the refusals above |
| `unsupported_relocation` | npm metadata that cannot be rebound |
| `invalid_option` | `npmTimeoutMs` is not a finite positive number |

The cache's own failures keep their `PreparedTestFixtureError` code. Nothing is
retried without the cache, and a failed build publishes nothing.

Each request appends one `prepared_publishing_fixture` record to its component
journal: `kind` (`pack` or `install`), the cache `key`, `outcome`, `work`, and
`npm_starts` by step. A request that failed records `outcome: "failed"` and its
error code. Each npm subprocess is also a `managed-test-process` span. A hit
starts two npm processes, both under the `config` step, and no `pack` or `install`.

## Matched consumer comparison

`tests/helpers/prepared-fixture-comparison.mjs` measures the consumers together.
The test `prepared fixture measurements compare matched cold and reused
consumers` in `tests/integration/prepared-committed-slice-fixtures.test.mjs`
runs it and asserts no timing threshold.

### Invocation

Other test files pack and install the same snapshot under the same keys, which
is the reuse this cache exists for, so inside an ordinary suite run the shared
entries may already be published. The comparison therefore runs in its own
runner invocation. `runPreparedFixtureComparison` writes a one-test file into a
`createNestedRunnerHarness` fixture and starts `tests/run-tests.mjs` on it once.
That nested runner creates its own `TMPDIR` root and so its own empty cache; no
key is salted, no input is altered and no entry is cleared. All four rounds,
both lanes and all three recipes run in that one nested process.

The nested run is retained beneath the outer run as `<outer-run>/nested/<run>`,
with its own `run.json` naming the outer run as `parent`. The comparison record
and every sample are in the nested run's component journal only. The outer test
requires the nested runner to exit 0 with status `tests_passed` and complete
recording, exactly one comparison record carrying the nested run's identity and
parent, and journals that read back without a malformed or torn line. It then
derives the summary again from the retained samples, and counts the nested
run's `prepared_publishing_fixture` records itself: per kind, four fresh, one
built and three hits under one key.

The outer test appends one `prepared_fixture_comparison_nested_run` record to
its own journal: both run identities, the nested run directory and journal, the
nested runner's wall time, and that wall time minus the comparison's own
source, snapshot and matched sections. That remainder is runner startup and
teardown, module loading and validation; it is part of no helper timing.

Budgets, innermost first: 1,080,000 ms for the nested test, 1,100,000 ms for
the nested runner's file watchdog, 1,140,000 ms for the harness bound and
1,200,000 ms for the outer test. The outer runner's file watchdog must exceed
that, so run the file with `--test-file-timeout=1260000`.

### Method

Setup, outside every measured interval: one committed candidate from
`createPublishSmokeSourceRepository`, and one full release snapshot built by
that candidate's own snapshot tool. The selection comes from
`resolvePublishingSelection` over `PUBLISHING_PACKAGES`. The source repository
must be unchanged afterwards.

Four rounds follow in the same process. Each round runs a `fresh` sample and a
`shared` sample; `fresh` goes first in even rounds and `shared` first in odd
rounds. A sample makes three calls into new private destinations:
`packPublishingPackages` on the whole snapshot, `installConsumer` on the
tarballs that call returned, and the committed-slice `fixture` with a record id
no other caller uses and otherwise ordinary options. The `fresh` lane passes
`fresh: true` to all three in every round. The `shared` lane must build each
recipe in round 0 and hit it in rounds 1 to 3. Nothing is cleared, retried or
discarded: a shared entry that is already published when round 0 asks for it,
a rebuild, a changed key or any failure fails the test, and no comparison is
retained.

Each measured interval is one complete helper call and nothing else. It
includes npm configuration discovery, relocation of the installed metadata, and
for Git the per-call scenario after the base. Journal reads, consumer
assertions and removal of the sample's roots run between and after the
intervals.

Both lanes get the same consumer assertions: the installed population and
versions equal the snapshot manifests; each package resolves to the caller's
own tarball; the installed `wiki` entrypoint is inside the consumer, outside
the source, and runs from a directory that is no repository; the Git base,
delivery, worktree, clean status and `fsck`; every root is private to its
sample; and the observations with caller paths left out are equal across all
eight samples.

### Evidence and counts

Publishing outcome, key, work and npm starts are read from the
`prepared_publishing_fixture` record each call appends to this process's
journal: exactly one new record of the expected kind per call, from a journal
that reads back without a malformed or torn line. Git outcome, key and work
come from `basePreparation`, and Git process starts from
`createCommittedSliceGitMeasurement`. `common_preparations` counts completed
common phases in both lanes and is not a build count.

For four requests per lane the test requires:

| Count | `fresh` | `shared` |
| --- | --- | --- |
| builds per recipe | 4 | 1, then 3 hits |
| `npm pack` starts | selected packages x 4 | selected packages x 1 |
| `npm install` starts | 4 | 1 |
| `git init`, base commits | 4 | 1 |
| `npm config` starts per publishing request | 2 | 2 |

One cache key per recipe across all eight samples is asserted directly, as are
equal tarball digests and lock integrities.

### Retained record

One `prepared_fixture_consumer_comparison` record is appended to the nested
run's component journal and read back for equality. It holds:

- `samples`: per round and lane, each call's `wall_ms`, `outcome`, `key`,
  `work`, process `starts`, `fs_read` and `fs_write`, the load average before
  and after, and a digest of the consumer result;
- `summary` for `pack`, `install`, `git` and `combined`: per lane the raw wall
  times, their total and median, summed `work` and `starts`, and
  `wall_outside_cache_work_ms` (total wall time minus `build_ms`, `hash_ms`,
  `copy_ms` and `wait_ms`); then `first_shared_build_wall_ms`,
  `warm_hit_median_wall_ms`, `fresh_median_minus_warm_hit_median_ms` and
  `fresh_minus_shared_total_wall_ms`. The last is signed and its shared total
  includes the one build, so a negative value is a regression;
- `git_counts`, `consumer_result`, `selected_packages`, the snapshot commit
  and its setup cost, and the accounting notes above;
- `run` (the nested run and its parent), `runtime` (Node, platform,
  architecture, npm version, CPU count), `provenance` from the nested run's
  `run.json` through `measurementProvenanceFromRun`, the facts it lacks, and
  `discrepancies` between the runner's source and the snapshot commit;
- `availability`, `uncontrolled`, `unavailable` and
  `negative_controls_rejected`.

Before the record is written, altered copies of the real observations must be
refused: a missing or duplicate sample or record, a repeated build, a warm
entry in place of the build, a different key or consumer result, a malformed
or torn journal, and an unavailable quantity carried as zero.

### What the comparison does not establish

- It is three preparations in one process and one nested runner invocation,
  not a suite runtime, and it makes no concurrency claim. What reuse saves a
  suite depends on how many callers share each key there.
- `fresh` means fresh fixture preparation. npm's download cache, the operating
  system's file cache and machine load are not controlled, and the first
  sample warms the first two for every later one.
- `fs_read` and `fs_write` are `process.resourceUsage()` block operation counts
  for the test process only. They are not bytes and exclude npm and Git
  children. Child I/O and CPU, physical disk bytes and network bytes are not
  measured. Where the platform reports no load average or block counts the
  value is `null` and listed under `unavailable`.
- The helpers run from the working tree while the snapshot is a commit. A
  dirty tree has no patch identity; it stays missing and is listed.
- Called directly in a runner invocation where another caller has already
  published the same keys, `comparePreparedFixtureConsumers` fails rather than
  report a hit as the build. Use `runPreparedFixtureComparison`.

## Limitations

- The publishing recipes key every regular file below a selected package, not
  only the files npm would pack. An unpacked file that changes, such as a
  generated cache inside a package directory, is a new key or an `input_moved`
  failure.
- Every publishing request starts `npm config get globalconfig` and
  `npm config list` to key the effective configuration, hit or miss.
- Reuse lasts for one runner invocation. There is no cross-run cache.
- The capture check detects input changes across the capture. It is not an
  atomic snapshot of files that something else keeps modifying.
- The digest records only the executable bit of a file's mode. Copies preserve
  full modes, but a change limited to other permission bits does not change the
  key.
- `prepare` is not interrupted. Bound it with the subprocess helpers it uses and
  the runner's file watchdog.
- `copyMode: "clone"` only requests a reflink; the filesystem decides. On the
  overlay filesystem backing `/tmp` in the development container,
  `COPYFILE_FICLONE_FORCE` fails with `ENOTSUP`, and 2,000 files of 16 KiB copied
  in 188 ms with the clone request against 183 ms without it (medians of five).
  The two modes cost the same there.
- A hit still hashes the inputs and the artifact and copies the artifact. For a
  cheap preparation that can cost more than rebuilding.
