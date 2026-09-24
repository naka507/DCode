import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [composerStyles, english, chinese, builtinCommands] =
  await Promise.all([
    read("../src/renderer/styles/composer.css"),
    read("../src/i18n/locales/en/index.ts"),
    read("../src/i18n/locales/zh-CN/index.ts"),
    read("../src/main/builtin-commands.ts"),
  ]);
test("placeholder changes fade without duplicating the native accessible value", () => {
  assert.match(composerStyles, /\.composer-input-stage\s*\{/);
  assert.match(composerStyles, /\.composer-placeholder\s*\{/);
  assert.match(composerStyles, /animation:\s*composer-placeholder-fade-in/);
  assert.match(composerStyles, /@keyframes composer-placeholder-fade-in/);
  assert.match(composerStyles, /opacity:\s*0\s*!important/);
});

test("both shipped locales provide welcome, command, file, and shortcut guidance", () => {
  assert.match(english, /placeholderHint:\s*"Type \/ for commands · @ for files"/);
  assert.match(english, /placeholderHomeHint:\s*"Type \/ for commands · @ for files"/);
  assert.match(english, /placeholderShortcut:\s*"Shift\+Enter for newline · Use Send to submit"/);
  assert.match(chinese, /placeholderHint:\s*"输入 \/ 使用命令 · @ 引用文件"/);
  assert.match(chinese, /placeholderHomeHint:\s*"输入 \/ 使用命令 · @ 引用文件"/);
  assert.match(chinese, /placeholderShortcut:\s*"Shift\+Enter 换行 · 点击发送提交"/);
});

test("the slash hint keeps the core session command aliases available", () => {
  for (const alias of ["new", "compact", "agent-mode", "plan-mode", "goal-mode"]) {
    assert.match(builtinCommands, new RegExp(`slash: "${alias}"`), alias);
  }
});
