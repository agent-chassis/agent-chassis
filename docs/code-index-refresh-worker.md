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
failure, its exit code/signal, and the captured diagnostic. A signal alone does
not identify the reason the signal was sent.

Existing `preparation.refresh.failure.details` retains bounded failure
diagnostics: up to 4,096 UTF-8 bytes from stderr and 1,024 from stdout, with the
beginning and end of each stream, observed UTF-8 byte counts and explicit truncation.
Pipe data is consumed throughout the worker lifetime without retaining an
unbounded log. Complete UTF-8 characters are preserved at clipping boundaries.
Diagnostics written after an IPC outcome are included. Successful output is
discarded. No additional worker, telemetry service, indexing backend or query
prerequisite is introduced.
