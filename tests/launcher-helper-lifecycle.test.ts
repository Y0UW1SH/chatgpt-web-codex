import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LauncherBrowserHelperClient } from "../src/adapters/chatgpt-web/launcher-helper-client";
import type { BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL } from "../src/launcher-browser-host";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function lifecycleClient(script: (root: string) => string, controlEndpoint = "http://127.0.0.1:39002") {
  const root = mkdtempSync(join(tmpdir(), "codex-helper-lifecycle-"));
  roots.push(root);
  const helper = join(root, "helper.cjs");
  writeFileSync(helper, script(root));
  const descriptorPath = join(root, "launcher.json");
  writeFileSync(descriptorPath, JSON.stringify({
    version: 3,
    kind: LAUNCHER_BROWSER_HOST_KIND,
    profile: "production",
    pid: process.pid,
    endpoint: "http://127.0.0.1:39001",
    control: {
      endpoint: controlEndpoint,
      token: "launcher-control-token-0123456789abcdefghijklmnop",
    },
    helper: { executable: process.execPath, script: helper },
    partition: "persist:codex-web-gpt-chatgpt",
    idleUrl: LAUNCHER_BROWSER_IDLE_URL,
    surfaceId: "launcher_surface_id_0123456789AB",
    surfaceTargets: { launcher_surface_id_0123456789AB: "native-owned-target" },
    createdAt: new Date().toISOString(),
  }), { mode: 0o600 });
  return new LauncherBrowserHelperClient({
    appName: "Codex Native2",
    browserHost: "launcher",
    browserHostDescriptorPath: descriptorPath,
    storageStatePath: join(root, "unused-state.json"),
    chromeExecutablePath: join(root, "unused-chrome"),
    turnTimeoutMs: 60_000,
    headed: true,
    autoApproveToolCalls: false,
    useSavedChats: false,
  });
}

test("closing a helper before readiness rejects its waiting turn", async () => {
  // Stay alive without advertising readiness, then honor the client's shutdown request.
  const client = lifecycleClient(() => "process.stdin.on('data', () => process.exit(0));\n");
  const turn = client.run({
    traceId: "close_before_ready",
    modelId: "gpt-5.6-sol",
    reasoning: "high",
    capabilities: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: false, proAvailable: false },
    prepare: async () => ({ text: "inspect", images: [], release() {} }),
    onTextDelta() {},
  }).then(() => "resolved", error => error);
  try {
    await client.close();
    const result = await Promise.race([turn, Bun.sleep(100).then(() => "still pending")]);
    expect(result).toBeInstanceOf(DOMException);
    expect(result.name).toBe("AbortError");
  } finally {
    await client.close();
  }
});

test.each([false, true])("old helper release cannot reject a replacement turn (release failure=%s)", async releaseFails => {
  let releaseEnd!: () => void;
  const heldEnd = new Promise<void>(resolve => { releaseEnd = resolve; });
  let receiveEnd!: () => void;
  const receivedEnd = new Promise<void>(resolve => { receiveEnd = resolve; });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch() {
      receiveEnd();
      await heldEnd;
      return releaseFails
        ? Response.json({ error: "old release failed" }, { status: 503 })
        : Response.json({ cancelledByUser: false });
    },
  });
  const client = lifecycleClient(root => `
    const fs = require("node:fs");
    const input = require("node:readline").createInterface({ input: process.stdin });
    const marker = ${JSON.stringify(join(root, "first-helper-started"))};
    const write = message => console.log(JSON.stringify(message));
    write({ type: "ready" });
    input.on("line", line => {
      const message = JSON.parse(line);
      if (message.type === "run") {
        if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "started"); process.exit(17); }
        write({ type: "event", id: message.id, event: "text", text: "replacement ready" });
      } else if (message.type === "result-request") {
        write({ type: "result", id: message.id, text: "replacement answer" });
      } else if (message.type === "shutdown") process.exit(0);
    });
  `, `http://127.0.0.1:${server.port}`);
  const abort = new AbortController();
  const turn: BrowserTurn = {
    traceId: "same_trace_replacement",
    modelId: "gpt-5.6-sol", reasoning: "high",
    capabilities: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: false, proAvailable: false },
    prepare: async () => ({ text: "inspect", images: [], release() {} }),
    onTextDelta() {},
  };
  try {
    const first = client.run({ ...turn, abortSignal: abort.signal }).catch(error => error);
    await receivedEnd;
    abort.abort();
    await first;
    let replacementStarted!: () => void;
    const started = new Promise<void>(resolve => { replacementStarted = resolve; });
    const replacement = client.run({ ...turn, onTextDelta: replacementStarted });
    // Observe rejection immediately, including on the unfixed implementation.
    const result = replacement.then(value => value, error => error);
    await started;
    releaseEnd();
    await Bun.sleep(50);
    await (client as unknown as { send(message: unknown): Promise<void> }).send({ type: "result-request", id: turn.traceId });
    expect(await result).toBe("replacement answer");
  } finally {
    releaseEnd();
    await client.close();
    await server.stop(true);
  }
});

test.each(["run", "abort"])("a delayed %s write failure cannot reject a replacement turn", async delayedType => {
  const client = lifecycleClient(() => `
    const input = require("node:readline").createInterface({ input: process.stdin });
    const write = message => console.log(JSON.stringify(message));
    write({ type: "ready" });
    input.on("line", line => {
      const message = JSON.parse(line);
      if (message.type === "run") write({ type: "event", id: message.id, event: "text", text: "started" });
      else if (message.type === "result-request") write({ type: "result", id: message.id, text: "answer" });
      else if (message.type === "shutdown") process.exit(0);
    });
  `);
  type WireClient = {
    sendTo(child: unknown, message: { type: string }): Promise<void>;
    send(message: { type: string; id: string }): Promise<void>;
  };
  const wire = client as unknown as WireClient;
  const sendTo = wire.sendTo.bind(client);
  let releaseWrite!: () => void;
  const heldWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
  let observeWrite!: () => void;
  const observedWrite = new Promise<void>(resolve => { observeWrite = resolve; });
  let delayed = false;
  let failedWrite: Promise<void> | undefined;
  const send = spyOn(wire, "sendTo").mockImplementation((child, message) => {
    const written = sendTo(child, message);
    if (delayed || message.type !== delayedType) return written;
    delayed = true;
    // Delivery can precede a transport error. Delay only the write acknowledgement;
    // keep the helper and both turn results running through the real protocol.
    const result = written.then(async () => {
      observeWrite();
      await heldWrite;
      throw new Error("old write failed");
    });
    failedWrite = result.catch(() => {});
    return result;
  });
  const abort = new AbortController();
  const turn: BrowserTurn = {
    traceId: "same_trace_write_replacement", modelId: "gpt-5.6-sol", reasoning: "high",
    capabilities: { localToolsEnabled: false, solAvailable: true, extraHighAvailable: false, proAvailable: false },
    prepare: async () => ({ text: "inspect", images: [], release() {} }), onTextDelta() {},
  };
  try {
    let firstStarted!: () => void;
    const started = new Promise<void>(resolve => { firstStarted = resolve; });
    const first = client.run({ ...turn, abortSignal: abort.signal, onTextDelta: firstStarted });
    await started;
    if (delayedType === "abort") abort.abort();
    await observedWrite;
    await wire.send({ type: "result-request", id: turn.traceId });
    expect(await first).toBe("answer");
    let replacementStarted!: () => void;
    const replacementReady = new Promise<void>(resolve => { replacementStarted = resolve; });
    const result = client.run({ ...turn, onTextDelta: replacementStarted }).then(value => value, error => error);
    await replacementReady;
    releaseWrite();
    await failedWrite;
    await new Promise<void>(resolve => setImmediate(resolve));
    await wire.send({ type: "result-request", id: turn.traceId });
    expect(await result).toBe("answer");
  } finally {
    releaseWrite();
    await client.close();
    send.mockRestore();
  }
});
