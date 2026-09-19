/**
 * Bundle src/ into ONE self-contained dist/index.html (CSS, JS and data inlined) so the demo
 * runs by double-clicking the file: no server, no network. public/ (manifest, icons, service worker)
 * is copied alongside for installability; the page itself never depends on those files. `--watch` rebuilds.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const path = (p: string) => new URL(p, root).pathname;

async function bundle() {
  const t0 = performance.now();
  const js = await build({
    entryPoints: [path("src/main.ts")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
    minify: !process.argv.includes("--watch"),
    legalComments: "none",
    logLevel: "warning",
  });
  const script = js.outputFiles[0]!.text.replace(/<\/script/gi, "<\\/script");
  const css = readFileSync(path("src/styles.css"), "utf8");
  const html = readFileSync(path("src/index.template.html"), "utf8")
    .replace("/*__CSS__*/", () => css)
    .replace("/*__JS__*/", () => script);
  mkdirSync(path("dist"), { recursive: true });
  writeFileSync(path("dist/index.html"), html);
  // PWA files (manifest, icons, service worker). The SW cache name is stamped with a hash of the page.
  cpSync(path("public"), path("dist"), { recursive: true });
  const version = createHash("sha256").update(html).digest("hex").slice(0, 10);
  writeFileSync(path("dist/sw.js"), readFileSync(path("public/sw.js"), "utf8").replace("__VERSION__", version));
  console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} KB  sw=${version}  (${Math.round(performance.now() - t0)} ms)`);
}

await bundle();
if (process.argv.includes("--watch")) {
  let timer: NodeJS.Timeout | undefined;
  watch(path("src"), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => bundle().catch((e) => console.error(e.message)), 100);
  });
  console.log("watching src/ ...");
}
