import { analysisAxios } from "./http.ts";

export const analysisClient = {
  async scan(url: string, options: { platform?: string; rescan?: boolean } = {}) {
    const response = await analysisAxios.post(`/task/analyze-product`, {
      url,
      platforms: options.platform?.split(","),
      rescan: options.rescan
    });
    return response.data;
  },

  async getReport(url: string, options: { version?: string; section?: string } = {}) {
    const endpoint = options.section ? `/report/${url}/${options.section}` : `/report/${url}`;
    const response = await analysisAxios.get(endpoint, {
      params: { version: options.version }
    });
    return response.data;
  },

  async getActions(url: string, module?: string) {
    const response = await analysisAxios.get(`/product/actions/${url}`, {
      params: { module }
    });
    return response.data;
  },

  async getSuggestion(url: string, taskId: string) {
    const response = await analysisAxios.post(`/task/suggest`, {
      url,
      task_id: taskId
    });
    return response.data;
  },

  async convertToPost(url: string, taskId: string, channelId?: string) {
    const response = await analysisAxios.post(`/task/convert-to-post`, {
      url,
      task_id: taskId,
      channel_id: channelId
    });
    return response.data;
  },

  async getUserInfo(userId: string) {
    const response = await analysisAxios.get(`/user/${userId}`);
    return response.data;
  },
};
