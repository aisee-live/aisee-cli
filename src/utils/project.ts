import { analysisClient } from "../clients/analysis.ts";
import { ApiError } from "../clients/api-error.ts";
import { UserError } from "./errors.ts";
import { getDomain } from "./url.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postiz scopes posts, dashboards and operation plans by `projectId`, which is
 * the aisee-core `products.id` UUID — but the CLI addresses products by domain
 * everywhere else. This resolves one to the other.
 *
 * `GET /product/{product_id}` already accepts a full URL, a bare domain or a
 * UUID (`get_product_by_id_or_url`), so a single lookup covers every form the
 * user might type.
 */

// Per-process memo: several commands resolve the same product more than once
// in a single invocation (e.g. channels select reads then writes).
const resolved = new Map<string, string>();

export function isProjectId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Resolve a user-supplied product reference to its `products.id`.
 *
 * A value that is already a UUID is returned untouched — no request, and no
 * failure for a product the lookup endpoint would reject for other reasons.
 */
export async function resolveProjectId(reference: string): Promise<string> {
  const value = reference.trim();
  if (!value) throw new UserError("A product reference is required.");
  if (isProjectId(value)) return value;

  const lookup = getDomain(value);
  const cached = resolved.get(lookup);
  if (cached) return cached;

  // A missing product is a real 404 from the orchestrator, so it arrives as a
  // rejection rather than an empty body — without this the advice below is
  // unreachable and the user just sees "[404] Product not found".
  const product = await analysisClient
    .getProduct(lookup)
    .catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }) as { id?: string } | null;
  const id = product?.id;
  if (!id) {
    throw new UserError(
      `No product found for '${reference}'. Run 'aisee scan ${reference}' to create it.`,
    );
  }

  resolved.set(lookup, id);
  return id;
}

/**
 * Resolve an optional `--project` flag.
 *
 * Omitting it is meaningful: the backend keeps its pre-project behaviour for
 * requests that carry no `projectId`, so the CLI must send nothing rather than
 * guessing a project.
 */
export async function resolveOptionalProjectId(reference?: string): Promise<string | undefined> {
  if (!reference) return undefined;
  return resolveProjectId(reference);
}
