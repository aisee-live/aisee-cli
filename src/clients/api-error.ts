import { UserError } from "../utils/errors.ts";

/**
 * Backend error codes the CLI reacts to by name rather than by message text.
 *
 * `PRODUCT_INACTIVE` is the orchestrator's `detail` for a deactivated product;
 * the credit and concurrency codes are the `detail` strings the action-dispatch
 * handler attaches to 402 / 429 so a client can render a CTA without sniffing
 * prose. See aisee_orchestrator/api/action_routes.py.
 */
export const ApiErrorCode = {
  PRODUCT_INACTIVE: "PRODUCT_INACTIVE",
  INSUFFICIENT_CREDIT: "Insufficient credit",
  CONCURRENCY_LIMIT: "Too many requests, existing task is processing",
} as const;

/**
 * Next step for the failure modes the backend signals by status/code.
 *
 * `suggestion` and `retryable` are the fields both error emitters already
 * render, so setting them here surfaces the hint on every command without
 * each module re-deriving it.
 */
function adviseFor(status: number | undefined, code: string | undefined): { suggestion?: string; retryable?: boolean } {
  if (code === ApiErrorCode.PRODUCT_INACTIVE) {
    return { suggestion: "Reactivate this product before running the command.", retryable: false };
  }
  switch (status) {
    case 401:
      return { suggestion: "Run 'aisee login' to sign in again.", retryable: false };
    case 402:
      return { suggestion: "Add credits to your account, then run this command again.", retryable: true };
    case 429:
      return {
        suggestion: "Another task for this item is still running. Wait for it to finish, then retry.",
        retryable: true,
      };
    default:
      return {};
  }
}

export class ApiError extends UserError {
  readonly status?: number;
  /** Backend-supplied error code, when the response carries one. */
  readonly code?: string;
  readonly body?: unknown;
  /** Rendered by both error emitters as "Suggestion: ...". */
  readonly suggestion?: string;
  readonly retryable?: boolean;

  constructor(message: string, options: { status?: number; code?: string; body?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;

    const advice = adviseFor(options.status, options.code);
    this.suggestion = advice.suggestion;
    this.retryable = advice.retryable;
  }

  /** True when the backend refused because the product is switched off. */
  isProductInactive(): boolean {
    return this.code === ApiErrorCode.PRODUCT_INACTIVE;
  }

  isInsufficientCredit(): boolean {
    return this.status === 402;
  }

  isConcurrencyLimit(): boolean {
    return this.status === 429;
  }
}

function joinMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        // FastAPI validation errors: { loc: [...], msg: "...", type: "..." }
        const record = entry as Record<string, unknown>;
        const loc = Array.isArray(record?.loc) ? record.loc.join(".") : undefined;
        const msg = typeof record?.msg === "string" ? record.msg : undefined;
        if (msg) return loc ? `${loc}: ${msg}` : msg;
        return undefined;
      })
      .filter((part): part is string => !!part);
    return parts.length > 0 ? parts.join("; ") : undefined;
  }
  return undefined;
}

/**
 * Normalize the three error-body shapes the CLI talks to into one ApiError.
 *
 * The shapes disagree about which field holds the human-readable message, so
 * they must be told apart before reading it:
 *
 *   orchestrator `create_error_response` -> { success: false, error, detail }
 *       `error` is the message; `detail` is a short CODE (PRODUCT_INACTIVE, ...).
 *   NestJS (postiz)                      -> { statusCode, message, error }
 *       `message` is the message (string or string[]); `error` is the status name.
 *   FastAPI HTTPException                -> { detail }
 *       `detail` is the message (string, or a validation-error array).
 *
 * Reading `detail` first — as the previous per-client helpers did — surfaced the
 * orchestrator's error CODE and discarded the reason behind it.
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  const response = (err as { response?: { status?: number; data?: unknown } }).response;
  const status = response?.status;
  const data = response?.data;

  if (!data || typeof data !== "object") {
    const fallback = (err as Error)?.message ?? String(err);
    return new ApiError(status ? `[${status}] ${fallback}` : fallback, { status, body: data });
  }

  const record = data as Record<string, unknown>;
  let message: string | undefined;
  let code: string | undefined;

  if (record.success === false) {
    message = joinMessage(record.error);
    code = typeof record.detail === "string" ? record.detail : undefined;
    // Some handlers put the whole explanation in `detail` and nothing in `error`.
    if (!message) message = joinMessage(record.detail);
  } else if (record.message !== undefined) {
    message = joinMessage(record.message);
    code = typeof record.error === "string" ? record.error : undefined;
  } else {
    message = joinMessage(record.detail);
  }

  message = message ?? (err as Error)?.message ?? String(err);
  const prefix = status ? `[${status}] ` : "";
  return new ApiError(`${prefix}${message}`, { status, code, body: data });
}

/**
 * Wrap an axios promise so every rejection surfaces as an ApiError.
 *
 * Kept untyped on purpose: the clients hand back raw backend payloads, and
 * typing this as `Promise<unknown>` would force a cast at every call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cx = <T = any>(p: Promise<T>): Promise<T> =>
  p.catch((err: unknown): never => {
    throw toApiError(err);
  });
