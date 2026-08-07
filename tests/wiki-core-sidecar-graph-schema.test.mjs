import test from "node:test";
import assert from "node:assert/strict";

import {
  assertValidSidecarResultEnvelope,
  classifySidecarGraphArtifactSchema,
  cloneSidecarTrustEnvelopeFixture,
  compareSidecarCliMcpParity,
  createSidecarGraphState,
  createSidecarParityFixture,
  normalizeSidecarCliJsonOutput,
  normalizeSidecarMcpStructuredContent,
  SIDECAR_ENVELOPE_REQUIRED_FIELDS,
  SIDECAR_EVIDENCE_BASIS_VALUES,
  SIDECAR_GRAPH_EDGE_KIND_VALUES,
  SIDECAR_GRAPH_NODE_KIND_VALUES,
  SIDECAR_GRAPH_SCHEMA_VERSION,
  SIDECAR_PARITY_REQUIRED_TRUST_FIELDS,
  SIDECAR_PARITY_SURFACE_EXPECTATIONS,
  SIDECAR_PARITY_TRANSPORTS,
  SIDECAR_SOURCE_KIND_VALUES,
  SIDECAR_TRUST_ENVELOPE_FIXTURES,
  validateSidecarGraphSection,
  validateSidecarGraphState,
  validateSidecarResultEnvelope
} from "../packages/wiki-core/src/index.mjs";
import {
  inspectSidecarGraphStructure,
  SIDECAR_GRAPH_PROVENANCE_EVIDENCE_BASIS_VALUES,
  SIDECAR_GRAPH_PROVENANCE_SOURCE_KIND_VALUES
} from "../packages/wiki-core/src/lib/sidecar-graph-schema.mjs";

test("sidecar graph schema version constant is pinned", () => {
  assert.equal(SIDECAR_GRAPH_SCHEMA_VERSION, "repo-code-graph.v1");
});

test("sidecar graph schema helpers validate optional artifact graph sections", () => {
  const expectedGeneratorIdentity = `sha256:${"a".repeat(64)}`;
  const graph = {
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_nodes: [
      {
        id: "file:packages/wiki-core/src/index.mjs",
        kind: "file",
        provenance: { source_kind: "code_index", canonicality: "derived" }
      }
    ],
    graph_edges: [
      {
        id: "edge:contains:index",
        kind: "contains",
        from_node_id: "file:packages/wiki-core/src/index.mjs",
        to_node_id: "module:packages/wiki-core/src/index.mjs",
        provenance: { source_kind: "code_index", canonicality: "derived" }
      }
    ]
  };

  assert.deepEqual(validateSidecarGraphSection(graph), []);
  assert.deepEqual(validateSidecarGraphState(createSidecarGraphState()), []);

  assert.deepEqual(inspectSidecarGraphStructure({}), {
    structurally_valid: true,
    graph_present: false,
    graph_schema_version: null,
    errors: []
  });
  assert.deepEqual(inspectSidecarGraphStructure({ graph }), {
    structurally_valid: true,
    graph_present: true,
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    errors: []
  });

  const unbound = classifySidecarGraphArtifactSchema({ graph });
  assert.equal(unbound.compatible, false);
  assert.equal(unbound.graph_state.graph_available, false);
  assert.match(unbound.errors.join("\n"), /expectedGeneratorIdentity/);

  const present = classifySidecarGraphArtifactSchema({
    graph: { ...graph, generator_identity: expectedGeneratorIdentity }
  }, { expectedGeneratorIdentity });
  assert.equal(present.compatible, true);
  assert.equal(present.graph_state.graph_available, true);
  assert.equal(present.graph_state.graph_schema_version, SIDECAR_GRAPH_SCHEMA_VERSION);

  const incompatible = classifySidecarGraphArtifactSchema({
    graph: {
      graph_schema_version: "repo-code-graph.v0",
      generator_identity: expectedGeneratorIdentity
    }
  }, { expectedGeneratorIdentity });
  assert.equal(incompatible.compatible, false);
  assert.equal(incompatible.graph_state.graph_available, false);
  assert.equal(incompatible.graph_state.status_reason, "graph_schema_incompatible");
  assert.deepEqual(validateSidecarGraphState(incompatible.graph_state), []);
  assert.equal(incompatible.graph_state.observed_graph_schema_version, "repo-code-graph.v0");
  assert.match(incompatible.errors.join("\n"), /repo-code-graph\.v1/);

  assert.match(
    validateSidecarGraphSection({
      graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
      graph_nodes: [{ id: "unknown", kind: "unknown" }]
    }).join("\n"),
    /graph\.graph_nodes\[0\]\.kind must be one of/
  );
});

test("sidecar graph schema accepts SCIP symbol node and edge kinds", () => {
  assert.ok(SIDECAR_GRAPH_NODE_KIND_VALUES.includes("symbol"));
  assert.ok(SIDECAR_GRAPH_EDGE_KIND_VALUES.includes("defines_symbol"));
  assert.ok(SIDECAR_GRAPH_EDGE_KIND_VALUES.includes("references_symbol"));
  assert.ok(SIDECAR_GRAPH_EDGE_KIND_VALUES.includes("calls_symbol"));
  assert.ok(SIDECAR_GRAPH_PROVENANCE_SOURCE_KIND_VALUES.includes("scip"));
  assert.ok(SIDECAR_GRAPH_PROVENANCE_EVIDENCE_BASIS_VALUES.includes("scip"));

  const callerSymbolNodeId =
    "symbol:scip-typescript npm @repo/wiki-core 0.0.0 src/index.mjs/getIndex().";
  const calleeSymbolNodeId =
    "symbol:scip-typescript npm @repo/wiki-core 0.0.0 src/lib/cache.mjs/readCache().";
  const scipProviderDescriptor = {
    name: "scip-typescript",
    version: "0.4.0",
    scip_protocol_version: "0.8.1"
  };
  const scipProvenance = {
    source_kind: "scip",
    canonicality: "derived",
    evidence_basis: "scip"
  };
  const graph = {
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_nodes: [
      {
        id: "file:packages/wiki-core/src/index.mjs",
        kind: "file",
        provenance: { source_kind: "code_index", canonicality: "derived" }
      },
      {
        id: "symbol:scip-typescript npm @repo/wiki-core 0.0.0 src/index.mjs/getIndex().",
        kind: "symbol",
        provenance: scipProvenance,
        provider_descriptor: scipProviderDescriptor,
        resolution: { state: "resolved" }
      },
      {
        id: calleeSymbolNodeId,
        kind: "symbol",
        provenance: scipProvenance,
        provider_descriptor: scipProviderDescriptor,
        resolution: { state: "resolved" }
      }
    ],
    graph_edges: [
      {
        id: "edge:defines_symbol:index",
        kind: "defines_symbol",
        from_node_id: "file:packages/wiki-core/src/index.mjs",
        to_node_id: callerSymbolNodeId,
        provenance: scipProvenance,
        provider_descriptor: scipProviderDescriptor,
        coverage: { language: "typescript", status: "covered", constructs: ["definition"] },
        resolution: { state: "resolved" }
      },
      {
        id: "edge:references_symbol:index",
        kind: "references_symbol",
        from_node_id: "file:packages/wiki-core/src/index.mjs",
        to_node_id: calleeSymbolNodeId,
        provenance: scipProvenance,
        provider_descriptor: scipProviderDescriptor,
        coverage: { language: "typescript", status: "covered", constructs: ["reference"] },
        resolution: { state: "unresolved", unresolved_reason: "external_symbol" }
      },
      {
        id: "edge:calls_symbol:index-to-cache",
        kind: "calls_symbol",
        from_node_id: callerSymbolNodeId,
        to_node_id: calleeSymbolNodeId,
        provenance: scipProvenance,
        provider_descriptor: scipProviderDescriptor,
        coverage: { language: "typescript", status: "covered", constructs: ["call"] },
        resolution: { state: "resolved" },
        occurrence_count: 2,
        lines: [12, 37]
      }
    ]
  };

  const callsSymbolEdge = graph.graph_edges.find((edge) => edge.kind === "calls_symbol");
  assert.ok(callsSymbolEdge);
  assert.equal(callsSymbolEdge.from_node_id, callerSymbolNodeId);
  assert.equal(callsSymbolEdge.to_node_id, calleeSymbolNodeId);
  assert.equal(Object.hasOwn(callsSymbolEdge, "line"), false);
  assert.deepEqual(validateSidecarGraphSection(graph), []);
});

test("sidecar artifact schema accepts scip source_kind and evidence_basis provenance", () => {
  assert.ok(SIDECAR_SOURCE_KIND_VALUES.includes("scip"));
  assert.ok(SIDECAR_EVIDENCE_BASIS_VALUES.includes("scip"));

  const envelope = cloneSidecarTrustEnvelopeFixture("fresh");
  envelope.source_kind = "scip";
  envelope.evidence_basis = "scip";
  envelope.derived_evidence.push({
    kind: "scip_symbol_reference",
    provenance: {
      source_kind: "scip",
      canonicality: "derived",
      evidence_basis: "scip"
    }
  });

  assert.deepEqual(validateSidecarResultEnvelope(envelope), []);
});

test("sidecar graph schema requires grammar-less SCIP provider descriptors by basis", () => {
  const scipGraphItem = {
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_edges: [
      {
        id: "edge:references_symbol:missing-provider",
        kind: "references_symbol",
        from_node_id: "file:packages/wiki-core/src/index.mjs",
        to_node_id: "symbol:scip-typescript npm @repo/wiki-core 0.0.0 src/index.mjs/getIndex().",
        provenance: {
          source_kind: "scip",
          canonicality: "derived",
          evidence_basis: "scip"
        }
      }
    ]
  };

  assert.match(
    validateSidecarGraphSection(scipGraphItem).join("\n"),
    /provider_descriptor is required for scip evidence/
  );

  scipGraphItem.graph_edges[0].provider_descriptor = {
    name: "scip-typescript",
    version: "0.4.0",
    scip_protocol_version: "0.8.1"
  };
  assert.deepEqual(validateSidecarGraphSection(scipGraphItem), []);
});

test("sidecar graph schema keeps parser-symbol grammar requirements intact", () => {
  const parserSymbolGraph = {
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_edges: [
      {
        id: "edge:imports_module:parser-provider",
        kind: "imports_module",
        from_node_id: "module:packages/wiki-core/src/index.mjs",
        to_node_id: "module:packages/wiki-core/src/lib/sidecar-graph-schema.mjs",
        provenance: {
          source_kind: "parser_symbol",
          canonicality: "derived",
          evidence_basis: "parser_symbol"
        },
        provider_descriptor: {
          name: "web-tree-sitter",
          runtime: "wasm",
          runtime_version: "0.25.0",
          grammar: "tree-sitter-javascript",
          grammar_version: "0.23.1"
        }
      }
    ]
  };

  assert.deepEqual(validateSidecarGraphSection(parserSymbolGraph), []);

  delete parserSymbolGraph.graph_edges[0].provider_descriptor.grammar;
  assert.match(
    validateSidecarGraphSection(parserSymbolGraph).join("\n"),
    /provider_descriptor\.grammar is required/
  );
});

test("sidecar trust envelope fixtures preserve dirty state and staleness independently", () => {
  for (const [name, fixture] of Object.entries(SIDECAR_TRUST_ENVELOPE_FIXTURES)) {
    assert.doesNotThrow(() => assertValidSidecarResultEnvelope(fixture), name);
  }

  assert.deepEqual(
    Object.fromEntries(
      ["dirty_missing", "dirty_fresh", "dirty_stale", "dirty_schema_incompatible"].map(
        (name) => [
          name,
          [
            SIDECAR_TRUST_ENVELOPE_FIXTURES[name].dirty_state,
            SIDECAR_TRUST_ENVELOPE_FIXTURES[name].staleness
          ]
        ]
      )
    ),
    {
      dirty_missing: ["dirty_worktree", "missing"],
      dirty_fresh: ["dirty_worktree", "fresh"],
      dirty_stale: ["dirty_worktree", "stale"],
      dirty_schema_incompatible: ["dirty_worktree", "rebuild_required"]
    }
  );

  assert.ok(SIDECAR_TRUST_ENVELOPE_FIXTURES.dirty.dirty_details.staged > 0);
  assert.ok(SIDECAR_TRUST_ENVELOPE_FIXTURES.dirty.dirty_details.untracked > 0);
  assert.equal(
    SIDECAR_TRUST_ENVELOPE_FIXTURES.schema_incompatible.staleness,
    "rebuild_required"
  );
  assert.equal(
    SIDECAR_TRUST_ENVELOPE_FIXTURES.dirty_schema_incompatible.dirty_state,
    "dirty_worktree"
  );

  assert.equal(
    SIDECAR_TRUST_ENVELOPE_FIXTURES.fresh.canonical_refs[0].provenance.canonicality,
    "canonical"
  );
  assert.equal(
    SIDECAR_TRUST_ENVELOPE_FIXTURES.fresh.derived_evidence[0].provenance.canonicality,
    "derived"
  );

  const missingField = cloneSidecarTrustEnvelopeFixture("fresh");
  delete missingField.dirty_details;
  assert.match(
    validateSidecarResultEnvelope(missingField).join("\n"),
    /dirty_details is required/
  );

  const invalidEnum = cloneSidecarTrustEnvelopeFixture("fresh");
  invalidEnum.staleness = "schema_mismatch";
  assert.match(
    validateSidecarResultEnvelope(invalidEnum).join("\n"),
    /envelope\.staleness must be one of/
  );
});

test("sidecar parity helpers compare CLI JSON with MCP structured content", () => {
  assert.deepEqual(SIDECAR_PARITY_TRANSPORTS, ["cli_json", "mcp_structured_content"]);
  assert.deepEqual(SIDECAR_PARITY_REQUIRED_TRUST_FIELDS, SIDECAR_ENVELOPE_REQUIRED_FIELDS);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(SIDECAR_PARITY_SURFACE_EXPECTATIONS).map(([surface, expectation]) => [
        surface,
        expectation.parityTestOwner
      ])
    ),
    {
      status: "WK-0035",
      build: "WK-0042",
      impact_paths: "WK-0041",
      context_for_path: "WK-0041"
    }
  );

  for (const surface of Object.keys(SIDECAR_PARITY_SURFACE_EXPECTATIONS)) {
    const fixture = createSidecarParityFixture({ surface, envelopeFixture: "dirty_fresh" });
    assert.deepEqual(
      normalizeSidecarCliJsonOutput(JSON.stringify(fixture.cliJson)),
      fixture.cliJson
    );
    assert.deepEqual(
      normalizeSidecarMcpStructuredContent(fixture.mcpResult),
      fixture.mcpResult.structuredContent
    );

    const compared = compareSidecarCliMcpParity({
      surface,
      cliJson: JSON.stringify(fixture.cliJson),
      mcpResult: fixture.mcpResult
    });
    assert.equal(compared.parityTestOwner, fixture.expectation.parityTestOwner);
    assert.equal(compared.envelope.dirty_state, "dirty_worktree");
    assert.equal(compared.envelope.staleness, "fresh");
  }
});

test("sidecar parity helpers require trust envelope fields before comparing", () => {
  const fixture = createSidecarParityFixture({ surface: "status" });
  const missingTrustField = cloneSidecarTrustEnvelopeFixture("fresh");
  delete missingTrustField.staleness;

  assert.throws(
    () =>
      compareSidecarCliMcpParity({
        surface: "status",
        cliJson: JSON.stringify(missingTrustField),
        mcpResult: fixture.mcpResult
      }),
    /staleness is required/
  );

  assert.throws(
    () =>
      compareSidecarCliMcpParity({
        surface: "status",
        cliJson: fixture.cliJson,
        mcpResult: {
          content: [],
          structuredContent: missingTrustField
        }
      }),
    /staleness is required/
  );

  const changedMcpEnvelope = cloneSidecarTrustEnvelopeFixture("fresh");
  changedMcpEnvelope.staleness = "stale";
  assert.throws(
    () =>
      compareSidecarCliMcpParity({
        surface: "status",
        cliJson: fixture.cliJson,
        mcpResult: {
          content: [],
          structuredContent: changedMcpEnvelope
        }
      }),
    /CLI JSON and MCP structuredContent differ/
  );
});
