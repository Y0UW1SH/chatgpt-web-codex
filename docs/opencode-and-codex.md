# Using this fork with Codex and OpenCode

This fork builds on [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web); upstream authorship and the [MIT license](../LICENSE) remain intact. It is independent software, not an official OpenAI or OpenCode integration. Its implemented model interface targets the native Codex harness. For OpenCode, the smallest credible integration is delegation to that harness.

## Run Codex from this source tree

Install Bun **1.4.0**, Git, and a current Codex CLI, then clone this fork:

```bash
git clone https://github.com/Y0UW1SH/chatgpt-web-codex.git
cd chatgpt-web-codex
bun run app
```

The [source launcher script](../scripts/start-launcher.ts) installs frozen dependencies in both the repository and `launcher`, builds the browser helper and renderer, then starts the production launcher. `bun run dev:launcher` retains the isolated [DEV harness](dev-chat.md); that profile does not configure normal Codex routing. See the [launcher package scripts](../launcher/package.json) for the underlying build/start commands.

Complete the launcher's account login and setup. Choose **Full** for local repository tools; it additionally requires the tunnel and the exact configured ChatGPT connector. **Browser-only** accepts supplied context/images but cannot inspect or edit local files through tools. Model choices depend on the authenticated account. Keep the launcher open and restart Codex after setup changes its route/catalog.

From this checkout, inspect configuration and health with:

```bash
bun run src/cli.ts --help
bun run src/cli.ts doctor --json
bun run src/cli.ts route status
bun run src/cli.ts service status
```

The default route is `http://127.0.0.1:17841/v1`. Setup manages the built-in `openai` provider's top-level `openai_base_url`, with a reversible journal; it rejects a selected custom `model_provider`. Prefer the setup workflow over hand-editing its managed settings. `bun run src/cli.ts route disconnect` restores the previous route; restart Codex afterward. See [architecture](architecture.md) and [security](security-model.md).

## Delegate from OpenCode

Keep OpenCode's own model provider configured normally. After Full-mode Codex works independently, run this from the target repository through OpenCode's shell tool, or wrap the invocation in a custom tool:

```bash
codex --ask-for-approval never exec \
  --sandbox read-only --json \
  --model chatgpt-web/gpt-6-sol \
  --cd "$PWD" \
  "Review this repository and report findings; make no edits."
```

Use an account-available Web slug from Codex's picker if this one is unavailable. `--json` produces JSON Lines events; collect the final agent message and check the process status and failure events. `never` disables approval prompts without granting additional permissions. `read-only` restricts local filesystem tool execution; it does not isolate external MCP/app actions. Use trusted configured tools. For an authorized editing task, use a separate worktree and explicitly choose `workspace-write`.

A wrapper should use subprocess argument arrays, send arbitrary task text through stdin using the documented `-` prompt, and handle cancellation and timeouts. Preserve the configured Codex home and saved authentication. Avoid `--ignore-user-config`, which bypasses the managed route, and retain session rollouts: this bridge can require them to recover trusted environment authority. This is a proposed delegation workflow, not a verified OpenCode tool integration.

## Direct OpenCode providers are currently unsupported

A custom base URL alone is insufficient:

- The server implements Responses, compaction, native models/search/images, and lifecycle routes. It has no `/v1/chat/completions` handler; Responses WebSocket requests receive HTTP 426.
- Web responses require `client_metadata["x-codex-turn-metadata"]` lifecycle identity and a canonical current user instruction. Full mode also validates Codex environment envelopes and, when necessary, local rollouts.
- `/v1/models` first forwards incoming Bearer authorization to the native Codex backend, then augments its Codex-shaped `models`/`slug` catalog. It is not a public OpenAI-style `data`/`id` list.
- Full-mode tools use a turn-scoped MCP broker and return tool calls/results to the outer harness. Configuring OpenCode as another client does not establish that lifecycle or authority.

These constraints come from the [HTTP routes](../src/server.ts), [turn replay keys](../src/adapters/chatgpt-web/turn-execution.ts), [environment validation](../src/adapters/chatgpt-web/environment.ts), and [native catalog augmentation](../src/model-catalog.ts).

## Improvement priorities

1. Document and continuously verify a client/version support matrix, including source-launch profile selection.
2. Add an explicit trusted OpenCode adapter with session/turn identity, tool schemas/results, cancellation, and environment policy. Keep native validation intact.
3. Add contract tests using real OpenCode requests, followed by account-bound streaming, tool-round, retry, and compaction checks before claiming support.
4. Separate client-neutral model discovery from authenticated native catalog passthrough, and reject unsupported clients early with actionable errors.

## Official references and verification limits

Reviewed against source and official documentation on 2026-10-18. No live ChatGPT account, launcher login, tunnel, or OpenCode-to-Codex tool flow was exercised for this guide.

- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Codex commands and exact flags](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [OpenCode V1 providers](https://opencode.ai/docs/providers/): Responses uses `@ai-sdk/openai`; Chat Completions uses `@ai-sdk/openai-compatible`.
- [OpenCode V2 providers](https://opencode.ai/v2/docs/providers/): native configuration uses `providers`/`package`/`settings`, with explicit Responses runtimes. [V2 migration](https://opencode.ai/v2/docs/migrate-v1/) also preserves supported V1 configuration through normalization. Neither configuration format resolves this bridge's native Codex requirements.
