import { singleFlight } from "../async/single-flight.ts";
import type { TelegramClient } from "./api.ts";

/**
 * Ядро поллера getUpdates. Правила (handbook gotchas/telegram.md):
 * - один токен — один поллер, вызовы не накладываются (single-flight);
 * - бот-админ видит всё: `accept` фильтрует по чату, теме и автору (`fromChat` ниже);
 * - курсор сдвигается и через отброшенные апдейты, иначе они вернутся снова;
 * - курсор сохраняется до последнего УСПЕШНО обработанного апдейта: упавший придёт ещё раз,
 *   остальные — нет.
 */

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  /** Пост в канале, где бот — администратор. */
  channel_post?: TgMessage;
  callback_query?: {
    id: string;
    from?: { id: number };
    data?: string;
    message?: TgMessage;
  };
};

export type TgMessage = {
  message_id: number;
  message_thread_id?: number;
  chat?: { id: number | string };
  from?: { id: number };
  text?: string;
  entities?: unknown[];
  reply_to_message?: TgMessage;
};

export type PollResult = { seen: number; handled: number; failed?: string };

export function createPoller(opts: {
  tg: TelegramClient;
  getOffset(): Promise<number>;
  setOffset(offset: number): Promise<void>;
  accept(update: TgUpdate): boolean;
  handle(update: TgUpdate): Promise<void>;
  allowedUpdates?: string[];
}): () => Promise<PollResult> {
  async function pollOnce(): Promise<PollResult> {
    const offset = await opts.getOffset();
    const updates = await opts.tg.call<TgUpdate[]>("getUpdates", {
      offset,
      timeout: 0,
      allowed_updates: opts.allowedUpdates ?? ["message", "callback_query"],
    });
    let next = offset;
    let handled = 0;
    try {
      for (const update of updates) {
        if (opts.accept(update)) {
          await opts.handle(update);
          handled++;
        }
        next = update.update_id + 1;
      }
    } catch (err) {
      if (next !== offset) await opts.setOffset(next);
      return { seen: updates.length, handled, failed: (err as Error).message };
    }
    if (next !== offset) await opts.setOffset(next);
    return { seen: updates.length, handled };
  }
  return singleFlight(pollOnce);
}

/**
 * Фильтр «чат + тема + автор». `threadIds` пустой — тема не проверяется; `senderId` не задан —
 * автор не проверяется. Нажатие кнопки проверяется по чату и теме сообщения-карточки.
 */
export function fromChat(f: {
  chatId: string | number;
  threadIds?: number[];
  senderId?: number;
}): (update: TgUpdate) => boolean {
  return (update) => {
    const message = update.message ?? update.channel_post ?? update.callback_query?.message;
    const sender = update.message?.from?.id ?? update.callback_query?.from?.id;
    if (!message || String(message.chat?.id ?? "") !== String(f.chatId)) return false;
    if (f.threadIds?.length && !f.threadIds.includes(message.message_thread_id ?? 0)) return false;
    if (f.senderId !== undefined && sender !== f.senderId) return false;
    return true;
  };
}
