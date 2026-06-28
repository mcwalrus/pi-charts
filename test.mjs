/**
 * picarts tests — node:test, no framework
 *
 * Tests the pure logic extracted from the extension:
 *   - config validation
 *   - health check helpers (TCP + command)
 *   - status symbol mapping
 *   - startup notification summary strings
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";

// ── Logic extracted from extension (same code, no pi imports needed) ──────────

function statusSymbol(status) {
  switch (status) {
    case "healthy":  return "●";
    case "starting": return "○";
    case "stopped":  return "○";
    case "timeout":  return "✗";
    case "crashed":  return "✗";
  }
}

function validateConfig(raw, warnings = []) {
  if (!Array.isArray(raw.carts)) return [];
  const seen = new Set();
  const valid = [];
  for (const cart of raw.carts) {
    if (!cart.name || !cart.command) {
      warnings.push("cart missing name or command");
      continue;
    }
    if (seen.has(cart.name)) {
      warnings.push(`duplicate name '${cart.name}'`);
      continue;
    }
    seen.add(cart.name);
    valid.push(cart);
  }
  return valid;
}

function summaryMessage(states) {
  const healthy = states.filter((s) => s.status === "healthy").length;
  const total = states.length;
  if (healthy === total) return `picarts: ${total} cart${total !== 1 ? "s" : ""} started`;
  if (healthy === 0)     return `picarts: 0 carts started, ${total} failed`;
  return `picarts: ${healthy} of ${total} carts started, ${total - healthy} failed`;
}

async function waitForTcp(addr, timeoutMs = 3_000) {
  const { createConnection } = await import("node:net");
  const lastColon = addr.lastIndexOf(":");
  const host = addr.slice(0, lastColon);
  const port = Number(addr.slice(lastColon + 1));
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const sock = createConnection({ host, port }, () => { sock.destroy(); resolve(true); });
      sock.on("error", () => resolve(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("statusSymbol — all states", () => {
  assert.equal(statusSymbol("healthy"),  "●");
  assert.equal(statusSymbol("starting"), "○");
  assert.equal(statusSymbol("stopped"),  "○");
  assert.equal(statusSymbol("timeout"),  "✗");
  assert.equal(statusSymbol("crashed"),  "✗");
});

test("validateConfig — valid carts", () => {
  const raw = {
    carts: [
      { name: "a", command: "echo a" },
      { name: "b", command: "echo b" },
    ],
  };
  const result = validateConfig(raw);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, "a");
});

test("validateConfig — missing name/command skipped", () => {
  const warnings = [];
  const raw = { carts: [{ name: "a" }, { command: "echo hi" }, { name: "b", command: "echo b" }] };
  const result = validateConfig(raw, warnings);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "b");
  assert.equal(warnings.length, 2);
});

test("validateConfig — duplicate names skipped", () => {
  const warnings = [];
  const raw = { carts: [{ name: "a", command: "x" }, { name: "a", command: "y" }] };
  const result = validateConfig(raw, warnings);
  assert.equal(result.length, 1);
  assert.ok(warnings.some((w) => w.includes("duplicate")));
});

test("validateConfig — not an array returns empty", () => {
  const result = validateConfig({ carts: "nope" });
  assert.equal(result.length, 0);
});

test("summaryMessage — all healthy", () => {
  const states = [{ status: "healthy" }, { status: "healthy" }];
  assert.equal(summaryMessage(states), "picarts: 2 carts started");
});

test("summaryMessage — singular cart", () => {
  const states = [{ status: "healthy" }];
  assert.equal(summaryMessage(states), "picarts: 1 cart started");
});

test("summaryMessage — all failed", () => {
  const states = [{ status: "timeout" }, { status: "crashed" }];
  assert.equal(summaryMessage(states), "picarts: 0 carts started, 2 failed");
});

test("summaryMessage — partial failure", () => {
  const states = [{ status: "healthy" }, { status: "timeout" }, { status: "healthy" }];
  assert.equal(summaryMessage(states), "picarts: 2 of 3 carts started, 1 failed");
});

test("waitForTcp — connects to a real listening server", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const ok = await waitForTcp(`127.0.0.1:${port}`);
    assert.ok(ok, "should succeed connecting to listening port");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("waitForTcp — times out when nothing listening", async () => {
  // Port 1 is almost certainly not listening and not firewalled to a different error
  const ok = await waitForTcp("127.0.0.1:1", 600);
  assert.equal(ok, false, "should time out on closed port");
});
