type LogLevel = "debug" | "info" | "warn" | "error";

let currentLevel: LogLevel = "error";

export function setLogLevel(level: string): void {
  const normalized = level.toLowerCase() as LogLevel;
  if (["debug", "info", "warn", "error"].includes(normalized)) {
    currentLevel = normalized;
  }
}

export function isDebug(): boolean {
  return currentLevel === "debug";
}
