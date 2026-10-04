import type { TelegramClient } from "./api.ts";

/**
 * Карточки с inline-кнопками: решение адресуется через callback_data, а не реплаем, поэтому
 * нажатие нельзя отнести не к той карточке. Тексты карточек — в проекте, здесь только механика.
 * Грабли: handbook gotchas/telegram.md#callback-64, #card-edit.
 */

const CALLBACK_LIMIT_BYTES = 64;

/** `<prefix>:<action>:<id>`; длиннее 64 байт Telegram не примет — ошибка сразу, а не на отправке. */
export function callbackData(prefix: string, action: string, id: string): string {
  const data = `${prefix}:${action}:${id}`;
  if (Buffer.byteLength(data, "utf8") > CALLBACK_LIMIT_BYTES) {
    throw new Error(`callback_data длиннее ${CALLBACK_LIMIT_BYTES} байт: ${data}`);
  }
  return data;
}

/** Разбор `callback_data`; чужой префикс или незнакомое действие — null. */
export function parseCallback<A extends string>(
  prefix: string,
  actions: readonly A[],
  data: string | null | undefined,
): { action: A; id: string } | null {
  const parts = (data ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== prefix) return null;
  const action = parts[1] as A;
  if (!actions.includes(action) || !/^[\w-]{1,48}$/.test(parts[2])) return null;
  return { action, id: parts[2] };
}

export type Button = { text: string; data: string };

export function inlineKeyboard(rows: Button[][]) {
  return {
    inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
  };
}

/**
 * Пометка решения дописывается В КОНЕЦ: смещения entities (жирный, ссылки) исходного сообщения
 * остаются верными, и карточку можно отредактировать без повторного рендера.
 */
export function markedText(text: string, mark: string): string {
  return `${text}\n\n${mark}`;
}

/**
 * Закрыть карточку: текст с пометкой, исходные entities, кнопки сняты. Отправлять `parse_mode`
 * нельзя — текст приходит от Telegram уже без HTML, разметка живёт в entities.
 */
export async function closeCard(
  tg: TelegramClient,
  card: { chatId: string | number; messageId: number; text: string; entities?: unknown[] },
  mark: string,
): Promise<void> {
  await tg.call("editMessageText", {
    chat_id: card.chatId,
    message_id: card.messageId,
    text: markedText(card.text, mark),
    entities: card.entities ?? [],
    reply_markup: { inline_keyboard: [] },
  });
}
