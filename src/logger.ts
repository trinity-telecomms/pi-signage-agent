const now = (): string => new Date().toISOString();

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, details?: unknown): void {
  if (details === undefined) {
    console.log(`${now()} [${level}] ${msg}`);
    return;
  }
  console.log(`${now()} [${level}] ${msg}`, details);
}

export const logger = {
  info: (msg: string, details?: unknown) => log('INFO', msg, details),
  warn: (msg: string, details?: unknown) => log('WARN', msg, details),
  error: (msg: string, details?: unknown) => log('ERROR', msg, details),
};
