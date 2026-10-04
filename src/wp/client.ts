import { readFile } from "node:fs/promises";

/**
 * Клиент WordPress REST API. Адрес сайта, тип записи и таймаут — параметры клиента, креды —
 * параметр каждого вызова: у чтения, публикации и медиатеки разные технические пользователи
 * (handbook gotchas/wordpress.md#publish-user). Перенесено из stack-radar `src/lib/wp/client.ts`.
 */

export type WpCredentials = {
  username: string;
  /** Application Password. Пробелы внутри значимы — WordPress выдаёт его группами. */
  appPassword: string;
};

export type WpEntry = {
  id: number;
  link: string;
  slug: string;
  status: string;
};

export type WpMedia = {
  id: number;
  sourceUrl: string;
};

export type CreateEntryInput = {
  title: string;
  slug: string;
  contentHtml: string;
  excerpt?: string;
  categories?: number[];
  featuredMedia?: number;
  status: "draft" | "publish";
  /** Поля Yoast и прочие meta. Работают, только если тип записи отдаёт `meta` в REST. */
  meta?: Record<string, string>;
};

export type UpdateEntryInput = {
  title: string;
  contentHtml: string;
  excerpt?: string;
  meta?: Record<string, string>;
};

export class WpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(`${message} (HTTP ${status}): ${body.slice(0, 500)}`);
    this.name = "WpError";
    this.status = status;
    this.body = body;
  }
}

export type WpClient = ReturnType<typeof createWp>;

export function createWp(opts: {
  baseUrl: string;
  /** REST base типа записи: `posts`, `encyclopedia` и т. п. */
  postType?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}) {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const type = opts.postType ?? "posts";
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const doFetch = opts.fetch ?? fetch;

  function authHeader(creds: WpCredentials): string {
    const raw = `${creds.username}:${creds.appPassword}`;
    return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
  }

  async function wpFetch(
    path: string,
    creds: WpCredentials | null,
    init: RequestInit = {},
  ): Promise<{ status: number; text: string }> {
    const res = await doFetch(`${base}/wp-json/wp/v2/${path.replace(/^\/+/, "")}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(creds ? { Authorization: authHeader(creds) } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, text: await res.text() };
  }

  function parseJson(text: string, what: string, status: number): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new WpError(`${what}: ответ не JSON`, status, text);
    }
  }

  function toEntry(raw: Record<string, unknown>): WpEntry {
    return {
      id: Number(raw.id),
      link: String(raw.link ?? ""),
      slug: String(raw.slug ?? ""),
      status: String(raw.status ?? ""),
    };
  }

  function firstEntry(text: string, what: string, status: number): WpEntry | null {
    const rows = parseJson(text, what, status);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return toEntry(rows[0] as Record<string, unknown>);
  }

  async function writeEntry(
    path: string,
    payload: Record<string, unknown>,
    creds: WpCredentials,
    what: string,
    okStatuses: number[],
  ): Promise<WpEntry> {
    const { status, text } = await wpFetch(path, creds, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!okStatuses.includes(status)) throw new WpError(what, status, text);
    const raw = parseJson(text, what, status) as Record<string, unknown>;
    if (!raw?.id) throw new WpError(`${what}: нет id в ответе`, status, text);
    return toEntry(raw);
  }

  return {
    /**
     * Запись с ТОЧНО таким slug в любом статусе. Авторизованно и с `status=any&context=edit`:
     * неавторизованный запрос видит только `publish`, и без этой проверки WordPress на занятый
     * slug молча создаёт дубль с `-2`.
     */
    async findEntry(slug: string, creds: WpCredentials): Promise<WpEntry | null> {
      const q = `${type}?slug=${encodeURIComponent(slug)}&status=any&context=edit&_fields=id,link,slug,status`;
      const { status, text } = await wpFetch(q, creds);
      if (status !== 200) throw new WpError("findEntry", status, text);
      return firstEntry(text, "findEntry", status);
    },

    /** Создаёт запись. Адрес берётся из `link` ответа: формулы по slug врут (рубрика, тип). */
    createEntry(input: CreateEntryInput, creds: WpCredentials): Promise<WpEntry> {
      const payload: Record<string, unknown> = {
        title: input.title,
        slug: input.slug,
        content: input.contentHtml,
        status: input.status,
      };
      if (input.categories) payload.categories = input.categories;
      if (input.excerpt) payload.excerpt = input.excerpt;
      if (input.featuredMedia) payload.featured_media = input.featuredMedia;
      if (input.meta && Object.keys(input.meta).length > 0) payload.meta = input.meta;
      return writeEntry(type, payload, creds, "createEntry", [200, 201]);
    },

    /** Частичное обновление: заголовок, тело, excerpt, meta. Slug, статус и обложку не трогает. */
    updateEntry(id: number, input: UpdateEntryInput, creds: WpCredentials): Promise<WpEntry> {
      const payload: Record<string, unknown> = { title: input.title, content: input.contentHtml };
      if (input.excerpt) payload.excerpt = input.excerpt;
      if (input.meta && Object.keys(input.meta).length > 0) payload.meta = input.meta;
      return writeEntry(`${type}/${id}`, payload, creds, "updateEntry", [200]);
    },

    /** Статус записи — защитная проверка перед публикацией: тронутую руками запись не публикуем. */
    async getEntryStatus(id: number, creds: WpCredentials): Promise<WpEntry> {
      const { status, text } = await wpFetch(
        `${type}/${id}?context=edit&_fields=id,link,slug,status`,
        creds,
      );
      if (status !== 200) throw new WpError("getEntryStatus", status, text);
      return toEntry(parseJson(text, "getEntryStatus", status) as Record<string, unknown>);
    },

    /** draft → publish; если статус не сменился — ошибка, а не тихий успех. */
    async publishEntry(id: number, creds: WpCredentials): Promise<WpEntry> {
      const entry = await writeEntry(
        `${type}/${id}`,
        { status: "publish" },
        creds,
        "publishEntry",
        [200],
      );
      if (entry.status !== "publish") {
        throw new WpError("publishEntry: статус не сменился", 200, JSON.stringify(entry));
      }
      return entry;
    },

    /**
     * Картинка в медиатеку. `alt_text` — в том же multipart-запросе: отдельный PATCH требует
     * `edit_posts`, а у пользователя медиатеки сознательно только `upload_files` (403 rest_cannot_edit).
     */
    async uploadMedia(
      input: { filePath: string; filename: string; altText: string; contentType?: string },
      creds: WpCredentials,
    ): Promise<WpMedia> {
      const bytes = await readFile(input.filePath);
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], { type: input.contentType ?? "image/jpeg" }),
        input.filename,
      );
      form.append("alt_text", input.altText);
      const { status, text } = await wpFetch("media", creds, { method: "POST", body: form });
      if (status !== 200 && status !== 201) throw new WpError("uploadMedia", status, text);
      const raw = parseJson(text, "uploadMedia", status) as Record<string, unknown>;
      if (!raw?.id) throw new WpError("uploadMedia: нет id в ответе", status, text);
      return { id: Number(raw.id), sourceUrl: String(raw.source_url ?? "") };
    },

    /** Опубликована ли запись — без кредов, публичный REST видит только `publish`. */
    async lookupPublished(slug: string): Promise<WpEntry | null> {
      const { status, text } = await wpFetch(
        `${type}?slug=${encodeURIComponent(slug)}&_fields=id,link,slug,status`,
        null,
      );
      if (status !== 200) throw new WpError("lookupPublished", status, text);
      return firstEntry(text, "lookupPublished", status);
    },
  };
}
