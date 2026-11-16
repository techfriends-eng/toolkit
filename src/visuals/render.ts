import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Картинки статьи: Mermaid → PNG (mmdc, scale 3), затем JPG нужного размера на фоне и чистка метаданных
 * (exiftool). Команды — bash-строка, её выполняет `Runner`: контейнер (`dockerRunner`, спутники) или
 * текущая машина (`localRunner`, образ wiki_visualizer). Нужны mmdc, convert, identify, exiftool.
 * Перенесено из bds-satellites src/lib/visuals/render.ts (bds-content ADR 0001, п. 4c): палитра сайта
 * (brand) осталась в проекте и приходит сюда готовыми `decorate` и `config`.
 */
export type Runner = (cmd: string) => { rc: number; out: string };

/** Вызов docker CLI: аргументы → код и вывод. Подменяется в тестах. */
export type Docker = (args: string[]) => { rc: number; out: string };

export const dockerCli: Docker = (args) => {
  const r = spawnSync("docker", args, { encoding: "utf8", timeout: 180_000 });
  return { rc: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

/** Команда в контейнере `image` с uid хоста; каталог `dir` смонтирован в /data и он же рабочий. */
export function dockerRunner(opts: {
  image: string;
  dir: string;
  uid: string;
  docker?: Docker;
}): Runner {
  const docker = opts.docker ?? dockerCli;
  return (cmd) =>
    docker([
      "run",
      "--rm",
      "--user",
      opts.uid,
      "-v",
      `${opts.dir}:/data`,
      opts.image,
      "bash",
      "-c",
      cmd,
    ]);
}

/** Команда здесь же, в каталоге `dir`. */
export function localRunner(dir: string, timeoutMs = 180_000): Runner {
  return (cmd) => {
    const r = spawnSync("bash", ["-c", cmd], { cwd: dir, encoding: "utf8", timeout: timeoutMs });
    return { rc: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
}

function exec(run: Runner, cmd: string): void {
  const r = run(cmd);
  if (r.rc !== 0) throw new Error(r.out.trim().split("\n").slice(-5).join(" | "));
}

export type FinishOptions = {
  background: string;
  /** Итоговый размер, сжатие без обрезки (`>`). По умолчанию 1200x800. */
  size?: string;
  /** Снять EXIF/XMP/C2PA exiftool. По умолчанию да. */
  stripMeta?: boolean;
};

/**
 * PNG → итоговый файл на фоне, сжатие до размера без обрезки, PNG удаляется. JPEG — качество 95 (резкие
 * границы текста схем), формат — по расширению `out`. exiftool снимает метаданные, если не выключен.
 */
function finish(png: string, out: string, o: FinishOptions): string {
  const size = o.size ?? "1200x800";
  const quality = /\.png$/i.test(out) ? "" : " -quality 95";
  const strip = o.stripMeta === false ? "" : ` && exiftool -q -overwrite_original -all= ${out}`;
  return `convert ${png} -background '${o.background}' -flatten -resize '${size}>'${quality} ${out}${strip} && rm -f ${png}`;
}

/**
 * bds-content content-rules R5: направление graph/flowchart и direction в subgraph TB/TD/BT → LR.
 * Остальной код схемы не меняется. Копия `mermaid_force_lr` из wiki_visualizer (lib/mermaid_render.sh).
 */
export function forceLR(mermaid: string): string {
  return mermaid
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*(?:graph|flowchart))\s+(?:TB|TD|BT)\b/, "$1 LR")
        .replace(/^(\s*direction)\s+(?:TB|TD|BT)\b/, "$1 LR"),
    )
    .join("\n");
}

export type SchemeOptions = FinishOptions & {
  /** Конфиг mmdc (`-c`): тема, шрифт, отступы. */
  config: Record<string, unknown>;
  /** Путь к puppeteer-config.json там, где выполняется команда. */
  puppeteerConfig: string;
  /** Правка кода перед рендером (цвета сайта). По умолчанию код как есть. */
  decorate?: (mermaid: string) => string;
  /** Масштаб mmdc (`-s`). По умолчанию 3. */
  scale?: number;
  /** Ширина холста mmdc (`-w`): шире — плотные схемы не наезжают подписями. По умолчанию естественная. */
  width?: number;
};

/**
 * Схема `mermaid` → `dir/file` (JPEG или PNG по расширению). R5: если PNG выше, чем шире, схема перерисовывается с LR и
 * берётся LR, когда он не выше, чем шире. Временные .mmd, .json и .png удаляются.
 */
export function renderScheme(
  run: Runner,
  dir: string,
  file: string,
  mermaid: string,
  o: SchemeOptions,
): void {
  const decorate = o.decorate ?? ((c: string) => c);
  const mmd = `${file}.mmd`;
  const conf = `${file}.mermaid.json`;
  writeFileSync(join(dir, mmd), `${decorate(mermaid)}\n`);
  writeFileSync(join(dir, conf), JSON.stringify(o.config));
  const png = `${file}.png`;
  const mmdc = (input: string, output: string) =>
    `mmdc -i ${input} -o ${output} -b '${o.background}' -p ${o.puppeteerConfig} -c ${conf} -s ${o.scale ?? 3}${o.width ? ` -w ${o.width}` : ""}`;
  const lr = forceLR(mermaid);
  let retry = "";
  if (lr !== mermaid) {
    const lrMmd = `${file}.lr.mmd`;
    const lrPng = `${file}.lr.png`;
    writeFileSync(join(dir, lrMmd), `${decorate(lr)}\n`);
    const taller = (p: string) =>
      `[ "$(identify -format '%h' ${p})" -gt "$(identify -format '%w' ${p})" ]`;
    retry =
      ` && if ${taller(png)}; then ${mmdc(lrMmd, lrPng)} && if ! ${taller(lrPng)}; then mv ${lrPng} ${png}; fi; fi` +
      ` && rm -f ${lrMmd} ${lrPng}`;
  }
  exec(run, `${mmdc(mmd, png)}${retry} && rm -f ${mmd} ${conf} && ${finish(png, file, o)}`);
}

/** Превью из готового PNG/JPEG модели: тот же размер, фон и чистка метаданных (C2PA модели). */
export function finalizePreview(run: Runner, raw: string, file: string, o: FinishOptions): void {
  exec(run, finish(raw, file, o));
}
