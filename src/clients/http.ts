import axios, { AxiosInstance } from "axios";
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

const createAxiosInstance = (serviceType: keyof Settings): AxiosInstance => {
  const instance = axios.create({ timeout: 30000 });

  instance.interceptors.request.use(async (config) => {
    const settings = await loadSettings();
    const creds = await loadCredentials();
    
    config.baseURL = settings[serviceType];
    
    if (creds?.accessToken) {
      config.headers.Authorization = `Bearer ${creds.accessToken}`;
    }
    config.headers["x-timezone"] = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
      const isCertError =
        error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
        error.code === "CERT_UNTRUSTED" ||
        (typeof error.message === "string" && error.message.includes("certificate"));
      if (isCertError && !originalRequest._tlsRetry) {
        originalRequest._tlsRetry = true;
        return instance(originalRequest);
      }

      if (error.response?.status === 401 && !originalRequest._retry) {
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

export const analysisAxios = createAxiosInstance("analysisApiUrl");
export const postAgentAxios = createAxiosInstance("postAgentApiUrl");
