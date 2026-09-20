

export class SidecarGraphIndexUnbuildableError extends Error {
  constructor(message, { code = "graph_index_unbuildable", cause = null, status = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SidecarGraphIndexUnbuildableError";
    this.code = code;
    const publicationOutcome = cause?.envelope?.publication_outcome ?? cause?.publication_outcome ?? null;
    this.envelope = {
      kind: "sidecar_graph_index_unbuildable",
      code,
      remediation: "correct the reported repository or cache failure and retry; graph queries prepare the committed code index automatically",
      ...(status?.status_reason ? { status_reason: status.status_reason } : {}),
      ...(publicationOutcome ? { publication_outcome: publicationOutcome } : {}),
      ...(cause ? { build_error: cause instanceof Error ? cause.message : String(cause) } : {})
    };
  }
}
