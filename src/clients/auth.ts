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

export const authClient = {
  async requestDeviceCode(clientId: string = "aisee-cli"): Promise<DeviceCodeResponse> {
    const { authApiUrl } = await loadSettings();
    const response = await axios.post(`${authApiUrl}/cli/auth/device-code`, {
      client_id: clientId
    });
    return response.data;
  },

  async pollToken(deviceCode: string): Promise<TokenResponse | "pending"> {
    try {
      const { authApiUrl } = await loadSettings();
      const response = await axios.post(`${authApiUrl}/cli/auth/token`, {
        device_code: deviceCode
      });
      
      if (response.data.error === "authorization_pending") {
        return "pending";
      }
      
      return response.data;
    } catch (error: any) {
      if (error.response?.data?.detail === "expired_token") {
        throw new Error("Login session expired");
      }
      throw error;
    }
  },

  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const { authApiUrl } = await loadSettings();
    const response = await axios.post(`${authApiUrl}/cli/auth/token-refresh`, {
      refresh_token: refreshToken
    });
    return response.data;
  },

  async getAccessToken(refreshToken: string): Promise<Omit<TokenResponse, "refresh_token">> {
    const { authApiUrl } = await loadSettings();
    const response = await axios.post(`${authApiUrl}/cli/auth/access-token`, {
      refresh_token: refreshToken
    });
    return response.data;
  }
};
