

import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";
import { projectControlledContractAuthoringRefusal } from
  "../../lib/controlled-contract-authoring-state.mjs";

function throwAuthoringRefusal(refusal) {
  throw new ControlledContractToolError(
    refusal.reason_code,
    "controlled-contract authoring continuation was refused",
    { replacement_call: refusal.replacement_call, ...(refusal.details ?? {}) }
  );
}

function throwProofGraphAuthoringFailure({
  input, reasonCode, details = {}, continuation = null
}) {
  throwAuthoringRefusal(projectControlledContractAuthoringRefusal({
    reasonCode,
    wkId: input.wkId,
    focus: input.focus ?? null,
    details,
    continuation
  }));
}

export { throwAuthoringRefusal, throwProofGraphAuthoringFailure };
