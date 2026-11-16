import { basename, dirname, resolve } from "node:path";
import type { parseArgs as ParseArgs } from "node:util";
import { localRunner, renderScheme, type Runner } from "../visuals/index.ts";

/** Ввод-вывод CLI параметром — команды тестируются без mmdc и процесса. */
export type VisualsCliIo = {
  argv: string[];
  readFile(path: string): Promise<string>;
  err(s: string): void;
  parseArgs: typeof ParseArgs;
  /** Runner для каталога результата; по умолчанию localRunner. */
  runner?: (dir: string) => Runner;
  /** Ширина и высота готовой картинки — для предупреждения R5. */
  size?: (path: string) => { w: number; h: number } | null;
};

const USAGE = `toolkit-visuals render --in F.mmd --out F.png|F.jpg --background '#RRGGBB'
    --config mermaid.json --puppeteer puppeteer-config.json
    [--width N] [--scale 3] [--size 1200x800] [--no-strip]
Mermaid → картинка здесь же (нужны mmdc, convert, identify; exiftool — без --no-strip). R5: схема выше,
чем шире, перерисовывается слева направо. Код выхода: 1 — рендер не удался, 2 — аргументы.`;

const OPTIONS = {
  in: { type: "string" },
  out: { type: "string" },
  background: { type: "string" },
  config: { type: "string" },
  puppeteer: { type: "string" },
  width: { type: "string" },
  scale: { type: "string" },
  size: { type: "string" },
  "no-strip": { type: "boolean" },
} as const;

class UsageError extends Error {}

export async function runVisualsCli(io: VisualsCliIo): Promise<number> {
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
  const num = (k: string): number | undefined => {
    if (v[k] === undefined) return undefined;
    const n = Number(need(k));
    if (!Number.isInteger(n) || n <= 0) throw new UsageError(`--${k}: нужно целое > 0`);
    return n;
  };
  try {
    if (cmd !== "render") throw new UsageError(cmd ? `неизвестная команда ${cmd}` : "нет команды");
    const out = resolve(need("out"));
    const background = need("background");
    if (!/^#[0-9a-f]{6}$/i.test(background)) throw new UsageError("--background: нужен #RRGGBB");
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(await io.readFile(need("config"))) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof UsageError) throw e;
      throw new UsageError(`--config: не прочитан JSON (${(e as Error).message})`);
    }
    const mermaid = (await io.readFile(need("in"))).replace(/\n+$/, "");
    const dir = dirname(out);
    renderScheme((io.runner ?? localRunner)(dir), dir, basename(out), mermaid, {
      background,
      config,
      puppeteerConfig: resolve(need("puppeteer")),
      width: num("width"),
      scale: num("scale"),
      size: typeof v.size === "string" && v.size ? v.size : undefined,
      stripMeta: !v["no-strip"],
    });
    const wh = io.size?.(out);
    if (wh && wh.h > wh.w)
      io.err("toolkit-visuals: R5 — схема выше, чем шире, LR не помог; нужна правка кода схемы\n");
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`toolkit-visuals: ${e.message}\n${USAGE}\n`);
      return 2;
    }
    io.err(`toolkit-visuals render: ${(e as Error).message}\n`);
    return 1;
  }
}
