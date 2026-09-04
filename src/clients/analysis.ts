import { analysisAxios } from "./http.ts";
import { UserError } from "../utils/errors.ts";
import { cx } from "./api-error.ts";
import { getDomain } from "../utils/url.ts";

/**
 * Terminal + in-flight states of `POST /action/{id}/generate-tasks` and
 * `GET /action/{id}/generated-tasks`. `unnecessary` and `unsupported` are
 * successful pre-flight outcomes; only `failed` is an error.
 */
export type SuggestionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "unnecessary"
  | "unsupported"
  | "failed";

export interface SuggestionResult {
  status: SuggestionStatus;
  task_id?: string;
  tasks?: unknown[];
  reason?: string;
  message?: string;
  error?: { kind?: string; message?: string; terminal?: boolean; failed_at?: string };
  [k: string]: unknown;
}

/**
 * Per-run analyzer model override applied to the analysis tree.
 * Mirrors `AnalyzerModelOverride` in aisee_orchestrator/models/product.py —
 * an omitted group keeps the subscription template's models.
 */
export interface AnalyzerModelOverride {
  ai_presence_analyzer?: string[];
  ai_competitor_analyzer?: string[];
}

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
  /**
   * Analyzer models available under the caller's subscription template.
   *
   * With a product reference the response also carries `latest_task`: the
   * models that product's most recent analysis actually ran with, which differ
   * from the template whenever that run used `model_overrides`.
   */
  async getAnalyzerModels(productId?: string) {
    const response = await cx(analysisAxios.get(`/task/analyzer-models`, {
      params: productId ? { product_id: productId } : undefined,
    }));
    return response.data;
  },

  async scan(
    url: string,
    options: { stream?: boolean; use_demo?: boolean; model_overrides?: AnalyzerModelOverride } = {},
  ) {
    try {
      const response = await cx(analysisAxios.post(`/task/analyze-product`, {
        product_id: url,
        stream: options.stream,
        use_demo: options.use_demo,
        model_overrides: options.model_overrides,
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
        model_overrides: options.model_overrides,
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
    options: { stream?: boolean; use_demo?: boolean; model_overrides?: AnalyzerModelOverride },
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

  async scanModule(
    url: string,
    module_code: string,
    options: { stream?: boolean; use_demo?: boolean; model_overrides?: AnalyzerModelOverride } = {},
  ) {
    const productId = getDomain(url);
    const taskResponse = await cx(analysisAxios.get(`/task/product-latest-tasks/${encodeURIComponent(productId)}`));
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
      model_overrides: options.model_overrides,
    }));
    return response.data;
  },

  async scanModuleAndWait(
    url: string,
    module_code: string,
    options: { stream?: boolean; use_demo?: boolean; model_overrides?: AnalyzerModelOverride },
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

  async getReport(url: string, options: { version?: string; user_id?: string } = {}) {
    const productId = getDomain(url);
    if (options?.version) {
      const response = await cx(analysisAxios.get(`/task`, {
        params: {
          product_id: productId,
          version_name: options.version,
          user_id: options.user_id
        }
      }));
      if (response.data?.items?.length > 0) {
        return response.data.items[0];
      }
      return { success: false, error: `Version ${options.version} not found` };
    } else {
      // `product-latest-tasks` accepts only `status`; report sections are a
      // client-side view over the returned result, not a server-side filter.
      const response = await cx(analysisAxios.get(`/task/product-latest-tasks/${encodeURIComponent(productId)}`));
      return response.data;
    }
  },

  async getActions(url: string, options: { module?: string; has_solution?: boolean; page?: number; size?: number; status?: string } = {}) {
    const productId = getDomain(url);
    const response = await cx(analysisAxios.get(`/action`, {
      params: {
        task_id: productId,
        source_module: options.module,
        has_solution: options.has_solution,
        page: options.page ?? 1,
        size: options.size ?? 100,
        status: options.status
      }
    }));
    return response.data;
  },

  async getActionsByTaskId(taskId: string) {
    const response = await cx(analysisAxios.get(`/action`, {
      params: {
        task_id: taskId,
        size: 1000
      }
    }));
    const result = response.data;
    if (!result?.items || result.items.length <= 0) {
      return [];
    }
    return result.items;
  },

  /**
   * Poll the read-only generation endpoint until the action reaches a terminal
   * status.
   *
   * `GET /action/{id}/generated-tasks` acquires no row lock, never dispatches
   * and never charges — unlike re-POSTing `generate-tasks`, which is what this
   * client used to do while polling `/task/detail/{id}`.
   */
  async pollGeneratedTasks(
    actionId: string,
    label = "Generating suggestions...",
    intervalMs = 2000,
    timeoutMs = 180000,
  ): Promise<SuggestionResult> {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const isTTY = process.stderr.isTTY;
    const clear = () => {
      if (isTTY) process.stderr.write("\r" + " ".repeat(label.length + 4) + "\r");
    };
    let frame = 0;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));

      const response = await cx(analysisAxios.get(`/action/${actionId}/generated-tasks`));
      const data = response.data as SuggestionResult;

      if (isTTY) {
        process.stderr.write(`\r${frames[frame % frames.length]} ${label}`);
        frame++;
      }

      if (data.status !== "processing" && data.status !== "pending") {
        clear();
        return data;
      }
    }

    clear();
    throw new UserError(
      `Suggestion generation for action ${actionId} did not finish within ${timeoutMs / 1000}s. ` +
      `It is still running — re-run this command to pick up the result.`,
    );
  },

  /**
   * Dispatch suggestion generation for an action and return its terminal state.
   *
   * `content_days` is only sent when the caller asks for it: the server default
   * (ACTION_TASK_CONTENT_DAYS, currently 1) is what produces the CONTENT items
   * `aisee action-post` consumes, and hardcoding 0 here disabled them entirely.
   *
   * `unnecessary` and `unsupported` are terminal SUCCESS states, not errors —
   * the action needs no fix, or has no playbook coverage. Callers render them.
   */
  async getSuggestion(
    actionId: string,
    options: { contentDays?: number } = {},
  ): Promise<SuggestionResult> {
    const config = options.contentDays !== undefined
      ? { params: { content_days: options.contentDays } }
      : undefined;

    const response = await cx(analysisAxios.post(`/action/${actionId}/generate-tasks`, null, config));
    const data = response.data as SuggestionResult;

    if (data.status === "processing") {
      return analysisClient.pollGeneratedTasks(actionId);
    }
    return data;
  },

  async getUserInfo(userId: string) {
    const response = await cx(analysisAxios.get(`/user/${userId}`));
    return response.data;
  },

  async getProduct(product_id: string) {
    const response = await cx(analysisAxios.get(`/product/${product_id}`));
    return response.data;
  },

  async getAction(action_id: string) {
    const response = await cx(analysisAxios.get(`/action/${action_id}`));
    return response.data;
  },

  async updateActionPost(action_id: string, sn: number, post_id: string) {
    const response = await cx(analysisAxios.post(`/action/${action_id}/set-post`, { sn, post_id }));
    return response.data;
  },

  async configChannels(productId: string, channels: Record<string, unknown>[]) {
    const response = await cx(analysisAxios.post(`/product/config/channles`, channels, {
      params: { product_id: productId }
    }));
    return response.data;
  },
};
