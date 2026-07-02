

async function drainStdin() {
  try {
    // eslint-disable-next-line no-unused-vars
    for await (const _chunk of process.stdin) {

    }
  } catch {

  }
}

export async function runRoleGuardClaudeHook(_argv) {
  await drainStdin();

}
