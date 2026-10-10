

import { ensureSidecarIndex } from "./sidecar-ensure.mjs";

const MESSAGE_LIMIT = 500;
const controller = new AbortController();
const cancel = (reason) => {
  if (!controller.signal.aborted) controller.abort(new Error(reason));
};
process.once("disconnect", () => cancel("refresh host disconnected"));
process.once("SIGTERM", () => cancel("refresh worker was asked to stop"));

function report(message, exitCode) {
  if (!process.connected) process.exit(exitCode);
  process.send(message, () => {
    process.disconnect();
    process.exitCode = exitCode;
  });
}

process.once("message", async (request) => {
  try {
    const ensured = await ensureSidecarIndex({ dir: request.dir, cacheDir: request.cacheDir,
      signal: controller.signal });
    report({ type: "completed", action: ensured.action, captured_head: ensured.captured_head,
      publication: { store_incarnation: ensured.publication.store_incarnation,
        sequence: ensured.publication.sequence,
        repository_commit: ensured.publication.repository_commit } }, 0);
  } catch (error) {
    const envelope = error?.envelope ?? null;
    report({ type: "failed",
      code: typeof error?.code === "string" ? error.code : "sidecar_refresh_failed",
      message: String(error?.message ?? error).slice(0, MESSAGE_LIMIT),
      cause_code: typeof envelope?.cause_code === "string" ? envelope.cause_code : null,
      publication_outcome: envelope?.publication_outcome ?? error?.publication_outcome ?? null }, 1);
  }
});
