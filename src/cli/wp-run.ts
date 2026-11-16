import type { parseArgs as ParseArgs } from "node:util";
import { createWp, WpError, type WpCredentials } from "../wp/index.ts";

/** Ввод-вывод CLI передаётся параметром — так команды тестируются без сети и процесса. */
export type WpCliIo = {
  argv: string[];
  env: Record<string, string | undefined>;
  readFile(path: string): Promise<string>;
  out(s: string): void;
  err(s: string): void;
  parseArgs: typeof ParseArgs;
  fetch?: typeof fetch;
};

const USAGE = `toolkit-wp <команда> [опции]
  find         --type T --slug S                    → id, link (нет записи — код 1)
  status       --type T --id N                      → status, link
  create       --type T --title X --slug S --content-file F|- [--featured-media N]
               [--categories-json '[1,2]'] [--meta-json '{...}'] [--only-accepted-meta]
               (всегда status=draft)                → id, link
  publish      --type T --id N [--date-gmt ISO]     → link
  dates        --type T --after ISO                 → date_gmt по строке
  upload-media --file F --filename N --alt A [--content-type image/jpeg] → id, source_url
  meta-keys    --type T                             → JSON-массив ключей meta
  categories   --text X --root N --link-pattern RE [--max 4] → JSON-массив id
Общие: --base-url URL (или WP_BASE_URL), --user-file F --pass-file F.`;

const OPTIONS = {
  "base-url": { type: "string" },
  "user-file": { type: "string" },
  "pass-file": { type: "string" },
  type: { type: "string" },
  slug: { type: "string" },
  id: { type: "string" },
  title: { type: "string" },
  "content-file": { type: "string" },
  "featured-media": { type: "string" },
  "categories-json": { type: "string" },
  "meta-json": { type: "string" },
  "only-accepted-meta": { type: "boolean" },
  "date-gmt": { type: "string" },
  after: { type: "string" },
  file: { type: "string" },
  filename: { type: "string" },
  alt: { type: "string" },
  "content-type": { type: "string" },
  text: { type: "string" },
  root: { type: "string" },
  "link-pattern": { type: "string" },
  max: { type: "string" },
} as const;

class UsageError extends Error {}

export async function runWpCli(io: WpCliIo): Promise<number> {
  let cmd: string | undefined;
  let v: Record<string, string | boolean | undefined>;
  try {
    const parsed = io.parseArgs({ args: io.argv, options: OPTIONS, allowPositionals: true });
    cmd = parsed.positionals[0];
    v = parsed.values;
  } catch (e) {
    io.err(`${(e as Error).message}\n${USAGE}\n`);
    return 2;
  }

  const need = (k: string): string => {
    const x = v[k];
    if (typeof x !== "string" || x === "") throw new UsageError(`нужен --${k}`);
    return x;
  };
  const int = (k: string): number => {
    const n = Number(need(k));
    if (!Number.isInteger(n)) throw new UsageError(`--${k}: нужно целое число`);
    return n;
  };
  const json = <T>(k: string, fallback: T): T => {
    const x = v[k];
    if (typeof x !== "string" || x === "") return fallback;
    try {
      return JSON.parse(x) as T;
    } catch {
      throw new UsageError(`--${k}: не JSON`);
    }
  };
  // bash `$(cat file)` срезал завершающие переводы строк — делаем так же.
  const secret = async (k: string) => (await io.readFile(need(k))).replace(/\n+$/, "");
  const creds = async (): Promise<WpCredentials> => ({
    username: await secret("user-file"),
    appPassword: await secret("pass-file"),
  });
  const lines = (...xs: (string | number)[]) => io.out(xs.map((x) => `${x}\n`).join(""));

  try {
    const baseUrl = (v["base-url"] as string | undefined) || io.env.WP_BASE_URL;
    if (!cmd) throw new UsageError("нет команды");
    if (!baseUrl) throw new UsageError("нужен --base-url или WP_BASE_URL");
    const postType = typeof v.type === "string" && v.type ? v.type : "posts";
    const wp = createWp({ baseUrl, postType, fetch: io.fetch });

    switch (cmd) {
      case "find": {
        const e = await wp.findEntry(need("slug"), await creds());
        if (!e) return 1;
        lines(e.id, e.link);
        return 0;
      }
      case "status": {
        const e = await wp.getEntryStatus(int("id"), await creds());
        lines(e.status, e.link);
        return 0;
      }
      case "create": {
        let meta = json<Record<string, string>>("meta-json", {});
        if (v["only-accepted-meta"] && Object.keys(meta).length > 0) {
          const accepted = new Set(await wp.restMetaKeys().catch(() => [] as string[]));
          const skipped = Object.keys(meta).filter((k) => !accepted.has(k));
          if (skipped.length) {
            io.err(
              `seo_meta_skipped: ${skipped.sort().join(", ")} (REST ${postType} их не принимает)\n`,
            );
          }
          meta = Object.fromEntries(Object.entries(meta).filter(([k]) => accepted.has(k)));
        }
        const fm = v["featured-media"];
        const e = await wp.createEntry(
          {
            title: need("title"),
            slug: need("slug"),
            contentHtml: await io.readFile(need("content-file")),
            featuredMedia: typeof fm === "string" && fm ? Number(fm) : undefined,
            categories: json<number[] | undefined>("categories-json", undefined),
            meta,
            status: "draft",
          },
          await creds(),
        );
        lines(e.id, e.link);
        return 0;
      }
      case "publish": {
        const date = v["date-gmt"];
        const e = await wp.publishEntry(int("id"), await creds(), {
          dateGmt: typeof date === "string" && date ? date : undefined,
        });
        lines(e.link);
        return 0;
      }
      case "dates": {
        const ds = await wp.entryDates(need("after"), await creds());
        if (ds.length) lines(...ds);
        return 0;
      }
      case "upload-media": {
        const ct = v["content-type"];
        const m = await wp.uploadMedia(
          {
            filePath: need("file"),
            filename: need("filename"),
            altText: typeof v.alt === "string" ? v.alt : "",
            contentType: typeof ct === "string" && ct ? ct : "image/jpeg",
          },
          await creds(),
        );
        lines(m.id, m.sourceUrl);
        return 0;
      }
      case "meta-keys": {
        lines(JSON.stringify(await wp.restMetaKeys()));
        return 0;
      }
      case "categories": {
        const max = v.max ? int("max") : undefined;
        const ids = await wp.matchCategories(need("text"), {
          rootId: int("root"),
          linkPattern: new RegExp(need("link-pattern")),
          max,
        });
        lines(JSON.stringify(ids));
        return 0;
      }
      default:
        throw new UsageError(`неизвестная команда ${cmd}`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`toolkit-wp: ${e.message}\n${USAGE}\n`);
      return 2;
    }
    const what = e instanceof WpError ? e.message : String(e);
    io.err(`toolkit-wp ${cmd}: ${what}\n`);
    return 1;
  }
}
