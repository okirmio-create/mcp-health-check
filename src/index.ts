import { program } from "commander";
import chalk from "chalk";
import { McpClient } from "./client.js";
import { validateTools, validateResources } from "./validator.js";
import { formatReport, formatJson } from "./reporter.js";
import type {
  CliOptions,
  HealthReport,
  CheckResult,
  Severity,
  McpServerInfo,
  McpToolDefinition,
  McpResourceDefinition,
} from "./types.js";

function computeOverall(checks: CheckResult[]): Severity {
  if (checks.some((c) => c.severity === "fail")) return "fail";
  if (checks.some((c) => c.severity === "warn")) return "warn";
  return "pass";
}

async function runHealthCheck(
  commandArgs: string[],
  opts: CliOptions
): Promise<void> {
  const checks: CheckResult[] = [];
  let server: McpServerInfo | null = null;
  let tools: McpToolDefinition[] = [];
  let resources: McpResourceDefinition[] = [];

  if (opts.transport === "sse") {
    console.error(
      chalk.red("SSE transport is not yet implemented. Use stdio (default).")
    );
    process.exit(1);
  }

  if (commandArgs.length === 0) {
    console.error(chalk.red("No server command provided."));
    console.error(
      chalk.dim("Usage: mcp-health-check <command> [args...] [options]")
    );
    console.error(
      chalk.dim("Example: mcp-health-check node my-server.js")
    );
    process.exit(1);
  }

  const [cmd, ...args] = commandArgs;
  const client = new McpClient(opts.timeout);

  if (opts.verbose) {
    console.error(chalk.dim(`Connecting to: ${cmd} ${args.join(" ")}`));
  }

  try {
    // Connect
    await client.connectStdio(cmd, args);
    checks.push({
      name: "connection",
      severity: "pass",
      message: "Server process started",
    });
  } catch (err) {
    checks.push({
      name: "connection",
      severity: "fail",
      message: `Failed to start server: ${(err as Error).message}`,
    });
    outputResult(
      { server, tools, resources, checks, overall: "fail", timestamp: new Date().toISOString() },
      opts
    );
    return;
  }

  try {
    // Initialize
    if (opts.verbose) console.error(chalk.dim("Sending initialize..."));
    const initResult = await client.initialize();
    server = initResult.serverInfo ?? null;
    checks.push({
      name: "initialize",
      severity: "pass",
      message: `Server initialized (protocol ${initResult.protocolVersion})`,
    });

    // List tools
    if (opts.verbose) console.error(chalk.dim("Listing tools..."));
    try {
      const toolsResult = await client.listTools();
      tools = toolsResult.tools ?? [];
      checks.push({
        name: "tools/list",
        severity: "pass",
        message: `Server returned ${tools.length} tool(s)`,
      });
    } catch (err) {
      checks.push({
        name: "tools/list",
        severity: "fail",
        message: `tools/list failed: ${(err as Error).message}`,
      });
    }

    // List resources
    if (opts.verbose) console.error(chalk.dim("Listing resources..."));
    try {
      const resourcesResult = await client.listResources();
      resources = resourcesResult.resources ?? [];
      checks.push({
        name: "resources/list",
        severity: "pass",
        message: `Server returned ${resources.length} resource(s)`,
      });
    } catch (err) {
      // Resources are optional in many servers
      checks.push({
        name: "resources/list",
        severity: "warn",
        message: `resources/list not supported: ${(err as Error).message}`,
      });
    }

    // Validate
    checks.push(...validateTools(tools));
    checks.push(...validateResources(resources));
  } catch (err) {
    checks.push({
      name: "initialize",
      severity: "fail",
      message: `Initialize failed: ${(err as Error).message}`,
    });
  } finally {
    client.disconnect();
  }

  const report: HealthReport = {
    server,
    tools,
    resources,
    checks,
    overall: computeOverall(checks),
    timestamp: new Date().toISOString(),
  };

  outputResult(report, opts);

  if (report.overall === "fail") {
    process.exitCode = 1;
  }
}

function outputResult(report: HealthReport, opts: CliOptions): void {
  if (opts.json) {
    console.log(formatJson(report));
  } else {
    console.log(formatReport(report, opts.verbose));
  }
}

program
  .name("mcp-health-check")
  .description("Validate and health-check MCP servers")
  .version("1.0.0")
  .argument("[command-and-args...]", "Server command and arguments")
  .option(
    "-t, --transport <type>",
    "Transport type: stdio or sse",
    "stdio"
  )
  .option("-u, --url <url>", "SSE endpoint URL (for sse transport)")
  .option("--timeout <ms>", "Connection timeout in ms", "10000")
  .option("-v, --verbose", "Show detailed output", false)
  .option("--json", "Output as JSON", false)
  .action(async (commandAndArgs: string[], options) => {
    const opts: CliOptions = {
      transport: options.transport as "stdio" | "sse",
      url: options.url,
      timeout: parseInt(options.timeout, 10),
      verbose: options.verbose,
      json: options.json,
    };

    await runHealthCheck(commandAndArgs, opts);
  });

program.parse();
