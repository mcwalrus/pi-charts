# picarts — Specification

A pi harness extension that runs sidecart processes (shell commands) on session startup and tears them down on shutdown.

## Config

File: `.pi/picarts.json` (project-local)

```json
{
  "carts": [
    {
      "name": "api-portforward",
      "command": "kubectl port-forward svc/api 8080:80",
      "health": { "tcp": "localhost:8080" }
    },
    {
      "name": "redis",
      "command": "redis-server"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique identifier per project. Used in status, logs, commands. |
| `command` | string | yes | Shell command to run. Executed via `$SHELL -c`. |
| `health` | object | no | Readiness probe. |
| `health.tcp` | string | no* | `"host:port"` — TCP connect succeeds. |
| `health.command` | string | no* | Shell command — exit 0 means ready. |

\* At most one of `health.tcp` or `health.command`.

## Lifecycle

```
session_start
  ├── read .pi/picarts.json
  ├── spawn all carts (shell: true, $SHELL env)
  ├── pipe stdout+stderr → .pi/picarts/{name}.log (truncated on open)
  ├── for each cart with health:
  │     poll readiness (500ms interval, 10s timeout)
  │     on ready → setStatus("picarts:{name}", "● {name}")
  │     on timeout → setStatus("picarts:{name}", "✗ {name} (timeout)")
  ├── for each cart without health:
  │     setStatus("picarts:{name}", "● {name}")
  └── notify summary: "picarts: {n} carts started"

session_shutdown
  ├── kill all carts (SIGTERM, 5s grace then SIGKILL)
  └── clear all picarts status slots
```

On process crash mid-session:
- `ctx.ui.notify("picarts: {name} exited ({code})", "error")`
- `ctx.ui.setStatus("picarts:{name}", "✗ {name} (exit {code})")`
- No auto-restart.

## Process management

```typescript
const procs = new Map<string, { process: ChildProcess; name: string }>();
```

- `spawn(command, [], { shell: true, env: process.env })` — inherits pi's environment
- Shell: `process.env.SHELL || "/bin/sh"`
- On exit: update status, notify if unexpected
- On shutdown: `proc.kill("SIGTERM")` → wait 5s → `proc.kill("SIGKILL")` if alive

## Health check

```typescript
import { createConnection } from "node:net";

async function waitForTcp(addr: string, timeoutMs = 10000): Promise<boolean> {
  const [host, port] = addr.split(":");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = createConnection({ host, port: Number(port) }, resolve);
        sock.on("error", reject);
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

async function waitForCommand(cmd: string, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { status } = spawnSync(cmd, [], { shell: true });
    if (status === 0) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}
```

## `/picarts` command

```
/picarts              → list all carts with status
/picarts start <name> → start a single cart
/picarts stop <name>  → stop a single cart
/picarts restart <name> → stop then start
/picarts logs <name>  → show last 50 lines of log
/picarts status       → same as list (alias)
```

Output for `list`:

```
picarts:
  ● api-portforward  (pid 1234, healthy)
  ✗ redis            (exit 1)
  ○ my-cart           (stopped)
```

## Logging

- Log path: `.pi/picarts/{name}.log`
- Truncated (overwritten) on each start
- `/picarts logs <name>` reads last 50 lines
- `fs.mkdirSync(".pi/picarts", { recursive: true })` on first spawn

## Error handling

| Condition | Behavior |
|-----------|----------|
| No config file | Silent, no carts |
| Invalid JSON | `notify("picarts: invalid config", "error")` |
| Duplicate `name` | `notify("picarts: duplicate name '{name}'", "error")`, skip dupes |
| `command` not found | spawn emits `"error"`, notify |
| Health check timeout | Status shows `✗ {name} (timeout)`, process stays running |
| Spawn during shutdown race | Skip spawn, log warning |

## File structure

```
~/.pi/agent/extensions/picarts/
├── index.ts
```

Single file extension under `~/.pi/agent/extensions/` for global availability. No npm dependencies — uses `node:child_process`, `node:net`, `node:fs`, `node:path` only.

## Out of scope (v1)

- Global sidecarts (`~/.pi/agent/picarts.json`)
- Auto-restart on crash
- PID files / orphan cleanup
- `health.command` can be added but TCP covers the port-forward case
- Config editing via command
- Restart backoff / max retries
- Process grouping (cgroups, job control)