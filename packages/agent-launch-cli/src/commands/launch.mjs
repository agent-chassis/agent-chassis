import path from "node:path";

import { launchReview } from "@agent-chassis/agent-launch-core";
import { parseArgs } from "../lib/cli.mjs";

export async function runLaunch(argv) {
  const { positionals, options } = parseArgs(argv);
  const [reviewId] = positionals;
  const result = await launchReview({ reviewId });
  const metaPath = path.join(result.runDir, "metadata", "meta.json");
  const output = {
    runId: result.runId,
    status: result.status,
    runDir: result.runDir,
    responsePath: result.responsePath,
    metaPath
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Launched ${output.runId}`);
    console.log(`Status: ${output.status}`);
    console.log(`Response: ${output.responsePath}`);
    console.log(`Meta: ${output.metaPath}`);
  }

  if (result.status !== "completed") {
    process.exitCode = 1;
  }
}
