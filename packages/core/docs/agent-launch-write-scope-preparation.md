
# New-Directory Write Scopes and Launcher Isolation

> Part of the [Agent Launch & Direct-Dispatch Reference](agent-launch-quickstart.md).

This page documents how the launcher resolves a declared `write_scope` entry
that does not yet exist on disk, the `bubblewrap` isolation that owns the real
write boundary, and the dry-run surface that reports the prepared write roots.

A WK may legitimately declare a `write_scope` entry that does not yet exist on
disk, for example a brand-new tool subtree such as
`tools/in0012-swebench-smoke` or a versioned subtree such as
`tools/example.v1`. The codex worker launcher resolves the declared scope to
its target directory (the entry itself for directory-shaped scopes, the parent
directory for file-shaped scopes) and pre-creates only the exact authorized
missing subtree before the Codex sandbox starts.

For Codex, the active launch mechanism is `-s workspace-write` plus
explicit `--add-dir <absolute-directory>` entries for each declared writable
root. The older `permissions.worker_scope.filesystem` / `:project_roots`
config is not the active enforcement path because current Codex no longer
recognizes that per-entry read/write table. This restores worker writability,
but it degrades enforcement granularity: `workspace-write` makes the whole
`-C <repo>` workspace writable, while `--add-dir` records the declared writable
directory intent and can extend the writable set with additional directories.
The launcher therefore cannot enforce file-level write_scope through
the Codex CLI alone.

Launcher-owned `bubblewrap` isolation replaces that degraded boundary. Local
role launches require a usable `bwrap` binary; missing or unusable `bwrap` is a
launch refusal, not a reason to fall back to repo-wide `workspace-write`.

Human/operator orchestrator entrypoints are the exception authorized by
decision. When `bubblewrap` is unavailable or unsupported, an operator shell
orchestrator launch may use an explicit direct mode only if the launcher emits a
loud warning and dry-run JSON records that OS-level bwrap isolation is
unavailable. Direct mode is not sandboxed write-scope enforcement: normal host
OS permissions apply. For structured roles, a no-CCE-key local/free launch may
use the documented unenforced plain-spawn path when no supported backend can be
used. A CCE-key launch requires the backend unless the operator explicitly
selects the recorded unenforced opt-out. These outcomes describe launcher
mechanics and policy validity, not a security-safe default.

Bubblewrap-isolated orchestrators receive one additional read-only repository-data
mount: the launcher derives the owning repository's managed-worktree root as
`<effective-user-home>/.agent-worktrees/<repo-basename>` and binds exactly that
directory. The effective home comes from the executing account's OS user record;
caller-supplied `HOME`, `XDG_*`, prompts, requests, and dispatch arguments cannot
redirect it. The launcher creates the per-repository root recursively with mode
`0700` as the executing user. The mount does not expose sibling repositories'
managed worktrees and does not grant mutation authority. It exists only so
orchestrators can inspect their own managed worktrees and obtain truthful Git
diagnostics; host lifecycle evidence remains authoritative for lifecycle and
exact-SHA integration decisions. An already-running orchestrator must be
restarted to receive this mount. Operator direct mode has no bwrap namespace and
therefore receives no additional bind.

For a user-local Ubuntu amd64 install without changing system packages, the
operator bootstrap recipe is:

```bash
cd /tmp
curl -LO http://security.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_0.9.0-1ubuntu0.1_amd64.deb
dpkg-deb -x bubblewrap_0.9.0-1ubuntu0.1_amd64.deb extracted/
mkdir -p ~/.local/bin
cp extracted/usr/bin/bwrap ~/.local/bin/
export PATH="$HOME/.local/bin:$PATH"
bwrap --version
```

This recipe only installs the `bwrap` executable into the operator's
`~/.local/bin`. The launcher implementation remains responsible for checking
availability, refusing when the isolation backend cannot be used, and enforcing
the role-specific writable roots.

Codex launches under this isolation receive exactly one launcher-authored
`mcp_servers.wiki` registration. It invokes the pinned stdio connector against
the fixed Unix-domain socket endpoint and credential file projected into the
final bubblewrap namespace. The connector runs on the launcher's own pinned
Node executable. Existing user or repository `config.toml` MCP entries are removed
from the per-run Codex
home; they cannot add, replace, or retarget the wiki server. No server package,
server dependency tree, repository endpoint, or broad writable home/config
root is mounted to preserve user MCP configuration.

Classification of nonexistent `write_scope` entries does not rely on a single
heuristic. When the entry exists on disk, the launcher uses the actual
filesystem state. When the entry does not exist, the launcher treats it as a
file-shaped scope if any of the following applies, otherwise as a new
directory:

- the trailing path segment matches a curated allowlist of well-known file
  extensions (for example `.md`, `.json`, `.mjs`, `.py`, `.sh`)
- the trailing path segment matches a curated allowlist of well-known
  extensionless filenames (for example `Dockerfile`, `Makefile`,
  `CODEOWNERS`, `LICENSE`, `README`, `CHANGELOG`)
- the trailing path segment is a single-dot dotfile (a basename that starts
  with `.` and contains no further dot, for example `.gitignore`, `.env`,
  `.npmrc`)
- the entry is a launcher wrapper path under
  `packages/agent-launch-cli/bin/`, which is treated as a file-shaped scope for
  classification and directory pre-creation; Codex receives only directory
  `--add-dir` entries because Codex 0.131 documents `--add-dir` as a directory
  argument

Versioned or otherwise dotted directory names such as `tools/example.v1` do
not match any file rule and are therefore prepared as the exact authorized
subtree, while file-shaped entries such as `tools/example.v1/config.json`,
`Dockerfile`, and `.gitignore` continue to prepare only the file parent (or
no new directory at all when the parent already exists). The launcher never
materializes a file-shaped scope on disk; only the parent directory may be
created.

Globbed scope entries (anything containing `*`, `?`, `[`, `]`, `{`, or `}`),
the repo root (`.`), and entries that would resolve outside the repo are never
pre-created. The repo root remains read-only unless the WK explicitly declares
it as a write scope.

The filename classification above applies only to unmanaged launches. A
managed worker's writable roots and files come from its frozen
`resolved_scope`, which already records whether each member is a directory or a
file. A glob contributes only the matching regular files that exist at the scope
base, so zero matches contribute nothing and no literal glob name or
hypothetical matching file is created. Only an explicitly named missing writable
leaf keeps missing-leaf preparation.

For a managed worker, Codex and Claude prepare missing directory members through
one shared step in the bubblewrap planner, immediately before namespace
inspection. The step creates only the exact missing leaf of each
`resolved_scope.writable.directories` member, and only under an existing,
non-symlinked parent. A slash-named leaf such as `.changeset/` stays a
directory. A missing extensionless file such as `bin/new-tool` stays a file
target and is precreated as an empty file, never as a directory. A missing,
replaced, or symlinked parent, or a member inside an excluded family, is refused
without creating anything. The launcher never grants the parent instead, so
`testdata/projects/action_pinning/` never becomes `testdata/projects/`.
Directories created for a plan that later refuses are rolled back.

Once planning succeeds, the launching attempt owns what the planner created,
bound to its run, unit, and scope source digest. A plan that does not match
the attempt refuses before any child is created and is released. For managed
Claude, the attempt settles its resources exactly once:

- A refusal before a child exists, including a failed or refused spawn,
  releases every created file and directory that keeps its recorded identity.
- An accepted child keeps its resources until its termination is observed.
  After that, each created directory is removed only if it still has its
  recorded identity and is empty. Populated, replaced, or symlinked entries
  are preserved. Created files are always preserved after a child has run,
  because an untouched empty file may be committed worker content.
- A timeout can report a terminal run before the child is gone. The terminal
  `exit` then carries `precreation_cleanup_deferred`, and release happens when
  the child actually terminates.

Release never recurses and never touches a parent, a sibling, a pre-existing
entry, or another attempt's resources. An owned directory that still qualifies
but could not be removed is a cleanup failure, not preservation. It is reported
as bounded `precreation_cleanup_failure` evidence with its repository-relative
path, beside the primary refusal or on the terminal `exit`, and never replaces
the primary outcome. Managed Codex
does not run the unmanaged preparer. Its `--add-dir` roots are the resolved
directory members plus the parents of resolved file members, while the
bubblewrap namespace stays the exact write boundary.

The dry-run plan exposes the prepared write roots in
`prepared_new_write_roots`, so operators can confirm which subtrees would be
created before launch:

```bash
npm run agent-launch -- worker --app codex <WK-ID#slice> --dry-run-json
```

The output includes one entry per authorized missing directory, with the
declared `scope_entry` and the resolved `directory` that the launcher would
create. For a managed worker both fields name the resolved directory member.
Dry-run planning never writes to disk.
