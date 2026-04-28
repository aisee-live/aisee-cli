import { analysisAxios } from "./http.ts";

export interface TaskTreeNode {
  task: {
    id: string;
    name: string;
    status: string;
    has_children: boolean;
    result?: unknown;
    error?: string;
    [k: string]: unknown;
  };
  children: TaskTreeNode[];
}

export const analysisClient = {
  async scan(url: string, options: { platforms?: string[]; task_template_id?: string; stream?: boolean; use_demo?: boolean } = {}) {
    const response = await analysisAxios.post(`/task/analyze-product`, {
      product_id: url,
      platforms: options.platforms,
      task_template_id: options.task_template_id,
      stream: options.stream,
      use_demo: options.use_demo
    });
    return response.data;
  },

  async getTaskTree(taskId: string): Promise<TaskTreeNode> {
    const response = await analysisAxios.get(`/task/tree/${taskId}`);
    return response.data as TaskTreeNode;
  },

  async scanAndWait(
    url: string,
    options: { task_template_id?: string; stream?: boolean; use_demo?: boolean },
    onTree?: (tree: TaskTreeNode, frame: number) => void
  ): Promise<unknown> {
    const response = await analysisAxios.post(`/task/analyze-product`, {
      product_id: url,
      task_template_id: options.task_template_id,
      stream: options.stream,
      use_demo: options.use_demo
    });
    const data = response.data as { task_id?: string; status?: string };
    const taskId = data.task_id;

    if (!taskId || data.status === "completed" || data.status === "failed") {
      return data;
    }

    let frame = 0;
    const deadline = Date.now() + 600_000; // 10 min

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const tree = await analysisClient.getTaskTree(taskId);
      if (onTree) onTree(tree, frame++);

      if (tree.task.status === "completed") return tree.task.result;
      if (tree.task.status === "failed") throw new Error(`Scan failed: ${tree.task.error ?? "unknown"}`);
    }

    throw new Error("Scan timed out after 10 minutes");
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

  async pollUntilDone(taskId: string, label: string, intervalMs = 2000, timeoutMs = 120000): Promise<void> {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const isTTY = process.stderr.isTTY;
    let frame = 0;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await analysisAxios.get(`/task/detail/${taskId}`);
      const data = response.data as { status?: string };

      if (isTTY) {
        process.stderr.write(`\r${frames[frame % frames.length]} ${label}`);
        frame++;
      }

      if (data.status === "completed") {
        if (isTTY) process.stderr.write("\r" + " ".repeat(label.length + 4) + "\r");
        return;
      }
      if (data.status === "failed") {
        if (isTTY) process.stderr.write("\r" + " ".repeat(label.length + 4) + "\r");
        throw new Error(`Task failed`);
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    if (isTTY) process.stderr.write("\r" + " ".repeat(label.length + 4) + "\r");
    throw new Error(`Task ${taskId} did not complete within ${timeoutMs / 1000}s`);
  },

  async getSuggestion(actionId: string) {
    const response = await analysisAxios.post(`/action/${actionId}/generate-tasks`, null, {
      params: { content_days: 0 }
    });
    const data = response.data as { task_id?: string; status?: string };
    if (data.task_id && data.status !== "completed" && data.status !== "failed") {
      await analysisClient.pollUntilDone(data.task_id, "Generating suggestions...");
      const result = await analysisAxios.post(`/action/${actionId}/generate-tasks`, null, {
        params: { content_days: 0 }
      });
      return result.data;
    }
    return data;
  },

  async convertToPost(actionId: string, channelId?: string) {
    const response = await analysisAxios.post(`/action/${actionId}/generate-tasks`, null, {
      params: { content_days: 1, channel_id: channelId }
    });
    const data = response.data as { task_id?: string; status?: string };
    if (data.task_id && data.status !== "completed" && data.status !== "failed") {
      await analysisClient.pollUntilDone(data.task_id, "Generating post draft...");
      const result = await analysisAxios.post(`/action/${actionId}/generate-tasks`, null, {
        params: { content_days: 1, channel_id: channelId }
      });
      return result.data;
    }
    return data;
  },

  async getUserInfo(userId: string) {
    const response = await analysisAxios.get(`/user/${userId}`);
    return response.data;
  },
};
