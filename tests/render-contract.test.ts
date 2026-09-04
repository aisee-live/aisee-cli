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

const { postCreateModule, postPublishModule, postPendingModule, postDashboardModule, channelSelectModule } =
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

/**
 * `channels select` is the only command that DELETES user data — it unbinds
 * channels in Postiz to match what the user passed. It also spans two stores
 * that can disagree, so every branch here is about not losing a binding by
 * accident.
 */
describe("channels select — reconciliation", () => {
  const CHANNELS = {
    integrations: [
      { id: "ch_x", identifier: "x", name: "Brand X", display: "Brand X" },
      { id: "ch_rd", identifier: "reddit", name: "Brand RD", display: "Brand RD" },
    ],
  };

  const BIND = "/integrations/integration-project";
  const LIST_BOUND = "/integrations/integration-project/list";

  function boom(status: number, message: string) {
    return () => {
      throw Object.assign(new Error(message), { response: { status, data: { message } } });
    };
  }

  /**
   * Exact-URL routing on purpose: `/integrations/integration-project` is a
   * prefix of `/integrations/integration-project/list`, so substring matching
   * silently makes a "bind fails" case fail the read as well.
   */
  function routes(overrides: Record<string, () => unknown> = {}) {
    return (call: { url: string; method: string }) => {
      const override = overrides[call.url];
      if (override) return override();
      if (call.url === "/integrations/list") return CHANNELS;
      if (call.url === LIST_BOUND) return { integrations: [] };
      if (call.url.startsWith("/product/config")) return { ok: true };
      if (call.url.startsWith("/product/")) return { id: "prod-1" };
      return {};
    };
  }

  it("should bind the additions, unbind the removals, and write the core list", async () => {
    setHandler(routes({ [LIST_BOUND]: () => ({ integrations: [{ id: "ch_rd" }] }) }));

    await withFormat("json", () =>
      channelSelectModule.execute({ url: "https://recon.test", channels: "ch_x" }));

    const bind = calls.find((c) => c.method === "post" && c.url === BIND);
    expect(bind?.body).toEqual({ integrationId: "ch_x", projectId: "prod-1" });

    // ch_rd was bound but is not in the new set, so it must be removed — an
    // upsert-only sync would leave it bound and still counted on the dashboard.
    const unbind = calls.find((c) => c.method === "delete");
    expect(unbind?.config?.params).toEqual({ integrationId: "ch_rd", projectId: "prod-1" });

    const core = calls.find((c) => c.url.startsWith("/product/config"));
    expect(core?.config?.params).toEqual({ product_id: "recon.test" });
  });

  it("should not unbind anything when the current bindings cannot be read", async () => {
    // Without the current set a safe diff is impossible; deleting on a guess
    // could drop a binding the user never asked to remove.
    setHandler(routes({ [LIST_BOUND]: boom(500, "upstream down") }));

    await expect(
      withFormat("json", () => channelSelectModule.execute({ url: "https://unreadable.test", channels: "ch_x" })),
    ).rejects.toThrow(/could not read existing bindings/);

    expect(callsFor("delete")).toHaveLength(0);
  });

  it("should still write the core list when a bind fails, and report the failure", async () => {
    setHandler(routes({ [BIND]: boom(409, "already bound elsewhere") }));

    await expect(
      withFormat("json", () => channelSelectModule.execute({ url: "https://partial.test", channels: "ch_x" })),
    ).rejects.toThrow(/already bound elsewhere/);

    // The read succeeded, so this really is a bind-only failure.
    expect(calls.some((c) => c.url === LIST_BOUND)).toBe(true);
    expect(calls.some((c) => c.method === "post" && c.url === BIND)).toBe(true);
    // A failed Postiz binding must not silently skip the aisee-core write.
    expect(calls.some((c) => c.url.startsWith("/product/config"))).toBe(true);
  });

  it("should report an unbind failure without losing the rest of the run", async () => {
    // Wrap the router so only the DELETE fails.
    const base = routes({ [LIST_BOUND]: () => ({ integrations: [{ id: "ch_rd" }] }) });
    setHandler((call) => {
      if (call.method === "delete") return boom(500, "unbind refused")();
      return base(call);
    });

    await expect(
      withFormat("json", () => channelSelectModule.execute({ url: "https://unbindfail.test", channels: "ch_x" })),
    ).rejects.toThrow(/unbind refused/);

    expect(calls.some((c) => c.url.startsWith("/product/config"))).toBe(true);
  });

  it("should refuse an unknown channel id before writing anything", async () => {
    setHandler(routes());

    await expect(
      withFormat("json", () => channelSelectModule.execute({ url: "https://unknown.test", channels: "ch_nope" })),
    ).rejects.toThrow(/Channel\(s\) not found: ch_nope/);

    expect(callsFor("post")).toHaveLength(0);
    expect(callsFor("delete")).toHaveLength(0);
  });

  it("should show both stores and flag a binding that exists in only one", async () => {
    setHandler((call) => {
      if (call.url === LIST_BOUND) return { integrations: [{ id: "ch_rd", providerIdentifier: "reddit" }] };
      if (call.url.startsWith("/product/")) {
        return { id: "prod-drift", config: { channels: [{ id: "ch_x", identifier: "x", display: "Brand X" }] } };
      }
      return {};
    });

    const out = await withFormat("table", () =>
      channelSelectModule.execute({ url: "https://drift.test" })) as string;

    expect(out).toContain("in_core");
    expect(out).toContain("in_postiz");
    expect(out).toContain("ch_x");
    expect(out).toContain("ch_rd");
    expect(out).toContain("bound on only one side");
  });
});
