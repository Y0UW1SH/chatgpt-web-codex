import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import { responseRequest } from "../src/server";

const chunkCount = 10_001;

function respond(stream: boolean, asynchronous: boolean): Promise<Response> {
  return responseRequest(new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    body: JSON.stringify({ model: "chatgpt-web/high", input: "Write an answer", stream }),
  }), defaultConfig("browser-only"), () => ({
    name: "event-backlog-fixture",
    async runTurn(_parsed, _incoming, emit) {
      for (let index = 0; index < chunkCount; index++) {
        emit({ type: "text_delta", text: "x" });
        if (asynchronous) await Promise.resolve();
      }
      emit({ type: "done", stopReason: "stop", endTurn: true });
    },
  }), { rememberState: false });
}

test("non-streaming responses drain asynchronous events while the adapter is running", async () => {
  const response = await respond(false, true);
  const body = await response.json();
  expect(body.status).toBe("completed");
  expect(body.output).toHaveLength(1);
  expect(body.output[0].content[0].text).toBe("x".repeat(chunkCount));
});

test("a synchronous event backlog returns an explicit JSON failure instead of rejecting the handler", async () => {
  const response = await respond(false, false);
  const body = await response.json();
  expect(body.status).toBe("failed");
  expect(body.error.message).toContain("Adapter event backlog exceeded");
});

test("a synchronous event backlog ends SSE with a failure instead of an unhandled producer rejection", async () => {
  const response = await respond(true, false);
  const body = await response.text();
  expect(body.includes("event: response.failed")).toBe(true);
  expect(body.includes("Adapter event backlog exceeded")).toBe(true);
  expect(body.includes("event: response.completed")).toBe(false);
  expect(body.endsWith("data: [DONE]\n\n")).toBe(true);
});
