// Whether agents may take new tasks. "start" begins paused: the person presses play on the dashboard.
export interface RunControl {
  working: () => boolean;
  play: () => void;
  // Stops new work; agents already at work finish their task.
  pause: () => void;
  // Resolves at the next play or pause, so the loop reacts at once instead of at its next tick.
  changed: () => Promise<void>;
}

export function createRunControl(onChange: (working: boolean) => void = () => {}): RunControl {
  let working = false;
  let waiters: (() => void)[] = [];
  const set = (value: boolean) => {
    if (working === value) return;
    working = value;
    onChange(value);
    const woken = waiters;
    waiters = [];
    for (const wake of woken) wake();
  };
  return {
    working: () => working,
    play: () => set(true),
    pause: () => set(false),
    changed: () => new Promise((resolve) => waiters.push(resolve)),
  };
}
