import axios, { AxiosInstance } from "axios";
import https from "https";
import { loadCredentials, saveCredentials, clearCredentials, loadSettings, Settings } from "../utils/config.ts";
import { authClient } from "./auth.ts";
import { isDebug } from "../utils/log-level.ts";

let isRefreshing = false;
let failedQueue: any[] = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

const createAxiosInstance = (serviceType: keyof Settings | "authApiUrl"): AxiosInstance => {
  const instance = axios.create({ timeout: 30000 });

  instance.interceptors.request.use(async (config) => {
    const settings = await loadSettings();
    const creds = await loadCredentials();

    config.baseURL = settings[serviceType as keyof Settings];

    if (settings.allowInsecure) {
      config.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }

    // For authApiUrl specifically (if it's not in the Settings interface but passed here)
    if (serviceType === "authApiUrl") {
      config.baseURL = settings.authApiUrl;
    }

    if (creds?.accessToken) {
      config.headers.Authorization = `Bearer ${creds.accessToken}`;
    }
    config.headers["x-timezone"] = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (isDebug()) {
      const fullUrl = `${config.baseURL ?? ""}${config.url ?? ""}`;
      const cleaned = config.params
        ? Object.fromEntries(
          Object.entries(config.params as Record<string, unknown>).filter(
            ([, v]) => v !== undefined && v !== null,
          ),
        )
        : undefined;
      const params = cleaned && Object.keys(cleaned).length
        ? `?${new URLSearchParams(cleaned as Record<string, string>).toString()}`
        : "";
      process.stderr.write(`[debug] [API] ${config.method?.toUpperCase() ?? "GET"} ${fullUrl}${params}\n`);
    }

    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      const res = error.response;

      if (res && isDebug()) {
        console.error(
          `\n[API] ${originalRequest?.method?.toUpperCase() ?? "?"} ${originalRequest?.baseURL ?? ""}${originalRequest?.url ?? ""}`
          + ` → ${res.status} ${res.statusText}`
        );
        if (res.data) {
          console.error(`[API] body:`, JSON.stringify(res.data));
        }
      }

      // Retry once on intermittent TLS errors (cold connection / cert cache miss)
      const errorMsg = String(error.message || "").toLowerCase();
      const isCertError =
        error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
        error.code === "CERT_UNTRUSTED" ||
        error.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
        errorMsg.includes("certificate") ||
        errorMsg.includes("tls") ||
        errorMsg.includes("verification error");

      if (isCertError && !originalRequest._tlsRetry) {
        const settings = await loadSettings();
        if (settings.allowInsecure) {
          // If we already allowed insecure, and it still fails, it's not a cert error we can bypass
          return Promise.reject(error);
        }
        originalRequest._tlsRetry = true;
        return instance(originalRequest);
      }

      if (isCertError && originalRequest._tlsRetry) {
        // Still failing after retry, add a helpful hint
        error.message = `${error.message}. Hint: Try 'aisee config set allow_insecure true' if you trust this network.`;
      }

      // Token Refresh Logic (only for non-auth requests)
      if (serviceType !== "authApiUrl" && error.response?.status === 401 && !originalRequest._retry) {
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
            setTimeout(() => reject(new Error("Token refresh timeout")), 30000);
          })
            .then(token => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              return instance(originalRequest);
            })
            .catch(err => Promise.reject(err));
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          const creds = await loadCredentials();
          if (!creds?.refreshToken) {
            throw new Error("No refresh token available");
          }

          const result = await authClient.getAccessToken(creds.refreshToken);

          await saveCredentials({
            ...creds,
            accessToken: result.access_token,
          });

          processQueue(null, result.access_token);
          originalRequest.headers.Authorization = `Bearer ${result.access_token}`;
          return instance(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError, null);
          await clearCredentials();
          console.error("\nSession expired. Please login again using 'aisee login'.");
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }

      return Promise.reject(error);
    }
  );

  return instance;
};

export const authAxios = createAxiosInstance("authApiUrl");
export const analysisAxios = createAxiosInstance("analysisApiUrl");
export const postAgentAxios = createAxiosInstance("postAgentApiUrl");
