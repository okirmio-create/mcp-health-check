# mcp-health-check

CLI tool to validate and health-check [Model Context Protocol (MCP)](https://modelcontextprotocol.io) servers.

Connects to your MCP server, discovers tools and resources, validates schemas, and produces a clear health report.

## Installation

```bash
npm install -g mcp-health-check
```

Or use directly with npx:

```bash
npx mcp-health-check node ./my-server.js
```

## Usage

```bash
# Check a stdio-based MCP server
mcp-health-check node my-server.js

# Check with npx
mcp-health-check npx my-mcp-server

# Check an SSE server
mcp-health-check --transport sse --url http://localhost:3000/sse

# Verbose output
mcp-health-check -v node my-server.js

# JSON output (for CI/CD)
mcp-health-check --json node my-server.js
```

## Options

| Option | Description | Default |
|--------|------------|---------|
| `--transport, -t` | Transport type: `stdio` or `sse` | `stdio` |
| `--url, -u` | SSE endpoint URL | - |
| `--timeout` | Connection timeout (ms) | `10000` |
| `--verbose, -v` | Detailed output | `false` |
| `--json` | Output as JSON | `false` |

## What It Checks

- **Initialization** — Server responds to MCP handshake
- **Tools** — Lists all tools, validates each has name, description, and inputSchema
- **Resources** — Lists all resources, validates URI and name
- **Schemas** — Validates JSON Schema structure of tool inputs
- **Duplicates** — Warns about duplicate tool/resource names

## Output

```
MCP Health Check Report
=======================
Server: my-server.js
Transport: stdio

Tools (3):
  [PASS] get_user — Get user by ID
  [PASS] create_post — Create a new post
  [WARN] delete_all — Missing description

Resources (1):
  [PASS] file:///config — Server configuration

Summary: 3 tools, 1 resource
Status: WARN (1 warning)
```

## Use Cases

- **CI/CD** — Validate MCP servers in your pipeline before deployment
- **Development** — Quick feedback while building MCP servers
- **Monitoring** — Periodic health checks of running MCP services

## Related

- [mcp-server-create](https://www.npmjs.com/package/mcp-server-create) — Scaffold new MCP servers
- [openapi-mcp-gen](https://www.npmjs.com/package/openapi-mcp-gen) — Generate MCP servers from OpenAPI specs

## License

MIT
