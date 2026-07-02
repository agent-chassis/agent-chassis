import {
  temporalWrapperDryRun,
  TemporalWrapperDryRunError
} from "../../../agent-launch-core/src/operations/temporal-wrapper-dry-run.mjs";
import { parseArgs } from "../lib/cli.mjs";

const OPTION_SPEC = new Map([
  ["handoff", "value"],
  ["launch-record", "value"],
  ["evidence", "value"],
  ["status-out", "value"],
  ["json", "boolean"]
]);

const SUPPORT_STATE = Object.freeze({
  state: "experimental_wip",
  supported: false,
  launch_surface: "not_supported",
  message:
    "Temporal wrapper dry-run is an experimental WIP diagnostic and is not a supported agent-launch launch surface."
});

export async function runTemporalWrapperDryRun(argv) {
  const unknownArgumentDetails = findUnknownArgumentDetails(argv);
  if (unknownArgumentDetails.length > 0) {
    writeUnknownOptionError(unknownArgumentDetails);
    process.exitCode = 1;
    return;
  }

  const { options } = parseArgs(argv);

  try {
    const result = await temporalWrapperDryRun({
      handoffPath: stringOption(options.handoff),
      launchRecordPath: stringOption(options["launch-record"]),
      evidencePath: stringOption(options.evidence),
      statusOutPath: stringOption(options["status-out"])
    });

    const output = {
      ok: result.ok,
      support: SUPPORT_STATE,
      status_path: result.statusPath,
      result: result.status.result,
      failures: result.failures
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Support: ${SUPPORT_STATE.message}`);
      console.log(`Temporal wrapper dry-run result: ${output.result}`);
      console.log(`Status: ${output.status_path}`);
      if (output.failures.length > 0) {
        console.log(`Failures: ${output.failures.length}`);
      }
    }

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (cause) {
    if (cause instanceof TemporalWrapperDryRunError) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            support: SUPPORT_STATE,
            error: {
              code: cause.code,
              message: cause.message,
              details: cause.details
            }
          },
          null,
          2
        )
      );
      process.exitCode = 1;
      return;
    }
    throw cause;
  }
}

function stringOption(value) {
  return typeof value === "string" ? value : undefined;
}

function findUnknownArgumentDetails(argv) {
  const details = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      details.push(unknownOptionDetail(token));
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const optionKind = OPTION_SPEC.get(rawKey);
    if (!optionKind) {
      details.push(unknownOptionDetail(token));
      continue;
    }

    if (optionKind === "boolean" && inlineValue !== undefined) {
      details.push(unknownOptionDetail(token));
      continue;
    }

    if (optionKind !== "value" || inlineValue !== undefined) {
      continue;
    }

    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      continue;
    }

    if (next.startsWith("-")) {
      details.push(unknownOptionDetail(next));
    }
    index += 1;
  }

  return details;
}

function unknownOptionDetail(path) {
  return {
    path,
    code: "unknown_option"
  };
}

function writeUnknownOptionError(details) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        support: SUPPORT_STATE,
        error: {
          code: "unknown_option",
          message: "Unknown option for temporal-wrapper-dry-run",
          details
        }
      },
      null,
      2
    )
  );
}
