import { postAgentAxios } from "./http.ts";

export const postAgentClient = {
  // Posts
  async createPost(data: { text: string; channels: string[]; schedule?: string; media?: string[] }) {
    const response = await postAgentAxios.post(`/posts`, data);
    return response.data;
  },

  async listPosts(filters: { status?: string; channel?: string; limit?: number } = {}) {
    const response = await postAgentAxios.get(`/posts`, { params: filters });
    return response.data;
  },

  async getDashboard(period: string = "7d") {
    const response = await postAgentAxios.get(`/dashboard`, { params: { period } });
    return response.data;
  },

  async publishPost(postId: string) {
    const response = await postAgentAxios.post(`/posts/${postId}/publish`);
    return response.data;
  },

  async schedulePost(postId: string, time: string) {
    const response = await postAgentAxios.post(`/posts/${postId}/schedule`, { time });
    return response.data;
  },

  // Channels
  async listChannels() {
    const response = await postAgentAxios.get(`/channels`);
    return response.data;
  },

  async removeChannel(id: string) {
    const response = await postAgentAxios.delete(`/channels/${id}`);
    return response.data;
  }
};
