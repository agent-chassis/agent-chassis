# npm and pnpm test-runtime layouts

This page defines how local test-runtime setup and test execution read the
dependency installation an operator's own package manager left for a Node
project: which installation owns a package, which lock that installation has,
which module trees it consists of, and how those trees are made resolvable
where a test runs. npm and pnpm are two layouts of the one `npm` dependency
ecosystem; an environment is `npm@<installation root>` under either. Setup
itself is in [Local test-runtime setup](local-test-runtime-setup.md), and
nothing on this page installs, downloads, converts or rewrites anything: the
operator installs dependencies with the project's own package manager.

## Workspace ownership and locks

An installation root is a `package.json` directory with the lock it has. The
launcher's `test-runtime-setup/npm-workspace.mjs` is the one owner of what a
package's declarations say about it, read by discovery, by the installation
owner and by setup's runner probes:

| Fact | Source |
| --- | --- |
| Lock | The lock that exists: `package-lock.json` (npm) or `pnpm-lock.yaml` (pnpm). |
| Lock, when both exist | The package's own evidence, in order: its `packageManager` field, a `pnpm-workspace.yaml`, then the metadata the package manager left in `node_modules` (`.package-lock.json` or `.modules.yaml`). When that names neither or both, no lock is chosen. |
| Workspace members under npm | package.json `workspaces`. |
| Workspace members under pnpm | `pnpm-workspace.yaml` `packages`, read as YAML with the `yaml` package. package.json `workspaces` is never a substitute. |
| Members below the bounded manifest walk | The directories the selected lock installs as local packages (npm `packages` keys, pnpm `importers`), and only those the declaration matches and that hold a `package.json`. Of a pnpm lock only the `importers` section is parsed, and a lock's content is read only when membership or local-source evidence is asked of it. |

A declared member belongs to the root that declares it. It shares that root's
lock and installation, it is never an environment of its own, and it is never
asked for a lock: no member `package-lock.json` is required, created or
inferred. A runner selected in a member (`--runner mocha@packages/core`) is
therefore prepared in the workspace that owns the member, and the environment
and its selection rows name that root. A later workspace pattern overrides an
earlier one, so a negated pattern removes a directory from the workspace.

A package no declaration matches keeps its own owner: a nested project with
its own lock, a directory a negation excludes, and a directory the lock records
but no pattern matches (a `file:` dependency, for example) are each their own
installation root, with their own lock or their own missing-lock report.

The installation's inputs are its `package.json`, each member's
`package.json`, the selected lock and, under pnpm, `pnpm-workspace.yaml`. Their
digest is the environment's input identity, and a coding worker must see each
of them (see
[Prepared test runtimes in the coding worker](agent-launch-worker-test-runtimes.md#prepared-test-runtimes-in-the-coding-worker)).

## Module trees

An installation is a set of module trees: the root's `node_modules` and the
`node_modules` of each declared member that has one. Any subset may exist. A
hoisted npm installation has the root's tree; an npm member that needs its own
version of a package also has its own tree; a pnpm installation has the root's
tree with the `.pnpm` virtual store and one tree per member that links into
it; and an installation whose only tree is a member's is an installation
(`source: member_node_modules`). The launcher's
`test-runtime-setup/npm-installation.mjs` is the one owner of this layout.

Installed packages stay where they really are and are never copied, flattened
or rewritten. Each package entry of a tree is one of:

| Entry | Meaning | Treatment |
| --- | --- | --- |
| A package directory, or a link that resolves inside one of the installation's own trees | An installed package: a hoisted package, a member-local package, or a pnpm virtual-store package with its own peer instance. | Kept at its real location, so Node resolves its transitive dependencies and peers exactly as it does natively. |
| A link to a declared workspace member | That member's source (`workspace_links`: package and member directory). | Resolves in the tree being tested. |
| A link to another directory of the project, or an installed directory the lock records as a copy of a local directory (`file:` with npm `install-links`, or a pnpm injected dependency) | Local source that is not a workspace member (`local_links`: package and directory, with `copy` for an installed copy). | Resolves in the tree being tested, like a member. It never becomes a workspace member. |
| A link that leaves the project | An input outside the installation. | Stays the link it is. Nothing outside the installation's own trees is bound for a confined probe or a worker. |

A package is found from the package that declares or uses it, in Node's own
nearest-ancestor order over these trees: the package's own tree, then each
ancestor's up to the installation root. A member's own version therefore wins
over the root's, the root serves every member, and a sibling member's tree is
never searched. A package is identified by where it is installed, never by its
name alone or by the spelling of a `.pnpm` directory.

A present npm dependency environment records `dir` and the root tree's
`workspace_links` and `local_links` (`dir` is null for a member-only
installation), `member_trees` (each member's `dir` and links), and `population`:
every physical installation root, each once, with a tree inside another
measured as part of it. Setup's content digest and each run's observed
provenance are taken over that population by the wiki-core population-identity
owner, so a change in a member's own tree is a change of the environment.
Generated state inside a tree (`.cache`, `.vite`, `.vite-temp`) is not part of
the identity.

## Validation and failures

Setup accepts an installation when every package a root or member manifest
requires (`dependencies` and `devDependencies`; optional and peer dependencies
may be absent) is installed where that package resolves it. Versions are the
package manager's concern and are not compared. Which trees exist and how
their packages are linked is the package manager's layout and is never a
reason to refuse.

Every failure names its condition, the input, the underlying cause, the known
effects, what is uncertain, and the next action with its actor. The recovery
names the package manager whose lock the project has (`npm ci` or
`pnpm install --frozen-lockfile`), which the operator runs; setup installs
nothing and creates no lock.

| Condition | Code | Named input |
| --- | --- | --- |
| The installation root has no lock | `test_runtime_dependency_lock_missing` | the installation root, with both supported lock names |
| Two locks and nothing decides between them | `test_runtime_environment_ambiguous` | both lock files |
| `package.json`, `pnpm-workspace.yaml` or `pnpm-lock.yaml` cannot be parsed | `test_runtime_manifest_invalid` | the file, with the parser's own error |
| No tree exists, or a required package is in neither the declaring package's tree nor an ancestor's | `test_runtime_dependencies_missing` | the missing packages, the manifest that requires each, and every location searched |
| A required package is a link whose target is gone | `test_runtime_dependencies_missing` | the link and its target (`broken_links`) |
| A tree or an installed package cannot be read | `test_runtime_dependency_input_inaccessible` | the path and the operating-system error; never reported as a missing package |
| A link names source the selected checkout does not hold | `test_runtime_selected_source_unavailable` | the package, its directory and the missing path; reported when a test run maps the installation, and source of another checkout is never substituted |

Locating an installation for a run applies none of these: a missing lock, an
undecided lock, a tree that cannot be read and an absent package are setup's
diagnostics, and the harness reports what it cannot load when it runs.

## Runners

A runner an npm package supplies (Jest, Vitest, Mocha, AVA, lib0) is looked up
by the same nearest-ancestor rule, from one package:

| Context | Package the lookup starts from |
| --- | --- |
| Setup's runner probe | The package that declares the runner: the root when it declares it, otherwise the first member that does. The probe's working directory is that package's directory in the private copy. |
| A test run or proof stage | The package that encloses the target test file. The working directory stays the installation root's project directory. |

That one lookup is the whole selection. A proof stage's observers load the
runner from the installed package it found, which the shared run names in the
stage's observer configuration (`runner_package`); they never repeat the
lookup from the working directory, the workspace root or the launcher's own
location (see [Test-proof execution](test-proof-execution.md)). The
ordinary command, the launcher entry that starts Jest or Vitest for a proof,
the Vitest runner in each worker and the Mocha reporter therefore use one
installation, and a member's own runner is used for its tests even when the
root installs another copy.

A runner the root installs serves every member through native ancestry. A
runner only a sibling member installs is not borrowed: the run is refused with
`test_runtime_runner_package_missing`, naming the package the lookup started
from and every location searched, and an installed runner that cannot be read
is `test_runtime_runner_package_inaccessible`. AVA's configuration loader is
found in the same installed AVA as its command. node:test is Node itself and
needs no installed package.

## Setup probes

An npm environment's runner probes run in a private copy of its project inside
the probe's confinement. Every module tree is bound read-only at its own path;
the copy holds each tree at its own place, either as one link to the installed
tree or, for a tree that holds source links, as a directory in which each
installed package links to where it is installed and each member or local
source link resolves to the copied source. The copy holds the project source
Git selects and never a dependency tree. The checkout and every installed tree
are read-only to the probe, the network is denied, and the copy disappears
with the probe.

## Dependency mapping for test runs

Test execution has one way to make a project's npm dependencies resolvable
where a test runs: for each module tree of the selected installation, a
`node_modules` symbolic link at that tree's own place in the project directory
the run executes in (the root's, and each member's whose directory that
checkout or copy has). The installation owner selects the installation (the
one the published configuration names, otherwise the one it locates), and every
runner and every execution context uses the same mapping; no runner, proof
stage or reviewer launch has another. A tree that holds no source link is
linked directly. A tree that holds one gets a
`node_modules.portfolio-test-<suffix>` generation beside its link, built
separately and published atomically, in which each installed package links to
the selected installation and each member or local source link resolves to
that directory in the tree being tested, so local source always resolves to
the executing checkout or proof copy.

Executable entries are a separate catalog from package entries. When a tree
needs rebasing, the installation owner's `npm-executable-entries.mjs` reads
its existing `.bin` entries and supplies that directory in the mapping. An
executable link, relative or absolute, keeps its installed target and native
dependency resolution, except that a target in an identified workspace or
local package resolves to the selected source instead. Regular launchers
(including pnpm's shell launchers) retain their bytes and permission mode,
with literal references to those identified source targets rebased to the
selected source. This includes absolute paths and `$basedir` references to
local copies. The interpreter, arguments and environment statements remain
those of the existing launcher. A pnpm tree's `.pnpm` store remains linked to
its installed location for launchers that address it directly; it is never a
package-discovery entry. Other hidden directories do not become packages.

No executable is manufactured from a manifest: an absent `.bin` supplies no
commands, and a broken executable target keeps its native failure. Unreadable
executable inputs retain their filesystem cause. Repository scripts still
choose their own explicit configuration, setup and command arguments, using
the package manager's native root/member executable lookup. The same layout
owner supplies executable entries to private setup copies and proof copies;
installed dependency trees remain read-only in confinement, and source
visibility remains governed by the execution context.

Resolving a runtime writes nothing. The shared run publishes the mapping after
it knows where it executes: in the selected checkout for an ordinary run and
for a proof stage that runs there, and in the stage's own copy for a proof
stage that transforms source, which leaves the checkout it copied unchanged.
The runner's own executable is resolved through the mapping in that same
directory. A mapping in a checkout is reused by later runs and survives per-run
cleanup; one in a copy is removed with its execution root.

Every destination is inspected before anything is published, and existing
entries are preserved. The selected tree itself, a link to it and the complete
expected layout of one published generation are reused; an empty directory, any
other tree, a link to anything else, a generation with a missing or retargeted
package, member or executable link, a missing or changed launcher (including
its permission mode), or an extra entry are conflicts, reported with
`test_runtime_dependency_projection_conflict` and never replaced.

A runner writes its own state where it finds `node_modules`, and through a
published mapping that is the generation: Vitest's results cache (`.vite`) and
the bundle Vite makes of a TypeScript configuration (`.vite-temp`) land at its
top. That state is no entry of the layout. A real directory at the top of a
generation under one of the names the installation owner keeps out of a tree's
identity (`.cache`, `.vite`, `.vite-temp`) is neither required nor a conflict,
so the run that left it, later runs and proof source capture in the same
checkout keep reusing the one generation. The allowance is exactly that: the
same name as a file or a link, the same name below a scope directory, and
every other name, hidden or not, are extra entries, and every package and
member link is still compared with the selected installation. Nothing is
removed from a generation, and what such a directory holds is not measured, as
it is not measured in the installed tree. A conflict
at any destination, or a source link the checkout cannot satisfy, refuses the
whole layout with nothing written. Absent destinations are then published one
by one. When one fails to publish, the run is refused with that failure and
its `layout` names the destinations already published, those reused and those
still unpublished: published and reused mappings stay and are verified again
by the next run, and only the failed attempt's own unpublished generation is
removed.

The same exact checks are available read-only, and that verification never
creates a missing mapping. The proof source snapshot and the transformed proof
copy use it to accept exactly a verified tree as a runtime input, for the root
and for each member through the workspace that owns it: a published link with
the one generation it publishes, or the selected installed tree itself where
the checkout is the installation. Terminal-candidate checkout verification
uses it to accept a verified published link at the candidate's own
`node_modules`. Every other entry is refused or measured as before, whatever
its name.

An ordinary run's source currentness uses the same verification at each of its
observations. A mapping is a runtime input, not source: its link is a symlink,
which ordinary source identity never measures, and the generation directory a
verified link publishes is not measured either. The run that publishes a
mapping and every run that reuses it therefore stay current
(`source.current: true`) with one `snapshot_digest`, and an eligible parent
comparison runs. A real directory or file the mapping owner does not verify is
measured as source whatever its name, and a test's own change to a source file
still moves the source. When the checkout is the top level of a Git work tree, every
entry a publication created, for every tree, is kept out of Git status with one
exact root-anchored line each in the exclude file Git itself resolves
(`git rev-parse --git-path info/exclude`), also when a later destination of the
same run failed. That file belongs to the repository, not to one checkout:
every linked worktree shares it, so a line added for one checkout applies at
the same relative path in the repository's other worktrees, and lines are never
removed. Existing lines are kept, a path Git tracks or already ignores gets no
line, a reused incumbent is never excluded, and no pattern covers other
`node_modules.portfolio-test-*` siblings. A directory that is not a Git work
tree, or not its top level, has no exclusion to make. When Git cannot be run or
asked, or the exclude file cannot be read or written, the run is refused with
`test_runtime_dependency_exclusion_failed`: its detail names the actual cause
(the Git command with its status and stderr, or the file error), the exact
lines intended and the exclude file when it is known. The mapping the run
published stays in place; a later run reuses it as an incumbent and adds no
line for it, so the operator adds the named lines after repairing the cause.

## Coding workers

A managed worker receives each module tree as its own read-only mount at that
tree's place in the worker checkout, so links between the trees and from a
tree to a workspace member resolve inside that checkout. A link that resolves
inside the installation's own trees is an installed package. The existing
source boundaries apply to every tree: a member a tree links must be visible
in the worker's scope (`test_runtime_workspace_member_outside_scope`), and a
link to repository source that is no declared member has no established
provenance (`test_runtime_local_package_provenance_unavailable`). Nothing
outside the installation's in-repository trees is bound for a worker.
