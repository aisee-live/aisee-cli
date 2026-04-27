/**
 * Minimal Zod v3 → JSON Schema converter covering the subset used in aisee modules.
 * Handles: ZodObject, ZodString, ZodNumber, ZodBoolean, ZodEnum,
 *           ZodOptional, ZodDefault, ZodNullable.
 */

interface ZodDef {
  typeName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  innerType?: any;
  values?: string[];
  checks?: Array<{ kind: string; value?: number; inclusive?: boolean }>;
  defaultValue?: () => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shape?: () => Record<string, any>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZodLike = { _def: ZodDef; description?: string; shape?: Record<string, any> };

function convertType(zodType: ZodLike): { schema: Record<string, unknown>; required: boolean } {
  const { typeName } = zodType._def;
  const description = zodType.description;

  if (typeName === "ZodOptional") {
    const inner = convertType(zodType._def.innerType);
    return {
      schema: { ...inner.schema, ...(description ? { description } : {}) },
      required: false,
    };
  }

  if (typeName === "ZodDefault") {
    const defaultValue = zodType._def.defaultValue!();
    const inner = convertType(zodType._def.innerType);
    return {
      schema: { ...inner.schema, default: defaultValue, ...(description ? { description } : {}) },
      required: false,
    };
  }

  if (typeName === "ZodNullable") {
    const inner = convertType(zodType._def.innerType);
    return {
      schema: { ...inner.schema, ...(description ? { description } : {}) },
      required: false,
    };
  }

  const base: Record<string, unknown> = {};
  if (description) base.description = description;

  switch (typeName) {
    case "ZodString": {
      base.type = "string";
      for (const c of zodType._def.checks ?? []) {
        if (c.kind === "url") base.format = "uri";
        else if (c.kind === "email") base.format = "email";
        else if (c.kind === "min") base.minLength = c.value;
        else if (c.kind === "max") base.maxLength = c.value;
      }
      break;
    }
    case "ZodNumber": {
      const checks = zodType._def.checks ?? [];
      base.type = checks.some((c) => c.kind === "int") ? "integer" : "number";
      for (const c of checks) {
        if (c.kind === "min") base.minimum = c.value;
        else if (c.kind === "max") base.maximum = c.value;
      }
      break;
    }
    case "ZodBoolean":
      base.type = "boolean";
      break;
    case "ZodEnum":
      base.type = "string";
      base.enum = zodType._def.values;
      break;
    default:
      base.type = "string";
  }

  return { schema: base, required: true };
}

export function zodToJsonSchema(zodSchema: unknown): Record<string, unknown> {
  if (!zodSchema || typeof zodSchema !== "object") return {};
  const zod = zodSchema as ZodLike;
  if (zod._def?.typeName !== "ZodObject") return {};

  // ZodObject exposes .shape as a direct property (Zod v3)
  const shape = zod.shape ?? (zod._def.shape ? zod._def.shape() : {});
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, zodType] of Object.entries(shape)) {
    const { schema, required: isRequired } = convertType(zodType as ZodLike);
    properties[key] = schema;
    if (isRequired) required.push(key);
  }

  const result: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) result.required = required;
  return result;
}
