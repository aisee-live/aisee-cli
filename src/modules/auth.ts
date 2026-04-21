import { z } from "zod";
import { createAnnotations } from "apcore-js";
import { saveCredentials, clearCredentials, loadCredentials } from "../utils/config.ts";
import open from "open";

import { authClient } from "../clients/auth.ts";
import chalk from "chalk";
import ora from "ora";

export const loginModule = {
  description: "Login to AISee via Device Authorization Flow",
  inputSchema: z.object({}),
  outputSchema: z.object({
    message: z.string(),
    email: z.string().optional()
  }),
  annotations: createAnnotations({ readonly: false }),
  async execute() {
    const deviceResp = await authClient.requestDeviceCode();

    console.log(chalk.cyan("\n! Action Required"));
    console.log(`1. Open your browser: ${chalk.blue.underline(deviceResp.verification_uri)}`);
    console.log(`2. Enter code: ${chalk.yellow.bold(deviceResp.user_code)}`);
    console.log(`\nAlternatively, open directly: ${chalk.blue.underline(deviceResp.verification_uri_complete)}\n`);

    await open(deviceResp.verification_uri_complete);

    const spinner = ora("Waiting for authorization...").start();

    return new Promise((resolve, reject) => {
      const interval = deviceResp.interval * 1000;
      
      // Keep track of the timeout timer to clear it later
      const timeoutTimer = setTimeout(() => {
        clearInterval(pollTimer);
        spinner.fail("Login timed out");
        reject(new Error("Device code expired. Please try again."));
      }, deviceResp.expires_in * 1000);

      const pollTimer = setInterval(async () => {
        try {
          const result = await authClient.pollToken(deviceResp.device_code);

          if (result !== "pending") {
            clearInterval(pollTimer);
            clearTimeout(timeoutTimer); // <--- Add this to allow process exit
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
              message: `Logged in as ${result.user.email}`,
              email: result.user.email
            });
          }
        } catch (err) {
          clearInterval(pollTimer);
          clearTimeout(timeoutTimer); // <--- Add this too
          spinner.fail("Login failed");
          reject(err);
        }
      }, interval);
    });
  }
};

export const logoutModule = {
  description: "Clear local credentials",
  inputSchema: z.object({}),
  outputSchema: z.object({ message: z.string() }),
  async execute() {
    await clearCredentials();
    return { message: "Logged out successfully" };
  }
};

export const whoamiModule = {
  description: "Show current user and credits",
  inputSchema: z.object({}),
  outputSchema: z.object({
    email: z.string(),
    plan: z.string(),
    credits: z.number()
  }),
  async execute() {
    const creds = await loadCredentials();
    if (!creds || !creds.accessToken) {
      throw new Error("Not logged in. Run 'aisee login' first.");
    }
    return creds;
  }
};
