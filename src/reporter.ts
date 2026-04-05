import chalk from "chalk";
import type { HealthReport, CheckResult, Severity } from "./types.js";

const ICONS: Record<Severity, string> = {
  pass: chalk.green("✓"),
  warn: chalk.yellow("⚠"),
  fail: chalk.red("✗"),
};

const STATUS_LABEL: Record<Severity, string> = {
  pass: chalk.bgGreen.black(" PASS "),
  warn: chalk.bgYellow.black(" WARN "),
  fail: chalk.bgRed.white(" FAIL "),
};

function formatCheck(check: CheckResult, verbose: boolean): string {
  const icon = ICONS[check.severity];
  const name = chalk.bold(check.name);
  let line = `  ${icon} ${name}: ${check.message}`;
  if (verbose && check.details) {
    line += `\n      ${chalk.dim(check.details)}`;
  }
  return line;
}

export function formatReport(report: HealthReport, verbose: boolean): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold.underline("MCP Health Check Report"));
  lines.push("");

  // Server info
  if (report.server) {
    lines.push(
      chalk.dim("Server: ") +
        `${report.server.name ?? "unknown"} v${report.server.version ?? "?"}`
    );
    if (report.server.protocolVersion) {
      lines.push(
        chalk.dim("Protocol: ") + report.server.protocolVersion
      );
    }
  }

  // Summary counts
  lines.push(
    chalk.dim("Tools: ") +
      `${report.tools.length}` +
      chalk.dim("  Resources: ") +
      `${report.resources.length}`
  );
  lines.push("");

  // Tools section
  if (report.tools.length > 0) {
    lines.push(chalk.bold("Tools:"));
    for (const tool of report.tools) {
      const desc = tool.description
        ? chalk.dim(` - ${truncate(tool.description, 60)}`)
        : chalk.dim.yellow(" - (no description)");
      lines.push(`  ${chalk.cyan(tool.name)}${desc}`);
    }
    lines.push("");
  }

  // Resources section
  if (report.resources.length > 0) {
    lines.push(chalk.bold("Resources:"));
    for (const res of report.resources) {
      const name = res.name ?? res.uri;
      lines.push(`  ${chalk.cyan(name)} ${chalk.dim(res.uri)}`);
    }
    lines.push("");
  }

  // Checks
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

  // Overall
  const passCount = passes.length;
  const warnCount = warns.length;
  const failCount = fails.length;
  const total = passCount + warnCount + failCount;

  lines.push(
    `${STATUS_LABEL[report.overall]}  ${passCount}/${total} passed` +
      (warnCount > 0 ? `, ${warnCount} warnings` : "") +
      (failCount > 0 ? `, ${failCount} failures` : "")
  );
  lines.push("");

  return lines.join("\n");
}

export function formatJson(report: HealthReport): string {
  return JSON.stringify(report, null, 2);
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "\u2026";
}
