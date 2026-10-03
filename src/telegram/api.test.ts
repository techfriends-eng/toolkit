import assert from "node:assert/strict";
import { test } from "node:test";
import { createTelegram, TelegramError } from "./api.ts";

function fakeFetch(responses: unknown[] = []) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let n = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const json = responses[n++] ?? { ok: true, result: { message_id: 100 + n } };
    return new Response(JSON.stringify(json));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("тема General: message_thread_id не отправляется", async () => {
  const f = fakeFetch();
  await createTelegram({ token: "T", fetch: f.impl }).sendMessage({ chatId: -1, text: "hi" });
  assert.equal("message_thread_id" in f.calls[0].body, false);
  assert.equal(f.calls[0].url, "https://api.telegram.org/botT/sendMessage");
});

test("заданная тема уходит как message_thread_id", async () => {
  const f = fakeFetch();
  await createTelegram({ token: "T", fetch: f.impl }).sendMessage({
    chatId: -1,
    text: "hi",
    threadId: 620,
  });
  assert.equal(f.calls[0].body.message_thread_id, 620);
});

test("длинный текст режется, кнопки только на последнем куске", async () => {
  const f = fakeFetch();
  const text = Array.from({ length: 200 }, (_, i) => `строка ${i} `.repeat(4)).join("\n");
  const { messageIds } = await createTelegram({ token: "T", fetch: f.impl }).sendMessage({
    chatId: -1,
    text,
    replyMarkup: { inline_keyboard: [] },
  });
  assert.ok(messageIds.length > 1);
  assert.equal(f.calls.length, messageIds.length);
  assert.equal("reply_markup" in f.calls[0].body, false);
  assert.ok("reply_markup" in f.calls[f.calls.length - 1].body);
});

test("ошибка API превращается в TelegramError с кодом", async () => {
  const f = fakeFetch([{ ok: false, error_code: 400, description: "message thread not found" }]);
  await assert.rejects(
    createTelegram({ token: "T", fetch: f.impl }).call("sendMessage", {}),
    (err: unknown) => err instanceof TelegramError && err.code === 400,
  );
});

test("parseMode null отключает разметку", async () => {
  const f = fakeFetch();
  await createTelegram({ token: "T", fetch: f.impl }).sendMessage({
    chatId: -1,
    text: "x",
    parseMode: null,
  });
  assert.equal("parse_mode" in f.calls[0].body, false);
});
