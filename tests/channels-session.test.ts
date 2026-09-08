import { beforeEach, describe, expect, it } from "bun:test";
import { resetStub, setHandler, withFormat } from "./support/api-stub.ts";

/**
 * `channels list` has to answer one question honestly: can this channel publish
 * right now?
 *
 * For 'extension' channels `connected` cannot answer it — that field tracks the
 * OAuth credential the 'api' send path uses, and an integration whose token is
 * stale publishes through the browser perfectly well. That mismatch is what
 * made a `connected: false` channel look unusable while it was in fact posting,
 * so these tests pin the field that does answer it.
 */

const { channelListModule } = await import("../src/modules/post/index.ts");
const { resetPublishMethodsCache } = await import("../src/clients/post-agent.ts");

const EXTENSION_METHODS = [
  { platform: "x", defaultMethod: "extension" },
  { platform: "quora", defaultMethod: "extension" },
  { platform: "linkedin", defaultMethod: "api" },
];

/** An hour ago — inside the server's staleness window. */
const RECENT = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function stubChannels(integrations: Record<string, unknown>[]): void {
  setHandler((call) => {
    if (call.url.includes("publish-methods")) return EXTENSION_METHODS;
    return { integrations };
  });
}

function channel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ch_1",
    identifier: "x",
    display: "aipartnerup",
    disabled: false,
    refreshNeeded: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetStub();
  // Module-level and shared across test files: without this, whichever file
  // fetched publish-methods first decides what send_path this module sees.
  resetPublishMethodsCache();
});

describe("channels list — extension session status", () => {
  it("should report matched when the browser is signed into this account", async () => {
    stubChannels([
      channel({
        activeSessionClient: "EXTENSION",
        extensionSessionCheckedAt: RECENT,
        extensionSessionStale: false,
      }),
    ]);
    const rows = (await withFormat("json", () => channelListModule.execute())) as any[];
    expect(rows[0].extension_session).toBe("matched");
  });

  it("should report not_matched when the platform was checked but another account is signed in", async () => {
    stubChannels([
      channel({
        activeSessionClient: "API",
        extensionSessionCheckedAt: RECENT,
        extensionSessionStale: false,
        extensionSessionHandle: "aiperceivable",
      }),
    ]);
    const rows = (await withFormat("json", () => channelListModule.execute())) as any[];
    expect(rows[0].extension_session).toBe("not_matched");
    expect(rows[0].browser_signed_in_as).toBe("aiperceivable");
  });

  it("should report unknown when the extension has never reported for this channel", async () => {
    stubChannels([channel({ activeSessionClient: "API", extensionSessionCheckedAt: null })]);
    const rows = (await withFormat("json", () => channelListModule.execute())) as any[];
    expect(rows[0].extension_session).toBe("unknown");
  });

  it("should report stale rather than matched when the last report has aged out", async () => {
    stubChannels([
      channel({
        activeSessionClient: "EXTENSION",
        extensionSessionCheckedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        extensionSessionStale: true,
      }),
    ]);
    const rows = (await withFormat("json", () => channelListModule.execute())) as any[];
    expect(rows[0].extension_session).toBe("stale");
  });

  it("should leave the status off api-routed channels, where a browser session is irrelevant", async () => {
    stubChannels([
      channel({
        id: "ch_li",
        identifier: "linkedin",
        activeSessionClient: "API",
        extensionSessionCheckedAt: RECENT,
      }),
    ]);
    const rows = (await withFormat("json", () => channelListModule.execute())) as any[];
    expect(rows[0].send_path).toBe("api");
    expect(rows[0]).not.toHaveProperty("extension_session");
  });

  it("should keep connected independent of the session status", async () => {
    // The exact case from the incident: OAuth credential stale, browser fine.
    stubChannels([
      channel({
        refreshNeeded: true,
        activeSessionClient: "EXTENSION",
        extensionSessionCheckedAt: RECENT,
        extensionSessionStale: false,
      }),
    ]);
    const rows = (await withFormat("json", () => channelListModule.execute())) as any[];
    expect(rows[0].connected).toBe(false);
    expect(rows[0].extension_session).toBe("matched");
  });
});

describe("channels list — notes", () => {
  it("should point the reader at extension_session instead of connected", async () => {
    stubChannels([channel({ activeSessionClient: "EXTENSION", extensionSessionCheckedAt: RECENT })]);
    const out = (await withFormat("table", () => channelListModule.execute())) as string;
    expect(out).toContain("extension_session");
  });

  it("should soften a not_matched verdict on quora, whose probe is unreliable", async () => {
    stubChannels([
      channel({
        id: "ch_q",
        identifier: "quora",
        activeSessionClient: "API",
        extensionSessionCheckedAt: RECENT,
        extensionSessionStale: false,
      }),
    ]);
    const out = (await withFormat("table", () => channelListModule.execute())) as string;
    expect(out).toContain("quora and devto");
  });

  it("should not raise the probe caveat when nothing on those platforms is unmatched", async () => {
    stubChannels([
      channel({
        activeSessionClient: "EXTENSION",
        extensionSessionCheckedAt: RECENT,
        extensionSessionStale: false,
      }),
    ]);
    const out = (await withFormat("table", () => channelListModule.execute())) as string;
    expect(out).not.toContain("quora and devto");
  });
});
