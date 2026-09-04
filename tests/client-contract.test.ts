import { beforeEach, describe, expect, it } from "bun:test";
import { calls, callsFor, rejectWith, resetStub, setHandler } from "./support/api-stub.ts";

/**
 * Contract tests for both API clients.
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

const { analysisClient } = await import("../src/clients/analysis.ts");
const { postAgentClient } = await import("../src/clients/post-agent.ts");
const { resolveProjectId, resolveOptionalProjectId, isProjectId } = await import("../src/utils/project.ts");

const INTEGRATIONS = { integrations: [{ id: "ch_x", identifier: "x", name: "Brand X" }] };

beforeEach(resetStub);

// ---------------------------------------------------------------------------
// analysis client
// ---------------------------------------------------------------------------

describe("analysisClient.getSuggestion", () => {
  it("should not send content_days when the caller does not ask for it", async () => {
    setHandler(() => ({ status: "completed", tasks: [] }));

    await analysisClient.getSuggestion("action-1");

    expect(calls[0]?.url).toBe("/action/action-1/generate-tasks");
    expect(calls[0]?.config).toBeUndefined();
  });

  it("should send content_days when explicitly requested, including zero", async () => {
    setHandler(() => ({ status: "completed", tasks: [] }));

    await analysisClient.getSuggestion("action-1", { contentDays: 0 });
    expect(calls[0]?.config?.params).toEqual({ content_days: 0 });

    calls.length = 0;
    await analysisClient.getSuggestion("action-1", { contentDays: 5 });
    expect(calls[0]?.config?.params).toEqual({ content_days: 5 });
  });

  it("should return a completed dispatch without polling at all", async () => {
    setHandler(() => ({ status: "completed", tasks: [{ sn: 1 }] }));

    const result = await analysisClient.getSuggestion("action-1");

    expect(result.status).toBe("completed");
    expect(callsFor("get")).toHaveLength(0);
  });

  it.each(["unnecessary", "unsupported"])(
    "should return the terminal %s state directly, without polling",
    async (status) => {
      setHandler(() => ({ status, reason: "already at target" }));

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
    setHandler(() => queue.shift() ?? { status: "completed" });

    const result = await analysisClient.pollGeneratedTasks("action-1", "test", 1, 5000);

    expect(result.status).toBe("completed");
    expect(callsFor("post")).toHaveLength(0);
    expect(new Set(calls.map((c) => c.url))).toEqual(new Set(["/action/action-1/generated-tasks"]));
  });

  it("should stop on a failed status rather than looping to the timeout", async () => {
    setHandler(() => ({ status: "failed", error: { message: "LLM returned garbage", terminal: true } }));

    const result = await analysisClient.pollGeneratedTasks("action-1", "test", 1, 5000);

    expect(result.status).toBe("failed");
    expect(calls).toHaveLength(1);
  });

  it("should time out with an actionable message when generation never settles", async () => {
    setHandler(() => ({ status: "processing" }));

    await expect(analysisClient.pollGeneratedTasks("action-1", "test", 1, 30)).rejects.toThrow(
      /did not finish within/,
    );
  });
});

describe("analysisClient.getReport", () => {
  it("should not send a section parameter the endpoint never accepted", async () => {
    setHandler(() => ({ id: "task-1", result: {} }));

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
    setHandler(() => ({}));

    await postAgentClient.getDashboard({ startDate: "2026-09-01T00:00:00.000Z", endDate: "2026-09-03T00:00:00.000Z" });

    const params = calls[0]?.config?.params as Record<string, unknown>;
    expect(calls[0]?.url).toBe("/dashboard/summary");
    expect(params.startDate).toBe("2026-09-01T00:00:00.000Z");
    expect(params.endDate).toBe("2026-09-03T00:00:00.000Z");
    expect(params).not.toHaveProperty("period");
  });

  it("should join array filters into the comma form both DTOs accept", async () => {
    setHandler(() => ({}));

    await postAgentClient.getDashboard({ channel: ["x", "reddit"], integrationId: ["i1", "i2"] });

    const params = calls[0]?.config?.params as Record<string, unknown>;
    expect(params.channel).toBe("x,reddit");
    expect(params.integrationId).toBe("i1,i2");
  });

  it("should omit empty filters entirely", async () => {
    setHandler(() => ({}));

    await postAgentClient.getDashboard({ channel: [] });

    expect(calls[0]?.config?.params).toEqual({});
  });
});

describe("postAgentClient.createPost", () => {
  function handleCreate(response: unknown) {
    setHandler((call) => (call.url === "/integrations/list" ? INTEGRATIONS : response));
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
    setHandler(() => ({ scheduled: [{ id: "p1", publishMethod: "extension" }], failed: [] }));

    const result = await postAgentClient.commitPosts([{ id: "p1" }]);

    expect(calls[0]?.url).toBe("/posts/schedule");
    expect(calls[0]?.body).toEqual({ posts: [{ id: "p1" }] });
    expect(result.scheduled[0]?.publishMethod).toBe("extension");
  });

  it("should pass an explicit publishMethod through", async () => {
    setHandler(() => ({ scheduled: [], failed: [] }));

    await postAgentClient.commitPosts([{ id: "p1", publishMethod: "api" }]);

    expect(calls[0]?.body).toEqual({ posts: [{ id: "p1", publishMethod: "api" }] });
  });

  it("should surface per-item failures instead of throwing", async () => {
    setHandler(() => ({
      scheduled: [],
      failed: [{ id: "p1", code: "INVALID_STATE", message: "Cannot schedule a post in state ERROR" }],
    }));

    const result = await postAgentClient.commitPosts([{ id: "p1" }]);

    expect(result.failed[0]?.code).toBe("INVALID_STATE");
  });
});

describe("postAgentClient.retryPost", () => {
  it("should hit the retry route", async () => {
    setHandler(() => ({ id: "p1" }));

    await postAgentClient.retryPost("p1");

    expect(calls[0]).toMatchObject({ method: "post", url: "/posts/p1/retry" });
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — project scoping, bindings, analyzer models
// ---------------------------------------------------------------------------

describe("postAgentClient.listPosts", () => {
  it("should send array filters in the comma form the DTO transform splits", async () => {
    setHandler(() => ({ results: [], total: 0 }));

    await postAgentClient.listPosts({ channel: ["x", "reddit"], source: ["calendar", "engage"] });

    const params = calls[0]?.config?.params as Record<string, unknown>;
    expect(params.channel).toBe("x,reddit");
    expect(params.source).toBe("calendar,engage");
  });

  it("should drop empty and undefined filters rather than sending blanks", async () => {
    setHandler(() => ({ results: [], total: 0 }));

    await postAgentClient.listPosts({ state: "DRAFT", channel: [], projectId: undefined });

    expect(calls[0]?.config?.params).toEqual({ state: "DRAFT", channel: undefined });
  });

  it("should pass project and plan scoping through", async () => {
    setHandler(() => ({ results: [], total: 0 }));

    await postAgentClient.listPosts({ projectId: "prod-1", operationPlanId: "plan-1", sortBy: "createdAt" });

    expect(calls[0]?.config?.params).toMatchObject({
      projectId: "prod-1",
      operationPlanId: "plan-1",
      sortBy: "createdAt",
    });
  });
});

describe("postAgentClient.getDashboard project scope", () => {
  it("should send projectId when given", async () => {
    setHandler(() => ({}));

    await postAgentClient.getDashboard({ projectId: "prod-1" });

    expect(calls[0]?.config?.params).toEqual({ projectId: "prod-1" });
  });
});

describe("postAgentClient.createPost — account-less platform targets", () => {
  it("should carry the platform in providerIdentifier with no integration", async () => {
    // Post.integrationId is nullable; such a post is published in-browser by
    // the extension, which resolves the platform from providerIdentifier.
    setHandler((call) => (call.url === "/integrations/list" ? INTEGRATIONS : [{ postId: "p1", integration: null }]));

    await postAgentClient.createPost({ text: "Hello", platforms: ["hackernews"] });

    const post = (calls.find((c) => c.url === "/posts")?.body as any).posts[0];
    expect(post.providerIdentifier).toBe("hackernews");
    expect(post.integration).toBeUndefined();
    expect(post.publishMethod).toBe("extension");
    expect(post.settings).toEqual({ title: "Hello" });
  });

  it("should not look up integrations when there are no bound channels", async () => {
    setHandler(() => [{ postId: "p1", integration: null }]);

    await postAgentClient.createPost({ text: "Hello", platforms: ["quora"] });

    expect(calls.find((c) => c.url === "/integrations/list")).toBeUndefined();
  });

  it("should refuse a post with no target at all", async () => {
    await expect(postAgentClient.createPost({ text: "Hello" })).rejects.toThrow(/at least one channel or platform/);
  });

  it("should send projectId when the caller resolved one", async () => {
    setHandler((call) => (call.url === "/integrations/list" ? INTEGRATIONS : [{ postId: "p1" }]));

    await postAgentClient.createPost({ text: "Hello", channels: ["ch_x"], projectId: "prod-1" });

    expect((calls.find((c) => c.url === "/posts")?.body as any).projectId).toBe("prod-1");
    expect((calls.find((c) => c.url === "/posts")?.body as any).source).toBe("calendar");
  });
});

describe("postAgentClient project bindings", () => {
  it("should list a project's bindings", async () => {
    setHandler(() => ({ integrations: [{ id: "ch_x" }] }));

    const rows = await postAgentClient.listProjectIntegrations("prod-1");

    expect(calls[0]?.url).toBe("/integrations/integration-project/list");
    expect(calls[0]?.config?.params).toEqual({ projectId: "prod-1" });
    expect(rows).toHaveLength(1);
  });

  it("should bind with a JSON body", async () => {
    setHandler(() => ({}));

    await postAgentClient.bindIntegrationToProject("ch_x", "prod-1");

    expect(calls[0]).toMatchObject({ method: "post", url: "/integrations/integration-project" });
    expect(calls[0]?.body).toEqual({ integrationId: "ch_x", projectId: "prod-1" });
  });

  it("should unbind with query params, not a body", async () => {
    // DELETE bodies are unreliable across proxies, so the route takes keys in
    // the query string.
    setHandler(() => ({ success: true }));

    await postAgentClient.unbindIntegrationFromProject("ch_x", "prod-1");

    expect(calls[0]).toMatchObject({ method: "delete", url: "/integrations/integration-project" });
    expect(calls[0]?.config?.params).toEqual({ integrationId: "ch_x", projectId: "prod-1" });
    expect(calls[0]?.body).toBeUndefined();
  });
});

describe("analysisClient.getAnalyzerModels", () => {
  it("should omit product_id when no product is given", async () => {
    setHandler(() => ({ ai_presence_analyzer: [] }));

    await analysisClient.getAnalyzerModels();

    expect(calls[0]?.url).toBe("/task/analyzer-models");
    expect(calls[0]?.config?.params).toBeUndefined();
  });

  it("should send product_id to also get the last run's models", async () => {
    setHandler(() => ({ ai_presence_analyzer: [], latest_task: null }));

    await analysisClient.getAnalyzerModels("example.com");

    expect(calls[0]?.config?.params).toEqual({ product_id: "example.com" });
  });
});

describe("analysisClient.scan model overrides", () => {
  it("should forward model_overrides to analyze-product", async () => {
    setHandler(() => ({ task_id: "t1", status: "processing" }));

    await analysisClient.scan("https://example.com", {
      model_overrides: { ai_presence_analyzer: ["openai/gpt-5.2"] },
    });

    expect((calls[0]?.body as any).model_overrides).toEqual({ ai_presence_analyzer: ["openai/gpt-5.2"] });
  });
});

// Kept last: getPublishMethods memoizes for the process, so a later test
// asking for it again would not see a request.
describe("postAgentClient.getPublishMethods", () => {
  it("should fetch once and reuse the org-level answer", async () => {
    setHandler(() => [{ platform: "x", extensionCapable: true, apiCapable: true, defaultMethod: "extension" }]);

    const first = await postAgentClient.getPublishMethods();
    const second = await postAgentClient.getPublishMethods();

    expect(first).toBe(second);
    expect(calls.filter((c) => c.url === "/posts/publish-methods")).toHaveLength(1);
  });
});

describe("resolveProjectId", () => {
  it("should return a UUID untouched, without a lookup", async () => {
    const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

    expect(await resolveProjectId(uuid)).toBe(uuid);
    expect(calls).toHaveLength(0);
  });

  it("should recognise a UUID regardless of case", () => {
    expect(isProjectId("3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe(true);
    expect(isProjectId("example.com")).toBe(false);
  });

  it("should look a domain up through the product endpoint, which accepts either form", async () => {
    setHandler(() => ({ id: "prod-uuid-1", url: "https://alpha.test" }));

    const id = await resolveProjectId("https://alpha.test");

    expect(id).toBe("prod-uuid-1");
    expect(calls[0]?.url).toBe("/product/alpha.test");
  });

  it("should memoize a resolved product for the process", async () => {
    setHandler(() => ({ id: "prod-uuid-2" }));

    await resolveProjectId("https://beta.test");
    const before = calls.length;
    await resolveProjectId("beta.test");

    expect(calls).toHaveLength(before);
  });

  it("should point at scan when the product does not exist yet", async () => {
    // A missing product is a real 404, which arrives as a rejection — not an
    // empty 200 body. Reading it as the latter left the advice unreachable and
    // surfaced a bare "[404] Product not found".
    setHandler(rejectWith(404, { success: false, error: "Product not found" }));

    await expect(resolveProjectId("https://missing.test")).rejects.toThrow(/aisee scan/);
  });

  it("should not swallow a non-404 failure as a missing product", async () => {
    setHandler(rejectWith(500, { success: false, error: "boom" }));

    await expect(resolveProjectId("https://broken.test")).rejects.toThrow(/boom/);
  });

  it("should send nothing when --project was not passed", async () => {
    expect(await resolveOptionalProjectId(undefined)).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — operation plans and automation
// ---------------------------------------------------------------------------

describe("postAgentClient.createOperationPlan", () => {
  it("should post the four required fields to the project-scoped route", async () => {
    setHandler(() => ({ id: "plan-1", status: "GENERATING" }));

    await postAgentClient.createOperationPlan("prod-1", {
      taskId: "task-1",
      startAt: "2026-10-01T00:00:00.000Z",
      endAt: "2026-10-07T00:00:00.000Z",
      platforms: ["x"],
    });

    expect(calls[0]?.url).toBe("/projects/prod-1/operation-plans");
    expect(calls[0]?.body).toMatchObject({ taskId: "task-1", platforms: ["x"] });
  });

  it("should not send a dryRun param on the real path", async () => {
    setHandler(() => ({ id: "plan-1", status: "GENERATING" }));

    await postAgentClient.createOperationPlan(
      "prod-1",
      { taskId: "t", startAt: "a", endAt: "b", platforms: ["x"] },
      false,
    );

    expect(calls[0]?.config?.params).toBeUndefined();
  });

  it("should send dryRun=true for a preview", async () => {
    setHandler(() => ({ id: null, status: "PREVIEW", dryRun: true }));

    const plan = await postAgentClient.createOperationPlan(
      "prod-1",
      { taskId: "t", startAt: "a", endAt: "b", platforms: ["x"] },
      true,
    );

    expect(calls[0]?.config?.params).toEqual({ dryRun: "true" });
    // A preview is never persisted, so there is no id to poll.
    expect(plan.id).toBeNull();
    expect(plan.status).toBe("PREVIEW");
  });
});

describe("postAgentClient.pollOperationPlan", () => {
  it("should keep polling through the non-terminal statuses", async () => {
    const queue = [
      { status: "GENERATING" },
      { status: "BILLING_PENDING" },
      { status: "READY", plan: { id: "plan-1" } },
    ];
    setHandler(() => queue.shift() ?? { status: "READY" });

    const plan = await postAgentClient.pollOperationPlan("plan-1", undefined, 1, 5000);

    expect(plan.status).toBe("READY");
    expect(calls).toHaveLength(3);
  });

  it.each(["FAILED", "BILLING_FAILED"])(
    "should stop on the terminal %s status, which never recovers on its own",
    async (status) => {
      setHandler(() => ({ status, errorCode: "GENERATION_FAILED", errorMessage: "boom" }));

      const plan = await postAgentClient.pollOperationPlan("plan-1", undefined, 1, 5000);

      expect(plan.status).toBe(status);
      expect(calls).toHaveLength(1);
    },
  );

  it("should time out pointing at plan status rather than hanging forever", async () => {
    setHandler(() => ({ status: "GENERATING" }));

    await expect(postAgentClient.pollOperationPlan("plan-1", undefined, 1, 30)).rejects.toThrow(
      /aisee plan status/,
    );
  });
});

describe("postAgentClient.getActivePlanId", () => {
  it("should return null when the project has no active plan", async () => {
    // The route answers { id: null } rather than 404 — a normal state.
    setHandler(() => ({ id: null }));

    expect(await postAgentClient.getActivePlanId("prod-1")).toBeNull();
    expect(calls[0]?.url).toBe("/projects/prod-1/operation-plans/active");
  });

  it("should return the id when there is one", async () => {
    setHandler(() => ({ id: "plan-9" }));

    expect(await postAgentClient.getActivePlanId("prod-1")).toBe("plan-9");
  });
});

describe("postAgentClient.saveAutomationPublishing", () => {
  it("should send the complete platform set and never a windows map", async () => {
    // `platforms` is the full enabled set, not a delta; a stored window
    // survives a save that does not mention it, so sending windows would risk
    // overwriting hours the CLI never asked about.
    setHandler(() => ({ saved: true, scheduled: { scheduled: [], failed: [] } }));

    await postAgentClient.saveAutomationPublishing("prod-1", { platforms: ["x", "reddit"], commit: true });

    expect(calls[0]?.url).toBe("/projects/prod-1/automation/publishing");
    expect(calls[0]?.body).toEqual({ platforms: ["x", "reddit"], commit: true });
    expect(calls[0]?.body).not.toHaveProperty("windows");
  });

  it("should pass an explicit publishMethod through for the committed batch", async () => {
    setHandler(() => ({ saved: true, scheduled: null }));

    await postAgentClient.saveAutomationPublishing("prod-1", {
      platforms: ["x"],
      commit: true,
      publishMethod: "extension",
    });

    expect(calls[0]?.body).toMatchObject({ publishMethod: "extension" });
  });
});

describe("analysisClient.getLatestTask", () => {
  it("should send the status filter and return the task", async () => {
    setHandler(() => ({ id: "task-7", version_name: "3.0", status: "completed" }));

    const task = await analysisClient.getLatestTask("https://example.com", "completed");

    expect(calls[0]?.url).toBe("/task/product-latest-tasks/example.com");
    expect(calls[0]?.config?.params).toEqual({ status: "completed" });
    expect(task?.id).toBe("task-7");
  });

  it("should return null for the endpoint's no-task answer instead of a truthy envelope", async () => {
    // It answers { success: false, message } rather than 404.
    setHandler(() => ({ success: false, message: "No task found for this product" }));

    expect(await analysisClient.getLatestTask("https://example.com", "completed")).toBeNull();
  });
});
