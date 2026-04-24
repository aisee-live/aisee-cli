import { postAgentAxios } from "./http.ts";

export const postAgentClient = {
  // Posts
  async createPost(data: { text: string; channels: string[]; schedule?: string; media?: string[] }) {
    const response = await postAgentAxios.post(`/posts`, data);
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
