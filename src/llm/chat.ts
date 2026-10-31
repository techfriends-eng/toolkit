/**
 * Вызов OpenAI-совместимого chat completions (xAI, OpenRouter) с повторами и подключаемым кэшем.
 *
 * - Повтор только на 429, 5xx и сетевых сбоях, с нарастающей паузой: случайный отказ провайдера
 *   не должен ронять задачу (handbook gotchas/llm.md#retries). 4xx кроме 429 не повторяются.
 * - Кэш — снаружи (`get`/`set`): где его хранить, решает проект. Ключ строит `buildCacheKey`
 *   с версией промпта (gotchas/llm.md#cache-key).
 * - Окончательный отказ — `null`, а не исключение: у вызывающего всегда есть запасной путь
 *   (шаблон, простая подпись). Фиктивный текст вместо ответа модели не подставляется.
 */

export type ChatCache = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

export type ChatRequest = {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Ключ кэша; без него кэш не используется. */
  cacheKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Дополнительные поля тела запроса провайдера, например `reasoning` и `usage` у OpenRouter. */
  body?: Record<string, unknown>;
};

/** Ответ с расходом: нужен, когда вызов оплачивается и журналируется (конвейеры генерации). */
export type ChatResult = {
  text: string;
  /** `length` — ответ обрезан по maxTokens, текст неполный, но оплачен. `cache` — взят из кэша. */
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    costUsd: number;
  };
};

export type ChatClient = {
  complete(req: ChatRequest): Promise<string | null>;
  completeDetailed(req: ChatRequest): Promise<ChatResult | null>;
};

type Payload = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

const NO_USAGE = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0 };

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export function createChat(opts: {
  /** Например `https://api.x.ai/v1` или `https://openrouter.ai/api/v1`. */
  baseUrl: string;
  apiKey: string;
  cache?: ChatCache;
  /** Всего попыток, по умолчанию 3. */
  attempts?: number;
  /** Пауза перед n-й повторной попыткой: backoffMs × n. По умолчанию 15 с. */
  backoffMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}): ChatClient {
  const doFetch = opts.fetch ?? fetch;
  const attempts = opts.attempts ?? 3;
  const backoffMs = opts.backoffMs ?? 15_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = opts.log ?? ((line: string) => console.info(`[llm] ${line}`));
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  async function readCache(key: string | undefined): Promise<string | null> {
    if (!key || !opts.cache) return null;
    try {
      return await opts.cache.get(key);
    } catch (err) {
      // Кэш — ускорение, а не условие работы: его сбой не должен ронять вызов.
      log(`cache read skipped: ${(err as Error).message}`);
      return null;
    }
  }

  async function writeCache(key: string | undefined, value: string): Promise<void> {
    if (!key || !opts.cache) return;
    try {
      await opts.cache.set(key, value);
    } catch (err) {
      log(`cache write skipped: ${(err as Error).message}`);
    }
  }

  async function callOnce(
    req: ChatRequest,
  ): Promise<{ result: ChatResult | null; retry: boolean }> {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
          ...(req.headers ?? {}),
        },
        body: JSON.stringify({
          ...(req.body ?? {}),
          model: req.model,
          max_tokens: req.maxTokens,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
        signal: AbortSignal.timeout(req.timeoutMs ?? 45_000),
      });
    } catch (err) {
      log(`network error: ${(err as Error).message}`);
      return { result: null, retry: true };
    }
    if (!res.ok) {
      log(`HTTP ${res.status}`);
      return { result: null, retry: RETRYABLE(res.status) };
    }
    const payload = (await res.json()) as Payload;
    const choice = payload.choices?.[0];
    const text = choice?.message?.content?.trim();
    if (!text) return { result: null, retry: false };
    const u = payload.usage ?? {};
    return {
      result: {
        text,
        finishReason: choice?.finish_reason ?? "stop",
        usage: {
          promptTokens: u.prompt_tokens ?? 0,
          completionTokens: u.completion_tokens ?? 0,
          reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
          costUsd: u.cost ?? 0,
        },
      },
      retry: false,
    };
  }

  async function run(req: ChatRequest): Promise<ChatResult | null> {
    if (!opts.apiKey) return null;
    const cached = await readCache(req.cacheKey);
    if (cached) {
      log(`cache hit ${req.cacheKey?.slice(0, 8)}`);
      return { text: cached, finishReason: "cache", usage: NO_USAGE };
    }
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const { result, retry } = await callOnce(req);
      if (result) {
        // Обрезанный ответ в кэш не кладём: следующий вызов должен получить полный.
        if (result.finishReason !== "length") await writeCache(req.cacheKey, result.text);
        return result;
      }
      if (!retry || attempt === attempts) return null;
      await sleep(backoffMs * attempt);
    }
    return null;
  }

  return {
    async complete(req) {
      return (await run(req))?.text ?? null;
    },
    completeDetailed: run,
  };
}
