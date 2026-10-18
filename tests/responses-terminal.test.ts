import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bridgeToResponsesSSE, buildResponseJSON } from "../src/bridge";
import { decodeCompactionSummary } from "../src/responses/compaction";
import { expandPreviousResponseInput, flushResponseState, rememberResponseState } from "../src/responses/state";
import type { AdapterEvent } from "../src/types";

async function streamedResponse(events: AdapterEvent[], compaction = false): Promise<Record<string, unknown>> {
  async function* source(): AsyncGenerator<AdapterEvent> {
    yield* events;
  }
  const text = await new Response(bridgeToResponsesSSE(
    source(), "chatgpt-web/test", undefined, undefined, undefined, undefined, 2_000,
    { compaction },
  )).text();
  const terminal = text.split("\n")
    .filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)))
    .find(event => ["response.completed", "response.incomplete", "response.failed"].includes(event.type));
  expect(terminal).toBeDefined();
  return terminal.response;
}

test("content-filtered output is incomplete in both JSON and SSE responses", async () => {
  const events: AdapterEvent[] = [
    { type: "text_delta", text: "Partial answer" },
    { type: "done", stopReason: "content_filter", endTurn: true },
  ];
  for (const response of [buildResponseJSON(events, "chatgpt-web/test"), await streamedResponse(events)]) {
    expect(response).toMatchObject({ status: "incomplete", incomplete_details: { reason: "content_filter" } });
  }
});

test("adapter EOF without a terminal event is incomplete in both JSON and SSE responses", async () => {
  const events: AdapterEvent[] = [{ type: "text_delta", text: "Unfinished answer" }];
  for (const response of [buildResponseJSON(events, "chatgpt-web/test"), await streamedResponse(events)]) {
    expect(response).toMatchObject({ status: "incomplete", incomplete_details: { reason: "adapter_eof" } });
  }
});

for (const stopReason of ["max_tokens", "content_filter"]) {
  test(`incomplete ${stopReason} compaction never supplies replacement history`, async () => {
    const events: AdapterEvent[] = [
      { type: "text_delta", text: "Truncated checkpoint" },
      { type: "done", stopReason, endTurn: true },
    ];
    for (const response of [
      buildResponseJSON(events, "chatgpt-web/test", { compaction: true }),
      await streamedResponse(events, true),
    ]) {
      expect(response.status).toBe("incomplete");
      expect(response.output).toEqual([]);
    }
  });
}

test("compaction adapter EOF never supplies replacement history", async () => {
  const events: AdapterEvent[] = [{ type: "text_delta", text: "Unfinished checkpoint" }];
  for (const response of [
    buildResponseJSON(events, "chatgpt-web/test", { compaction: true }),
    await streamedResponse(events, true),
  ]) {
    expect(response.status).toBe("incomplete");
    expect(response.output).toEqual([]);
  }
});

test("completed compaction still supplies exactly one checkpoint in JSON and SSE", async () => {
  const events: AdapterEvent[] = [
    { type: "text_delta", text: "Complete checkpoint" },
    { type: "done", stopReason: "stop", endTurn: true },
  ];
  for (const response of [
    buildResponseJSON(events, "chatgpt-web/test", { compaction: true }),
    await streamedResponse(events, true),
  ]) {
    expect(response.status).toBe("completed");
    const output = response.output as Array<{ type: string; encrypted_content: string }>;
    expect(output).toHaveLength(1);
    expect(output[0]!.type).toBe("compaction");
    expect(decodeCompactionSummary(output[0]!.encrypted_content)).toBe("Complete checkpoint");
  }
});

test("continuation cache retains max-token partials and rejects filtered or unfinished output", async () => {
  const cases: Array<{ response: Record<string, unknown>; replayable: boolean }> = [];
  for (const stopReason of ["max_tokens", "content_filter", undefined]) {
    const events: AdapterEvent[] = [
      { type: "text_delta", text: "Partial answer" },
      ...(stopReason ? [{ type: "done" as const, stopReason }] : []),
    ];
    for (const response of [buildResponseJSON(events, "chatgpt-web/test"), await streamedResponse(events)]) {
      cases.push({ response, replayable: stopReason === "max_tokens" });
    }
  }
  const originalHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = mkdtempSync(join(tmpdir(), "responses-terminal-"));
  try {
    process.env.CODEX_CHATGPT_WEB_HOME = home;
    for (const { response, replayable } of cases) {
      rememberResponseState({ input: "Original prompt", store: false }, response, { force: true });
      const next = { previous_response_id: response.id, input: "Continue" };
      const expanded = expandPreviousResponseInput(next);
      if (replayable) {
        expect(expanded).not.toBe(next);
        expect((expanded as Record<string, unknown>).input).toEqual([
          { role: "user", content: "Original prompt" },
          ...(response.output as unknown[]),
          { role: "user", content: "Continue" },
        ]);
      } else {
        expect(expanded).toBe(next);
      }
    }
  } finally {
    flushResponseState();
    if (originalHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  }
});
