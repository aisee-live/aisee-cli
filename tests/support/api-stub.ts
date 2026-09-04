import { mock } from "bun:test";

/**
 * Shared axios stub for every test that exercises a client or a module.
 *
 * It lives in one module on purpose: `mock.module` replaces a module globally
 * for the whole test run, so a second test file registering its own stub for
 * `clients/http.ts` would not rebind the client modules already imported
 * against the first one. Importing this module from every test file keeps a
 * single registration and a single set of recorded calls.
 */

export interface RecordedCall {
  method: string;
  url: string;
  body?: unknown;
  config?: { params?: Record<string, unknown>; data?: unknown };
}

export const calls: RecordedCall[] = [];

type Handler = (call: RecordedCall) => unknown;

const empty: Handler = () => ({});
let handler: Handler = empty;

/** Answer the next requests. The call is passed in so routes can be told apart. */
export function setHandler(fn: Handler): void {
  handler = fn;
}

export function resetStub(): void {
  calls.length = 0;
  handler = empty;
}

export function callsFor(method: string): RecordedCall[] {
  return calls.filter((c) => c.method === method);
}

function verb(method: string) {
  return (url: string, a?: unknown, b?: unknown) => {
    // axios signatures differ: get(url, config) vs post(url, body, config)
    const isBodyVerb = method === "post" || method === "put";
    const call: RecordedCall = isBodyVerb
      ? { method, url, body: a, config: b as RecordedCall["config"] }
      : { method, url, config: a as RecordedCall["config"] };
    calls.push(call);
    // axios always settles a promise, so a handler that throws must come back
    // as a rejection rather than a synchronous throw.
    try {
      return Promise.resolve({ data: handler(call) });
    } catch (err) {
      return Promise.reject(err);
    }
  };
}

/** Reject the next request the way axios does, so `cx` maps it to an ApiError. */
export function rejectWith(status: number, data: unknown): Handler {
  return () => {
    throw Object.assign(new Error("Request failed"), { response: { status, data } });
  };
}

export const axiosStub = {
  get: verb("get"),
  post: verb("post"),
  put: verb("put"),
  delete: verb("delete"),
};

mock.module("../../src/clients/http.ts", () => ({
  analysisAxios: axiosStub,
  postAgentAxios: axiosStub,
  authAxios: axiosStub,
}));

/**
 * Run `fn` with a forced `--format`.
 *
 * Both format helpers read `process.argv` directly, so a render test has to go
 * through argv rather than a parameter.
 */
export async function withFormat<T>(format: string, fn: () => Promise<T>): Promise<T> {
  const original = process.argv;
  process.argv = [...original, "--format", format];
  try {
    return await fn();
  } finally {
    process.argv = original;
  }
}
