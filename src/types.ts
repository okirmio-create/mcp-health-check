export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpResourceDefinition {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpServerInfo {
  name?: string;
  version?: string;
  protocolVersion?: string;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo?: McpServerInfo;
}

export interface ToolsListResult {
  tools: McpToolDefinition[];
}

export interface ResourcesListResult {
  resources: McpResourceDefinition[];
}

export type Severity = "pass" | "warn" | "fail";

export interface CheckResult {
  name: string;
  severity: Severity;
  message: string;
  details?: string;
}

export interface HealthReport {
  server: McpServerInfo | null;
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
  checks: CheckResult[];
  overall: Severity;
  timestamp: string;
}

export interface CliOptions {
  transport: "stdio" | "sse";
  url?: string;
  timeout: number;
  verbose: boolean;
  json: boolean;
}
