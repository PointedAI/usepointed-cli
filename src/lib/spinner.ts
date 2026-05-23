const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  stop(finalMessage?: string): void;
}

export function startSpinner(message: string): Spinner {
  if (!process.stderr.isTTY) {
    process.stderr.write(`${message}\n`);
    return { stop() {} };
  }

  let frame = 0;
  const interval = setInterval(() => {
    process.stderr.write(`\r${FRAMES[frame % FRAMES.length]} ${message}`);
    frame++;
  }, 80);

  return {
    stop(finalMessage?: string) {
      clearInterval(interval);
      process.stderr.write("\r\x1b[K");
      if (finalMessage) {
        process.stderr.write(`${finalMessage}\n`);
      }
    },
  };
}
