# local-context-mcp

Expose local files, workspaces, and AI coding history to MCP clients through a **read-only** bridge.

The server never exposes write, shell, delete, commit, or process-execution tools.

## Authorization model

There is no persistent path whitelist or blacklist.

Each tool call explicitly supplies a `root` path. That root is the complete access boundary for that call:

- the tool may read the root itself and descendants beneath it;
- `..` traversal outside root is rejected;
- symlink escapes are rejected;
- another directory requires another explicit root in a later call.

Example:

```text
root = /Users/fatto/Desktop/ui-to-code
```

That call may access:

```text
/Users/fatto/Desktop/ui-to-code/**
```

but not:

```text
/Users/fatto/Desktop/another-project
```

This keeps the interaction simple: give the MCP the path you want it to read, and that path defines the scope.

## Requirements

- Node.js 20+

## Install

```bash
git clone https://github.com/fattoliu/local-context-mcp.git
cd local-context-mcp
npm install
```

## Run

```bash
npm start
```

The MCP endpoint is:

```text
http://127.0.0.1:7331/mcp
```

Health check:

```text
http://127.0.0.1:7331/health
```

No local directory is permanently configured or exposed at startup.

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

For convenience, `projectsRoot` defaults to `~/.claude/projects`, but this is only a tool-argument default, not a server-wide whitelist. You can point the Claude parser at another compatible history directory at any time.

Claude Code session `.jsonl` files are normalized into role/text/timestamp records where possible.

## Security model

`local-context-mcp` is designed around a strict read-only boundary:

1. The path supplied as `root` defines the access boundary for that tool call.
2. Requested paths are resolved with `realpath`, so `..` traversal and symlink escapes are rejected.
3. Directory recursion does not follow symbolic links.
4. No file-write tool exists.
5. No shell/process tool exists.
6. Large file reads and search result counts are capped.
7. MCP instructions explicitly mark local content as untrusted data so file contents are not treated as instructions.

The current server binds to `127.0.0.1` by default and is intended for local development/testing. **Do not expose `/mcp` directly to the public Internet yet.** Remote ChatGPT connectivity with OAuth + a secure tunnel is planned as the next layer.

## Configuration

See `.env.example` for supported environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `LOCAL_CONTEXT_HOST` | `127.0.0.1` | HTTP bind address |
| `LOCAL_CONTEXT_PORT` | `7331` | HTTP port |
| `LOCAL_CONTEXT_MAX_READ_BYTES` | `524288` | Maximum bytes returned by one `read_file` call |
| `LOCAL_CONTEXT_MAX_SEARCH_RESULTS` | `100` | Global search result cap |

There is intentionally no `LOCAL_CONTEXT_ROOTS` configuration.

## Example use cases

Once connected to an MCP client, requests can look like:

> Read everything relevant under `/Users/fatto/Desktop/ui-to-code` and explain the project.

> Search `/Users/fatto/Desktop/my-project` for `target_xpath` and show me the relevant files.

> Read my Claude Code history under `~/.claude/projects` and find the latest ui-to-code conversation.

> Search my Claude Code history for discussions about MCP.

## Roadmap

- OAuth 2.1 / PKCE for remote MCP clients.
- Cloudflare Tunnel integration.
- Guided ChatGPT connector setup.
- Codex/Claude installer skill.
- More AI coding history providers (Codex, Cursor, etc.).
- Better text/binary detection and search indexing.

## License

MIT
