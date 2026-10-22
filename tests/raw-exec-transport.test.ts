import { expect, test } from "bun:test";
import { CHATGPT_WEB_AGENT_WAIT_POLL_MS, transportBoundRawExecProgram } from "../src/adapters/chatgpt-web/mcp-server";

async function execute(input: string, serializeInput = false) {
  const calls: Array<{ name: string; input: unknown }> = [];
  const output: unknown[] = [];
  const tools = Object.fromEntries(["web__run", "collaboration__wait_agent", "exec"].map(name => [
    name,
    async (input: unknown) => {
      if (serializeInput) input = JSON.parse(JSON.stringify(input));
      calls.push({ name, input });
      return { name, input };
    },
  ]));
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<void>;
  const run = new AsyncFunction("tools", "ALL_TOOLS", "text", "image", "audio", "generatedImage",
    '"use strict";\n' + transportBoundRawExecProgram(input, "exec"));
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

test("raw exec preserves module strictness for top-level this", async () => {
  const execution = await execute("text(this === undefined);");

  await execution.result;
  expect(execution.output).toEqual([true]);
});

test("raw exec rejects undeclared assignments without leaking globals", async () => {
  const key = "__cgw_raw_exec_undeclared_regression__";
  expect(Object.hasOwn(globalThis, key)).toBe(false);
  try {
    const execution = await execute(`${key} = 1;`);
    await expect(execution.result).rejects.toBeInstanceOf(ReferenceError);
    expect(Object.hasOwn(globalThis, key)).toBe(false);
  } finally {
    Reflect.deleteProperty(globalThis, key);
  }
});

test("raw exec rejects writes to the protected tool registry instead of silently ignoring them", async () => {
  const execution = await execute("tools.web__run = async () => 'overwritten'; await tools.web__run({});");

  await expect(execution.result).rejects.toBeInstanceOf(TypeError);
  expect(execution.calls).toEqual([]);
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

test("raw exec validates the same wait arguments that reach native serialization", async () => {
  const execution = await execute(`
    let reads = 0;
    await tools.collaboration__wait_agent({
      get timeout_ms() { return ++reads === 1 ? ${CHATGPT_WEB_AGENT_WAIT_POLL_MS} : 300000; }
    });
  `, true);
  await execution.result;
  expect(execution.calls).toEqual([{
    name: "collaboration__wait_agent", input: { timeout_ms: CHATGPT_WEB_AGENT_WAIT_POLL_MS },
  }]);
});

test("raw exec rejects a wait timeout changed by toJSON before native dispatch", async () => {
  const execution = await execute(`
    await tools.collaboration__wait_agent({
      timeout_ms: ${CHATGPT_WEB_AGENT_WAIT_POLL_MS},
      toJSON() { return { timeout_ms: 300000 }; }
    });
  `, true);
  await expect(execution.result).rejects.toThrow(`requires timeout_ms=${CHATGPT_WEB_AGENT_WAIT_POLL_MS}`);
  expect(execution.calls).toEqual([]);
});
