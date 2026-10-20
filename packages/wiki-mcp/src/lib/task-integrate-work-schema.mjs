import { selectedResponseDetailSchema } from "./selected-response-snapshot.mjs";

export const INTEGRATE_WORK_TOOL_NAME = "integrate_work";

export function createIntegrateWorkInputContract(z) {
  const inputSchema = z.object({ delivery: selectedResponseDetailSchema(z).shape.source
    .describe("The immutable original result of the delivery being approved."),
    candidate_version: z.string().regex(/^[a-f0-9]{64}$/u).optional()
      .describe("Copy only from an issued unfinished-integration recovery; fences candidate checkout preparation.") }).strict();
  return Object.freeze({ inputSchema, advertisedInputSchema: inputSchema });
}
