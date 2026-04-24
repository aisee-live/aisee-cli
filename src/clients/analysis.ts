import { analysisAxios } from "./http.ts";

export const analysisClient = {
  async scan(url: string, options: { platforms?: string[]; task_template_id?: string; stream?: boolean; use_demo?: boolean } = {}) {
    // The backend handles both UUID and URL in the product_id field
    const response = await analysisAxios.post(`/task/analyze-product`, {
      product_id: url,
      platforms: options.platforms,
      task_template_id: options.task_template_id,
      stream: options.stream,
      use_demo: options.use_demo
    });
    return response.data;
  },

  async getPostList(options: { product_id?: string; user_id?: string; status?: string; business_type?: string; size?: number } = {}) {
    // Note: The orchestrator handles URL to product_id mapping if URL is passed
    const response = await analysisAxios.get(`/task`, {
      params: { ...options }
    });
    return response.data
  },

  async getReport(url: string, options: { version?: string; section?: string; user_id?: string } = {}) {
    // Note: The orchestrator handles URL to product_id mapping if URL is passed
    if (options?.version) {
      const response = await analysisAxios.get(`/task`, {
        params: {
          product_id: url,
          version_name: options.version,
          user_id: options.user_id
        }
      });
      if (response.data && response.data.items && response.data.items.length > 0) {
        return response.data.items[0];
      } else {
        return { success: false, error: `Version ${options.version} not found` };
      }
    } else {
      const response = await analysisAxios.get(`/task/product-latest-tasks/${url}`, {
        params: { section: options.section }
      });
      return response.data;
    }
  },

  async getActions(url: string, options: { module?: string; page?: number; size?: number; status?: string } = {}) {
    const response = await analysisAxios.get(`/action`, {
      params: {
        task_id: url, // Backend also handles URL mapping for task_id filter
        source_module: options.module,
        page: options.page,
        size: options.size,
        status: options.status
      }
    });
    return response.data;
  },

  async getSuggestion(actionId: string) {
    // Detailed implementation plans are generated via the generate-tasks endpoint
    const response = await analysisAxios.post(`/action/${actionId}/generate-tasks`, null, {
      params: { content_days: 0 }
    });
    return response.data;
  },

  async convertToPost(actionId: string, channelId?: string) {
    // Conversion to social post is handled by generate-tasks with content_days > 0
    const response = await analysisAxios.post(`/action/${actionId}/generate-tasks`, null, {
      params: { 
        content_days: 1,
        channel_id: channelId 
      }
    });
    return response.data;
  },

  async getUserInfo(userId: string) {
    const response = await analysisAxios.get(`/user/${userId}`);
    return response.data;
  },
};
