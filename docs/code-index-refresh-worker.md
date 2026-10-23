# Code-index refresh worker failures

Public informational code-index queries request the existing background refresh
worker. The worker runs `ensureSidecarIndex` against the current checkout,
including admitted working-tree edits and untracked sources. Repository-wide
indexing admission and scratch recovery remain owned by the updater lock; see
[Automatic index preparation](mcp-repository-model.md#automatic-index-preparation).

`sidecar-refresh-process.mjs` observes the worker until process close, after
stdout and stderr have drained. An IPC completion message succeeds only when
the worker actually exits with code zero and no signal. The coordinator retains
that exit observation internally. A reported failure preserves its preparation
code, cause and publication outcome together with the actual exit code/signal.
A worker that exits without reporting keeps the `sidecar_refresh_worker_exited`
failure, its exit code/signal, and its explicit process diagnosis. The diagnosis
identifies the refresh worker PID and its `ensureSidecarIndex` operation, not a
provider subprocess. Provider failures reported over IPC retain their own nested
cause and process facts. A signal alone does not identify why the process died;
without an explicit error diagnostic the cause remains unknown.

The process observer captures bounded internal diagnostics: up to 4,096 UTF-8
bytes from stderr and 1,024 from stdout, with the beginning and end of each
stream, observed UTF-8 byte counts and explicit truncation.
Pipe data is consumed throughout the worker lifetime without retaining an
unbounded log. Complete UTF-8 characters are preserved at clipping boundaries.
Diagnostics written after an IPC outcome are included. Successful output is
discarded. Separately, streaming capture preserves complete explicit `fatal:`,
`error:` and Node `FATAL ERROR:` lines, case-insensitively, even across chunk
boundaries and beyond the raw capture budget. The same diagnostic projection
interprets captured subprocess failures.

The coordinator removes raw streams from retained failure state while keeping
the structured process diagnosis and worker-reported cause. Registered
`query_code_index` status, context, impact and navigation responses carry those
diagnoses, exit facts and recovery guidance beside material coverage limits.
They expose no raw logs. An unexpected exit leaves publication effects
unconfirmed; queries continue to read any usable prior publication with its
honest freshness qualification. Capturing a fatal diagnosis does not repair the
underlying crash or establish a particular remedy. No additional worker,
telemetry service, indexing backend or query prerequisite is introduced.

CLI and MCP build/rebuild use the same configuration, launcher and process
observer as background refresh, with `buildSidecarIndex` as their diagnosed
operation. They retain the complete build result and typed preparation failure
envelope across IPC. Refresh continues to use `ensureSidecarIndex`.

The committed repository-root `agent-launch.toml` key
`code_index.build_heap_mib` selects the preparation child's V8 old-space ceiling
in MiB. Absence of the file, table or key selects 8192; explicit values must be
positive TOML integers within the JavaScript/native byte-conversion bounds
(17592186044415 on 64-bit, 4095 on 32-bit). The default is validated too, so a
32-bit host needs an explicit committed value at most 4095. This ceiling neither
reserves RAM nor limits total RSS. See the
[preparation configuration](mcp-repository-model.md#automatic-index-preparation).

Each fresh launch asynchronously reads the bound repository's committed HEAD,
independently of host cwd. Uncommitted or staged edits have no effect. A later
committed setting applies without restarting the MCP host; running/joined work
keeps its captured ceiling and queued work reads when starting. Heap selection
adds no new cache identity input; the existing source collector may include the
file, and dirty edits may still trigger ordinary incremental updates. Cancellation or close during configuration reads
prevents a late orphan spawn.

Configuration failures occur before spawn with `sidecar_config_malformed_toml`,
`sidecar_config_invalid_type`, `sidecar_config_fractional`,
`sidecar_config_nonpositive`, `sidecar_config_out_of_range`,
`sidecar_config_unreadable` or `sidecar_config_unsupported_source`. Each reports
the repository file, key, cause and exact correction. Syntax errors retain
line/column without raw source. Correct the setting or reported Git-object
failure, commit the corrected regular file, then retry the requesting operation.
Background configuration failures become the existing failed refresh state and
backoff while usable published queries continue. Passive status/detail never
read the configuration or start preparation. Existing publication outcomes
remain unchanged, including unpublished after a failed rebuild reset.

Explicit Node argv overrides a conflicting inherited `NODE_OPTIONS` heap for
the preparation child, with no parent-environment mutation. The TypeScript
provider's separate 8192 MiB ceiling and external benchmark wrapper's descendant
policy remain independent. No heap allocation or OOM diagnosis is implied.
