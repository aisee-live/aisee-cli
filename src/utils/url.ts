import { z } from "zod";

const DOMAIN_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const WITH_PROTOCOL_RE = /^(https?):\/\/([^/]+)$/;

const INVALID_MSG =
  'Invalid URL. Accepted formats: "domain.name", "http://domain.name", "https://domain.name"';

export function normalizeProductUrl(raw: string): string {
  const s = raw.trim().replace(/\/+$/, "");

  const protocolMatch = s.match(WITH_PROTOCOL_RE);
  if (protocolMatch) {
    return `${protocolMatch[1]}://${protocolMatch[2]}`;
  }

  if (DOMAIN_RE.test(s)) {
    return s;
  }

  throw new Error(INVALID_MSG);
}

export function getDomain(url: string): string {
  const s = url.trim().replace(/\/+$/, "");
  const protocolMatch = s.match(/^(https?):\/\/([^/]+)$/);
  if (protocolMatch) return protocolMatch[2];
  return s;
}

export const productUrlSchema = z.string().transform((val, ctx) => {
  try {
    return normalizeProductUrl(val);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: INVALID_MSG });
    return z.NEVER;
  }
});
