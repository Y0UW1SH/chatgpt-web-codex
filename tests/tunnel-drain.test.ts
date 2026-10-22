import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

for (const action of ["stop", "restart"]) {
  test(`CLI tunnel ${action} retains the daemon drain through the tunnel operation`, async () => {
    const fixture = mkdtempSync(join(tmpdir(), "codex-tunnel-drain-"));
    const program = join(fixture, "cli.ts");
    writeFileSync(program, `
      import { spyOn } from "bun:test";
      import * as config from ${JSON.stringify(join(root, "src/config.ts"))};
      import * as service from ${JSON.stringify(join(root, "src/service.ts"))};
      import * as tunnel from ${JSON.stringify(join(root, "src/tunnel.ts"))};
      import * as tunnelService from ${JSON.stringify(join(root, "src/tunnel-service.ts"))};
      let accepting = true;
      const calls = [];
      spyOn(config, "loadConfig").mockReturnValue({ host: "127.0.0.1", port: 17841, controlToken: "fixture" });
      spyOn(service, "getServiceStatus").mockReturnValue({ loaded: true });
      spyOn(globalThis, "fetch").mockImplementation(async url => {
        const action = new URL(url).pathname.split("/").at(-1);
        calls.push(action);
        accepting = action === "resume";
        return Response.json({ status: "ok", accepting_turns: accepting, active_http_turns: 0, active_browser_turns: 0 });
      });
      const check = name => {
        if (accepting) throw new Error("daemon accepted a new turn before " + name);
        calls.push(name);
      };
      spyOn(tunnelService, "restartTunnelService").mockImplementation(async () => { check("restart"); });
      spyOn(tunnelService, "stopTunnelService").mockImplementation(async () => { check("stop service"); });
      spyOn(tunnelService, "getTunnelServiceStatus").mockReturnValue({ running: ${action !== "stop"} });
      spyOn(tunnel, "stopTunnel").mockImplementation(() => { check("stop runtime"); });
      spyOn(tunnel, "waitForTunnelReady").mockImplementation(async () => { check("ready"); return { ok: true }; });
      spyOn(tunnel, "tunnelStatus").mockReturnValue({ ok: false });
      process.argv = [process.execPath, ${JSON.stringify(join(root, "src/cli.ts"))}, "tunnel", ${JSON.stringify(action)}];
      await import(${JSON.stringify(join(root, "src/cli.ts"))});
      process.once("beforeExit", () => console.log("CALLS=" + JSON.stringify(calls)));
    `);
    try {
      const child = Bun.spawn([process.execPath, program], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      const calls = JSON.parse(stdout.split("\n").find(line => line.startsWith("CALLS="))!.slice(6));
      expect(calls).toEqual(action === "restart"
        ? ["drain", "restart", "ready", "resume"]
        : ["drain", "stop service", "stop runtime", "resume"]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}

for (const refusesStop of [false, true]) {
test(`CLI uninstall ${refusesStop ? "preserves the tunnel and integration when the daemon refuses to stop" : "stops the daemon before removing its MCP tunnel"}`, async () => {
  const fixture = mkdtempSync(join(tmpdir(), "codex-uninstall-drain-"));
  const program = join(fixture, "cli.ts");
  const configPath = join(fixture, "config.json");
  writeFileSync(configPath, "{}");
  writeFileSync(program, `
    import { spyOn } from "bun:test";
    import * as config from ${JSON.stringify(join(root, "src/config.ts"))};
    import * as integration from ${JSON.stringify(join(root, "src/codex-integration.ts"))};
    import * as service from ${JSON.stringify(join(root, "src/service.ts"))};
    import * as tunnel from ${JSON.stringify(join(root, "src/tunnel.ts"))};
    import * as tunnelService from ${JSON.stringify(join(root, "src/tunnel-service.ts"))};
    let daemonLoaded = true;
    const calls = [];
    spyOn(config, "getConfigPath").mockReturnValue(${JSON.stringify(configPath)});
    spyOn(config, "loadConfig").mockReturnValue({ mode: "full", browserHost: "managed-chrome" });
    spyOn(service, "assertServiceIdle").mockResolvedValue(undefined);
    spyOn(service, "uninstallService").mockImplementation(async () => {
      if (${refusesStop}) throw new Error("daemon has an active browser turn");
      daemonLoaded = false;
      calls.push("stop daemon");
    });
    spyOn(tunnelService, "uninstallTunnelService").mockImplementation(async () => {
      if (daemonLoaded) throw new Error("daemon accepted a new turn before tunnel removal");
      calls.push("stop tunnel service");
    });
    spyOn(tunnel, "stopTunnel").mockImplementation(() => {
      if (daemonLoaded) throw new Error("daemon accepted a new turn before tunnel removal");
      calls.push("stop tunnel runtime");
    });
    spyOn(integration, "uninstallCodexIntegration").mockImplementation(() => { calls.push("restore integration"); });
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.argv = [process.execPath, ${JSON.stringify(join(root, "src/cli.ts"))}, "uninstall", "--yes", "--keep-data"];
    await import(${JSON.stringify(join(root, "src/cli.ts"))});
    process.once("beforeExit", () => console.log("CALLS=" + JSON.stringify(calls)));
  `);
  try {
    const child = Bun.spawn([process.execPath, program], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe(refusesStop ? "codex-chatgpt-web: daemon has an active browser turn\n" : "");
    expect(exitCode).toBe(refusesStop ? 1 : 0);
    const calls = JSON.parse(stdout.split("\n").find(line => line.startsWith("CALLS="))!.slice(6));
    expect(calls).toEqual(refusesStop ? [] : ["stop daemon", "stop tunnel service", "stop tunnel runtime", "restore integration"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
}
