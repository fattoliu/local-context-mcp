# local-context-mcp

Expose local files, workspaces, and AI coding history to MCP clients through a **read-only** bridge.

Access is request-scoped: the caller supplies a `root` path for generic file operations, and every resolved path must stay inside that root. No persistent path whitelist is required.

The server never exposes write, shell, delete, commit, or process-execution tools.

## Authorization model

There is no persistent path whitelist or blacklist.

Each tool call explicitly supplies a `root` path. That root is the complete access boundary for that call:

- the tool may read the root itself and descendants beneath it;
- `..` traversal outside root is rejected;
- symlink escapes are rejected;
- another directory requires another explicit root in a later call.

## Requirements

- Node.js 20+
- `cloudflared` for remote ChatGPT access

## Install

```bash
git clone https://github.com/fattoliu/local-context-mcp.git
cd local-context-mcp
npm install
```

## Local MCP

```bash
npm start
```

Endpoint:

```text
http://127.0.0.1:7331/mcp
```

Health check:

```text
http://127.0.0.1:7331/health
```

No local directory is permanently configured or exposed at startup.

## Fixed Cloudflare hostname

This repository defaults to the fixed hostname:

```text
mcp.fatto.dpdns.org
```

Install `cloudflared` if needed:

```bash
brew install cloudflared
```

Authorize this Mac with Cloudflare once:

```bash
cloudflared tunnel login
```

Then create/reuse the named tunnel and bind the DNS route:

```bash
npm run setup
```

The setup command uses tunnel name `local-context-mcp` and writes its local config to:

```text
~/.local-context-mcp/cloudflared.yml
```

Start the MCP server:

```bash
npm start
```

Start the Cloudflare Tunnel in another terminal:

```bash
npm run tunnel
```

The final public MCP URL is:

```text
https://mcp.fatto.dpdns.org/mcp
```

> Cloudflare Tunnel only provides secure transport to the Mac. Do not add this endpoint to ChatGPT until the OAuth layer is enabled. OAuth 2.1 / PKCE is the next implementation step.

## CLI

```bash
npm run doctor
npm run setup
npm start
npm run tunnel
```

Custom hostname/tunnel name is also supported:

```bash
node ./bin/local-context-mcp.js setup \
  --hostname mcp.example.com \
  --tunnel-name local-context-mcp
```

## MCP tools

### Generic local context

- `inspect_root(root)` — validate and describe the root explicitly supplied for a request.
- `list_directory(root, path?, depth?)` — list contents inside root.
- `read_file(root, path, start?, length?)` — read a UTF-8 file inside root with byte pagination.
- `search_files(root, query, ...)` — literal text search inside root.

Every generic file tool is request-scoped to `root`.

### Claude Code history

- `list_claude_projects(projectsRoot?)`
- `list_claude_sessions(projectsRoot?, projectId)`
- `read_claude_session(projectsRoot?, projectId, sessionId)`
- `search_claude_history(projectsRoot?, query, projectId?)`

For convenience, `projectsRoot` defaults to `~/.claude/projects`, but this is only a tool-argument default, not a server-wide whitelist.

## Security model

1. The path supplied as `root` defines the access boundary for that tool call.
2. Requested paths are resolved with `realpath`, so `..` traversal and symlink escapes are rejected.
3. Directory recursion does not follow symbolic links.
4. No file-write tool exists.
5. No shell/process tool exists in the MCP surface.
6. Large file reads and search result counts are capped.
7. MCP instructions explicitly mark local content as untrusted data so file contents are not treated as instructions.
8. The public Cloudflare hostname must be protected by OAuth before ChatGPT is connected.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `LOCAL_CONTEXT_HOST` | `127.0.0.1` | HTTP bind address |
| `LOCAL_CONTEXT_PORT` | `7331` | HTTP port |
| `LOCAL_CONTEXT_MAX_READ_BYTES` | `524288` | Maximum bytes returned by one `read_file` call |
| `LOCAL_CONTEXT_MAX_SEARCH_RESULTS` | `100` | Global search result cap |

There is intentionally no `LOCAL_CONTEXT_ROOTS` configuration.

## Example use cases

> Read everything relevant under `/Users/fatto/Desktop/ui-to-code` and explain the project.

> Search `/Users/fatto/Desktop/my-project` for `target_xpath`.

> Read my latest Claude Code conversation for the ui-to-code project.

> Search my Claude Code history for discussions about MCP.

## Roadmap

- OAuth 2.1 / PKCE for remote MCP clients.
- Guided ChatGPT connector setup.
- Background launch/keep-alive on macOS.
- Codex/Claude installer skill.
- More AI coding history providers (Codex, Cursor, etc.).
- Better text/binary detection and search indexing.

## License

MIT
