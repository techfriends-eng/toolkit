import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseVisuals } from "./meta.ts";
import { generatePreview, PreviewFailed } from "./preview.ts";
import {
  dockerRunner,
  finalizePreview,
  forceLR,
  localRunner,
  renderScheme,
  type Docker,
  type Runner,
} from "./render.ts";

const OPTS = {
  background: "#F4F8F9",
  config: { theme: "base", themeVariables: { fontSize: "26px" } },
  puppeteerConfig: "/visuals/puppeteer-config.json",
};
const META = `# Метаданные статьи X

- **Термин:** KRaft

## Часть 2. Визуализации

### Превью-картинка

- **Имя файла:** \`kraft_quorum_preview.jpg\`
- **ALT:** Три контроллера KRaft на стенде

    Photorealistic server rack, three glowing nodes, palette #294A70 #FFAB1F.
    No unreadable text.

### Схема 1. Кворум

- **Имя файла:** \`kraft_quorum_scheme1.jpg\`
- **ALT:** Кворум из трёх контроллеров и брокер

\`\`\`mermaid
%%{init: {'theme':'base'}}%%
flowchart LR
  a --> b
\`\`\`

### Схема 2. Восстановление

- **Имя файла:** \`kraft_quorum_scheme2.jpg\`
- **ALT:** Порядок восстановления

\`\`\`mermaid
flowchart TD
  x --> y
\`\`\`

## SEO
`;

test("метаданные: превью с промптом, схемы по номерам с кодом Mermaid", () => {
  const v = parseVisuals(META);
  assert.deepEqual(v.preview, {
    file: "kraft_quorum_preview.jpg",
    alt: "Три контроллера KRaft на стенде",
    prompt:
      "Photorealistic server rack, three glowing nodes, palette #294A70 #FFAB1F.\nNo unreadable text.",
  });
  assert.deepEqual(
    v.schemes.map((s) => [s.n, s.file, s.mermaid.split("\n").pop()]),
    [
      [1, "kraft_quorum_scheme1.jpg", "  a --> b"],
      [2, "kraft_quorum_scheme2.jpg", "  x --> y"],
    ],
  );
});

test("превью: запасная модель маршрутом fallback, картинка из data URI, стоимость", async () => {
  let sent: Record<string, unknown> = {};
  const fake = (async (_u: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        usage: { cost: 0.04 },
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: `data:image/png;base64,${Buffer.from("PNG").toString("base64")}`,
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  }) as unknown as typeof fetch;
  const r = await generatePreview({ apiKey: "k", models: ["a", "b"], prompt: "p", fetch: fake });
  assert.equal(r.bytes.toString(), "PNG");
  assert.equal(r.ext, "png");
  assert.equal(r.costUsd, 0.04);
  assert.deepEqual(sent.models, ["a", "b"]);
  assert.equal(sent.route, "fallback");
  assert.deepEqual(sent.modalities, ["image", "text"]);
});

function imageFake(answers: { status?: number; body: string }[]) {
  const sent: string[][] = [];
  const fake = (async (_url: string, init: RequestInit) => {
    sent.push((JSON.parse(String(init.body)) as { models: string[] }).models);
    const a = answers[sent.length - 1];
    return new Response(a.body, { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fake, sent };
}
const NO_IMAGE = `${" ".repeat(400)}${JSON.stringify({
  model: "m",
  usage: { cost: 0.01 },
  choices: [{ finish_reason: "stop", message: { content: "не могу" } }],
})}`;
const IMAGE = JSON.stringify({
  usage: { cost: 0.04 },
  choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,UE5H" } }] } }],
});
const noSleep = async () => {};

test("превью: ответ без картинки повторяется со следующей модели, расход суммируется", async () => {
  const { fake, sent } = imageFake([{ body: NO_IMAGE }, { body: IMAGE }]);
  const r = await generatePreview({
    apiKey: "k",
    models: ["a", "b"],
    prompt: "p",
    fetch: fake,
    sleep: noSleep,
  });
  assert.deepEqual(sent, [
    ["a", "b"],
    ["b", "a"],
  ]);
  assert.equal(r.costUsd, 0.05);
});

test("превью: три ответа без картинки — ошибка с причиной и расходом, а не пробелы", async () => {
  const { fake, sent } = imageFake([{ body: NO_IMAGE }, { body: NO_IMAGE }, { body: NO_IMAGE }]);
  await assert.rejects(
    generatePreview({ apiKey: "k", models: ["a", "b"], prompt: "p", fetch: fake, sleep: noSleep }),
    (e: unknown) =>
      e instanceof PreviewFailed &&
      /в ответе нет картинки \(m; stop; не могу\)/.test(e.message) &&
      Math.abs(e.costUsd - 0.03) < 1e-9,
  );
  assert.equal(sent.length, 3);
});

test("превью: 402 не повторяется, 502 повторяется", async () => {
  const empty = imageFake([{ status: 402, body: '{"error":{"message":"balance"}}' }]);
  await assert.rejects(
    generatePreview({
      apiKey: "k",
      models: ["a"],
      prompt: "p",
      fetch: empty.fake,
      sleep: noSleep,
    }),
    /HTTP 402/,
  );
  assert.equal(empty.sent.length, 1);
  const flaky = imageFake([{ status: 502, body: "bad gateway" }, { body: IMAGE }]);
  const r = await generatePreview({
    apiKey: "k",
    models: ["a"],
    prompt: "p",
    fetch: flaky.fake,
    sleep: noSleep,
  });
  assert.equal(flaky.sent.length, 2);
  assert.equal(r.costUsd, 0.04);
});

test("метаданные: отклонения модели — превью под ##, промпт строкой, без маркеров", () => {
  const v = parseVisuals(
    "## Превью-картинка\n\n**Имя файла:** s_preview.jpg\n\n**ALT:** превью статьи\n\n**Промпт (Nano Banana Pro, 1200x800):** Photorealistic desk.\n\n## Схемы\n",
  );
  assert.deepEqual(v.preview, {
    file: "s_preview.jpg",
    alt: "превью статьи",
    prompt: "Photorealistic desk.",
  });
});

test("рендер схемы в контейнере: mmdc с конфигом, JPG 1200x800 и чистка метаданных одной командой", () => {
  const dir = mkdtempSync(join(tmpdir(), "vis-"));
  const calls: string[][] = [];
  const docker: Docker = (args) => {
    calls.push(args);
    return { rc: 0, out: "" };
  };
  const run = dockerRunner({ image: "bds-sat-visuals:0.1.0", dir, uid: "1001:1001", docker });
  renderScheme(run, dir, "s_scheme1.jpg", "flowchart LR\n a-->b", {
    ...OPTS,
    decorate: (c) => `${c}\n  classDef accent fill:#A9CBD4;`,
  });
  assert.equal(
    readFileSync(join(dir, "s_scheme1.jpg.mmd"), "utf8"),
    "flowchart LR\n a-->b\n  classDef accent fill:#A9CBD4;\n",
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(dir, "s_scheme1.jpg.mermaid.json"), "utf8")),
    OPTS.config,
  );
  assert.deepEqual(calls[0].slice(0, 7), [
    "run",
    "--rm",
    "--user",
    "1001:1001",
    "-v",
    `${dir}:/data`,
    "bds-sat-visuals:0.1.0",
  ]);
  const cmd = calls[0].at(-1)!;
  assert.match(
    cmd,
    /mmdc -i s_scheme1\.jpg\.mmd -o s_scheme1\.jpg\.png -b '#F4F8F9' -p \/visuals\/puppeteer-config\.json -c s_scheme1\.jpg\.mermaid\.json -s 3/,
  );
  assert.match(
    cmd,
    /-background '#F4F8F9' -flatten -resize '1200x800>' -quality 95 s_scheme1\.jpg/,
  );
  assert.match(cmd, /exiftool -q -overwrite_original -all= s_scheme1\.jpg/);
});

test("рендер схемы: ошибка mmdc — исключение с хвостом вывода", () => {
  const dir = mkdtempSync(join(tmpdir(), "vis-"));
  const run: Runner = () => ({ rc: 1, out: "Parse error on line 2\nExpecting 'SEMI'" });
  assert.throws(() => renderScheme(run, dir, "f.jpg", "bad", OPTS), /Parse error on line 2/);
});

test("R5: forceLR меняет только направление сверху вниз", () => {
  assert.equal(forceLR("flowchart TD\n  a-->b"), "flowchart LR\n  a-->b");
  assert.equal(
    forceLR("graph BT\n  subgraph X\n    direction TB\n  end"),
    "graph LR\n  subgraph X\n    direction LR\n  end",
  );
  assert.equal(forceLR('flowchart LR\n  a["TD"]-->b'), 'flowchart LR\n  a["TD"]-->b');
  assert.equal(forceLR("sequenceDiagram\n  a->>b: x"), "sequenceDiagram\n  a->>b: x");
});

test("R5: вертикальная схема — проверка высоты и перерисовка LR; горизонтальная — без неё", () => {
  const dir = mkdtempSync(join(tmpdir(), "vis-"));
  const cmds: string[] = [];
  const run: Runner = (c) => {
    cmds.push(c);
    return { rc: 0, out: "" };
  };
  renderScheme(run, dir, "v.jpg", "flowchart TD\n a-->b", OPTS);
  assert.match(cmds[0], /identify -format '%h' v\.jpg\.png/);
  assert.match(cmds[0], /mmdc -i v\.jpg\.lr\.mmd -o v\.jpg\.lr\.png/);
  assert.match(readFileSync(join(dir, "v.jpg.lr.mmd"), "utf8"), /^flowchart LR/);
  renderScheme(run, dir, "h.jpg", "flowchart LR\n a-->b", OPTS);
  assert.doesNotMatch(cmds[1], /identify/);
});

test("размер, масштаб и exiftool настраиваются; превью — та же доводка", () => {
  const dir = mkdtempSync(join(tmpdir(), "vis-"));
  const cmds: string[] = [];
  const run: Runner = (c) => {
    cmds.push(c);
    return { rc: 0, out: "" };
  };
  renderScheme(run, dir, "w.jpg", "flowchart LR\n a-->b", {
    ...OPTS,
    size: "1600x900",
    scale: 2,
    stripMeta: false,
  });
  assert.match(cmds[0], / -s 2 /);
  assert.match(cmds[0], /-resize '1600x900>'/);
  assert.doesNotMatch(cmds[0], /exiftool/);
  finalizePreview(run, "raw.png", "p.jpg", { background: "#FFFFFF" });
  assert.equal(
    cmds[1],
    "convert raw.png -background '#FFFFFF' -flatten -resize '1200x800>' -quality 95 p.jpg && exiftool -q -overwrite_original -all= p.jpg && rm -f raw.png",
  );
});

test("localRunner: команда в заданном каталоге, код и вывод", () => {
  const dir = mkdtempSync(join(tmpdir(), "vis-"));
  const run = localRunner(dir);
  const ok = run("pwd");
  assert.equal(ok.rc, 0);
  assert.equal(ok.out.trim().endsWith(dir.split("/").pop()!), true);
  assert.equal(run("echo boom >&2; exit 3").rc, 3);
  assert.match(run("echo boom >&2; exit 3").out, /boom/);
});
