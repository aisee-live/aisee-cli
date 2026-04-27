/**
 * Bridges the apcore-js Registry (list/getDefinition) to the apcore-cli
 * Registry interface (listModules/getModule), converting ModuleDescriptor
 * shapes along the way (moduleId → id, Zod schemas → JSON Schema).
 */

import type { Registry, ModuleDescriptor } from "apcore-cli";
import { Registry as ApCoreRegistry } from "apcore-js";
import { zodToJsonSchema } from "./zod-to-schema.ts";

export class RegistryAdapter implements Registry {
  constructor(private readonly registry: ApCoreRegistry) {}

  listModules(): ModuleDescriptor[] {
    return this.registry.list().map((id) => this.toDescriptor(id)).filter(
      (d): d is ModuleDescriptor => d !== null,
    );
  }

  getModule(moduleId: string): ModuleDescriptor | null {
    return this.toDescriptor(moduleId);
  }

  private toDescriptor(moduleId: string): ModuleDescriptor | null {
    const def = this.registry.getDefinition(moduleId);
    if (!def) return null;
    return {
      id: def.moduleId,
      name: def.name ?? def.moduleId,
      description: def.description,
      tags: def.tags,
      inputSchema: zodToJsonSchema(def.inputSchema),
      outputSchema: {},
      annotations: def.annotations as Record<string, unknown> | undefined,
      metadata: def.metadata,
    };
  }
}
