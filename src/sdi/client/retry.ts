export interface RetryConfig {
  maxAttempts: number;
  baseMs: number;
  capMs: number;
}

export const DEFAULT_RETRY: RetryConfig = { maxAttempts: 3, baseMs: 1000, capMs: 8000 };

/** Backoff esponenziale con tetto e jitter (0.5x-1x). `attempt` parte da 1. */
export function backoffDelay(
  attempt: number,
  cfg: RetryConfig,
  random: () => number = Math.random,
): number {
  const exp = Math.min(cfg.capMs, cfg.baseMs * 2 ** (attempt - 1));
  return Math.round(exp * (0.5 + random() * 0.5));
}

export interface RetryOptions<T> {
  cfg: RetryConfig;
  /** true se l'esito va ritentato (solo rete/timeout/5xx). */
  shouldRetry: (outcome: T) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Esegue `op` fino a maxAttempts; ritorna l'ultimo esito e il numero di tentativi. */
export async function withRetry<T>(
  op: (attempt: number) => Promise<T>,
  opts: RetryOptions<T>,
): Promise<{ outcome: T; attempts: number }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const outcome = await op(attempt);
    if (!opts.shouldRetry(outcome) || attempt >= opts.cfg.maxAttempts) {
      return { outcome, attempts: attempt };
    }
    await sleep(backoffDelay(attempt, opts.cfg, opts.random));
  }
}
