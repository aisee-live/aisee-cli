import { describe, expect, it } from "bun:test";
import { buildPlatformSettings } from "../src/clients/post-agent.ts";
import { UserError } from "../src/utils/errors.ts";

const BODY = "Launching our new pricing page\n\nMore details in the post.";

describe("buildPlatformSettings — platforms whose DTO is empty or fully optional", () => {
  // KickDto and QuoraSettingsDto are empty classes; facebook/twitch/gmb have
  // only optional fields. Sending {} is correct, and adding CLI flags for them
  // would be inventing requirements the backend does not have.
  it.each(["facebook", "kick", "twitch", "quora", "gmb", "threads", "mastodon", "bluesky", "telegram", "nostr", "vk"])(
    "should send an empty settings object for %s",
    (platform) => {
      expect(buildPlatformSettings(platform, BODY)).toEqual({});
    },
  );
});

describe("buildPlatformSettings — required fields derived from the post body", () => {
  it("should derive a title for hackernews", () => {
    expect(buildPlatformSettings("hackernews", BODY)).toEqual({
      title: "Launching our new pricing page",
    });
  });

  it("should strip markdown heading markers when deriving a title", () => {
    expect(buildPlatformSettings("hackernews", "## Release 2.0\n\nbody")).toEqual({ title: "Release 2.0" });
  });

  it("should send a wordpress post type alongside the derived title", () => {
    expect(buildPlatformSettings("wordpress", BODY)).toEqual({
      title: "Launching our new pricing page",
      type: "post",
    });
  });

  it("should default devto tags to an empty array", () => {
    expect(buildPlatformSettings("devto", BODY)).toEqual({
      title: "Launching our new pricing page",
      tags: [],
    });
  });

  it("should prefer an explicit title over the derived one", () => {
    expect(buildPlatformSettings("dribbble", BODY, { title: "Custom" })).toEqual({ title: "Custom" });
  });
});

describe("buildPlatformSettings — required fields only the user can supply", () => {
  it("should refuse discord without a channel id instead of sending an empty string", () => {
    // DiscordDto.channel is @IsDefined @MinLength(1): "" is a 400.
    expect(() => buildPlatformSettings("discord", BODY)).toThrow(UserError);
    expect(() => buildPlatformSettings("discord", BODY)).toThrow(/--channel-target/);
  });

  it("should refuse slack without a channel id", () => {
    expect(() => buildPlatformSettings("slack", BODY)).toThrow(/--channel-target/);
  });

  it("should refuse pinterest without a board id", () => {
    expect(() => buildPlatformSettings("pinterest", BODY)).toThrow(/--board/);
  });

  it("should refuse reddit without a subreddit", () => {
    expect(() => buildPlatformSettings("reddit", BODY)).toThrow(/--subreddit/);
  });

  it("should accept a discord channel id", () => {
    expect(buildPlatformSettings("discord", BODY, { channelTarget: "123456" })).toEqual({ channel: "123456" });
  });

  it("should build the nested reddit submission shape", () => {
    expect(buildPlatformSettings("reddit", BODY, { subreddit: "SaaS" })).toEqual({
      subreddit: [
        {
          value: {
            subreddit: "SaaS",
            title: "Launching our new pricing page",
            type: "text",
            is_flair_required: false,
          },
        },
      ],
    });
  });

  it.each(["r/SaaS", "/r/SaaS"])("should normalize the %s prefix form", (input) => {
    const settings = buildPlatformSettings("reddit", BODY, { subreddit: input }) as any;
    expect(settings.subreddit[0].value.subreddit).toBe("SaaS");
  });

  it("should refuse hashnode without tags even when a publication is given", () => {
    // HashnodeSettingsDto.tags is @ArrayMinSize(1).
    expect(() => buildPlatformSettings("hashnode", BODY, { publication: "pub_1" })).toThrow(/--tags/);
  });

  it("should refuse hashnode when the derived title is under its 6-character minimum", () => {
    expect(() =>
      buildPlatformSettings("hashnode", "Hi\n\nbody", { publication: "pub_1", tags: ["saas"] }),
    ).toThrow(/at least 6 characters/);
  });

  it("should build hashnode settings when everything is supplied", () => {
    expect(buildPlatformSettings("hashnode", BODY, { publication: "pub_1", tags: ["saas", "pricing"] })).toEqual({
      title: "Launching our new pricing page",
      publication: "pub_1",
      tags: [
        { value: "saas", label: "saas" },
        { value: "pricing", label: "pricing" },
      ],
    });
  });

  it("should use the lemmy community id for posting and only a label for display", () => {
    // The provider posts with `+value.id`, so the id must survive verbatim.
    const settings = buildPlatformSettings("lemmy", BODY, { community: "42" }) as any;
    expect(settings.subreddit[0].value.id).toBe("42");
    expect(settings.subreddit[0].value.subreddit.length).toBeGreaterThanOrEqual(2);
  });

  it("should reuse the derived subject as the listmonk preview", () => {
    expect(buildPlatformSettings("listmonk", BODY, { list: "7" })).toEqual({
      subject: "Launching our new pricing page",
      preview: "Launching our new pricing page",
      list: "7",
    });
  });
});

describe("buildPlatformSettings — platforms that were already correct", () => {
  it("should keep the x reply setting", () => {
    expect(buildPlatformSettings("x", BODY)).toEqual({ who_can_reply_post: "everyone" });
  });

  it("should keep linkedin visibility", () => {
    expect(buildPlatformSettings("linkedin", BODY)).toEqual({ visibility: "PUBLIC" });
    expect(buildPlatformSettings("linkedin-page", BODY)).toEqual({ visibility: "PUBLIC" });
  });

  it("should clamp the youtube title to 100 characters", () => {
    const long = "y".repeat(150);
    const settings = buildPlatformSettings("youtube", long) as any;
    expect(settings.title).toHaveLength(100);
    expect(settings.type).toBe("public");
  });

  it("should send the full tiktok settings block", () => {
    expect(buildPlatformSettings("tiktok", BODY)).toMatchObject({
      privacy_level: "PUBLIC_TO_EVERYONE",
      content_posting_method: "DIRECT_POST",
      autoAddMusic: "no",
    });
  });
});

describe("buildPlatformSettings — wrapcast", () => {
  it("should refuse an empty farcaster channel rather than sending an empty array", () => {
    // FarcasterDto has no ArrayMinSize, so `{ subreddit: [] }` passes validation
    // and only fails later at publish time — the worst place to find out.
    expect(() => buildPlatformSettings("wrapcast", BODY)).toThrow(/--channel-target/);
  });

  it("should build the farcaster channel shape", () => {
    expect(buildPlatformSettings("wrapcast", BODY, { channelTarget: "aisee" })).toEqual({
      subreddit: [{ value: { id: "aisee" } }],
    });
  });
});
