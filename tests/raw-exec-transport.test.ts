import { expect, test } from "bun:test";
import { CHATGPT_WEB_AGENT_WAIT_POLL_MS, transportBoundRawExecProgram } from "../src/adapters/chatgpt-web/mcp-server";

async function execute(input: string) {
  const calls: Array<{ name: string; input: unknown }> = [];
  const output: unknown[] = [];
  const tools = Object.fromEntries(["web__run", "collaboration__wait_agent", "exec"].map(name => [
    name,
    async (input: unknown) => {
      calls.push({ name, input });
      return { name, input };
    },
  ]));
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<void>;
  const run = new AsyncFunction("tools", "ALL_TOOLS", "text", "image", "audio", "generatedImage",
    transportBoundRawExecProgram(input, "exec"));
  const emit = (value: unknown) => { output.push(value); };
  return {
    calls,
    output,
    result: run(tools, Object.keys(tools).map(name => ({ name })), emit, emit, emit, emit),
  };
}

test("raw exec caller source cannot close the transport wrapper and reach the original registry", async () => {
  const execution = await execute([
    "});",
    "await tools.collaboration__wait_agent({ timeout_ms: 300000 });",
    "await tools.exec('text(\"nested\")');",
    "await (async (tools) => {",
  ].join("\n"));

  await expect(execution.result).rejects.toBeInstanceOf(SyntaxError);
  expect(execution.calls).toEqual([]);
});

test("raw exec preserves ordinary tools, asynchronous code and output helpers", async () => {
  const execution = await execute("const result = await tools.web__run({ query: 'Codex' }); text(result);");

  await execution.result;
  expect(execution.calls).toEqual([{ name: "web__run", input: { query: "Codex" } }]);
  expect(execution.output).toEqual([{ name: "web__run", input: { query: "Codex" } }]);
});

test("raw exec allows only the exact wait polling interval", async () => {
  const accepted = await execute(`await tools.collaboration__wait_agent({ timeout_ms: ${CHATGPT_WEB_AGENT_WAIT_POLL_MS} });`);
  await accepted.result;
  expect(accepted.calls).toEqual([{
    name: "collaboration__wait_agent", input: { timeout_ms: CHATGPT_WEB_AGENT_WAIT_POLL_MS },
  }]);

  for (const timeout of ["undefined", String(CHATGPT_WEB_AGENT_WAIT_POLL_MS - 1), String(CHATGPT_WEB_AGENT_WAIT_POLL_MS + 1)]) {
    const rejected = await execute(`await tools.collaboration__wait_agent({ timeout_ms: ${timeout} });`);
    await expect(rejected.result).rejects.toThrow(`requires timeout_ms=${CHATGPT_WEB_AGENT_WAIT_POLL_MS}`);
    expect(rejected.calls).toEqual([]);
  }
});

test("raw exec still rejects recursive raw exec before native dispatch", async () => {
  const execution = await execute("await tools.exec('text(\"nested\")');");

  await expect(execution.result).rejects.toThrow("Nested raw exec is unavailable");
  expect(execution.calls).toEqual([]);
});
