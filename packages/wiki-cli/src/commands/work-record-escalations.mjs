import path from "node:path";

import {
  acceptWorkRecordEscalation,
  proposeWorkRecordEscalation
} from "@agent-chassis/wiki-core";
import { optionalOption, parseArgs, requireOption } from "../lib/cli.mjs";

const OPERATOR_TRUST_ENV_VAR = "WIKI_OPERATOR_TRUST";
const OPERATOR_CONFIRM_PHRASE = "I CONFIRM OPERATOR AUTHORITY";

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function normalizeNullableOption(value) {
  if (value === "null") {
    return null;
  }
  return value;
}

function resolveOperatorTrustGate(options, env = process.env) {
  if (env[OPERATOR_TRUST_ENV_VAR] === "1") {
    return { source: "env", attestation: OPERATOR_TRUST_ENV_VAR };
  }
  const confirm = optionalOption(options, "operator-confirm");
  if (typeof confirm === "string" && confirm === OPERATOR_CONFIRM_PHRASE) {
    return { source: "operator_confirm", attestation: OPERATOR_CONFIRM_PHRASE };
  }
  return null;
}

function createTrustedEscalationOptions(options, { status, trustGate }) {
  const baseOptions = {
    recordId: requireOption(options, "record-id", "work-record-escalations requires --record-id"),
    escalationId: requireOption(options, "id", "work-record-escalations requires --id"),
    reason: requireOption(options, "reason", "work-record-escalations requires --reason"),
    kind: requireOption(
      options,
      "kind",
      "work-record-escalations requires explicit --kind (e.g. critical_blast_radius)"
    ),
    provenanceSourceKind: requireOption(
      options,
      "provenance-source-kind",
      "work-record-escalations requires explicit --provenance-source-kind"
    ),
    provenanceCanonicality: requireOption(
      options,
      "provenance-canonicality",
      "work-record-escalations requires explicit --provenance-canonicality"
    ),
    provenanceEvidenceBasis: requireOption(
      options,
      "provenance-evidence-basis",
      "work-record-escalations requires explicit --provenance-evidence-basis"
    ),
    sliceId: normalizeNullableOption(optionalOption(options, "slice-id")),
    maxBlastRadius: requireOption(
      options,
      "max-blast-radius",
      "work-record-escalations requires explicit --max-blast-radius (low|medium|high|critical)"
    ),
    expiresAt: normalizeNullableOption(optionalOption(options, "expires-at")),
    recordUpdated: normalizeNullableOption(optionalOption(options, "record-updated")),
    dir: path.resolve(String(options.dir || ".")),
    trustGate
  };

  const acceptedAtMessage =
    status === "accepted"
      ? "work-record-escalations accept requires --accepted-at"
      : "work-record-escalations propose requires --accepted-at to record the proposer timestamp";

  return {
    ...baseOptions,
    acceptedAt: requireOption(options, "accepted-at", acceptedAtMessage),
    acceptedByActor: requireOption(
      options,
      "accepted-by-actor",
      "work-record-escalations requires explicit --accepted-by-actor (operator|orchestrator|reviewer)"
    ),
    acceptedById: requireOption(
      options,
      "accepted-by-id",
      "work-record-escalations requires explicit --accepted-by-id"
    ),
    acceptedBySource: requireOption(
      options,
      "accepted-by-source",
      "work-record-escalations requires explicit --accepted-by-source"
    ),
    authorityRef: requireOption(
      options,
      "authority-ref",
      "work-record-escalations requires explicit --authority-ref pointing to a real DEC/IN/WK record"
    )
  };
}

function printResult(result) {
  console.log(`Operation: ${result.operation}`);
  console.log(`Record: ${result.record_id}`);
  console.log(`Escalation: ${result.escalation_id}`);
  console.log(`Valid: ${result.valid}`);
  console.log(`Path: ${result.source_path_relative}`);
}

async function runPropose(options, trustGate) {
  return proposeWorkRecordEscalation(
    createTrustedEscalationOptions(options, { status: "proposed", trustGate })
  );
}

async function runAccept(options, trustGate) {
  return acceptWorkRecordEscalation(
    createTrustedEscalationOptions(options, { status: "accepted", trustGate })
  );
}

export async function runWorkRecordEscalations(argv) {
  const { positionals, options } = parseArgs(argv);
  const [subcommand = "help"] = positionals;

  if (options.help || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(
      [
        "Usage: wiki work-record-escalations <propose|accept> --record-id <WK-0001> --id <ESC-0001> --reason <text> --accepted-at <ISO-8601> [options] [--json]",
        "",
        "Trusted authoring requires operator authorization. Provide ONE of:",
        `  - environment variable ${OPERATOR_TRUST_ENV_VAR}=1 (set by operator entrypoints, stripped by worker wrappers)`,
        `  - command-line flag --operator-confirm "${OPERATOR_CONFIRM_PHRASE}"`,
        "",
        "All authoring fields are required explicitly (no default actor, source, or authority ref).",
        "",
        "Options:",
        "  --kind <critical_blast_radius>",
        "  --accepted-by-actor <operator|orchestrator|reviewer>",
        "  --accepted-by-id <string>",
        "  --accepted-by-source <explicit_user_instruction|accepted_decision|reviewed_handoff|closed_work_record>",
        "  --authority-ref <DEC-0001|IN-0001|WK-0001>  must resolve to an existing canonical record",
        "  --provenance-source-kind <canonical_docs|canonical_wiki|issue|decision|area|code_index|git_history|parser_symbol|test_adjacency>",
        "  --provenance-canonicality <canonical|derived|generated|external|unknown>",
        "  --provenance-evidence-basis <explicit_metadata|path_match|docs_backlink|git_blob|git_tree|cochange|lexical_match|parser_extract|inferred_test_adjacency|unknown>",
        "  --slice-id <slice-id>",
        "  --max-blast-radius <low|medium|high|critical>",
        "  --expires-at <ISO-8601|null>",
        "  --record-updated <YYYY-MM-DD>",
        "  --operator-confirm <phrase>",
        "  --dir <path>",
        "  --json"
      ].join("\n")
    );
    return;
  }

  const trustGate = resolveOperatorTrustGate(options);
  if (!trustGate) {
    throw new Error(
      `Refusing trusted escalation authoring: set ${OPERATOR_TRUST_ENV_VAR}=1 or pass --operator-confirm "${OPERATOR_CONFIRM_PHRASE}"`
    );
  }

  let result;
  switch (subcommand) {
    case "propose":
      result = await runPropose(options, trustGate);
      break;
    case "accept":
      result = await runAccept(options, trustGate);
      break;
    default:
      throw new Error(`Unknown work-record-escalations subcommand: ${subcommand}`);
  }

  if (options.json) {
    printJson(result);
    return;
  }

  printResult(result);
  if (!result.valid && result.diagnostics.length > 0) {
    for (const diagnostic of result.diagnostics) {
      console.log(`- ${diagnostic.code}: ${diagnostic.message}`);
    }
  }
}
