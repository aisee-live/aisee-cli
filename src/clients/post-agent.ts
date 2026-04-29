import { postAgentAxios } from "./http.ts";

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

export const postAgentClient = {
  // Posts
  async createPost(data: { text: string; channels: string[]; schedule?: string; media?: string[] }) {
    const group = generateId(10);
    const date = data.schedule ?? toLocalISOString(new Date());

    const payload = {
      type: data.schedule ? "schedule" : "now",
      tags: [] as string[],
      shortLink: false,
      date,
      posts: data.channels.map(channelId => ({
        integration: { id: channelId },
        group,
        settings: {
          active_thread_finisher: false,
          community: "",
          "plug--x-repost-post-users--delay": "0",
          "plug--x-repost-post-users--integrations": [] as string[],
          thread_finisher: "",
          who_can_reply_post: "everyone",
          quote_tweet_url: "",
          "plug--x-repost-post-users--active": false,
        },
        value: [
          {
            id: generateId(10),
            content: textToHtml(data.text),
            delay: 0,
            image: data.media ?? [],
          },
        ],
      })),
    };

    const response = await postAgentAxios.post(`/posts`, payload);
    return response.data;
  },

  async listPosts(filters: { state?: string; channel?: string[]; page?: number; pageSize?: number } = {}) {
    const response = await postAgentAxios.get(`/posts/list`, { params: filters });
    return response.data;
  },

  async getDashboard(period: string = "7d") {
    // Note: The new API uses /dashboard/summary for dashboard data
    const response = await postAgentAxios.get(`/dashboard/summary`, { params: { period } });
    return response.data;
  },

  async publishPost(postId: string) {
    // Postiz uses retry endpoint to trigger immediate publishing for failed or queued posts
    const response = await postAgentAxios.post(`/posts/${postId}/retry`);
    return response.data;
  },

  async schedulePost(postId: string, time: string) {
    // Rescheduling uses the /posts/{id}/date endpoint
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
  }
};
