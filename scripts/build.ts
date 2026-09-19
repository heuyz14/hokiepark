/**
 * Bundle src/ into ONE self-contained dist/index.html (CSS, JS and data inlined) so the demo
 * runs by double-clicking the file: everything the JS needs to RUN is in this one file, no build
 * server. The map itself now needs live network to fetch its basemap tiles/style/fonts (MapLibre
 * GL JS + OpenFreeMap - see ui/map.ts), so unlike the rest of the app it will not work offline;
 * that's a deliberate tradeoff for a real, good-looking basemap instead of a hand-drawn one.
 * public/ (manifest, icons, service worker) is copied alongside for installability; the page
 * itself never depends on those files. `--watch` rebuilds.
 */
import { build } from "esbuild";
import { parseLiveConfig, type LiveConfig } from "../src/lib/live-config.ts";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const path = (p: string) => new URL(p, root).pathname;
const outIdx = process.argv.indexOf("--out");
const outDir = outIdx > 0 ? process.argv[outIdx + 1]! : path("dist");

// Optional Supabase feed. Only the PUBLIC url + anon/publishable key are embedded; a service-role/secret key aborts the build.
let liveConfig: LiveConfig | null;
try {
  liveConfig = parseLiveConfig(process.env.HOKIEPARK_SUPABASE_URL, process.env.HOKIEPARK_SUPABASE_ANON_KEY, process.env.HOKIEPARK_POLL_MS);
} catch (err) {
  console.error(`Build aborted: ${(err as Error).message}`);
  process.exit(1);
}

/**
 * MapLibre runs its tile parsing on a Web Worker, which by default it loads relative to its own
 * module URL (`import.meta.url`) - that doesn't exist once everything is inlined into one HTML
 * file. The fix: bundle maplibre-gl's dedicated worker entrypoint into ITS OWN fully self-contained
 * script (no more imports), embed that source as a string in the app bundle, and at runtime turn
 * it into a Blob URL via `maplibregl.setWorkerUrl()` before creating any Map. Bundled once, not
 * per rebuild - it's a fixed node_modules dependency, not part of src/.
 */
async function bundleMapLibreWorker(): Promise<string> {
  const out = await build({
    entryPoints: [path("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs")],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2022",
    minify: true,
    legalComments: "none",
    logLevel: "warning",
  });
  return out.outputFiles[0]!.text;
}

async function bundle(mapLibreWorkerSrc: string) {
  const t0 = performance.now();
  const js = await build({
    entryPoints: [path("src/main.ts")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
    minify: !process.argv.includes("--watch"),
    legalComments: "none",
    define: { __LIVE_CONFIG__: JSON.stringify(liveConfig), __MAPLIBRE_WORKER_SRC__: JSON.stringify(mapLibreWorkerSrc) },
    logLevel: "warning",
  });
  const script = js.outputFiles[0]!.text.replace(/<\/script/gi, "<\\/script");
  const css = readFileSync(path("src/styles.css"), "utf8") + "\n" + readFileSync(path("node_modules/maplibre-gl/dist/maplibre-gl.css"), "utf8");
  const html = readFileSync(path("src/index.template.html"), "utf8")
    .replace("/*__CSS__*/", () => css)
    .replace("/*__JS__*/", () => script);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/index.html`, html);
  // PWA files (manifest, icons, service worker). The SW cache name is stamped with a hash of the page.
  cpSync(path("public"), outDir, { recursive: true });
  const version = createHash("sha256").update(html).digest("hex").slice(0, 10);
  writeFileSync(`${outDir}/sw.js`, readFileSync(path("public/sw.js"), "utf8").replace("__VERSION__", version));
  console.log(`${outDir === path("dist") ? "dist" : outDir}/index.html  ${(html.length / 1024).toFixed(0)} KB  sw=${version}  live feed: ${liveConfig ? "ON (" + new URL(liveConfig.url).host + ")" : "OFF (sample counts)"}  (${Math.round(performance.now() - t0)} ms)`);
}

const mapLibreWorkerSrc = await bundleMapLibreWorker();
await bundle(mapLibreWorkerSrc);
if (process.argv.includes("--watch")) {
  let timer: NodeJS.Timeout | undefined;
  watch(path("src"), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => bundle(mapLibreWorkerSrc).catch((e) => console.error(e.message)), 100);
  });
  console.log("watching src/ ...");
}
