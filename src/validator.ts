import type {
  McpToolDefinition,
  McpResourceDefinition,
  CheckResult,
} from "./types.js";

const VALID_JSON_SCHEMA_TYPES = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
];

function validateJsonSchema(
  schema: Record<string, unknown>,
  path: string
): CheckResult[] {
  const results: CheckResult[] = [];

  if (schema.type !== undefined) {
    const t = schema.type;
    if (typeof t === "string" && !VALID_JSON_SCHEMA_TYPES.includes(t)) {
      results.push({
        name: `${path}.type`,
        severity: "fail",
        message: `Invalid JSON Schema type: "${t}"`,
      });
    }
  }

  if (schema.properties !== undefined) {
    if (typeof schema.properties !== "object" || schema.properties === null) {
      results.push({
        name: `${path}.properties`,
        severity: "fail",
        message: "properties must be an object",
      });
    } else {
      for (const [key, value] of Object.entries(
        schema.properties as Record<string, unknown>
      )) {
        if (typeof value === "object" && value !== null) {
          results.push(
            ...validateJsonSchema(
              value as Record<string, unknown>,
              `${path}.properties.${key}`
            )
          );
        }
      }
    }
  }

  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required)) {
      results.push({
        name: `${path}.required`,
        severity: "fail",
        message: "required must be an array",
      });
    } else {
      for (const r of schema.required) {
        if (typeof r !== "string") {
          results.push({
            name: `${path}.required`,
            severity: "fail",
            message: `required entries must be strings, got ${typeof r}`,
          });
        }
      }

      // Check that required fields exist in properties
      if (
        schema.properties &&
        typeof schema.properties === "object" &&
        Array.isArray(schema.required)
      ) {
        const propKeys = Object.keys(
          schema.properties as Record<string, unknown>
        );
        for (const req of schema.required as string[]) {
          if (!propKeys.includes(req)) {
            results.push({
              name: `${path}.required`,
              severity: "warn",
              message: `Required field "${req}" not found in properties`,
            });
          }
        }
      }
    }
  }

  return results;
}

export function validateTools(tools: McpToolDefinition[]): CheckResult[] {
  const results: CheckResult[] = [];

  if (tools.length === 0) {
    results.push({
      name: "tools",
      severity: "warn",
      message: "Server exposes no tools",
    });
    return results;
  }

  // Check for duplicate names
  const nameCount = new Map<string, number>();
  for (const tool of tools) {
    nameCount.set(tool.name, (nameCount.get(tool.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCount) {
    if (count > 1) {
      results.push({
        name: `tool:${name}`,
        severity: "fail",
        message: `Duplicate tool name "${name}" (appears ${count} times)`,
      });
    }
  }

  for (const tool of tools) {
    // Name check
    if (!tool.name || typeof tool.name !== "string") {
      results.push({
        name: "tool:(unnamed)",
        severity: "fail",
        message: "Tool is missing a name",
      });
      continue;
    }

    const prefix = `tool:${tool.name}`;

    // Description check
    if (!tool.description) {
      results.push({
        name: prefix,
        severity: "warn",
        message: "Tool has no description",
      });
    } else if (tool.description.length < 10) {
      results.push({
        name: prefix,
        severity: "warn",
        message: "Tool description is very short (< 10 chars)",
      });
    }

    // inputSchema check
    if (!tool.inputSchema) {
      results.push({
        name: prefix,
        severity: "warn",
        message: "Tool has no inputSchema",
      });
    } else {
      if (typeof tool.inputSchema !== "object") {
        results.push({
          name: `${prefix}.inputSchema`,
          severity: "fail",
          message: "inputSchema must be an object",
        });
      } else {
        // Should be type: "object" at top level
        if (tool.inputSchema.type !== "object") {
          results.push({
            name: `${prefix}.inputSchema`,
            severity: "warn",
            message: `inputSchema top-level type is "${tool.inputSchema.type ?? "undefined"}", expected "object"`,
          });
        }

        // Check if schema is effectively empty
        if (
          !tool.inputSchema.properties &&
          !tool.inputSchema.oneOf &&
          !tool.inputSchema.anyOf &&
          !tool.inputSchema.allOf
        ) {
          results.push({
            name: `${prefix}.inputSchema`,
            severity: "warn",
            message: "inputSchema has no properties defined",
          });
        }

        // Deep schema validation
        results.push(
          ...validateJsonSchema(tool.inputSchema, `${prefix}.inputSchema`)
        );
      }
    }

    // Passed all critical checks
    const hasFail = results.some(
      (r) => r.name.startsWith(prefix) && r.severity === "fail"
    );
    if (!hasFail) {
      results.push({
        name: prefix,
        severity: "pass",
        message: "Tool definition is valid",
      });
    }
  }

  return results;
}

export function validateResources(
  resources: McpResourceDefinition[]
): CheckResult[] {
  const results: CheckResult[] = [];

  if (resources.length === 0) {
    results.push({
      name: "resources",
      severity: "pass",
      message: "No resources exposed (this is fine)",
    });
    return results;
  }

  for (const resource of resources) {
    const prefix = `resource:${resource.uri ?? "(no uri)"}`;

    if (!resource.uri) {
      results.push({
        name: prefix,
        severity: "fail",
        message: "Resource is missing a URI",
      });
      continue;
    }

    if (!resource.name) {
      results.push({
        name: prefix,
        severity: "warn",
        message: "Resource has no name",
      });
    }

    if (!resource.description) {
      results.push({
        name: prefix,
        severity: "warn",
        message: "Resource has no description",
      });
    }

    const hasFail = results.some(
      (r) => r.name === prefix && r.severity === "fail"
    );
    if (!hasFail) {
      results.push({
        name: prefix,
        severity: "pass",
        message: "Resource definition is valid",
      });
    }
  }

  return results;
}
