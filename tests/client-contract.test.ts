import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Contract tests for both API clients.
 *
 * They share one file because `mock.module` replaces a module globally for the
 * whole test run: a second file mocking `clients/http.ts` would not rebind the
 * client modules already imported against the first stub.
 *
 * What these pin:
 *   - `content_days=0` was sent unconditionally, telling the server to generate
 *     no CONTENT items — the exact items `aisee action-post` consumes.
 *   - suggestion polling hit `/task/detail/{id}` and then re-POSTed
 *     `generate-tasks`, instead of the read-only `generated-tasks` endpoint.
 *   - the dashboard sent a `period` parameter no DTO declares.
 *   - `post publish` called the ERROR-only retry route, and `createPost`
 *     invented a `state` the API never returned.
 */

interface RecordedCall {
  method: string;
  url: string;
  body?: unknown;
  config?: { params?: Record<string, unknown>; data?: unknown };
}

const calls: RecordedCall[] = [];
let handler: (call: RecordedCall) => unknown = () => ({});

function verb(method: string) {
  return (url: string, a?: unknown, b?: unknown) => {
    // axios signatures differ: get(url, config) vs post(url, body, config)
    const isBodyVerb = method === "post" || method === "put";
    const call: RecordedCall = isBodyVerb
      ? { method, url, body: a, config: b as RecordedCall["config"] }
      : { method, url, config: a as RecordedCall["config"] };
    calls.push(call);
    return Promise.resolve({ data: handler(call) });
  };
}

const axiosStub = {
  get: verb("get"),
  post: verb("post"),
  put: verb("put"),
  delete: verb("delete"),
};

mock.module("../src/clients/http.ts", () => ({
  analysisAxios: axiosStub,
  postAgentAxios: axiosStub,
  authAxios: axiosStub,
}));

const { analysisClient } = await import("../src/clients/analysis.ts");
const { postAgentClient } = await import("../src/clients/post-agent.ts");

const INTEGRATIONS = { integrations: [{ id: "ch_x", identifier: "x", name: "Brand X" }] };

beforeEach(() => {
  calls.length = 0;
  handler = () => ({});
});

function only(method: string): RecordedCall[] {
  return calls.filter((c) => c.method === method);
}

// ---------------------------------------------------------------------------
// analysis client
// ---------------------------------------------------------------------------

describe("analysisClient.getSuggestion", () => {
  it("should not send content_days when the caller does not ask for it", async () => {
    handler = () => ({ status: "completed", tasks: [] });

    await analysisClient.getSuggestion("action-1");

    expect(calls[0]?.url).toBe("/action/action-1/generate-tasks");
    expect(calls[0]?.config).toBeUndefined();
  });

  it("should send content_days when explicitly requested, including zero", async () => {
    handler = () => ({ status: "completed", tasks: [] });

    await analysisClient.getSuggestion("action-1", { contentDays: 0 });
    expect(calls[0]?.config?.params).toEqual({ content_days: 0 });

    calls.length = 0;
    await analysisClient.getSuggestion("action-1", { contentDays: 5 });
    expect(calls[0]?.config?.params).toEqual({ content_days: 5 });
  });

  it("should return a completed dispatch without polling at all", async () => {
    handler = () => ({ status: "completed", tasks: [{ sn: 1 }] });

    const result = await analysisClient.getSuggestion("action-1");

    expect(result.status).toBe("completed");
    expect(only("get")).toHaveLength(0);
  });

  it.each(["unnecessary", "unsupported"])(
    "should return the terminal %s state directly, without polling",
    async (status) => {
      handler = () => ({ status, reason: "already at target" });

      const result = await analysisClient.getSuggestion("action-1");

      expect(result.status).toBe(status);
      expect(calls).toHaveLength(1);
    },
  );
});

describe("analysisClient.pollGeneratedTasks", () => {
  it("should poll the read-only generated-tasks endpoint, never re-POST", async () => {
    const queue: unknown[] = [
      { status: "processing", task_id: "task-9" },
      { status: "completed", tasks: [{ sn: 1 }] },
    ];
    handler = () => queue.shift() ?? { status: "completed" };

    const result = await analysisClient.pollGeneratedTasks("action-1", "test", 1, 5000);

    expect(result.status).toBe("completed");
    expect(only("post")).toHaveLength(0);
    expect(new Set(calls.map((c) => c.url))).toEqual(new Set(["/action/action-1/generated-tasks"]));
  });

  it("should stop on a failed status rather than looping to the timeout", async () => {
    handler = () => ({ status: "failed", error: { message: "LLM returned garbage", terminal: true } });

    const result = await analysisClient.pollGeneratedTasks("action-1", "test", 1, 5000);

    expect(result.status).toBe("failed");
    expect(calls).toHaveLength(1);
  });

  it("should time out with an actionable message when generation never settles", async () => {
    handler = () => ({ status: "processing" });

    await expect(analysisClient.pollGeneratedTasks("action-1", "test", 1, 30)).rejects.toThrow(
      /did not finish within/,
    );
  });
});

describe("analysisClient.getReport", () => {
  it("should not send a section parameter the endpoint never accepted", async () => {
    handler = () => ({ id: "task-1", result: {} });

    await analysisClient.getReport("https://example.com");

    expect(calls[0]?.url).toContain("/task/product-latest-tasks/");
    expect(calls[0]?.config?.params).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// post-agent client
// ---------------------------------------------------------------------------

describe("postAgentClient.getDashboard", () => {
  it("should send a date window and never a period parameter", async () => {
    handler = () => ({});

    await postAgentClient.getDashboard({ startDate: "2026-09-01T00:00:00.000Z", endDate: "2026-09-03T00:00:00.000Z" });

    const params = calls[0]?.config?.params as Record<string, unknown>;
    expect(calls[0]?.url).toBe("/dashboard/summary");
    expect(params.startDate).toBe("2026-09-01T00:00:00.000Z");
    expect(params.endDate).toBe("2026-09-03T00:00:00.000Z");
    expect(params).not.toHaveProperty("period");
  });

  it("should join array filters into the comma form both DTOs accept", async () => {
    handler = () => ({});

    await postAgentClient.getDashboard({ channel: ["x", "reddit"], integrationId: ["i1", "i2"] });

    const params = calls[0]?.config?.params as Record<string, unknown>;
    expect(params.channel).toBe("x,reddit");
    expect(params.integrationId).toBe("i1,i2");
  });

  it("should omit empty filters entirely", async () => {
    handler = () => ({});

    await postAgentClient.getDashboard({ channel: [] });

    expect(calls[0]?.config?.params).toEqual({});
  });
});

describe("postAgentClient.createPost", () => {
  function handleCreate(response: unknown) {
    handler = (call) => (call.url === "/integrations/list" ? INTEGRATIONS : response);
  }

  it("should send type=now when neither draft nor schedule is given", async () => {
    handleCreate([{ postId: "p1", integration: "ch_x", state: "PUBLISHED" }]);

    await postAgentClient.createPost({ text: "Hello", channels: ["ch_x"] });

    const create = calls.find((c) => c.url === "/posts");
    expect((create?.body as any).type).toBe("now");
  });

  it("should send type=draft when asked, so the post can be committed later", async () => {
    handleCreate([{ postId: "p1", integration: "ch_x" }]);

    await postAgentClient.createPost({ text: "Hello", channels: ["ch_x"], draft: true });

    expect((calls.find((c) => c.url === "/posts")?.body as any).type).toBe("draft");
  });

  it("should send type=schedule when a time is given", async () => {
    handleCreate([{ postId: "p1", integration: "ch_x" }]);

    await postAgentClient.createPost({ text: "Hello", channels: ["ch_x"], schedule: "2026-12-01T10:00:00Z" });

    expect((calls.find((c) => c.url === "/posts")?.body as any).type).toBe("schedule");
  });

  it("should return the API rows verbatim rather than inventing a state", async () => {
    // A schedule/draft response carries no `state`; the old client filled in
    // "QUEUE"/"SENT", reporting posts as sent that had not been sent.
    handleCreate([{ postId: "p1", integration: "ch_x" }]);

    const result = await postAgentClient.createPost({ text: "Hello", channels: ["ch_x"], draft: true });

    expect(result).toEqual([{ postId: "p1", integration: "ch_x" }]);
    expect(result[0]).not.toHaveProperty("state");
  });

  it("should preserve the resolved publishMethod a now-post comes back with", async () => {
    handleCreate([{ postId: "p1", integration: "ch_x", state: "QUEUE", publishMethod: "EXTENSION" }]);

    const result = await postAgentClient.createPost({ text: "Hello", channels: ["ch_x"] });

    expect(result[0].state).toBe("QUEUE");
    expect(result[0].publishMethod).toBe("EXTENSION");
  });

  it("should attach the platform settings built for the channel's provider", async () => {
    handleCreate([{ postId: "p1", integration: "ch_x" }]);

    await postAgentClient.createPost({ text: "Hello", channels: ["ch_x"] });

    const post = (calls.find((c) => c.url === "/posts")?.body as any).posts[0];
    expect(post.settings).toEqual({ who_can_reply_post: "everyone" });
    expect(post.integration).toEqual({ id: "ch_x" });
  });
});

describe("postAgentClient.commitPosts", () => {
  it("should commit through /posts/schedule, not the retry route", async () => {
    handler = () => ({ scheduled: [{ id: "p1", publishMethod: "extension" }], failed: [] });

    const result = await postAgentClient.commitPosts([{ id: "p1" }]);

    expect(calls[0]?.url).toBe("/posts/schedule");
    expect(calls[0]?.body).toEqual({ posts: [{ id: "p1" }] });
    expect(result.scheduled[0]?.publishMethod).toBe("extension");
  });

  it("should pass an explicit publishMethod through", async () => {
    handler = () => ({ scheduled: [], failed: [] });

    await postAgentClient.commitPosts([{ id: "p1", publishMethod: "api" }]);

    expect(calls[0]?.body).toEqual({ posts: [{ id: "p1", publishMethod: "api" }] });
  });

  it("should surface per-item failures instead of throwing", async () => {
    handler = () => ({
      scheduled: [],
      failed: [{ id: "p1", code: "INVALID_STATE", message: "Cannot schedule a post in state ERROR" }],
    });

    const result = await postAgentClient.commitPosts([{ id: "p1" }]);

    expect(result.failed[0]?.code).toBe("INVALID_STATE");
  });
});

describe("postAgentClient.retryPost", () => {
  it("should hit the retry route", async () => {
    handler = () => ({ id: "p1" });

    await postAgentClient.retryPost("p1");

    expect(calls[0]).toMatchObject({ method: "post", url: "/posts/p1/retry" });
  });
});

