// Central point for embedded OpenAPI specs
// These are bundled into the binary by Bun during compilation.

import authSpec from "../../docs/openapi/auth.json" assert { type: "json" };
import analysisSpec from "../../docs/openapi/analysis.json" assert { type: "json" };
import postAgentSpec from "../../docs/openapi/post-agent.json" assert { type: "json" };
import { UserError } from "../utils/errors.ts";

export { authSpec, analysisSpec, postAgentSpec };

/**
 * Helper to get the full OpenAPI spec for a service.
 * Useful for documentation or dynamic discovery within the CLI.
 *
 * The CLI's zod enum only shapes `--help` output — apcore-cli's runtime
 * validation doesn't enforce `enum`, so an unknown value reaches here and
 * must be rejected explicitly instead of falling through to `undefined`.
 */
export function getEmbeddedSpec(service: "auth" | "analysis" | "post-agent") {
  switch (service) {
    case "auth": return authSpec;
    case "analysis": return analysisSpec;
    case "post-agent": return postAgentSpec;
    default:
      throw new UserError(`Unknown service: '${service}'. Expected one of: auth, analysis, post-agent.`);
  }
}
