# picarts

A [pi.dev](https://pi.dev) harness extension that runs sidecart processes on session startup — `kubectl port-forward`, `redis-server`, or any shell command — and tears them down cleanly on shutdown.

## Install

Place in the global extensions directory:

```
~/.pi/agent/extensions/picarts/index.ts
```

Pi auto-discovers extensions in this location. No build step required (jiti handles TypeScript).

## Configure

Create `.pi/picarts.json` in your project root:

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

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Unique identifier per project |
| `command` | yes | Shell command to run |
| `health.tcp` | no | `"host:port"` — TCP readiness probe |
| `health.command` | no | Shell command — exit 0 means ready |

## What happens

On `session_start`:
1. Reads `.pi/picarts.json`
2. Spawns each cart via your shell (`$SHELL`)
3. Pipes output to `.pi/picarts/{name}.log`
4. Runs health checks (if configured) with 10s timeout
5. Shows footer status: `● api-portforward` or `✗ redis (timeout)`
6. Notifies you: `picarts: 2 carts started` or `picarts: 1 of 2 carts started, 1 failed`

On `session_shutdown`:
1. Sends SIGTERM to all carts
2. Waits 5s, then SIGKILL if still alive
3. Clears footer status

## Commands

```
/picarts              List all carts with status
/picarts start <name> Start a cart
/picarts stop <name>  Stop a cart
/picarts restart <name> Stop then start
/picarts logs <name>  Show last 50 lines of log
/picarts status       Same as list
```

## Logs

Per-cart logs at `.pi/picarts/{name}.log`, truncated on each start. View with `/picarts logs <name>` or the built-in `read` tool.

## Failure handling

- **Startup failure:** Notified with log path (e.g. `picarts: redis failed (exit 1). Logs: .pi/picarts/redis.log`)
- **Mid-session crash:** Notified immediately, no auto-restart
- **Health check timeout:** Cart stays running, status shows `✗ {name} (timeout)`

## Documentation

- [Specification](docs/SPECIFICATION.md)
- [Design considerations](docs/CONSIDERATIONS.md)