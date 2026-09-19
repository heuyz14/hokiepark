import { adaBadge } from "./badge.ts";

export function renderLegend(el: HTMLElement): void {
  el.innerHTML = `
    <button type="button" class="legend-toggle" aria-expanded="true" aria-controls="legend-body">Map legend</button>
    <ul id="legend-body">
      <li><span class="legend-parking" aria-hidden="true">P</span>Parking</li>
      <li>${adaBadge({ label: "Accessible" })}</li>
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
