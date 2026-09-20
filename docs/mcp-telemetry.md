
# Anonymous MCP metrics

The wiki-MCP server can record anonymous numeric metrics about registered tool
handler invocations into compressed local log files. Collection is off unless an
operator configures a destination. The files and the format below are the whole
first-pass interface: there is no MCP query route, database, dashboard, or
background service, and no tool argument, result, error text, or identity is
stored.

## Enabling collection

Set the host-only `AGENT_CHASSIS_MCP_METRICS_ROOT` environment variable on the
process that starts the wiki-MCP server or the agent launcher. It must name an
existing, absolute, non-symlink directory owned by the same user with mode `0700`.

- Unset (or empty): collection is disabled. No writer, timer, or file exists.
- Valid: each server process writes its own metric files into that directory.
- Invalid (relative, missing, not a real directory, not owned, not `0700`): the
  server starts normally, collects nothing, and writes one structured stderr
  diagnostic with `event: "anonymous_mcp_metrics"`, `reason: "invalid_config"`,
  and a fixed `config_reason`. The configured path is never printed.

`resolveMcpMetricsConfig` in
`packages/agent-launch-cli/src/lib/mcp-metrics-config.mjs` is the only owner of
that validation. Launcher-managed host servers receive the setting only through
the conduit's launcher-minted host environment, which forwards the root already
resolved in the launching process; every receiving host, including hosts that
dispatch nested managed runs, resolves it again before writing. The setting is not
accepted from tool arguments, prompts, model-specific switches, or confined worker
environments, and the directory is not mounted into confined workers. It is
independent of `AGENT_CHASSIS_MCP_TRANSCRIPT_ROOT`; enabling one never enables or
reuses the other. See [Agent-launch confinement and MCP conduit](agent-launch-confinement-mcp-conduit.md)
and the [environment reference](env-reference.md).

## What is recorded

Coverage is registered handler invocations at the single production handler
boundary (`createToolUsageAuditBoundaryRecorder` in
`packages/wiki-mcp/src/lib/tool-usage-audit-mcp-tools.mjs`). Calls that the MCP
SDK or a registration schema/effects guard rejects before the handler boundary
produce no metric.

Each line is one JSON object with `schema_version: "anonymous-mcp-metrics.v1"`.
Call records have exactly these fields, in this order:

| Field | Values |
|---|---|
| `kind` | `call` |
| `hour_utc` | UTC hour bucket such as `2026-09-15T13:00:00.000Z`, or `null` |
| `clock_status` | `measured` or `clock_unavailable` |
| `tool` | the tool name this server registered |
| `outcome` | `returned`, `returned_error` (an own `isError: true` data property), or `threw` |
| `elapsed_us` | handler wall time in whole microseconds from a monotonic clock, or `null` |
| `duration_status` | `measured`, `clock_unavailable`, or `invalid_duration` |
| `request_json_bytes`, `response_json_bytes` | compact JSON UTF-8 byte counts, or `null` |
| `request_status`, `response_status` | `measured`, `unsafe_value`, `budget_exceeded`, `not_returned`, or `measurement_failed` |
| `input_tokens`, `output_tokens` | always `null` in this pass |
| `token_status` | `not_instrumented` |
| `representation` | `handler_compact_json` |

Health records have exactly `schema_version`, `kind: "health"`, `hour_utc`,
`clock_status`, `reason`, and a positive `count`. Reasons are `invalid_config`,
`invalid_record`, `queue_full`, `measurement_failed`, `compression_failed`,
`file_failed`, `shutdown_timeout`, and `late_completion`.

Measurement notes:

- Elapsed time covers only the handler call; metric encoding and file work happen
  afterwards. Measured zero stays `0`; an unavailable or invalid clock is `null`
  with an explicit status, never an invented value.
- Byte counts describe the handler's own JSON arguments and result, not SDK wire
  bytes, billed usage, or model-visible content. They are counted without
  serializing or copying the value, and only for plain JSON data within depth 32,
  4,096 values, and 262,144 string/key code units. Proxies, getters, `toJSON`,
  custom prototypes, cycles, and non-JSON values are reported as `unsafe_value`;
  oversized values as `budget_exceeded`. A thrown call has `not_returned`.
- Token counts are not instrumented: no authenticated token measurement exists at
  this boundary, and tokens are never estimated from bytes.

Records carry no tool arguments, results, prompts, error messages or stacks,
payload hashes or snippets, and no user, account, session, run, workflow, work
record, request, machine, or repository identifier, path, or URL. Records are
constructed from this allowlist rather than scrubbed, and tool-execution results
are unchanged whether collection is enabled or not.

## Files and growth

Each server process appends to files it creates exclusively, named
`metrics-<32 random hex characters>.jsonl.gz` with mode `0600`. Names and gzip
headers contain no time, process id, host name, or identity. Each file is a
sequence of gzip members, each holding complete JSON lines, so ordinary tools
read them directly:

```sh
zcat "$AGENT_CHASSIS_MCP_METRICS_ROOT"/metrics-*.jsonl.gz | jq -c 'select(.kind == "call")'
```

A process starts a new file when the UTC hour changes or before a member would
push the current file past 16 MiB compressed. Every process start and every
rotation mints a fresh random name.

Retention is the directory itself. The writer never deletes, reopens, or
overwrites completed files, and there is no automatic age, count, or size
expiry in this pass. Disk use therefore grows with traffic and with the number of
server processes (each launcher-managed connection runs its own host server,
which writes its own files). Watch the directory's file count and allocated size
as well as byte totals; many small compressed files carry filesystem overhead that
compression does not remove. Operators prune or archive old files themselves.

## Limits and failure behavior

- Only schema-validated encoded lines of at most 1,024 bytes are queued, with at
  most 256 KiB pending. Lines are flushed in batches of at most 64 KiB, at 64 KiB
  pending or after one second, with one batch and one asynchronous gzip (level 1)
  operation in flight per process. A compressed member over 128 KiB is refused.
- Queue pressure drops new records and counts `queue_full`. Compression or file
  failure (including a write that makes no progress) disables that process's
  writer and closes its file; tool calls keep working. There is no retry service.
- Loss and failure counts are written back into the log as health records while
  the writer can still write, and reported on stderr as fixed-category
  `anonymous_mcp_metrics` diagnostics at most once per reason per minute plus one
  shutdown summary. Diagnostics carry no values or paths. Loss counts cannot be
  guaranteed durable while the disk itself is failing.

## Shutdown and loss

The server's existing stdio shutdown controller remains the only shutdown owner.
Its server-close hook closes the MCP server and then the metrics writer, which
stops admitting records, flushes, and closes its file within a one-second
deadline inside the controller's existing two-second drain. A graceful client EOF
— including a launcher-managed client closing its connection — takes this path.

Delivery is not crash-proof. There is no fsync per member and no exactly-once
guarantee. A crash, an abrupt disconnect, a launcher SIGTERM or SIGKILL, or a race
with the teardown deadline can lose buffered records that were not yet written or
leave a partial final gzip member at the end of a file. Completed earlier members
and files remain ordinary readable gzip data; streaming gzip readers report the
truncated tail as an error after emitting the complete lines before it. Records
from handlers that finish after shutdown began are dropped and counted as
`late_completion`.
