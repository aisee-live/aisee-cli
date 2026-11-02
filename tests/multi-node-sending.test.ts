import { beforeEach, describe, expect, it } from "bun:test";
import { calls, resetStub, setHandler, withFormat } from "./support/api-stub.ts";
const { postAgentClient } = await import("../src/clients/post-agent.ts");
const post = await import("../src/modules/post/index.ts");

beforeEach(resetStub);

describe("multi-node sending", () => {
  it("blocks a controlled retry while the outcome awaits reconciliation", async () => {
    setHandler(() => ({ posts: [{ id: "p1", state: "ERROR" }], sending: {
      status: "RECONCILING", allowedActions: { retry: { allowed: false, reason: "SEND_RETRY_UNSAFE" } },
    } }));
    await expect(postAgentClient.retryPost("p1")).rejects.toThrow("SEND_RETRY_UNSAFE");
    expect(calls.every(c => c.method === "get")).toBe(true);
  });

  it("retries the original post only when the backend allows it", async () => {
    setHandler(c => c.method === "get" ? { posts: [{ id: "p1" }], sending: {
      allowedActions: { retry: { allowed: true, reason: null } },
    } } : { id: "p1" });
    await postAgentClient.retryPost("p1");
    expect(calls.map(c => [c.method, c.url])).toEqual([
      ["get", "/posts/p1"], ["post", "/posts/p1/retry"],
    ]);
  });

  it("does not retry when the status read fails", async () => {
    setHandler(() => { throw new Error("Status unavailable"); });
    await expect(postAgentClient.retryPost("p1")).rejects.toThrow("Status unavailable");
    expect(calls).toHaveLength(1);
  });

  it("preserves legacy retry behavior when no sending summary exists", async () => {
    setHandler(c => c.method === "get" ? { posts: [{ id: "p1", state: "ERROR" }] } : { id: "p1" });
    expect(await postAgentClient.retryPost("p1")).toEqual({ id: "p1" });
    expect(calls.at(-1)?.url).toBe("/posts/p1/retry");
  });

  it("requires affirmative permission when a sending summary omits retry actions", async () => {
    setHandler(() => ({ posts: [{ id: "p1" }], sending: { status: "RECONCILING" } }));
    await expect(postAgentClient.retryPost("p1")).rejects.toThrow("SEND_RETRY_UNSAFE");
    expect(calls).toHaveLength(1);
  });

  it("shows reconciliation, pauses, account and action reasons in status", async () => {
    setHandler(() => ({ posts: [{ id: "p1", state: "ERROR" }], sending: {
      status: "RECONCILING", paused: true, integrationId: "account-1",
      allowedActions: { retry: { allowed: false, reason: "SEND_RETRY_UNSAFE" } },
    } }));
    const out = await withFormat("table", () => post.postStatusModule.execute({ id: "p1" }));
    expect(out).toContain("RECONCILING");
    expect(out).toContain("account-1");
    expect(out).toContain("SEND_RETRY_UNSAFE");
    expect(out).toContain("true");
  });

  it("preserves the complete status response in JSON", async () => {
    const raw = { posts: [{ id: "p1", state: "QUEUE" }], sending: { status: "PARTIAL_SUCCESS" } };
    setHandler(() => raw);
    expect(await withFormat("json", () => post.postStatusModule.execute({ id: "p1" }))).toEqual(raw);
  });

  it("renders partial success and segment outcomes in Markdown", async () => {
    setHandler(() => ({ posts: [{ id: "p1", state: "ERROR" }], sending: {
      status: "PARTIAL_SUCCESS", segments: [{ segmentIndex: 0, status: "CONFIRMED" }],
    } }));
    const out = await withFormat("markdown", () => post.postStatusModule.execute({ id: "p1" }));
    expect(out).toContain("PARTIAL_SUCCESS");
    expect(out).toContain("CONFIRMED");
  });

  it("renders legacy post state when no sending summary is returned", async () => {
    setHandler(() => ({ posts: [{ id: "p1", state: "PUBLISHED" }] }));
    const out = await withFormat("table", () => post.postStatusModule.execute({ id: "p1" }));
    expect(out).toContain("PUBLISHED");
    expect(out).toContain("p1");
  });

  it("labels pending counts as legacy and points to per-post status", async () => {
    setHandler(() => ({ dueNow: 0, leased: 0, scheduledAhead: 0 }));
    const out = await withFormat("table", () => post.postPendingModule.execute());
    expect(out).toContain("legacy");
    expect(out).toContain("post status");
  });
});
