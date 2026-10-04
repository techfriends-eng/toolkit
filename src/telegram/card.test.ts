import assert from "node:assert/strict";
import { test } from "node:test";
import type { TelegramClient } from "./api.ts";
import { callbackData, closeCard, inlineKeyboard, markedText, parseCallback } from "./card.ts";

const ACTIONS = ["approve", "reject", "debug"] as const;

test("callback_data собирается и разбирается обратно", () => {
  const data = callbackData("pick", "approve", "a_0123456789abcdef");
  assert.equal(data, "pick:approve:a_0123456789abcdef");
  assert.deepEqual(parseCallback("pick", ACTIONS, data), {
    action: "approve",
    id: "a_0123456789abcdef",
  });
});

test("длиннее 64 байт — ошибка сразу (кириллица считается байтами)", () => {
  assert.throws(() => callbackData("pick", "approve", "я".repeat(30)), /64 байт/);
});

test("чужой префикс, незнакомое действие, мусор — null", () => {
  assert.equal(parseCallback("pick", ACTIONS, "wiki:approve:x"), null);
  assert.equal(parseCallback("pick", ACTIONS, "pick:delete:x"), null);
  assert.equal(parseCallback("pick", ACTIONS, "pick:approve:a b"), null);
  assert.equal(parseCallback("pick", ACTIONS, undefined), null);
});

test("inlineKeyboard переводит data в callback_data", () => {
  assert.deepEqual(inlineKeyboard([[{ text: "Да", data: "p:a:1" }]]), {
    inline_keyboard: [[{ text: "Да", callback_data: "p:a:1" }]],
  });
});

test("closeCard: пометка в конце, entities сохранены, кнопки сняты, без parse_mode", async () => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const tg = {
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      return true;
    },
    sendMessage: async () => ({ messageIds: [] }),
  } as unknown as TelegramClient;
  const entities = [{ type: "bold", offset: 0, length: 5 }];
  await closeCard(tg, { chatId: -1, messageId: 9, text: "Title", entities }, "✅ в работу");
  assert.equal(calls[0].method, "editMessageText");
  assert.equal(calls[0].params.text, markedText("Title", "✅ в работу"));
  assert.deepEqual(calls[0].params.entities, entities);
  assert.deepEqual(calls[0].params.reply_markup, { inline_keyboard: [] });
  assert.equal("parse_mode" in calls[0].params, false);
});
