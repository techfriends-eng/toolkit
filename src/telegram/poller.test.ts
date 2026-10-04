import assert from "node:assert/strict";
import { test } from "node:test";
import type { TelegramClient } from "./api.ts";
import { createPoller, fromChat, type TgUpdate } from "./poller.ts";

function fakeTg(updates: TgUpdate[]) {
  const calls: Record<string, unknown>[] = [];
  const tg = {
    call: async (_m: string, params: Record<string, unknown> = {}) => {
      calls.push(params);
      return updates;
    },
    sendMessage: async () => ({ messageIds: [] }),
  } as unknown as TelegramClient;
  return { tg, calls };
}

const msg = (id: number, chat: number, thread: number, from: number): TgUpdate => ({
  update_id: id,
  message: {
    message_id: id,
    chat: { id: chat },
    message_thread_id: thread,
    from: { id: from },
    text: "ok",
  },
});

test("курсор сдвигается и через отброшенные апдейты", async () => {
  let offset = 10;
  const handled: number[] = [];
  const { tg, calls } = fakeTg([msg(10, -1, 619, 1), msg(11, -2, 619, 1), msg(12, -1, 620, 1)]);
  const poll = createPoller({
    tg,
    getOffset: async () => offset,
    setOffset: async (n) => void (offset = n),
    accept: fromChat({ chatId: -1, threadIds: [619], senderId: 1 }),
    handle: async (u) => void handled.push(u.update_id),
  });
  assert.deepEqual(await poll(), { seen: 3, handled: 1 });
  assert.deepEqual(handled, [10]);
  assert.equal(offset, 13);
  assert.equal(calls[0].offset, 10);
});

test("сбой обработки: курсор встаёт на упавший апдейт, прошлые не повторятся", async () => {
  let offset = 1;
  const { tg } = fakeTg([msg(1, -1, 0, 1), msg(2, -1, 0, 1), msg(3, -1, 0, 1)]);
  const poll = createPoller({
    tg,
    getOffset: async () => offset,
    setOffset: async (n) => void (offset = n),
    accept: () => true,
    handle: async (u) => {
      if (u.update_id === 2) throw new Error("db down");
    },
  });
  const r = await poll();
  assert.equal(r.failed, "db down");
  assert.equal(offset, 2);
});

test("вызовы не накладываются (single-flight)", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const tg = {
    call: async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return [];
    },
    sendMessage: async () => ({ messageIds: [] }),
  } as unknown as TelegramClient;
  const poll = createPoller({
    tg,
    getOffset: async () => 0,
    setOffset: async () => {},
    accept: () => true,
    handle: async () => {},
  });
  await Promise.all([poll(), poll(), poll()]);
  assert.equal(maxInFlight, 1);
});

test("fromChat: кнопка проверяется по сообщению-карточке, автор — по нажавшему", () => {
  const accept = fromChat({ chatId: "-1", threadIds: [619], senderId: 7 });
  const press = (from: number): TgUpdate => ({
    update_id: 1,
    callback_query: {
      id: "q",
      from: { id: from },
      data: "pick:approve:x",
      message: { message_id: 5, chat: { id: -1 }, message_thread_id: 619 },
    },
  });
  assert.equal(accept(press(7)), true);
  assert.equal(accept(press(8)), false);
});

test("fromChat видит и посты канала", () => {
  const accept = fromChat({ chatId: -5 });
  assert.equal(accept({ update_id: 1, channel_post: { message_id: 1, chat: { id: -5 } } }), true);
  assert.equal(accept({ update_id: 2, channel_post: { message_id: 1, chat: { id: -6 } } }), false);
});
