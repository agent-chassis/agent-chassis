import {
  ensureLauncherRoleGuardSecret,
  getLauncherRoleGuardSecretPath,
  initializeDefaultRegistry
} from "@agent-chassis/agent-launch-core";
import { parseArgs } from "../lib/cli.mjs";

export async function runInitConfig(argv) {
  const { options } = parseArgs(argv);
  const registryPath = await initializeDefaultRegistry({
    force: Boolean(options.force)
  });
  await ensureLauncherRoleGuardSecret();
  console.log(`Wrote launcher registry ${registryPath}`);
  console.log(`Provisioned launcher role-guard secret ${getLauncherRoleGuardSecretPath()}`);
}
