import { authAxios } from "./http.ts";

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
    const response = await authAxios.post("/cli/auth/device-code", { client_id: clientId });
    return response.data;
  },

  async pollToken(deviceCode: string): Promise<TokenResponse | "pending" | "slow_down"> {
    try {
      const response = await authAxios.post("/cli/auth/token", {
        device_code: deviceCode
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
    const response = await authAxios.post("/cli/auth/token-refresh", {
      refresh_token: refreshToken
    });
    return response.data;
  },

  async getAccessToken(refreshToken: string): Promise<Omit<TokenResponse, "refresh_token">> {
    const response = await authAxios.post("/cli/auth/access-token", {
      refresh_token: refreshToken
    });
    return response.data;
  }
};
