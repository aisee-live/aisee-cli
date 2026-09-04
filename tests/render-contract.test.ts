import { beforeEach, describe, expect, it } from "bun:test";
import { calls, callsFor, resetStub, setHandler, withFormat } from "./support/api-stub.ts";

/**
 * Render-layer tests: the module `execute` functions, not just the clients.
 *
 * The clients were covered from the start; the modules were not, which is how
 * `post pending` shipped reading `count`/`due`/`total` from an endpoint that
 * answers `{ dueNow, leased, scheduledAhead }` and therefore always printed 0.
 * A client test could not have caught that — the request was fine, the reading
 * of the response was not.
 */

const { postCreateModule, postPublishModule, postPendingModule, postDashboardModule } =
  await import("../src/modules/post/index.ts");
const { planPostsModule, planActivateModule } = await import("../src/modules/plan/index.ts");

const INTEGRATIONS = { integrations: [{ id: "ch_x", identifier: "x", name: "Brand X" }] };

beforeEach(resetStub);

describe("post pending", () => {
  it("should report the three counts the endpoint actually returns", async () => {
    setHandler(() => ({ dueNow: 3, leased: 1, scheduledAhead: 7 }));

    const out = await withFormat("table", () => postPendingModule.execute()) as string;

    expect(out).toContain("due_now");
    expect(out).toMatch(/due_now\s+3/);
    expect(out).toMatch(/leased\s+1/);
    expect(out).toMatch(/scheduled_ahead\s+7/);
  });

  it("should explain the browser dependency when anything is waiting", async () => {
    setHandler(() => ({ dueNow: 2, leased: 0, scheduledAhead: 0 }));

    const out = await withFormat("table", () => postPendingModule.execute()) as string;

    expect(out).toContain("signed-in Chrome");
  });

  it("should stay quiet when the queue is empty", async () => {
    setHandler(() => ({ dueNow: 0, leased: 0, scheduledAhead: 4 }));

    const out = await withFormat("table", () => postPendingModule.execute()) as string;

    expect(out).not.toContain("signed-in Chrome");
    expect(out).toMatch(/scheduled_ahead\s+4/);
  });

  it("should return the raw payload for machine formats", async () => {
    setHandler(() => ({ dueNow: 3, leased: 1, scheduledAhead: 7 }));

    const out = await withFormat("json", () => postPendingModule.execute());

    expect(out).toEqual({ dueNow: 3, leased: 1, scheduledAhead: 7 });
  });
});

describe("post dashboard", () => {
  it("should turn --period into a date window and never send period", async () => {
    setHandler(() => ({}));

    await withFormat("json", () => postDashboardModule.execute({ period: "7d" }));

    const params = calls[0]?.config?.params as Record<string, string>;
    expect(params).not.toHaveProperty("period");
    expect(params.startDate).toBeDefined();
    expect(params.endDate).toBeDefined();

    // 7d is seven whole days inclusive, so the window spans six day boundaries.
    const days = (Date.parse(params.endDate) - Date.parse(params.startDate)) / 86400000;
    expect(Math.round(days)).toBe(6);
  });

  it("should refuse a channel the DTO would reject, naming the valid values", async () => {
    setHandler(() => ({}));

    await expect(
      withFormat("json", () => postDashboardModule.execute({ period: "7d", channel: "myspace" })),
    ).rejects.toThrow(/Unknown channel\(s\): myspace/);
    expect(calls).toHaveLength(0);
  });
});

describe("post create", () => {
  function handleCreate(response: unknown) {
    setHandler((call) => (call.url === "/integrations/list" ? INTEGRATIONS : response));
  }

  it("should label a draft as DRAFT and say how to commit it", async () => {
    // The API returns no state for a draft; the old code invented one.
    handleCreate([{ postId: "p1", integration: "ch_x" }]);

    const out = await withFormat("table", () =>
      postCreateModule.execute({ text: "Hello", channel: "ch_x", draft: true })) as string;

    expect(out).toContain("DRAFT");
    expect(out).toContain("aisee post publish");
  });

  it("should surface the send path and the browser dependency for an extension post", async () => {
    handleCreate([{ postId: "p1", integration: "ch_x", state: "QUEUE", publishMethod: "EXTENSION" }]);

    const out = await withFormat("table", () =>
      postCreateModule.execute({ text: "Hello", channel: "ch_x", draft: false })) as string;

    expect(out).toContain("QUEUE");
    expect(out).toContain("EXTENSION");
    expect(out).toContain("signed-in Chrome");
  });

  it("should not claim a send path for an API-routed post", async () => {
    handleCreate([{ postId: "p1", integration: "ch_x", state: "PUBLISHED", publishMethod: "API" }]);

    const out = await withFormat("table", () =>
      postCreateModule.execute({ text: "Hello", channel: "ch_x", draft: false })) as string;

    expect(out).not.toContain("signed-in Chrome");
  });

  it("should reject --draft together with --schedule", async () => {
    await expect(
      withFormat("table", () =>
        postCreateModule.execute({ text: "Hi", channel: "ch_x", draft: true, schedule: "2026-12-01T10:00:00Z" })),
    ).rejects.toThrow(/mutually exclusive/);
  });
});

describe("post publish", () => {
  it("should report what was queued and on which send path", async () => {
    setHandler(() => ({ scheduled: [{ id: "p1", publishMethod: "extension" }], failed: [] }));

    const out = await withFormat("table", () =>
      postPublishModule.execute({ id: "p1", retry: false })) as string;

    expect(out).toContain("p1 queued via extension");
    expect(out).toContain("signed-in Chrome");
  });

  it("should explain INVALID_STATE by pointing at --retry", async () => {
    setHandler(() => ({
      scheduled: [],
      failed: [{ id: "p1", code: "INVALID_STATE", message: "Cannot schedule a post in state ERROR" }],
    }));

    await expect(
      withFormat("table", () => postPublishModule.execute({ id: "p1", retry: false })),
    ).rejects.toThrow(/--retry/);
  });

  it("should use the ERROR-only retry route when asked", async () => {
    setHandler(() => ({ id: "p1" }));

    await withFormat("json", () => postPublishModule.execute({ id: "p1", retry: true }));

    expect(calls[0]).toMatchObject({ method: "post", url: "/posts/p1/retry" });
  });
});

describe("plan posts", () => {
  it("should say there is no active plan instead of listing every plan's posts", async () => {
    setHandler((call) => {
      if (call.url.startsWith("/product/")) return { id: "prod-noplan" };
      if (call.url.endsWith("/operation-plans/active")) return { id: null };
      return { results: [], total: 0 };
    });

    const out = await withFormat("table", () =>
      planPostsModule.execute({ project: "https://noplan.test", all_plans: false, size: 20 })) as string;

    expect(out).toContain("No active plan");
    expect(out).toContain("--all-plans");
    // The whole point: it must not have widened the query to every plan.
    expect(callsFor("get").some((c) => c.url === "/posts/list")).toBe(false);
  });

  it("should list every plan's posts when --all-plans is given", async () => {
    setHandler((call) => {
      if (call.url.startsWith("/product/")) return { id: "prod-allplans" };
      return { results: [], total: 0, page: 1, totalPages: 1 };
    });

    await withFormat("json", () =>
      planPostsModule.execute({ project: "https://allplans.test", all_plans: true, size: 20 }));

    const list = calls.find((c) => c.url === "/posts/list");
    expect(list?.config?.params).toMatchObject({ hasOperationPlan: true });
    // No active-plan lookup is needed when the caller asked for all of them.
    expect(calls.some((c) => c.url.endsWith("/operation-plans/active"))).toBe(false);
  });
});

describe("plan activate", () => {
  it("should refuse to write an empty platform set, which would disable publishing", async () => {
    setHandler((call) => {
      if (call.url.startsWith("/product/")) return { id: "prod-empty" };
      if (call.url.endsWith("/automation")) return { publishing: { platforms: { x: { enabled: false } } } };
      return {};
    });

    await expect(
      withFormat("table", () => planActivateModule.execute({ project: "https://empty.test" })),
    ).rejects.toThrow(/Pass --platforms/);
    // Nothing may be written when the guard trips.
    expect(callsFor("post")).toHaveLength(0);
  });

  it("should echo the project's current set back when --platforms is omitted", async () => {
    setHandler((call) => {
      if (call.url.startsWith("/product/")) return { id: "prod-echo" };
      if (call.url.endsWith("/automation")) {
        return { publishing: { platforms: { x: { enabled: true }, reddit: { enabled: true }, medium: { enabled: false } } } };
      }
      return { saved: true, scheduled: { scheduled: [], failed: [] } };
    });

    await withFormat("json", () => planActivateModule.execute({ project: "https://echo.test" }));

    const save = calls.find((c) => c.url.endsWith("/automation/publishing"));
    expect((save?.body as any).platforms.sort()).toEqual(["reddit", "x"]);
    expect((save?.body as any).commit).toBe(true);
    expect(save?.body).not.toHaveProperty("windows");
  });

  it("should name the platforms an explicit set is about to switch off", async () => {
    setHandler((call) => {
      if (call.url.startsWith("/product/")) return { id: "prod-off" };
      if (call.url.endsWith("/automation")) {
        return { publishing: { platforms: { x: { enabled: true }, reddit: { enabled: true } } } };
      }
      return { saved: true, scheduled: { scheduled: [{ id: "p1", publishMethod: "api" }], failed: [] } };
    });

    const out = await withFormat("table", () =>
      planActivateModule.execute({ project: "https://off.test", platforms: "x" })) as string;

    expect(out).toContain("switched OFF");
    expect(out).toContain("reddit");
  });
});
