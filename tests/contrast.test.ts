import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Phase 3/5: readable in bright daylight. Checks WCAG AA (4.5:1) for every text/background pair the UI uses,
 * reading the real CSS custom properties so a palette edit that breaks contrast fails here. */
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const expand = (h: string) => (h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h);
const vars = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\s*;/g)].map((m) => [m[1]!, expand(m[2]!)]));

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const v = (n: string) => {
  const c = vars[n];
  assert.ok(c, `missing CSS variable --${n}`);
  return c;
};

const PAIRS: [string, string, string][] = [
  ["body text", v("ink"), v("paper")],
  ["muted text on white", v("muted"), v("paper")],
  ["maroon text on white (headings, links)", v("maroon"), v("paper")],
  ["white on maroon (header, buttons, my chat bubble)", "#ffffff", v("maroon")],
  ["white on ADA blue (badge)", "#ffffff", v("ada")],
  ["ADA blue on white (zero-count outline badge)", v("ada"), v("paper")],
  ["Open pill", v("ok"), v("ok-bg")],
  ["Limited pill", v("warn"), v("warn-bg")],
  ["Full pill", v("bad"), v("bad-bg")],
  ["maroon on assistant bubble", v("maroon"), "#f4eff0"],
  ["ink on assistant bubble", v("ink"), "#f4eff0"],
];

for (const [name, fg, bg] of PAIRS) {
  test(`contrast >= 4.5:1 - ${name}`, () => {
    const r = ratio(fg, bg);
    assert.ok(r >= 4.5, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
  });
}

test("ADA blue is visually distinct from residential-building blue (spec Section 10)", () => {
  // Distinct in luminance, not just hue: badges must never be mistaken for a residential building.
  assert.ok(Math.abs(lum(v("ada")) - lum(v("cat-residential"))) > 0.15);
});
