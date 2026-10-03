import { splitTelegram } from "./text.ts";

/**
 * Минимальный клиент Bot API: один `call` и `sendMessage` с темами и нарезкой.
 * Токен и fetch передаются при создании, поэтому клиент тестируется без сети
 * и не держит глобального состояния (handbook standards/04-code-style.md).
 */

const API = "https://api.telegram.org";

export type TelegramClient = {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  sendMessage(msg: SendMessage): Promise<{ messageIds: number[] }>;
};

export type SendMessage = {
  chatId: string | number;
  text: string;
  /** Тема супергруппы. Не задана или 0 — сообщение уходит в General. */
  threadId?: number | null;
  parseMode?: "HTML" | "MarkdownV2" | null;
  /** Кнопки вешаются только на последний кусок длинного сообщения. */
  replyMarkup?: unknown;
  disablePreview?: boolean;
};

export class TelegramError extends Error {
  // Поля объявлены явно: parameter properties (`constructor(readonly x)`) node --experimental-strip-types
  // не поддерживает. handbook gotchas/typescript-node.md#strip-types
  readonly method: string;
  readonly code: number | undefined;
  constructor(method: string, code: number | undefined, description: string) {
    super(`Telegram ${method}: ${description}`);
    this.method = method;
    this.code = code;
  }
}

export function createTelegram(opts: {
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): TelegramClient {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await doFetch(`${API}/bot${opts.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json()) as {
      ok: boolean;
      result?: T;
      error_code?: number;
      description?: string;
    };
    if (!json.ok) {
      throw new TelegramError(method, json.error_code, json.description ?? `HTTP ${res.status}`);
    }
    return json.result as T;
  }

  async function sendMessage(msg: SendMessage): Promise<{ messageIds: number[] }> {
    const chunks = splitTelegram(msg.text);
    const messageIds: number[] = [];
    for (const [i, chunk] of chunks.entries()) {
      const params: Record<string, unknown> = {
        chat_id: msg.chatId,
        text: chunk,
        disable_web_page_preview: msg.disablePreview ?? true,
      };
      // General не принимает message_thread_id — поле только для заданной темы.
      // handbook gotchas/telegram.md#general-topic
      if (msg.threadId) params.message_thread_id = msg.threadId;
      const parseMode = msg.parseMode === undefined ? "HTML" : msg.parseMode;
      if (parseMode) params.parse_mode = parseMode;
      if (msg.replyMarkup && i === chunks.length - 1) params.reply_markup = msg.replyMarkup;
      const sent = await call<{ message_id: number }>("sendMessage", params);
      messageIds.push(sent.message_id);
    }
    return { messageIds };
  }

  return { call, sendMessage };
}
