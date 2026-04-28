import { z } from "zod";
import { createAnnotations } from "apcore-js";
import { saveCredentials, clearCredentials, loadCredentials } from "../utils/config.ts";
import open from "open";

import { authClient } from "../clients/auth.ts";
import { analysisClient } from "../clients/analysis.ts";
import chalk from "chalk";
import ora from "ora";

/**
 * User schema based on OpenAPI UserResponse components
 */
export const UserResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  username: z.string().nullable().optional(),
  is_active: z.boolean(),
  is_superuser: z.boolean().default(false),
  type: z.string().nullable().optional(),
  roles: z.array(z.any()).nullable().optional(),
  created_at: z.string().datetime().nullable().optional(),
  updated_at: z.string().datetime().nullable().optional(),
  plan: z.string().optional(),
  credits: z.number().optional()
});

export const loginModule = {
  description: "Login to AISee via Device Authorization Flow (RFC 8628)",
  inputSchema: z.object({
    client_id: z.string().default("aisee-cli").describe("Optional client identifier")
  }),
  outputSchema: z.object({
    message: z.string().describe("Success message"),
    id: z.string().describe("User ID"),
    email: z.string().describe("User email"),
    username: z.string().nullable().optional().describe("Username"),
  }),
  annotations: createAnnotations({ readonly: false }),
  async execute(input: any) {
    const deviceResp = await authClient.requestDeviceCode(input.client_id);
    
    console.log(chalk.cyan("\n! Action Required"));
    console.log(`1. Open your browser: ${chalk.blue.underline(deviceResp.verification_uri)}`);
    console.log(`2. Enter code: ${chalk.yellow.bold(deviceResp.user_code)}`);
    
    if (deviceResp.verification_uri_complete) {
      console.log(`\nAlternatively, open directly: ${chalk.blue.underline(deviceResp.verification_uri_complete)}\n`);
      await open(deviceResp.verification_uri_complete);
    }

    const spinner = ora("Waiting for authorization...").start();

    return new Promise((resolve, reject) => {
      const interval = (deviceResp.interval || 5) * 1000;
      
      const timeoutTimer = setTimeout(() => {
        clearInterval(pollTimer);
        spinner.fail("Login timed out");
        reject(new Error("Device code expired. Please try again."));
      }, (deviceResp.expires_in || 300) * 1000);

      const pollTimer = setInterval(async () => {
        try {
          const result = await authClient.pollToken(deviceResp.device_code);

          if (result !== "pending") {
            clearInterval(pollTimer);
            clearTimeout(timeoutTimer);
            spinner.succeed("Login successful!");

            await saveCredentials({
              userId: result.user.id,
              accessToken: result.access_token,
              refreshToken: result.refresh_token,
              email: result.user.email,
              plan: "Pro", 
              credits: 0    
            });

            resolve({
              message: `Successfully logged in as ${result.user.email}`,
              id: result.user.id,
              email: result.user.email,
              username: result.user.username ?? null,
            });
          }
        } catch (err) {
          clearInterval(pollTimer);
          clearTimeout(timeoutTimer);
          spinner.fail("Login failed");
          reject(err);
        }
      }, interval);
    });
  }
};

export const logoutModule = {
  description: "Logout user by revoking local credentials",
  inputSchema: z.object({}),
  outputSchema: z.object({ message: z.string() }),
  async execute() {
    await clearCredentials();
    return { message: "Logged out successfully and local credentials cleared." };
  }
};

export const whoamiModule = {
  description: "Display information about the currently authenticated user",
  inputSchema: z.object({}),
  outputSchema: UserResponseSchema,
  async execute() {
    const creds = await loadCredentials();
    if (!creds || !creds.accessToken || !creds.userId) {
      throw new Error("Not logged in. Run 'aisee auth login' first.");
    }
    
    try {
      const userInfo = await analysisClient.getUserInfo(creds.userId);
      
      const totalCredits = (userInfo.credit_balances || []).reduce(
        (acc: number, bal: any) => acc + (bal.amount || 0), 
        0
      );
      
      const planName = userInfo.credit_package?.name || "Free";

      return {
        id: userInfo.id,
        email: userInfo.email,
        username: userInfo.username,
        is_active: userInfo.is_active,
        plan: planName,
        credits: totalCredits
      };
    } catch (error) {
      // Fallback to local credentials if API call fails
      return {
        id: creds.userId,
        email: creds.email,
        is_active: true,
        plan: creds.plan,
        credits: creds.credits
      };
    }
  }
};
