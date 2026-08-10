const DOMAINS = Object.freeze({
  "database-unique-insert": Object.freeze({
    winnerStart: 1, loserStart: 2, winnerTerminal: 4, loserTerminal: 3,
    effect: "row:account/7", state: "rows:1"
  }),
  "queue-deduplicated-enqueue": Object.freeze({
    winnerStart: 2, loserStart: 1, winnerTerminal: 3, loserTerminal: 5,
    effect: "message:job/9", state: "queued:job/9"
  }),
  "filesystem-create-if-absent": Object.freeze({
    winnerStart: 10, loserStart: 10, winnerTerminal: 12, loserTerminal: 11,
    effect: "file:lease.lock", state: "files:lease.lock"
  })
});

const LEGITIMATE_VARIANTS = Object.freeze({
  "winner-terminal-first": (execution) => {
    execution.winnerTerminal = 3;
    execution.loserTerminal = 4;
  },
  "loser-terminal-first": (execution) => {
    execution.winnerTerminal = 4;
    execution.loserTerminal = 3;
  },
  "simultaneous-starts": (execution) => {
    execution.winnerStart = 1;
    execution.loserStart = 1;
  }
});

const MUTATIONS = Object.freeze({
  "serialized-loser-start": (execution) => {
    execution.loserStart = Math.min(execution.winnerTerminal, execution.loserTerminal);
  },
  "both-succeed": (execution) => { execution.loserRejected = false; },
  "both-refuse": (execution) => { execution.winnerAccepted = false; },
  "duplicate-effect": (execution) => {
    execution.effects.push({ attempt: "loser", identity: `${execution.effects[0].identity}:2` });
  },
  "wrong-winner-effect": (execution) => { execution.effects[0].attempt = "loser"; },
  "loser-state-diverges": (execution) => { execution.loserPostState += ":diverged"; },
  "wrong-loser-resource": (execution) => { execution.loserObservedResource += ":other"; }
});

function executeSingleWinnerEffect({
  domain = "database-unique-insert",
  variant = null,
  mutant = null
} = {}) {
  const selected = DOMAINS[domain];
  if (!selected) throw new TypeError(`unknown domain: ${domain}`);
  const execution = {
    domain,
    attemptCount: 2,
    winnerStart: selected.winnerStart,
    loserStart: selected.loserStart,
    winnerTerminal: selected.winnerTerminal,
    loserTerminal: selected.loserTerminal,
    winnerAccepted: true,
    loserRejected: true,
    effects: [{ attempt: "winner", identity: selected.effect }],
    effectResource: selected.effect,
    winnerObservedResource: selected.effect,
    loserObservedResource: selected.effect,
    winnerPostState: selected.state,
    loserPostState: selected.state
  };
  if (variant !== null) {
    const apply = LEGITIMATE_VARIANTS[variant];
    if (!apply) throw new TypeError(`unknown variant: ${variant}`);
    apply(execution);
  }
  if (mutant !== null) {
    const mutate = MUTATIONS[mutant];
    if (!mutate) throw new TypeError(`unknown mutant: ${mutant}`);
    mutate(execution);
  }
  return execution;
}

function singleWinnerEffectGuaranteeSatisfied(execution) {
  const firstTerminal = Math.min(execution.winnerTerminal, execution.loserTerminal);
  const overlap = execution.winnerStart < firstTerminal &&
    execution.loserStart < firstTerminal;
  const electedOutcomes = execution.winnerAccepted === true &&
    execution.loserRejected === true;
  const electedEffect = execution.effects.length === 1 &&
    execution.effects[0].attempt === "winner";
  const sameResource = execution.winnerObservedResource === execution.effectResource &&
    execution.loserObservedResource === execution.effectResource;
  return execution.attemptCount === 2 && overlap && electedOutcomes &&
    electedEffect && sameResource &&
    execution.loserPostState === execution.winnerPostState;
}

export {
  DOMAINS,
  LEGITIMATE_VARIANTS,
  MUTATIONS,
  executeSingleWinnerEffect,
  singleWinnerEffectGuaranteeSatisfied
};
