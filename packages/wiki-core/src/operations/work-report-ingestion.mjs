import path from "node:path";

import { ingestWorkReport as ingestWorkReportCore } from "../lib/work-report-ingestion.mjs";

export async function ingestWorkReport({ dir = ".", ...options } = {}) {
  return ingestWorkReportCore({
    dir: path.resolve(String(dir)),
    ...options
  });
}
