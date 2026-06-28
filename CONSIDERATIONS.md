# picarts — Considerations

## 1. Config placement

**Option A: `.pi/picarts.json`** — Sits next to `settings.json` in the standard `.pi/` config dir. Simple, follows pi convention, one file per project.

**Option B: `.pi/picarts/config.json`** — Dedicated subdirectory. Allows future files (logs, pid files) without cluttering `.pi/` root. Overkill for a single config today but scales.

**Recommendation:** `.pi/picarts.json`. One file, one concern. If we need logs/pids later, add `.pi/picarts/` then — the directory can coexist. YAGNI on the subdirectory.

Config shape:

```json
{
  "carts": [
    {
      "name": "api-portforward",
      "command": "kubectl port-forward svc/api 8080:80",
      "health": { "tcp": "localhost:8080" }
    }
  ]
}
```

## 2. Lifecycle: when sidecarts start and stop

pi extensions must **not** start background processes in the factory function. The factory runs in invocations that never start a session (`pi --list-models`, etc.).

**Correct lifecycle:**
- `session_start` → spawn sidecart processes
- `session_shutdown` → kill them (reason: `"quit" | "reload" | "new" | "resume" | "fork"`)

On `/reload`, `session_shutdown` fires then `session_start` fires again. Sidecarts should be restarted.

On `/new` or `/resume`, the old session shuts down and a new one starts. Sidecarts from the old session get killed; the new session re-reads config and starts fresh if the project config still applies.

## 3. Process management

`node:child_process.spawn()` is the right primitive — not `exec` (buffers), not `spawnSync` (blocks).

Each sidecart needs:
- The `ChildProcess` handle (for `.kill()` on shutdown)
- The configured `name` (for status display)
- Exit status tracking

No process manager library needed. A `Map<string, { process: ChildProcess, name: string }>` in the extension closure does it. ponytail: `Map` over a process manager class.

## 4. Logs, warnings, and exit statuses

**Logs:** Pipe `stdout`/`stderr` from each sidecart to a log file: `.pi/picarts/{name}.log`. Rotating logs are overkill — truncate on start. The LLM can read the log file with the built-in `read` tool if it needs to debug.

**Exit status:** Watch for `"exit"` and `"close"` events on each `ChildProcess`. On unexpected exit (non-zero, or exit without `session_shutdown`):
- `ctx.ui.notify()` with warning
- `ctx.ui.setStatus("picarts:{name}", theme.fg("error", "✗ {name}"))`

**Restart policy:** For v1, do not auto-restart. Log the crash, notify the user, let them decide. Auto-restart is a rabbit hole (backoff, max retries, flapping). Add when a real need surfaces.

## 5. Shell involvement

`spawn(command, [], { shell: true })` — let the shell handle argument splitting, env vars, and PATH resolution. This is what `kubectl port-forward` needs.

Use the user's shell: `process.env.SHELL || "/bin/sh"`. This picks up local shell configuration (`.zshrc`, `.bashrc` aliases, etc.) which matters for `kubectl` and similar tools.

For environment: pass `process.env` as-is. The sidecart inherits the pi process environment, which is what the user expects.

## 6. Health-check / readiness probe

**Do we need it?** For `kubectl port-forward`, yes — the process starts but the tunnel isn't ready for a second or two. Other sidecarts may have similar warm-up.

**Minimal implementation:** Optional `health` field per sidecart config:
- `{ "tcp": "localhost:8080" }` — TCP connect succeeds
- `{ "command": "curl -sf http://localhost:8080/health" }` — exit code 0

On `session_start`, after spawning, poll the health check with a timeout (e.g. 10s, 500ms interval). Once healthy (or timeout), update status.

Skip it for v1 if it adds complexity. The user can see `kubectl` output in the log. But a simple TCP check is ~10 lines:

```typescript
async function waitForTcp(host: string, port: number, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { await connect({ host, port }); return true; }
    catch { await new Promise(r => setTimeout(r, 500)); }
  }
  return false;
}
```

## 7. How this affects the pi harness

**Minimal impact.** The extension:
- Subscribes to `session_start` and `session_shutdown` — standard lifecycle events
- Uses `ctx.ui.setStatus()` for sidecart status in the footer
- Uses `ctx.ui.notify()` for warnings
- Registers a `/picarts` command for manual management (list, restart, stop, start)

It does **not**:
- Override any built-in tools
- Modify the system prompt
- Intercept tool calls
- Add tools the LLM calls

The only surface is a slash command and footer status. The harness is unaffected otherwise.

## 8. Existing frameworks to consider

**VS Code tasks** (`tasks.json`): Has `problemMatcher`, `presentation`, `group`, `isBackground`. Over-engineered for our case. We don't need problem matchers or panel management.

**foreman/overmind (Procfile)**: Process managers for dev. Good model but we're not building a general process manager. We're spawning 1-3 sidecarts.

**docker-compose healthchecks**: Good conceptual model for the `health` field, but we don't need the full DSL. TCP check + optional command is enough.

**systemd**: Has restart policies, dependencies, socket activation. Overkill.

**Takeaway:** No framework needed. `spawn` + `Map` + lifecycle events. The pi extension API already gives us everything.

## 9. Failure modes

| Scenario | Behavior |
|----------|----------|
| Config file missing | No sidecarts started, silent (no error) |
| Config invalid JSON | `ctx.ui.notify("picarts: invalid config", "error")`, skip |
| Command not found | `spawn` emits `"error"` event, notify, no retry |
| Process crashes mid-session | Notify, update status, no auto-restart |
| pi exits without `session_shutdown` (SIGKILL) | Orphan processes. Acceptable for v1. Could write PID files later. |
| Multiple sidecarts, one fails | Others keep running, failed one shows error status |

## 10. Open questions for review

1. **Config location:** `.pi/picarts.json` vs `.pi/picarts/config.json` — preference?
2. **Auto-restart on crash:** Skip for v1? Or simple single-retry?
3. **Health checks:** Include simple TCP check in v1? Or ship without and add when needed?
4. **PID files:** Needed for orphan cleanup on SIGKILL? Or acceptable to leave orphans for v1?
5. **Global sidecarts:** Should `~/.pi/agent/picarts.json` also be supported for sidecarts that run regardless of project?
6. **`/picarts` command scope:** Just list/restart/stop/start? Or also edit config?