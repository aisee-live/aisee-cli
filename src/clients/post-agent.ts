import { postAgentAxios } from "./http.ts";
import { authClient } from "./auth.ts";
import { cx } from "./api-error.ts";
import { loadCredentials, loadSettings, saveCredentials } from "../utils/config.ts";
import { isDebug } from "../utils/log-level.ts";
import { getFileBlob, basename } from "../utils/file-adapter.ts";
import { UserError } from "../utils/errors.ts";

function generateId(length = 10): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map(para => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function toLocalISOString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const tz = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${tz}`;
}

function normalizeScheduleDate(schedule: string): string {
  const normalized = schedule.includes("T") ? schedule : schedule.replace(" ", "T");
  const date = new Date(normalized);
  return isNaN(date.getTime()) ? schedule : toLocalISOString(date);
}

// Extracts the first non-empty line, stripping Markdown heading markers.
function extractTitle(text: string): string {
  const first = text.split("\n").find(l => l.trim().length > 0) ?? "";
  return first.replace(/^#+\s*/, "").trim().slice(0, 100) || "Post";
}

/**
 * Provider identifiers the posts-list and dashboard DTOs accept for `channel`
 * (`@IsIn(VALID_CHANNELS, { each: true })`). Mirrors
 * libraries/nestjs-libraries/src/dtos/posts/get.posts-list.dto.ts — an
 * unlisted value is a 400, so the CLI validates locally for a better message.
 */
export const VALID_CHANNELS = [
  "x", "reddit", "linkedin", "linkedin-page", "instagram",
  "instagram-standalone", "facebook", "youtube", "tiktok",
  "pinterest", "threads", "mastodon", "bluesky", "medium",
  "devto", "hashnode", "wordpress", "discord", "slack",
  "telegram", "dribbble", "kick", "twitch", "lemmy",
  "listmonk", "gmb", "wrapcast", "nostr", "vk", "quora", "hackernews",
] as const;

/**
 * Per-platform values the CLI cannot derive from the post body — a subreddit,
 * a Discord channel id, a Hashnode publication. Each maps to a `post create`
 * flag; a platform that needs one and does not get it is refused up front
 * rather than sent as an empty string (which the backend DTOs reject).
 */
export interface PlatformOptions {
  /** Overrides the title derived from the first line of the post body. */
  title?: string;
  /** reddit: target subreddit (with or without `r/`). */
  subreddit?: string;
  /** pinterest: board id. */
  board?: string;
  /** discord / slack / wrapcast: target channel id. */
  channelTarget?: string;
  /** hashnode: publication id. */
  publication?: string;
  /** listmonk: mailing-list id. */
  list?: string;
  /** lemmy: numeric community id (the provider posts with `+value.id`). */
  community?: string;
  /** hashnode / devto / youtube: tag labels. */
  tags?: string[];
}

function requireOption(value: string | undefined, platform: string, flag: string, what: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new UserError(
      `Posting to '${platform}' requires ${what}. Pass ${flag}.`,
    );
  }
  return trimmed;
}

function requireTitle(text: string, options: PlatformOptions, platform: string, minLength: number): string {
  const title = (options.title ?? extractTitle(text)).trim();
  if (title.length < minLength) {
    throw new UserError(
      `Posting to '${platform}' requires a title of at least ${minLength} characters ` +
      `(derived "${title}"). Pass --title.`,
    );
  }
  return title;
}

function toTagObjects(tags: string[]): Array<{ value: string; label: string }> {
  return tags.map((tag) => ({ value: tag, label: tag }));
}

/**
 * Build the `settings` object for one platform.
 *
 * The server re-derives `settings.__type` from the bound account in
 * `mapTypeToPost`, so only the platform's own fields belong here. Platforms
 * absent from the switch validate fine with `{}` — either their DTO is empty
 * (kick, quora) or every field is optional (facebook, twitch, gmb, threads,
 * mastodon, bluesky, telegram, nostr, vk).
 */
export function buildPlatformSettings(
  platform: string,
  text?: string,
  options: PlatformOptions = {},
): Record<string, unknown> {
  const body = text ?? "";

  switch (platform) {
    // --- required field, derived from the post body -------------------------
    case "dribbble":
      return { title: requireTitle(body, options, platform, 1) };
    case "hackernews":
      return { title: requireTitle(body, options, platform, 2) };
    case "wordpress":
      return { title: requireTitle(body, options, platform, 2), type: "post" };
    case "devto":
      return {
        title: requireTitle(body, options, platform, 2),
        tags: options.tags ? toTagObjects(options.tags.slice(0, 4)) : [],
      };

    // --- required field only the user can supply ----------------------------
    case "discord":
    case "slack":
      return {
        channel: requireOption(options.channelTarget, platform, "--channel-target <id>", "a channel id"),
      };
    case "pinterest":
      return { board: requireOption(options.board, platform, "--board <id>", "a board id") };
    case "reddit": {
      const subreddit = requireOption(options.subreddit, platform, "--subreddit <name>", "a subreddit")
        .replace(/^\/?r\//, "");
      return {
        subreddit: [
          {
            value: {
              subreddit,
              title: requireTitle(body, options, platform, 2),
              type: "text",
              is_flair_required: false,
            },
          },
        ],
      };
    }
    case "lemmy": {
      const id = requireOption(options.community, platform, "--community <id>", "a numeric community id");
      return {
        subreddit: [
          {
            value: {
              // Display label only — the provider posts with `+value.id`.
              subreddit: `community/${id}`,
              id,
              title: requireTitle(body, options, platform, 2),
            },
          },
        ],
      };
    }
    case "hashnode": {
      if (!options.tags?.length) {
        throw new UserError(`Posting to '${platform}' requires at least one tag. Pass --tags <a,b>.`);
      }
      return {
        title: requireTitle(body, options, platform, 6),
        publication: requireOption(options.publication, platform, "--publication <id>", "a publication id"),
        tags: toTagObjects(options.tags),
      };
    }
    case "listmonk": {
      const subject = requireTitle(body, options, platform, 1);
      return {
        subject,
        preview: subject,
        list: requireOption(options.list, platform, "--list <id>", "a mailing-list id"),
      };
    }

    // --- validates with an empty array, but publishes nowhere ---------------
    case "wrapcast":
      return {
        subreddit: [
          {
            value: {
              id: requireOption(options.channelTarget, platform, "--channel-target <id>", "a Farcaster channel id"),
            },
          },
        ],
      };

    // --- already correct ----------------------------------------------------
    case "x":
      return { who_can_reply_post: "everyone" };
    case "linkedin":
    case "linkedin-page":
      return { visibility: "PUBLIC" };
    case "instagram":
    case "instagram-standalone":
      return { post_type: "post", collaborators: [] };
    case "youtube":
      return {
        title: requireTitle(body, options, platform, 2).slice(0, 100),
        type: "public",
        tags: options.tags ? toTagObjects(options.tags) : [],
      };
    case "medium":
      return {
        title: requireTitle(body, options, platform, 2),
        tags: options.tags ? toTagObjects(options.tags.slice(0, 4)) : [],
      };
    case "tiktok":
      return {
        privacy_level: "PUBLIC_TO_EVERYONE",
        duet: false,
        stitch: false,
        comment: true,
        autoAddMusic: "no",
        brand_content_toggle: false,
        brand_organic_toggle: false,
        content_posting_method: "DIRECT_POST",
      };

    // Platforms whose DTO is empty or entirely optional.
    default:
      return {};
  }
}

async function lookupChannelPlatform(channelId: string): Promise<string> {
  const response = await cx(postAgentAxios.get("/integrations/list"));
  const integrations: any[] = response.data?.integrations ?? [];
  const match = integrations.find((ch: any) => ch.id === channelId);
  return match?.identifier ?? "";
}

export type MediaObject = { id: string; path: string };

/** Resolved send path for one post, as reported by the backend. */
export type PublishMethod = "extension" | "api";

export interface CreatedPost {
  postId: string;
  integration: string | null;
  /** Present for `now` posts only — the API returns no state for drafts/schedules. */
  state?: string;
  releaseURL?: string | null;
  /** Present for `now` posts — `EXTENSION` means the browser must publish it. */
  publishMethod?: string | null;
  [k: string]: unknown;
}

export interface ScheduleResult {
  scheduled: Array<{ id: string; publishMethod: PublishMethod | null }>;
  failed: Array<{ id: string; code: string; message: string }>;
}

export interface PublishMethodInfo {
  platform?: string;
  identifier?: string;
  selectable?: string[];
  default?: string;
  requiresAccount?: boolean;
  [k: string]: unknown;
}

let publishMethodsCache: PublishMethodInfo[] | null = null;

export const postAgentClient = {
  // Posts
  async createPost(data: {
    text: string;
    channels: string[];
    schedule?: string;
    /** Create as DRAFT so it can later be committed via `commitPosts`. */
    draft?: boolean;
    media?: MediaObject[];
    platformOptions?: PlatformOptions;
    publishMethod?: PublishMethod;
    projectId?: string;
  }): Promise<CreatedPost[]> {
    const group = generateId(10);
    const date = data.schedule ? normalizeScheduleDate(data.schedule) : toLocalISOString(new Date());
    const posts = await Promise.all(
      data.channels.map(async (channelId) => {
        const platform = await lookupChannelPlatform(channelId);
        const settings = buildPlatformSettings(platform, data.text, data.platformOptions ?? {});
        return {
          integration: { id: channelId },
          group,
          settings,
          ...(data.publishMethod ? { publishMethod: data.publishMethod } : {}),
          value: [
            {
              id: generateId(10),
              content: textToHtml(data.text),
              delay: 0,
              image: data.media ?? [],
            },
          ],
        };
      })
    );

    const type = data.draft ? "draft" : data.schedule ? "schedule" : "now";
    const payload = {
      type,
      tags: [] as string[],
      shortLink: false,
      source: "calendar",
      ...(data.projectId ? { projectId: data.projectId } : {}),
      date,
      posts,
    };

    const response = await cx(postAgentAxios.post(`/posts`, payload));
    if (isDebug()) {
      console.error("[DEBUG] createPost payload:", JSON.stringify(payload, null, 2));
      console.error("[DEBUG] createPost response:", JSON.stringify(response.data, null, 2));
    }
    // Returned verbatim. A `now` post carries the real DB state plus the
    // resolved publishMethod; a draft/schedule carries no state at all, and
    // inventing one here hid the fact that nothing had been sent.
    return (Array.isArray(response.data) ? response.data : [response.data]) as CreatedPost[];
  },

  /**
   * Commit DRAFT posts to the send queue (DRAFT -> QUEUE).
   *
   * This is the real "publish" entry point: it resolves and stamps each post's
   * send path, starts the Temporal workflow for API posts, and leaves extension
   * posts in QUEUE for the extension's publish-due loop. A post already in
   * QUEUE/PUBLISHED is an idempotent no-op success; anything else (i.e. ERROR)
   * comes back in `failed` with code INVALID_STATE.
   */
  async commitPosts(
    items: Array<{ id: string; publishMethod?: PublishMethod; date?: string }>,
  ): Promise<ScheduleResult> {
    const response = await cx(postAgentAxios.post(`/posts/schedule`, { posts: items }));
    return response.data as ScheduleResult;
  },

  /** Retry a post the backend already tried and failed. ERROR state only. */
  async retryPost(postId: string) {
    const response = await cx(postAgentAxios.post(`/posts/${postId}/retry`));
    return response.data;
  },

  /**
   * Resolved send path per platform for this organization.
   *
   * Org-level state the backend tells clients to fetch once and cache — it is
   * the only correct source, since the extension allowlist and the "is an
   * account bound?" half are both server-side.
   */
  async getPublishMethods(): Promise<PublishMethodInfo[]> {
    if (publishMethodsCache) return publishMethodsCache;
    const response = await cx(postAgentAxios.get(`/posts/publish-methods`));
    const data = response.data;
    publishMethodsCache = (Array.isArray(data) ? data : data?.methods ?? []) as PublishMethodInfo[];
    return publishMethodsCache;
  },

  /** Org-wide count of QUEUE posts waiting for the browser extension. */
  async countPublishDue() {
    const response = await cx(postAgentAxios.get(`/posts/publish-due/count`));
    return response.data;
  },

  async uploadMedia(filePath: string): Promise<MediaObject> {
    const [settings, creds] = await Promise.all([loadSettings(), loadCredentials()]);

    const doUpload = async (token: string | undefined) => {
      const formData = new FormData();
      // getFileBlob returns a Blob-like object (BunFile in Bun, Blob in Node)
      formData.append("file", await getFileBlob(filePath), basename(filePath));
      return fetch(`${settings.postAgentApiUrl}/media/upload-simple`, {
        method: "POST",
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    };

    let response = await doUpload(creds?.accessToken);

    if (response.status === 401 && creds?.refreshToken) {
      const refreshed = await authClient.getAccessToken(creds.refreshToken);
      await saveCredentials({ ...creds, accessToken: refreshed.access_token });
      response = await doUpload(refreshed.access_token);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Media upload failed: ${response.status} ${body}`);
    }
    const data = await response.json() as any;
    return { id: data.id, path: data.path };
  },

  async listPosts(filters: { state?: string; channel?: string[]; page?: number; pageSize?: number } = {}) {
    const response = await cx(postAgentAxios.get(`/posts/list`, { params: filters }));
    return response.data;
  },

  /**
   * Dashboard summary for a date window.
   *
   * The API has no `period` parameter — it takes `startDate`/`endDate` (parsed
   * to the request timezone, then widened to whole days server-side). Sending
   * `period` did nothing at all.
   */
  async getDashboard(
    options: {
      startDate?: string;
      endDate?: string;
      channel?: string[];
      integrationId?: string[];
    } = {},
  ) {
    const params: Record<string, unknown> = {};
    if (options.startDate) params.startDate = options.startDate;
    if (options.endDate) params.endDate = options.endDate;
    if (options.channel?.length) params.channel = options.channel.join(",");
    if (options.integrationId?.length) params.integrationId = options.integrationId.join(",");

    const response = await cx(postAgentAxios.get(`/dashboard/summary`, { params }));
    return response.data;
  },

  async schedulePost(postId: string, time: string) {
    const response = await cx(postAgentAxios.put(`/posts/${postId}/date`, { date: time }));
    return response.data;
  },

  // Channels
  async listChannels() {
    const response = await cx(postAgentAxios.get(`/integrations/list`));
    return response.data;
  },

  async removeChannel(id: string) {
    const response = await cx(postAgentAxios.delete(`/integrations`, { data: { id } }));
    return response.data;
  },
};
