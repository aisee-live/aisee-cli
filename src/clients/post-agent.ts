import { postAgentAxios } from "./http.ts";
import { authClient } from "./auth.ts";
import { loadCredentials, loadSettings, saveCredentials } from "../utils/config.ts";
import { basename } from "node:path";

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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

function buildPlatformSettings(platform: string, text?: string): Record<string, unknown> {
  const title = text ? extractTitle(text) : "Post";

  switch (platform) {
    case "x":
      return { who_can_reply_post: "everyone" };
    case "linkedin":
    case "linkedin-page":
      return { visibility: "PUBLIC" };
    case "instagram":
    case "instagram-standalone":
      return { post_type: "post", collaborators: [] };
    case "youtube":
      return { title: title.length >= 2 ? title : "Post", type: "public", tags: [] };
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
    case "discord":
      return { channel: "" };
    case "slack":
      return { channel: "" };
    case "reddit":
      return {
        subreddit: [
          { value: { subreddit: "", title, type: "text", is_flair_required: false } },
        ],
      };
    case "medium":
      return { title, subtitle: "", tags: [] };
    case "pinterest":
      return { board: "" };
    case "wrapcast":
      return { subreddit: [] };
    // Platforms with no required settings: threads, mastodon, bluesky, telegram, nostr, vk, facebook
    default:
      return {};
  }
}

async function lookupChannelPlatform(channelId: string): Promise<string> {
  const response = await postAgentAxios.get("/integrations/list");
  const integrations: any[] = response.data?.integrations ?? [];
  const match = integrations.find((ch: any) => ch.id === channelId);
  return match?.identifier ?? "";
}

export type MediaObject = { id: string; path: string };

export const postAgentClient = {
  // Posts
  async createPost(data: {
    text: string;
    channels: string[];
    schedule?: string;
    media?: MediaObject[];
  }) {
    const group = generateId(10);
    const date = data.schedule ? normalizeScheduleDate(data.schedule) : toLocalISOString(new Date());

    const posts = await Promise.all(
      data.channels.map(async (channelId) => {
        const platform = await lookupChannelPlatform(channelId);
        const settings = buildPlatformSettings(platform, data.text);
        return {
          integration: { id: channelId },
          group,
          settings,
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

    const payload = {
      type: data.schedule ? "schedule" : "now",
      tags: [] as string[],
      shortLink: false,
      date,
      posts,
    };

    const response = await postAgentAxios.post(`/posts`, payload);
    return response.data;
  },

  async uploadMedia(filePath: string): Promise<MediaObject> {
    const [settings, creds] = await Promise.all([loadSettings(), loadCredentials()]);

    const doUpload = (token: string | undefined) => {
      const formData = new FormData();
      // Bun.file returns a BunFile (Blob subclass) — avoids the Buffer→Blob
      // conversion that breaks axios multipart serialization in Bun runtime.
      formData.append("file", Bun.file(filePath), basename(filePath));
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
    const response = await postAgentAxios.get(`/posts/list`, { params: filters });
    return response.data;
  },

  async getDashboard(period: string = "7d") {
    const response = await postAgentAxios.get(`/dashboard/summary`, { params: { period } });
    return response.data;
  },

  async publishPost(postId: string) {
    const response = await postAgentAxios.post(`/posts/${postId}/retry`);
    return response.data;
  },

  async schedulePost(postId: string, time: string) {
    const response = await postAgentAxios.put(`/posts/${postId}/date`, { date: time });
    return response.data;
  },

  // Channels
  async listChannels() {
    const response = await postAgentAxios.get(`/integrations/list`);
    return response.data;
  },

  async removeChannel(id: string) {
    const response = await postAgentAxios.delete(`/integrations`, { data: { id } });
    return response.data;
  },
};
