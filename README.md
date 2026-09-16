# local-context-mcp

Expose selected local files, workspaces, and AI coding history to MCP clients through a **read-only** bridge.

The first release focuses on two things:

- generic local file access under explicitly allowed roots;
- Claude Code history under `~/.claude/projects`.

The server never exposes write, shell, delete, commit, or process-execution tools.

## Requirements

- Node.js 20+

## Install

```bash
git clone https://github.com/fattoliu/local-context-mcp.git
cd local-context-mcp
npm install
```

## Run

By default, only `~/.claude/projects` is exposed:

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

To expose more local directories on macOS/Linux:

```bash
LOCAL_CONTEXT_ROOTS="$HOME/.claude/projects:/Users/fatto/Desktop" npm start
```

Do not expose your entire home directory unless you actually want every readable file beneath it to become available to the MCP client.

## MCP tools

### Generic local context

- `list_roots` — list explicitly allowed local roots.
- `list_directory` — list directory contents under an allowed root.
- `read_file` — read a UTF-8 file with byte pagination.
- `search_files` — literal text search under an allowed root.

### Claude Code history

- `list_claude_projects`
- `list_claude_sessions`
- `read_claude_session`
- `search_claude_history`

Claude Code session `.jsonl` files are normalized into role/text/timestamp records where possible.

## Security model

`local-context-mcp` is designed around a strict read-only boundary:

1. Only paths beneath `LOCAL_CONTEXT_ROOTS` can be accessed.
2. Paths are resolved with `realpath`, so `..` traversal and symlink escapes are rejected.
3. No file-write tool exists.
4. No shell/process tool exists.
5. Large file reads and search result counts are capped.
6. MCP instructions explicitly mark local content as untrusted data so file contents are not treated as instructions.

The current `0.1.x` server binds to `127.0.0.1` by default and is intended for local development/testing. **Do not expose `/mcp` directly to the public Internet yet.** Remote ChatGPT connectivity with OAuth + a secure tunnel is planned as the next layer.

## Configuration

See `.env.example` for supported environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `LOCAL_CONTEXT_HOST` | `127.0.0.1` | HTTP bind address |
| `LOCAL_CONTEXT_PORT` | `7331` | HTTP port |
| `LOCAL_CONTEXT_ROOTS` | `~/.claude/projects` | Allowed roots, separated by the platform path delimiter |
| `CLAUDE_PROJECTS_ROOT` | `~/.claude/projects` | Claude Code history root |
| `LOCAL_CONTEXT_MAX_READ_BYTES` | `524288` | Maximum bytes returned by one `read_file` call |
| `LOCAL_CONTEXT_MAX_SEARCH_RESULTS` | `100` | Global search result cap |

## Example use cases

Once connected to an MCP client, requests can look like:

> Read my latest Claude Code conversation for the ui-to-code project.

> Search my Claude Code history for discussions about MCP.

> Search `/Users/fatto/Desktop/my-project` for `target_xpath` and show me the relevant files.

> Read the README and package.json from this local project.

## Roadmap

- OAuth 2.1 / PKCE for remote MCP clients.
- Cloudflare Tunnel integration.
- Guided ChatGPT connector setup.
- Codex/Claude installer skill.
- More AI coding history providers (Codex, Cursor, etc.).
- Better text/binary detection and search indexing.

## License

MIT
