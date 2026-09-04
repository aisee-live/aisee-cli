/**
 * Structured breakdown attached to a failure.
 *
 * Values must stay scalar: the TTY emitter renders `details` with one
 * `key: String(value)` line per entry, so a nested array or object would print
 * as `[object Object]`. The JSON emitter passes the same object through
 * verbatim, so one flat map serves both readers.
 */
export type ErrorDetails = Record<string, string | number | boolean>;

export class UserError extends Error {
  /** Forwarded by both error emitters (apcore-cli's and ours). */
  readonly details?: ErrorDetails;

  constructor(message: string, options: { details?: ErrorDetails } = {}) {
    super(message);
    this.name = "UserError";
    if (options.details) this.details = options.details;
  }
}
