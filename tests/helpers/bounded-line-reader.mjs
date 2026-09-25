

export const BOUNDED_LINE_EOF_POLICIES = Object.freeze(["reject", "report"]);

export function createBoundedLineReader({ maxLineBytes, eofPolicy, onLine, onFailure, onTrailing }) {
  if (!Number.isInteger(maxLineBytes) || maxLineBytes <= 1) {
    throw new TypeError("maxLineBytes must be an integer greater than 1");
  }
  if (!BOUNDED_LINE_EOF_POLICIES.includes(eofPolicy)) {
    throw new TypeError(`eofPolicy must be one of ${BOUNDED_LINE_EOF_POLICIES.join(", ")}`);
  }
  if (eofPolicy === "report" && typeof onTrailing !== "function") {
    throw new TypeError("the report EOF policy requires onTrailing");
  }
  let pending = Buffer.alloc(0);
  let offset = 0;
  let ended = false;

  function fail(failure) {
    ended = true;
    pending = Buffer.alloc(0);
    onFailure(failure);
  }

  return Object.freeze({
    push(chunk) {
      if (ended) return;
      let input = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      try {
        while (true) {
          const newline = input.indexOf(10);
          if (newline < 0) break;
          if (newline + 1 > maxLineBytes) {
            return fail({ kind: "oversize", offset, bytes: newline + 1 });
          }
          const line = input.subarray(0, newline);
          const lineOffset = offset;
          offset += newline + 1;
          input = input.subarray(newline + 1);
          onLine(line, lineOffset);
          if (ended) return;
        }
        if (input.length >= maxLineBytes) {
          return fail({ kind: "oversize", offset, bytes: input.length });
        }
        pending = Buffer.from(input);
      } catch (error) {
        fail({ kind: "consumer", offset, error });
      }
    },
    end() {
      if (ended) return;
      ended = true;
      if (pending.length === 0) return;
      const tail = pending;
      pending = Buffer.alloc(0);
      if (eofPolicy === "reject") onFailure({ kind: "trailing", offset, bytes: tail.length });
      else onTrailing({ offset, bytes: tail });
    },
    get offset() { return offset; }
  });
}
