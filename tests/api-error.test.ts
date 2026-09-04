import { describe, expect, it } from "bun:test";
import { ApiError, ApiErrorCode, toApiError } from "../src/clients/api-error.ts";

function axiosError(status: number, data: unknown): unknown {
  return Object.assign(new Error("Request failed"), { response: { status, data } });
}

describe("toApiError", () => {
  it("should read `error` as the message and `detail` as the code when the body is an orchestrator envelope", () => {
    // aisee_shared create_error_response -> { success, error, detail }
    const err = toApiError(
      axiosError(403, { success: false, error: "Product example.com is deactivated", detail: "PRODUCT_INACTIVE" }),
    );

    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("[403] Product example.com is deactivated");
    expect(err.code).toBe(ApiErrorCode.PRODUCT_INACTIVE);
    expect(err.isProductInactive()).toBe(true);
  });

  it("should keep the reason rather than the code when an orchestrator 402 carries both", () => {
    const err = toApiError(
      axiosError(402, { success: false, error: "Balance 3 is below the required 50", detail: "Insufficient credit" }),
    );

    expect(err.message).toBe("[402] Balance 3 is below the required 50");
    expect(err.isInsufficientCredit()).toBe(true);
  });

  it("should fall back to `detail` when an orchestrator envelope has no `error` text", () => {
    const err = toApiError(axiosError(400, { success: false, error: "", detail: "Something explained here" }));

    expect(err.message).toBe("[400] Something explained here");
  });

  it("should read `message` when the body is a NestJS error", () => {
    const err = toApiError(
      axiosError(400, { statusCode: 400, message: "Board is required", error: "Bad Request" }),
    );

    expect(err.message).toBe("[400] Board is required");
    expect(err.code).toBe("Bad Request");
  });

  it("should join a NestJS array message", () => {
    const err = toApiError(
      axiosError(400, { statusCode: 400, message: ["title must be longer", "board should not be empty"] }),
    );

    expect(err.message).toBe("[400] title must be longer; board should not be empty");
  });

  it("should read `detail` when the body is a bare FastAPI HTTPException", () => {
    const err = toApiError(axiosError(404, { detail: "Task not found" }));

    expect(err.message).toBe("[404] Task not found");
  });

  it("should flatten FastAPI validation errors into one message", () => {
    const err = toApiError(
      axiosError(422, {
        detail: [
          { loc: ["body", "startAt"], msg: "invalid datetime format", type: "value_error" },
        ],
      }),
    );

    expect(err.message).toBe("[422] body.startAt: invalid datetime format");
  });

  it("should flag a 429 as a concurrency limit", () => {
    const err = toApiError(
      axiosError(429, { success: false, error: "existing task is processing", detail: "Too many requests" }),
    );

    expect(err.isConcurrencyLimit()).toBe(true);
  });

  it("should degrade gracefully when there is no response body", () => {
    const err = toApiError(new Error("socket hang up"));

    expect(err.message).toBe("socket hang up");
    expect(err.status).toBeUndefined();
  });

  it("should pass an ApiError through unchanged", () => {
    const original = new ApiError("already normalized", { status: 500 });

    expect(toApiError(original)).toBe(original);
  });
});

describe("ApiError advice", () => {
  it("should suggest reactivating the product on PRODUCT_INACTIVE", () => {
    const err = toApiError(
      axiosError(403, { success: false, error: "Product is deactivated", detail: "PRODUCT_INACTIVE" }),
    );

    expect(err.suggestion).toMatch(/Reactivate/);
    expect(err.retryable).toBe(false);
  });

  it("should suggest topping up on 402 and mark it retryable", () => {
    const err = toApiError(axiosError(402, { success: false, error: "no credit", detail: "Insufficient credit" }));

    expect(err.suggestion).toMatch(/Add credits/);
    expect(err.retryable).toBe(true);
  });

  it("should suggest waiting on 429", () => {
    const err = toApiError(axiosError(429, { success: false, error: "busy", detail: "Too many requests" }));

    expect(err.suggestion).toMatch(/still running/);
    expect(err.retryable).toBe(true);
  });

  it("should suggest re-login on 401", () => {
    const err = toApiError(axiosError(401, { detail: "Not authenticated" }));

    expect(err.suggestion).toMatch(/aisee login/);
  });

  it("should attach no advice to an ordinary 404", () => {
    const err = toApiError(axiosError(404, { detail: "Task not found" }));

    expect(err.suggestion).toBeUndefined();
    expect(err.retryable).toBeUndefined();
  });
});
