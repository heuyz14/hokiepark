import type { BuildingCategory } from "../types.ts";
import { CATEGORY_SHORT } from "./format.ts";
import { adaBadge } from "./badge.ts";

const ORDER: BuildingCategory[] = ["academic", "residential", "support", "athletic"];

export function renderLegend(el: HTMLElement): void {
  el.innerHTML = `
    <button type="button" class="legend-toggle" aria-expanded="true" aria-controls="legend-body">Legend</button>
    <ul id="legend-body">
      ${ORDER.map((c) => `<li><span class="swatch cat-${c}"></span>${CATEGORY_SHORT[c]}</li>`).join("")}
      <li><span class="swatch swatch-drill"></span>Drillfield</li>
      <li>${adaBadge({ label: "Accessible" })}</li>
    </ul>`;
  const btn = el.querySelector<HTMLButtonElement>(".legend-toggle")!;
  const body = el.querySelector<HTMLElement>("#legend-body")!;
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    body.hidden = !open;
  });
}
