import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { CHATGPT_COMPOSER_SELECTOR, CHATGPT_COMPOSER_VARIANTS } from "../src/chatgpt-ui/composer";

const require = createRequire(import.meta.url);

// The packaged launcher cannot import the TypeScript UI contract, so its sign-in probe keeps a
// copy of the composer selector. Upstream fixes for ChatGPT UI changes land in src/chatgpt-ui/;
// fail here if that copy is left behind, instead of the launcher misreporting a signed-in page.
test("launcher sign-in probe uses the verified ChatGPT composer contract", () => {
  const { COMPOSER_SELECTOR } = require("../launcher/electron/browser-host.cjs");

  expect(COMPOSER_SELECTOR).toBe(CHATGPT_COMPOSER_SELECTOR);
  for (const variant of Object.values(CHATGPT_COMPOSER_VARIANTS)) {
    expect(COMPOSER_SELECTOR).toContain(variant);
  }
});
