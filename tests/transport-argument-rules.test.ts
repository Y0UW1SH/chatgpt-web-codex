import { expect, test } from "bun:test";
import {
  CHATGPT_WEB_AGENT_WAIT_POLL_MS,
  CHATGPT_WEB_COMMAND_POLL_MAX_MS,
  CHATGPT_WEB_COMMAND_POLL_MIN_MS,
  CHATGPT_WEB_TRANSPORT_ARGUMENT_RULES,
  transportArgumentViolation,
  transportBoundRawExecProgram,
} from "../src/adapters/chatgpt-web/mcp-server";

// MCP calls and caller-authored raw exec must enforce the same transport rules. These cases run
// through every enforcement path so the rules cannot drift between them again.
const cases: Array<[name: string, args: unknown, accepted: boolean]> = [
  ["collaboration__wait_agent", { timeout_ms: CHATGPT_WEB_AGENT_WAIT_POLL_MS }, true],
  ["collaboration__wait_agent", { timeout_ms: CHATGPT_WEB_AGENT_WAIT_POLL_MS, targets: ["a"] }, true],
  ["collaboration__wait_agent", {}, false],
  ["collaboration__wait_agent", { timeout_ms: CHATGPT_WEB_AGENT_WAIT_POLL_MS - 1 }, false],
  ["collaboration__wait_agent", { timeout_ms: String(CHATGPT_WEB_AGENT_WAIT_POLL_MS) }, false],
  ["collaboration__wait_agent", [CHATGPT_WEB_AGENT_WAIT_POLL_MS], false],
  ["collaboration__wait_agent", null, false],
  ["write_stdin", { session_id: 1 }, true],
  ["write_stdin", { session_id: 1, yield_time_ms: CHATGPT_WEB_COMMAND_POLL_MIN_MS }, true],
  ["write_stdin", { session_id: 1, yield_time_ms: CHATGPT_WEB_COMMAND_POLL_MAX_MS }, true],
  ["write_stdin", { session_id: 1, yield_time_ms: CHATGPT_WEB_COMMAND_POLL_MIN_MS - 1 }, false],
  ["write_stdin", { session_id: 1, yield_time_ms: CHATGPT_WEB_COMMAND_POLL_MAX_MS + 1 }, false],
  ["write_stdin", { session_id: 1, yield_time_ms: 1000.5 }, false],
  ["write_stdin", { session_id: 1, yield_time_ms: "1000" }, false],
  ["write_stdin", { session_id: 1, yield_time_ms: null }, false],
  ["web__run", { timeout_ms: 1 }, true],
];

async function rawExecAccepts(name: string, args: unknown): Promise<boolean> {
  const calls: unknown[] = [];
  const tools = Object.fromEntries(["collaboration__wait_agent", "write_stdin", "web__run", "exec"].map(tool => [
    tool,
    async (input: unknown) => { calls.push(input); },
  ]));
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...params: string[]
  ) => (...values: unknown[]) => Promise<void>;
  const program = transportBoundRawExecProgram(
    `await tools[${JSON.stringify(name)}](${JSON.stringify(args)});`,
    "exec",
  );
  const run = new AsyncFunction("tools", "ALL_TOOLS", "text", "image", "audio", "generatedImage", `"use strict";\n${program}`);
  const ignore = () => {};
  try {
    await run(tools, Object.keys(tools).map(tool => ({ name: tool })), ignore, ignore, ignore, ignore);
  } catch {
    expect(calls).toEqual([]);
    return false;
  }
  expect(calls).toEqual([args]);
  return true;
}

test.each(cases)("%s %p is accepted=%p by every enforcement path", async (name, args, accepted) => {
  const direct = transportArgumentViolation(name, args, CHATGPT_WEB_TRANSPORT_ARGUMENT_RULES);
  expect(direct === null).toBe(accepted);
  // The raw exec program embeds this function's source, so it must not depend on module scope.
  const isolated = new Function(`return (${transportArgumentViolation.toString()});`)() as typeof transportArgumentViolation;
  expect(isolated(name, args, JSON.parse(JSON.stringify(CHATGPT_WEB_TRANSPORT_ARGUMENT_RULES)))).toBe(direct);
  expect(await rawExecAccepts(name, args)).toBe(accepted);
});
