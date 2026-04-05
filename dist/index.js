#!/usr/bin/env node

// src/index.ts
import { program } from "commander";
import chalk2 from "chalk";

// src/client.ts
import { spawn } from "child_process";
var McpClient = class {
  child = null;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  buffer = "";
  timeoutMs;
  constructor(timeoutMs = 1e4) {
    this.timeoutMs = timeoutMs;
  }
  async connectStdio(command, args) {
    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });
    this.child.on("error", (err) => {
      for (const [, handler] of this.pending) {
        handler.reject(err);
      }
      this.pending.clear();
    });
    this.child.on("exit", (code) => {
      if (this.pending.size > 0) {
        const err = new Error(`Server process exited with code ${code}`);
        for (const [, handler] of this.pending) {
          handler.reject(err);
        }
        this.pending.clear();
      }
    });
    await new Promise((r) => setTimeout(r, 200));
    if (this.child.exitCode !== null) {
      throw new Error(
        `Server process exited immediately with code ${this.child.exitCode}`
      );
    }
  }
  processBuffer() {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== void 0 && this.pending.has(msg.id)) {
          const handler = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          handler.resolve(msg);
        }
      } catch {
      }
    }
  }
  send(request) {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin?.writable) {
        reject(new Error("Not connected to server"));
        return;
      }
      const id = request.id;
      if (id !== void 0) {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Request timed out after ${this.timeoutMs}ms: ${request.method}`));
        }, this.timeoutMs);
        this.pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          }
        });
      }
      const data = JSON.stringify(request) + "\n";
      this.child.stdin.write(data, (err) => {
        if (err) {
          if (id !== void 0) this.pending.delete(id);
          reject(err);
        }
        if (id === void 0) resolve({});
      });
    });
  }
  request(method, params) {
    const id = this.nextId++;
    return this.send({ jsonrpc: "2.0", id, method, params });
  }
  notify(method, params) {
    return this.send({
      jsonrpc: "2.0",
      method,
      params
    }).then(() => {
    });
  }
  async initialize() {
    const resp = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-health-check", version: "1.0.0" }
    });
    if (resp.error) {
      throw new Error(`Initialize failed: ${resp.error.message}`);
    }
    await this.notify("notifications/initialized");
    return resp.result;
  }
  async listTools() {
    const resp = await this.request("tools/list");
    if (resp.error) {
      throw new Error(`tools/list failed: ${resp.error.message}`);
    }
    return resp.result ?? { tools: [] };
  }
  async listResources() {
    const resp = await this.request("resources/list");
    if (resp.error) {
      return { resources: [] };
    }
    return resp.result ?? { resources: [] };
  }
  getStderr() {
    if (!this.child?.stderr) return null;
    let data = "";
    this.child.stderr.on("data", (chunk) => {
      data += chunk.toString();
    });
    return data;
  }
  disconnect() {
    if (this.child) {
      this.child.stdin?.end();
      this.child.kill("SIGTERM");
      this.child = null;
    }
    for (const [, handler] of this.pending) {
      handler.reject(new Error("Client disconnected"));
    }
    this.pending.clear();
  }
};

// src/validator.ts
var VALID_JSON_SCHEMA_TYPES = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null"
];
function validateJsonSchema(schema, path) {
  const results = [];
  if (schema.type !== void 0) {
    const t = schema.type;
    if (typeof t === "string" && !VALID_JSON_SCHEMA_TYPES.includes(t)) {
      results.push({
        name: `${path}.type`,
        severity: "fail",
        message: `Invalid JSON Schema type: "${t}"`
      });
    }
  }
  if (schema.properties !== void 0) {
    if (typeof schema.properties !== "object" || schema.properties === null) {
      results.push({
        name: `${path}.properties`,
        severity: "fail",
        message: "properties must be an object"
      });
    } else {
      for (const [key, value] of Object.entries(
        schema.properties
      )) {
        if (typeof value === "object" && value !== null) {
          results.push(
            ...validateJsonSchema(
              value,
              `${path}.properties.${key}`
            )
          );
        }
      }
    }
  }
  if (schema.required !== void 0) {
    if (!Array.isArray(schema.required)) {
      results.push({
        name: `${path}.required`,
        severity: "fail",
        message: "required must be an array"
      });
    } else {
      for (const r of schema.required) {
        if (typeof r !== "string") {
          results.push({
            name: `${path}.required`,
            severity: "fail",
            message: `required entries must be strings, got ${typeof r}`
          });
        }
      }
      if (schema.properties && typeof schema.properties === "object" && Array.isArray(schema.required)) {
        const propKeys = Object.keys(
          schema.properties
        );
        for (const req of schema.required) {
          if (!propKeys.includes(req)) {
            results.push({
              name: `${path}.required`,
              severity: "warn",
              message: `Required field "${req}" not found in properties`
            });
          }
        }
      }
    }
  }
  return results;
}
function validateTools(tools) {
  const results = [];
  if (tools.length === 0) {
    results.push({
      name: "tools",
      severity: "warn",
      message: "Server exposes no tools"
    });
    return results;
  }
  const nameCount = /* @__PURE__ */ new Map();
  for (const tool of tools) {
    nameCount.set(tool.name, (nameCount.get(tool.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCount) {
    if (count > 1) {
      results.push({
        name: `tool:${name}`,
        severity: "fail",
        message: `Duplicate tool name "${name}" (appears ${count} times)`
      });
    }
  }
  for (const tool of tools) {
    if (!tool.name || typeof tool.name !== "string") {
      results.push({
        name: "tool:(unnamed)",
        severity: "fail",
        message: "Tool is missing a name"
      });
      continue;
    }
    const prefix = `tool:${tool.name}`;
    if (!tool.description) {
      results.push({
        name: prefix,
        severity: "warn",
        message: "Tool has no description"
      });
    } else if (tool.description.length < 10) {
      results.push({
        name: prefix,
        severity: "warn",
        message: "Tool description is very short (< 10 chars)"
      });
    }
    if (!tool.inputSchema) {
      results.push({
        name: prefix,
        severity: "warn",
        message: "Tool has no inputSchema"
      });
    } else {
      if (typeof tool.inputSchema !== "object") {
        results.push({
          name: `${prefix}.inputSchema`,
          severity: "fail",
          message: "inputSchema must be an object"
        });
      } else {
        if (tool.inputSchema.type !== "object") {
          results.push({
            name: `${prefix}.inputSchema`,
            severity: "warn",
            message: `inputSchema top-level type is "${tool.inputSchema.type ?? "undefined"}", expected "object"`
          });
        }
        if (!tool.inputSchema.properties && !tool.inputSchema.oneOf && !tool.inputSchema.anyOf && !tool.inputSchema.allOf) {
          results.push({
            name: `${prefix}.inputSchema`,
            severity: "warn",
            message: "inputSchema has no properties defined"
          });
        }
        results.push(
          ...validateJsonSchema(tool.inputSchema, `${prefix}.inputSchema`)
        );
      }
    }
    const hasFail = results.some(
      (r) => r.name.startsWith(prefix) && r.severity === "fail"
    );
    if (!hasFail) {
      results.push({
        name: prefix,
        severity: "pass",
        message: "Tool definition is valid"
      });
    }
  }
  return results;
}
function validateResources(resources) {
  const results = [];
  if (resources.length === 0) {
    results.push({
      name: "resources",
      severity: "pass",
      message: "No resources exposed (this is fine)"
    });
    return results;
  }
  for (const resource of resources) {
    const prefix = `resource:${resource.uri ?? "(no uri)"}`;
    if (!resource.uri) {
      results.push({
        name: prefix,
        severity: "fail",
        message: "Resource is missing a URI"
      });
      continue;
    }
    if (!resource.name) {
      results.push({
        name: prefix,
        severity: "warn",
        message: "Resource has no name"
      });
    }
    if (!resource.description) {
      results.push({
        name: prefix,
        severity: "warn",
        message: "Resource has no description"
      });
    }
    const hasFail = results.some(
      (r) => r.name === prefix && r.severity === "fail"
    );
    if (!hasFail) {
      results.push({
        name: prefix,
        severity: "pass",
        message: "Resource definition is valid"
      });
    }
  }
  return results;
}

// src/reporter.ts
import chalk from "chalk";
var ICONS = {
  pass: chalk.green("\u2713"),
  warn: chalk.yellow("\u26A0"),
  fail: chalk.red("\u2717")
};
var STATUS_LABEL = {
  pass: chalk.bgGreen.black(" PASS "),
  warn: chalk.bgYellow.black(" WARN "),
  fail: chalk.bgRed.white(" FAIL ")
};
function formatCheck(check, verbose) {
  const icon = ICONS[check.severity];
  const name = chalk.bold(check.name);
  let line = `  ${icon} ${name}: ${check.message}`;
  if (verbose && check.details) {
    line += `
      ${chalk.dim(check.details)}`;
  }
  return line;
}
function formatReport(report, verbose) {
  const lines = [];
  lines.push("");
  lines.push(chalk.bold.underline("MCP Health Check Report"));
  lines.push("");
  if (report.server) {
    lines.push(
      chalk.dim("Server: ") + `${report.server.name ?? "unknown"} v${report.server.version ?? "?"}`
    );
    if (report.server.protocolVersion) {
      lines.push(
        chalk.dim("Protocol: ") + report.server.protocolVersion
      );
    }
  }
  lines.push(
    chalk.dim("Tools: ") + `${report.tools.length}` + chalk.dim("  Resources: ") + `${report.resources.length}`
  );
  lines.push("");
  if (report.tools.length > 0) {
    lines.push(chalk.bold("Tools:"));
    for (const tool of report.tools) {
      const desc = tool.description ? chalk.dim(` - ${truncate(tool.description, 60)}`) : chalk.dim.yellow(" - (no description)");
      lines.push(`  ${chalk.cyan(tool.name)}${desc}`);
    }
    lines.push("");
  }
  if (report.resources.length > 0) {
    lines.push(chalk.bold("Resources:"));
    for (const res of report.resources) {
      const name = res.name ?? res.uri;
      lines.push(`  ${chalk.cyan(name)} ${chalk.dim(res.uri)}`);
    }
    lines.push("");
  }
  lines.push(chalk.bold("Checks:"));
  const fails = report.checks.filter((c) => c.severity === "fail");
  const warns = report.checks.filter((c) => c.severity === "warn");
  const passes = report.checks.filter((c) => c.severity === "pass");
  for (const check of fails) {
    lines.push(formatCheck(check, verbose));
  }
  for (const check of warns) {
    lines.push(formatCheck(check, verbose));
  }
  if (verbose) {
    for (const check of passes) {
      lines.push(formatCheck(check, verbose));
    }
  } else if (passes.length > 0) {
    lines.push(`  ${ICONS.pass} ${passes.length} checks passed`);
  }
  lines.push("");
  const passCount = passes.length;
  const warnCount = warns.length;
  const failCount = fails.length;
  const total = passCount + warnCount + failCount;
  lines.push(
    `${STATUS_LABEL[report.overall]}  ${passCount}/${total} passed` + (warnCount > 0 ? `, ${warnCount} warnings` : "") + (failCount > 0 ? `, ${failCount} failures` : "")
  );
  lines.push("");
  return lines.join("\n");
}
function formatJson(report) {
  return JSON.stringify(report, null, 2);
}
function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "\u2026";
}

// src/index.ts
function computeOverall(checks) {
  if (checks.some((c) => c.severity === "fail")) return "fail";
  if (checks.some((c) => c.severity === "warn")) return "warn";
  return "pass";
}
async function runHealthCheck(commandArgs, opts) {
  const checks = [];
  let server = null;
  let tools = [];
  let resources = [];
  if (opts.transport === "sse") {
    console.error(
      chalk2.red("SSE transport is not yet implemented. Use stdio (default).")
    );
    process.exit(1);
  }
  if (commandArgs.length === 0) {
    console.error(chalk2.red("No server command provided."));
    console.error(
      chalk2.dim("Usage: mcp-health-check <command> [args...] [options]")
    );
    console.error(
      chalk2.dim("Example: mcp-health-check node my-server.js")
    );
    process.exit(1);
  }
  const [cmd, ...args] = commandArgs;
  const client = new McpClient(opts.timeout);
  if (opts.verbose) {
    console.error(chalk2.dim(`Connecting to: ${cmd} ${args.join(" ")}`));
  }
  try {
    await client.connectStdio(cmd, args);
    checks.push({
      name: "connection",
      severity: "pass",
      message: "Server process started"
    });
  } catch (err) {
    checks.push({
      name: "connection",
      severity: "fail",
      message: `Failed to start server: ${err.message}`
    });
    outputResult(
      { server, tools, resources, checks, overall: "fail", timestamp: (/* @__PURE__ */ new Date()).toISOString() },
      opts
    );
    return;
  }
  try {
    if (opts.verbose) console.error(chalk2.dim("Sending initialize..."));
    const initResult = await client.initialize();
    server = initResult.serverInfo ?? null;
    checks.push({
      name: "initialize",
      severity: "pass",
      message: `Server initialized (protocol ${initResult.protocolVersion})`
    });
    if (opts.verbose) console.error(chalk2.dim("Listing tools..."));
    try {
      const toolsResult = await client.listTools();
      tools = toolsResult.tools ?? [];
      checks.push({
        name: "tools/list",
        severity: "pass",
        message: `Server returned ${tools.length} tool(s)`
      });
    } catch (err) {
      checks.push({
        name: "tools/list",
        severity: "fail",
        message: `tools/list failed: ${err.message}`
      });
    }
    if (opts.verbose) console.error(chalk2.dim("Listing resources..."));
    try {
      const resourcesResult = await client.listResources();
      resources = resourcesResult.resources ?? [];
      checks.push({
        name: "resources/list",
        severity: "pass",
        message: `Server returned ${resources.length} resource(s)`
      });
    } catch (err) {
      checks.push({
        name: "resources/list",
        severity: "warn",
        message: `resources/list not supported: ${err.message}`
      });
    }
    checks.push(...validateTools(tools));
    checks.push(...validateResources(resources));
  } catch (err) {
    checks.push({
      name: "initialize",
      severity: "fail",
      message: `Initialize failed: ${err.message}`
    });
  } finally {
    client.disconnect();
  }
  const report = {
    server,
    tools,
    resources,
    checks,
    overall: computeOverall(checks),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  outputResult(report, opts);
  if (report.overall === "fail") {
    process.exitCode = 1;
  }
}
function outputResult(report, opts) {
  if (opts.json) {
    console.log(formatJson(report));
  } else {
    console.log(formatReport(report, opts.verbose));
  }
}
program.name("mcp-health-check").description("Validate and health-check MCP servers").version("1.0.0").argument("[command-and-args...]", "Server command and arguments").option(
  "-t, --transport <type>",
  "Transport type: stdio or sse",
  "stdio"
).option("-u, --url <url>", "SSE endpoint URL (for sse transport)").option("--timeout <ms>", "Connection timeout in ms", "10000").option("-v, --verbose", "Show detailed output", false).option("--json", "Output as JSON", false).action(async (commandAndArgs, options) => {
  const opts = {
    transport: options.transport,
    url: options.url,
    timeout: parseInt(options.timeout, 10),
    verbose: options.verbose,
    json: options.json
  };
  await runHealthCheck(commandAndArgs, opts);
});
program.parse();
