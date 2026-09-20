import type { BuildingCategory } from "../types.ts";
import { adaBadge } from "./badge.ts";
import { CATEGORY_COLOR, CATEGORY_SHORT } from "./format.ts";

export function renderLegend(el: HTMLElement): void {
  el.innerHTML = `
    <button type="button" class="legend-toggle" aria-expanded="true" aria-controls="legend-body">Map legend</button>
    <ul id="legend-body">
      <li><span class="legend-parking" aria-hidden="true">P</span>Parking</li>
      <li>${adaBadge({ label: "Accessible" })}</li>
      ${(Object.keys(CATEGORY_COLOR) as BuildingCategory[]).map((c) => `<li class="legend-building"><span class="swatch swatch-building" style="background:${CATEGORY_COLOR[c]}" aria-hidden="true"></span>${CATEGORY_SHORT[c]}</li>`).join("")}
      <li class="permit-result-key"><span class="swatch swatch-permit-yes"></span>Permit valid</li>
      <li class="permit-result-key"><span class="swatch swatch-permit-check"></span>Check sign</li>
      <li class="permit-result-key"><span class="swatch swatch-permit-no"></span>Not covered</li>
    </ul>`;
  const btn = el.querySelector<HTMLButtonElement>(".legend-toggle")!;
  const body = el.querySelector<HTMLElement>("#legend-body")!;
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    body.hidden = !open;
  });
}
