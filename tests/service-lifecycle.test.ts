import { describe, expect, spyOn, test } from "bun:test";
import * as service from "../src/service";
import { negotiateDrain, withServiceDrain } from "../src/service";

describe("service drain lifecycle", () => {
  test("compensates when a drain may have reached the daemon before the client times out", async () => {
    const actions: string[] = [];
    let acceptingTurns = true;
    const control = async (action: "drain" | "resume") => {
      actions.push(action);
      acceptingTurns = action === "resume";
      if (action === "drain") throw new Error("request timed out after delivery");
      return { accepting_turns: true, active_http_turns: 0, active_browser_turns: 0 };
    };

    await expect(negotiateDrain(control)).rejects.toThrow("atomic idleness could not be proven");
    expect(actions).toEqual(["drain", "resume"]);
    expect(acceptingTurns).toBe(true);
  });

  test("releases a verified idle drain", async () => {
    const actions: string[] = [];
    const lease = await negotiateDrain(async action => {
      actions.push(action);
      return action === "drain"
        ? { accepting_turns: false, active_http_turns: 0, active_browser_turns: 0 }
        : { accepting_turns: true, active_http_turns: 0, active_browser_turns: 0 };
    });
    expect(actions).toEqual(["drain"]);
    await lease.release();
    expect(actions).toEqual(["drain", "resume"]);
  });

  for (const operationFails of [false, true]) {
    test(`holds the daemon drain through asynchronous work and resumes after ${operationFails ? "failure" : "success"}`, async () => {
      let accepting = true;
      const loaded = spyOn(service, "getServiceStatus").mockReturnValue({ loaded: true } as never);
      const fetch = spyOn(globalThis, "fetch").mockImplementation((async url => {
        accepting = String(url).endsWith("/resume");
        return Response.json({ accepting_turns: accepting, active_http_turns: 0, active_browser_turns: 0 });
      }) as typeof globalThis.fetch);
      try {
        const operation = withServiceDrain({ host: "127.0.0.1", port: 17841, controlToken: "fixture" } as never, async () => {
          expect(accepting).toBe(false);
          await Promise.resolve();
          expect(accepting).toBe(false);
          if (operationFails) throw new Error("tunnel mutation failed");
          return "ready";
        });
        if (operationFails) await expect(operation).rejects.toThrow("tunnel mutation failed");
        else expect(await operation).toBe("ready");
        expect(accepting).toBe(true);
      } finally {
        fetch.mockRestore();
        loaded.mockRestore();
      }
    });
  }

  test("preserves both a failed runtime mutation and a failed compensating resume", async () => {
    const loaded = spyOn(service, "getServiceStatus").mockReturnValue({ loaded: true } as never);
    const fetch = spyOn(globalThis, "fetch").mockImplementation((async url => String(url).endsWith("/resume")
      ? new Response(null, { status: 503 })
      : Response.json({ accepting_turns: false, active_http_turns: 0, active_browser_turns: 0 })) as typeof globalThis.fetch);
    try {
      await expect(withServiceDrain({ host: "127.0.0.1", port: 17841, controlToken: "fixture" } as never,
        async () => { throw new Error("tunnel mutation failed"); }))
        .rejects.toThrow("tunnel mutation failed; compensating daemon resume also failed: HTTP 503");
    } finally {
      fetch.mockRestore();
      loaded.mockRestore();
    }
  });
});
