import { analysisAxios } from "./http.ts";
import { UserError } from "../utils/errors.ts";

function extractApiError(err: unknown): UserError {
  const e = err as { response?: { status?: number; data?: unknown } };
  const data = e.response?.data;
  let detail: string | undefined;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    detail = (d.detail ?? d.message ?? d.error) as string | undefined;
  }
  const status = e.response?.status;
  const prefix = status ? `[${status}] ` : "";
  return new UserError(`${prefix}${detail ?? String(err)}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cx = (p: Promise<any>): Promise<any> => p.catch((err: unknown): never => { throw extractApiError(err); });

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
  async scan(url: string, options: { stream?: boolean; use_demo?: boolean } = {}) {
    try {
      const response = await cx(analysisAxios.post(`/task/analyze-product`, {
        product_id: url,
        stream: options.stream,
        use_demo: options.use_demo
      }));
      return response.data;
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      const taskIdMatch = err.message.match(/uncompleted task ([0-9a-f-]{36})/);
      if (!taskIdMatch) throw err;

      const blockedTaskId = taskIdMatch[1];
      const treeResp = await cx(analysisAxios.get(`/task/tree/${blockedTaskId}`));
      const tree = treeResp.data as TaskTreeNode;
      if (tree.task.status !== "failed") throw err;

      const retryResp = await cx(analysisAxios.post(`/task/analyze-task`, {
        task_id: blockedTaskId,
        stream: options.stream,
      }));
      return retryResp.data;
    }
  },

  async getTaskTree(taskId: string): Promise<TaskTreeNode> {
    const response = await cx(analysisAxios.get(`/task/tree/${taskId}`));
    return response.data as TaskTreeNode;
  },

  async scanAndWait(
    url: string,
    options: { stream?: boolean; use_demo?: boolean },
    onTree?: (tree: TaskTreeNode, frame: number) => void
  ): Promise<unknown> {
    const data: any = await analysisClient.scan(url, options);
    const taskId = data.task_id;

    if (!taskId || data.status === "completed" || data.status === "failed") {
      return data;
    }

    let frame = 0;
    const deadline = Date.now() + 600_000;

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const tree = await analysisClient.getTaskTree(taskId);
      if (onTree) onTree(tree, frame++);

      if (tree.task.status === "completed") return tree.task.result;
      if (tree.task.status === "failed") throw new UserError(`Scan failed: ${tree.task.error ?? "unknown"}`);
    }

    throw new UserError("Scan timed out after 10 minutes");
  },

  async scanModule(url: string, module_code: string, options: { stream?: boolean; use_demo?: boolean } = {}) {
    const taskResponse = await cx(analysisAxios.get(`/task/product-latest-tasks/${url}`));
    if (!taskResponse.data) {
      throw new UserError(`Task not found: ${url}`);
    }
    if (taskResponse.data.status !== "completed") {
      throw new UserError(`Task is not completed: ${url}`);
    }

    const rootTaskId = taskResponse.data.id as string | undefined;
    if (!rootTaskId) {
      throw new UserError(`Task ID not found for: ${url}`);
    }

    const tree = await analysisClient.getTaskTree(rootTaskId);
    let task_id = "";
    for (const child of tree.children ?? []) {
      if (child.task.code === module_code) {
        task_id = child.task.id;
        break;
      }
    }

    if (!task_id) {
      throw new UserError(`Module '${module_code}' not found`);
    }

    const response = await cx(analysisAxios.post(`/task/analyze-task`, {
      task_id,
      stream: options.stream,
    }));
    return response.data;
  },

  async scanModuleAndWait(
    url: string,
    module_code: string,
    options: { stream?: boolean; use_demo?: boolean },
    onTree?: (tree: TaskTreeNode, frame: number) => void
  ): Promise<unknown> {
    const data: any = await analysisClient.scanModule(url, module_code, options);
    const taskId = data.task_id;

    if (!taskId || data.status === "completed" || data.status === "failed") {
      return data;
    }

    let frame = 0;
    const deadline = Date.now() + 600_000;

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const tree = await analysisClient.getTaskTree(taskId);
      if (onTree) onTree(tree, frame++);

      if (tree.task.status === "completed") return tree.task.result;
      if (tree.task.status === "failed") throw new UserError(`Scan failed: ${tree.task.error ?? "unknown"}`);
    }

    throw new UserError("Scan timed out after 10 minutes");
  },

  async getPostList(options: { product_id?: string; user_id?: string; status?: string; business_type?: string; page?: number; size?: number } = {}) {
    const response = await cx(analysisAxios.get(`/task`, {
      params: { ...options }
    }));
    return response.data;
  },

  async getReport(url: string, options: { version?: string; section?: string; user_id?: string } = {}) {
    if (options?.version) {
      const response = await cx(analysisAxios.get(`/task`, {
        params: {
          product_id: url,
          version_name: options.version,
          user_id: options.user_id
        }
      }));
      if (response.data?.items?.length > 0) {
        return response.data.items[0];
      }
      return { success: false, error: `Version ${options.version} not found` };
    } else {
      const response = await cx(analysisAxios.get(`/task/product-latest-tasks/${url}`, {
        params: { section: options.section }
      }));
      return response.data;
    }
  },

  async getActions(url: string, options: { module?: string; page?: number; size?: number; status?: string } = {}) {
    const response = await cx(analysisAxios.get(`/action`, {
      params: {
        task_id: url,
        source_module: options.module,
        page: options.page,
        size: options.size,
        status: options.status
      }
    }));
    return response.data;
  },

  async pollUntilDone(taskId: string, label: string, intervalMs = 2000, timeoutMs = 120000): Promise<void> {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const isTTY = process.stderr.isTTY;
    let frame = 0;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await cx(analysisAxios.get(`/task/detail/${taskId}`));
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
        throw new UserError(`Task failed`);
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    if (isTTY) process.stderr.write("\r" + " ".repeat(label.length + 4) + "\r");
    throw new UserError(`Task ${taskId} did not complete within ${timeoutMs / 1000}s`);
  },

  async getSuggestion(actionId: string) {
    const response = await cx(analysisAxios.post(`/action/${actionId}/generate-tasks`, null, {
      params: { content_days: 0 }
    }));
    const data = response.data as { task_id?: string; status?: string };
    if (data.task_id && data.status !== "completed" && data.status !== "failed") {
      await analysisClient.pollUntilDone(data.task_id, "Generating suggestions...");
      const result = await cx(analysisAxios.post(`/action/${actionId}/generate-tasks`, null, {
        params: { content_days: 0 }
      }));
      return result.data;
    }
    return data;
  },

  async convertToPost(actionId: string, channelId?: string) {
    const response = await cx(analysisAxios.post(`/action/${actionId}/generate-tasks`, null, {
      params: { content_days: 1, channel_id: channelId }
    }));
    const data = response.data as { task_id?: string; status?: string };
    if (data.task_id && data.status !== "completed" && data.status !== "failed") {
      await analysisClient.pollUntilDone(data.task_id, "Generating post draft...");
      const result = await cx(analysisAxios.post(`/action/${actionId}/generate-tasks`, null, {
        params: { content_days: 1, channel_id: channelId }
      }));
      return result.data;
    }
    return data;
  },

  async getUserInfo(userId: string) {
    const response = await cx(analysisAxios.get(`/user/${userId}`));
    return response.data;
  },
};
