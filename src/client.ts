import { spawn, type ChildProcess } from "node:child_process";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  InitializeResult,
  ToolsListResult,
  ResourcesListResult,
} from "./types.js";

export class McpClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }
  >();
  private buffer = "";
  private timeoutMs: number;

  constructor(timeoutMs = 10_000) {
    this.timeoutMs = timeoutMs;
  }

  async connectStdio(command: string, args: string[]): Promise<void> {
    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.child.stdout!.on("data", (chunk: Buffer) => {
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

    // Brief delay to let the process start
    await new Promise((r) => setTimeout(r, 200));

    if (this.child.exitCode !== null) {
      throw new Error(
        `Server process exited immediately with code ${this.child.exitCode}`
      );
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const handler = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          handler.resolve(msg);
        }
      } catch {
        // Skip non-JSON lines (stderr leaking into stdout, etc.)
      }
    }
  }

  private send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin?.writable) {
        reject(new Error("Not connected to server"));
        return;
      }

      const id = request.id;
      if (id !== undefined) {
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
          },
        });
      }

      const data = JSON.stringify(request) + "\n";
      this.child.stdin.write(data, (err) => {
        if (err) {
          if (id !== undefined) this.pending.delete(id);
          reject(err);
        }
        // Notifications (no id) resolve immediately
        if (id === undefined) resolve({} as JsonRpcResponse);
      });
    });
  }

  private request(
    method: string,
    params?: Record<string, unknown>
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return this.send({ jsonrpc: "2.0", id, method, params });
  }

  private notify(
    method: string,
    params?: Record<string, unknown>
  ): Promise<void> {
    return this.send({
      jsonrpc: "2.0",
      method,
      params,
    } as JsonRpcRequest).then(() => {});
  }

  async initialize(): Promise<InitializeResult> {
    const resp = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-health-check", version: "1.0.0" },
    });

    if (resp.error) {
      throw new Error(`Initialize failed: ${resp.error.message}`);
    }

    await this.notify("notifications/initialized");
    return resp.result as InitializeResult;
  }

  async listTools(): Promise<ToolsListResult> {
    const resp = await this.request("tools/list");
    if (resp.error) {
      throw new Error(`tools/list failed: ${resp.error.message}`);
    }
    return (resp.result as ToolsListResult) ?? { tools: [] };
  }

  async listResources(): Promise<ResourcesListResult> {
    const resp = await this.request("resources/list");
    if (resp.error) {
      // Some servers don't support resources — treat as empty
      return { resources: [] };
    }
    return (resp.result as ResourcesListResult) ?? { resources: [] };
  }

  getStderr(): string | null {
    if (!this.child?.stderr) return null;
    let data = "";
    this.child.stderr.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    return data;
  }

  disconnect(): void {
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
}
