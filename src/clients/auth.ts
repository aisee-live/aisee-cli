import axios from "axios";
import { loadSettings } from "../utils/config.ts";

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  token_url: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    username: string;
  };
}

const handleTlsRetry = async (fn: () => Promise<any>): Promise<any> => {
  try {
    return await fn();
  } catch (error: any) {
    // Retry once: TLS session cache may not be warm on first cold connection
    if (error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || error.code === "CERT_UNTRUSTED" || error.message?.includes("certificate")) {
      return await fn();
    }
    throw error;
  }
};

export const authClient = {
  async requestDeviceCode(clientId: string = "aisee-cli"): Promise<DeviceCodeResponse> {
    const { authApiUrl } = await loadSettings();
    const url = `${authApiUrl}/cli/auth/device-code`;
    return handleTlsRetry(async () => {
      const response = await axios.post(url, { client_id: clientId });
      return response.data;
    });
  },

  async pollToken(deviceCode: string): Promise<TokenResponse | "pending" | "slow_down"> {
    try {
      const { authApiUrl } = await loadSettings();
      const response = await handleTlsRetry(async () => {
        return await axios.post(`${authApiUrl}/cli/auth/token`, {
          device_code: deviceCode
        });
      });
      
      if (response.data?.error === "authorization_pending") {
        return "pending";
      }

      return response.data;
    } catch (error: any) {
      const errorData = error.response?.data;
      const errorCode = errorData?.error || errorData?.detail;

      if (errorCode === "authorization_pending") {
        return "pending";
      }
      
      if (errorCode === "slow_down") {
        return "slow_down";
      }

      if (errorCode === "expired_token") {
        throw new Error("Login session expired");
      }
      
      if (errorCode === "access_denied") {
        throw new Error("Login access denied by user");
      }

      throw error;
    }
  },

  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const { authApiUrl } = await loadSettings();
    return handleTlsRetry(async () => {
      const response = await axios.post(`${authApiUrl}/cli/auth/token-refresh`, {
        refresh_token: refreshToken
      });
      return response.data;
    });
  },

  async getAccessToken(refreshToken: string): Promise<Omit<TokenResponse, "refresh_token">> {
    const { authApiUrl } = await loadSettings();
    return handleTlsRetry(async () => {
      const response = await axios.post(`${authApiUrl}/cli/auth/access-token`, {
        refresh_token: refreshToken
      });
      return response.data;
    });
  }
};
