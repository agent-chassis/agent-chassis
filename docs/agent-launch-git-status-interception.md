# Git status under the private-family overlay

This page describes one output adaptation inside orchestrator confinement.
The confinement itself is in
[Agent-launch confinement and MCP conduit](agent-launch-confinement-mcp-conduit.md).

Git reads the repository index, which lists every tracked path under
`wiki/contracts`, while the enforced namespace shows that subtree as an empty
read-only mount. An ordinary `git status` inside a confined session therefore
reports each hidden contract as a deletion. Those rows describe the overlay, not
the working tree, and they bury the session's real changes.

Confined Codex, Claude, Agy, and OpenCode orchestrator launches correct the
output. The shared orchestrator composition asks the planner to intercept Git in the namespace
itself: one launcher-owned executable, a package-local asset, is bound read-only
over every supported Git executable entrypoint, and each original Git is kept at
a launcher-owned read-only location that the executable delegates to.
Interception is a property of the mounts, not of the child's `PATH` or
environment. A login shell whose profile replaces `PATH`, a cleared environment,
and a direct absolute-path call such as `/usr/bin/git status` all start the same
executable. The child's environment is left exactly as the caller composed it.

When that executable sees an ordinary `git status` whose global options resolve
to the launcher-designated repository, it adds the root-anchored exclusion
pathspec `:(top,exclude)wiki/contracts` and execs the original Git recorded for
the entrypoint it was started as. An explicit `wiki/contracts` pathspec from the
caller stays excluded, because the exclusion wins. Every other invocation is
exec'd to that same original with its argv unchanged.

## Supported Git executable entrypoints

The inventory is bounded and derived from launcher and runtime facts. Nothing is
scanned recursively, and no path that the namespace did not already show becomes
visible. An entrypoint is covered when it is a runnable file inside one of the
namespace's system read-only roots (by default `/usr`, `/etc`, `/opt`, `/lib`,
`/lib64`, `/bin`, `/sbin`, `/var/lib/dpkg`) and outside the designated
repository, and it is one of:

- `git` in a directory of the child's launch `PATH`, which is how a packaged Git
  such as `/opt/agent-chassis/git/bin/git` is found;
- `git` in a standard system command directory: `/usr/local/sbin`,
  `/usr/local/bin`, `/usr/sbin`, `/usr/bin`, `/sbin`, `/bin`;
- `git` in the exec path that each Git found above reports for itself
  (`git --exec-path`, for example `/usr/lib/git-core`), and in the child's
  `GIT_EXEC_PATH`. Git puts that directory first on `PATH` for hooks, aliases and
  script helpers, so a `git` those run resolves there;
- `git-status` in such an exec path when it is its own file, as in an
  installation that hard-links its builtins.

Every namespace path of a covered executable is bound over. A merged-`/usr` host
shows `/usr/bin/git` at `/bin/git` and `/usr/lib/git-core/git` at
`/lib/git-core/git` as well, because each system root is mounted at its own
path. A symlink alias, such as `/usr/local/bin/git` pointing at a packaged Git or
an exec-path `git` linked to `bin/git`, reaches the executable through the file
it resolves to and is recorded as a path it can be started as. A `git-<name>`
builtin link in an exec path runs `<name>` as the subcommand, as Git does, so
`git-status` is filtered like `git status`. A symlink the launcher did not
inventory is followed with the namespace's `readlink` when there is one.

## Preserved originals

Each distinct original executable, by real path, is its own original. Two
installed Git versions, and the separate `git` file that some distributions ship
in the exec path, are never redirected to one binary: every entrypoint delegates
to the original that was at that entrypoint.

The launcher-owned root is `/agent-launch-git-status-wrapper`, a tmpfs that is
populated and then remounted read-only, so the child can change none of it:

| Path below the root | Content |
| --- | --- |
| `originals/<n>/bin/git` | The original executable, bound read-only from the host file. |
| `originals/<n>/{libexec,lib,lib64,share,etc}` | Symlinks to the same directories of that executable's installation prefix, where they exist. |
| `entrypoints/<absolute entrypoint path>` | Symlink to the `originals/<n>/bin` directory that entrypoint delegates to. |
| `repository` | Symlink to the designated repository. |
| `excluded/<n>` | Symlink to each hidden private-family directory. |

The installation prefix is found the way Git finds its own: the executable's
directory with a trailing `libexec/git-core`, `lib/git-core`, `libexec/git`,
`bin` or `git` removed. An executable in none of those has no prefix of its own
and is preserved alone at `originals/<n>/git`. This layout keeps the original's
runtime behavior. A Git with compiled-in paths reads its exec path, templates,
system configuration and libraries from the same absolute paths as before,
wherever it runs. A Git built to derive its prefix from its own location derives
the mirrored prefix, and reads the same exec path, templates, configuration and
libraries through the symlinks. Such a Git reports its exec path as
`originals/<n>/libexec/git-core` below the root, which is the same directory
reached through the symlink. Its exec path still holds the bound-over `git`,
so helper lookup reaches the executable again. The symlinks add no visibility:
they resolve through the namespace exactly as the original paths do, including
every mask. No Git directory is mounted a second time, and `GIT_EXEC_PATH` is
not forced; caller options and environment are honored as Git ordinarily honors
them.

The executable reads these facts by path, with shell builtins only, and takes
nothing from the environment.

## Mount order and refusals

The root and the entrypoint binds are emitted after the system baseline and
after every read-only, home, family-runtime, writable, runtime, provisioned-Git,
test-runtime and role-guide mount, so none of those can undo the interception.
They are emitted before the secret-file masks, the in-repository tmpfs masks, the
private-family overlay and the `wiki/decisions` overlay, which keep final
precedence.

A selected interception that cannot be built refuses the launch before the
planner changes anything on the host. It never falls back to a `PATH`-only or
unfiltered status:

| Code | Cause |
| --- | --- |
| `agent_launch.isolation.git_status_wrapper_asset_unavailable.v1` | The package-local executable is missing, not a regular file, or not executable. |
| `agent_launch.isolation.git_status_wrapper_original_invalid.v1` | An entrypoint cannot be resolved to a real file, its path cannot be bound safely, it does not answer `git --exec-path` with an absolute directory, or more than 16 distinct Git executables were found. |
| `agent_launch.isolation.git_status_wrapper_recursion.v1` | An entrypoint already is the launcher's executable, by path, by file identity or by content, so there is no original behind it. |
| `agent_launch.isolation.git_status_wrapper_mount_collision.v1` | Another mount of the plan shows different content at an entrypoint, a confidentiality mask would hide the executable, a mount overlaps the launcher-owned root, or the hidden directory is not below the designated repository. |

Each refusal names the entrypoint or mount and the repair. At run time, a
missing recorded original, unreadable launcher facts, or a run outside a
launcher namespace is an explicit exit-127 error on stderr.

## Status argument handling

The subcommand is identified by walking argv past Git's global options, including
the ones that consume a separate value (`-C`, `-c`, `--git-dir`, `--work-tree`,
`--namespace`, `--super-prefix`, `--attr-source`, `--config-env`), so a pathspec,
a commit message, or a configuration value that happens to read `status` is never
mistaken for the subcommand. `git status` has no option that consumes a separate
following value, so everything after the subcommand that does not begin with `-`,
and everything after a `--`, is a caller pathspec. Status options and formats,
working directory, output streams and exit status are the real Git's; an invalid
invocation stays invalid rather than becoming a successful status.

In Git's ordinary pathspec mode the exclusion is appended as a pathspec: no `--`
separator is inserted, no caller option, pathspec or separator position is
rewritten, and a trailing pathspec cannot be swallowed as an option argument.

Under `--literal-pathspecs`, or a true `GIT_LITERAL_PATHSPECS`, Git reads every
pathspec as a plain filename, so an appended `:(top,exclude)...` element would
name a file that does not exist and silently hide the caller's own rows. The
invocation is therefore normalized: the global literal flags are dropped,
`GIT_LITERAL_PATHSPECS` is set to `0` for that one real-Git call, each caller
pathspec is re-expressed with explicit `:(literal)` magic (exactly the meaning
global literal mode gave it, including wildcards, bracket expressions, leading
colons and case-sensitivity), and the launcher's exclusion keeps its magic.
`--no-literal-pathspecs` returns the invocation to the appended shape, last flag
winning as in Git's own handling.

Two literal-mode invocations that real Git itself rejects are handed to it
untouched: an empty pathspec, and literal mode combined with another global
pathspec mode (`--glob-pathspecs`, `--noglob-pathspecs`, `--icase-pathspecs`, or
their environment spellings) once any pathspec is present. That combination
without a caller pathspec is legal Git, so it is still filtered.

## Where the interception applies

The interception is omitted, with no argv change, for a sparse worker namespace
(which shows only its frozen scope and carries no Git metadata), for a plan that
carries no private-family overlay, and when the namespace shows no Git
executable entrypoint. Worker, reviewer, redteam and validation-confinement
plans, and any planner caller that does not ask for it, get no root, no bind and
no preserved original. No role gains Git access or Git metadata it did not
already have.

Coverage is bounded:

- Only the entrypoints listed above are covered. A Git executable outside the
  system read-only roots, inside the designated repository, or installed or
  copied into the namespace after launch is not.
- An in-process Git library or language binding does not run a Git executable
  and still shows the overlay rows.
- A preserved original is itself a runnable Git. Calling it by its path under
  `/agent-launch-git-status-wrapper/originals` runs Git unadapted.
- Only `status` is adapted. `git diff`, `git ls-files`, `git commit` and every
  other subcommand keep the real Git's answer, including the overlay's deletions.
- Long-format status may print the `git add` advice line instead of
  `git add/rm`, because the only deletion has been excluded.

This is an output adaptation, not a confidentiality boundary. The empty read-only
overlay remains the enforcement; the executable never reads a private path or a
repository object, and nothing touches a host Git executable, host Git
configuration, the index, or any Git metadata entitlement. It ships inside the
installed launcher package, so a running launcher process picks it up only after
a reinstall or restart.
