import { cleanupAgentRuns } from "@agent-chassis/agent-launch-core";

export async function runCleanup() {
  const result = await cleanupAgentRuns();
  console.log(`Removed ${result.removed.length} path(s)`);
  for (const entry of result.removed) {
    console.log(`- ${entry}`);
  }
}

