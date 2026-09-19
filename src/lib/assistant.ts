import { BUILDINGS, GARAGES, LOTS } from "../data/index.ts";
import type { Garage, Lot, SelectionKind } from "../types.ts";
import { formatMeters, nearest, walkMinutes } from "./nearby.ts";
import { garageStatus, garageTotals, levelStatus, openAdaSpaces, openSpaces, STATUS_LABEL } from "./occupancy.ts";
import { detectPermit, eligibleLevels, eligibleOpen, levelAllows, lotAllows, PERMIT_LABEL, type PermitChoice } from "./permits.ts";

/**
 * Deterministic parking assistant (Phase 4). It answers ONLY from BUILDINGS/LOTS/GARAGES through the
 * same occupancy helpers the map, list and sheet use, so its numbers cannot disagree with them.
 * No network, no API key. `Answerer` is the seam where an LLM proxy could be swapped in later.
 */
export interface AnswerRef {
  kind: SelectionKind;
  id: string;
  label: string;
}
export interface Answer {
  lines: string[];
  refs: AnswerRef[];
}
export type Answerer = (question: string) => Promise<Answer>;

export const SUGGESTED_QUESTIONS = [
  "Where's the closest open parking to Squires Student Center?",
  "Is there accessible parking near Cassell Coliseum?",
  "Which garage has the most open spots right now?",
];

interface Place {
  kind: SelectionKind;
  id: string;
  name: string;
  lat: number;
  lon: number;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["hall", "center", "centre", "student", "the", "of", "and", "building", "lot", "garage", "parking", "street", "st", "wing", "east", "north", "south", "west"]);
const sigTokens = (name: string) => norm(name).split(" ").filter((t) => t.length >= 3 && !STOP.has(t));

/** Best place mentioned in the question: most matching distinctive name tokens wins; `prefer` breaks ties. */
export function findPlace(question: string): Place | null {
  const q = new Set(norm(question).split(" "));
  const prefer: SelectionKind[] = /\blots?\b/.test(norm(question)) ? ["lot", "building", "garage"] : /\bgarages?\b/.test(norm(question)) ? ["garage", "building", "lot"] : ["building", "garage", "lot"];
  const all: Place[] = [
    ...BUILDINGS.map((b) => ({ kind: "building" as const, id: b.id, name: b.name, lat: b.lat, lon: b.lon })),
    ...GARAGES.map((g) => ({ kind: "garage" as const, id: g.id, name: g.name, lat: g.lat, lon: g.lon })),
    ...LOTS.map((l) => ({ kind: "lot" as const, id: l.id, name: l.name, lat: l.lat, lon: l.lon })),
  ];
  let best: { p: Place; hits: number; ratio: number } | null = null;
  for (const p of all) {
    const toks = sigTokens(p.name);
    const hits = toks.filter((t) => q.has(t)).length;
    if (!hits) continue;
    const ratio = hits / toks.length;
    if (ratio < 0.5) continue;
    // A lone short word ("life" in "Graduate Life Center") is not enough to name a place.
    if (hits < 2 && toks.length > 1 && !toks.some((t) => q.has(t) && t.length >= 5)) continue;
    const better =
      !best ||
      hits > best.hits ||
      (hits === best.hits && ratio > best.ratio) ||
      (hits === best.hits && ratio === best.ratio && prefer.indexOf(p.kind) < prefer.indexOf(best.p.kind));
    if (better) best = { p, hits, ratio };
  }
  return best?.p ?? null;
}

const garageLine = (g: Garage) => {
  const t = garageTotals(g);
  return `${g.name}: ${t.open} of ${t.capacity} open (${STATUS_LABEL[garageStatus(g)]}), ${t.adaOpen} accessible open`;
};
const distText = (m: number) => `${formatMeters(m)}, about ${walkMinutes(m)} min walk`;
const adaLevels = (g: Garage) =>
  g.levels
    .filter((l) => openAdaSpaces(l) > 0)
    .map((l) => `${l.label.split(" - ")[0]}: ${openAdaSpaces(l)}`)
    .join(", ");
const lotNote = "Live space counts aren't tracked for lots, so this is permit and accessibility info only.";
const ref = (kind: SelectionKind, id: string, label: string): AnswerRef => ({ kind, id, label });

function adaAnswer(place: Place | null): Answer {
  const refs: AnswerRef[] = [];
  const lines: string[] = [];
  const from = place ?? { lat: 37.2285, lon: -80.4225 }; // Drillfield centre when no place is named
  const adaLots = nearest(LOTS.filter((l) => l.hasADA), from, 2);
  const adaGarages = nearest(GARAGES.filter((g) => garageTotals(g).adaOpen > 0), from, 1);
  lines.push(place ? `Accessible parking near ${place.name}:` : "Accessible parking on campus:");
  for (const { item, meters } of adaLots) {
    lines.push(`- ${item.name} lot: ${place ? distText(meters) + ", " : ""}${item.adaSpaces} designated accessible spaces (${item.permit} permit).`);
    refs.push(ref("lot", item.id, `${item.name} lot`));
  }
  for (const { item, meters } of adaGarages) {
    const t = garageTotals(item);
    lines.push(`- ${item.name}${place ? ` (${distText(meters)})` : ""}: ${t.adaOpen} accessible spaces open right now (${adaLevels(item)}).`);
    refs.push(ref("garage", item.id, item.name));
  }
  if (!adaLots.length && !adaGarages.length) lines.push("No accessible spaces are currently listed as open.");
  lines.push(lotNote);
  return { lines, refs };
}

const permitGarageLine = (g: Garage, p: PermitChoice) => {
  const t = garageTotals(g);
  return `${g.name}: ${eligibleOpen(g, p)} open on levels for a ${PERMIT_LABEL[p]} permit (${t.open} of ${t.capacity} open overall), ${t.adaOpen} accessible open`;
};

function nearestAnswer(place: Place, permit: PermitChoice | null = null): Answer {
  const lines = [`Closest parking${permit ? ` for a ${PERMIT_LABEL[permit]} permit` : ""} to ${place.name}:`];
  const refs: AnswerRef[] = [];
  const openCount = (g: Garage) => (permit ? eligibleOpen(g, permit) : garageTotals(g).open);
  const openGarages = nearest(GARAGES.filter((g) => openCount(g) > 0), place, 1);
  for (const { item, meters } of openGarages) {
    lines.push(`- ${permit ? permitGarageLine(item, permit) : garageLine(item)} - ${distText(meters)}.`);
    refs.push(ref("garage", item.id, item.name));
  }
  for (const g of GARAGES.filter((x) => openCount(x) === 0)) {
    lines.push(permit ? `- ${g.name} has ${eligibleLevels(g, permit).length ? "no open spaces" : "no levels"} for a ${PERMIT_LABEL[permit]} permit right now.` : `- ${g.name} is full right now.`);
  }
  const lots = permit ? LOTS.filter((l) => lotAllows(l, permit) || l.hasADA) : LOTS;
  for (const { item, meters } of nearest(lots, place, 2)) {
    lines.push(`- ${item.name} lot (${item.permit} permit${item.hasADA ? ", accessible spaces" : ""}) - ${distText(meters)}.`);
    refs.push(ref("lot", item.id, `${item.name} lot`));
  }
  lines.push(lotNote);
  return { lines, refs };
}

function mostOpenAnswer(permit: PermitChoice | null = null): Answer {
  const count = (g: Garage) => (permit ? eligibleOpen(g, permit) : garageTotals(g).open);
  const ranked = [...GARAGES].sort((a, b) => count(b) - count(a));
  const top = ranked[0]!;
  const refs = ranked.map((g) => ref("garage", g.id, g.name));
  if (count(top) === 0) return { lines: [permit ? `Neither garage has open spaces for a ${PERMIT_LABEL[permit]} permit right now.` : "Both garages are full right now."], refs };
  if (permit) {
    const t = garageTotals(top);
    return { lines: [`${top.name} has the most open spaces for a ${PERMIT_LABEL[permit]} permit right now: ${eligibleOpen(top, permit)} (of ${t.open} open overall).`, ...ranked.map((g) => `- ${permitGarageLine(g, permit)}`)], refs };
  }
  const t = garageTotals(top);
  return { lines: [`${top.name} has the most open spaces right now: ${t.open} of ${t.capacity}.`, ...ranked.map((g) => `- ${garageLine(g)}`)], refs };
}

function placeStatusAnswer(place: Place, permit: PermitChoice | null = null): Answer {
  if (place.kind === "garage") {
    const g = GARAGES.find((x) => x.id === place.id)!;
    return {
      lines: [garageLine(g), ...(permit ? [`For a ${PERMIT_LABEL[permit]} permit: ${eligibleOpen(g, permit)} open on eligible levels.`] : []), ...g.levels.map((l) => `- ${l.label}: ${openSpaces(l)} open of ${l.capacity} (${STATUS_LABEL[levelStatus(l)]}), ${openAdaSpaces(l)} accessible open`)],
      refs: [ref("garage", g.id, g.name)],
    };
  }
  if (place.kind === "lot") {
    const l = LOTS.find((x) => x.id === place.id) as Lot;
    return {
      lines: [`${l.name} lot: ${l.permit} permit, status ${l.status}${l.hasADA ? `, ${l.adaSpaces} designated accessible spaces` : ", no designated accessible spaces"}.`, ...(permit ? [`A ${PERMIT_LABEL[permit]} permit is ${lotAllows(l, permit) ? "valid" : "not valid"} here.`] : []), lotNote],
      refs: [ref("lot", l.id, `${l.name} lot`)],
    };
  }
  return nearestAnswer(place, permit);
}

function permitAnswer(permit: PermitChoice): Answer {
  const lots = LOTS.filter((l) => lotAllows(l, permit));
  const levels = GARAGES.flatMap((g) => g.levels.filter((l) => levelAllows(l, permit)).map((l) => ({ g, l })));
  const label = PERMIT_LABEL[permit];
  if (!lots.length && !levels.length) return { lines: [`Nothing in the demo data is listed for a ${label} permit.`, lotNote], refs: [] };
  return {
    lines: [
      permit === "visitor" ? "Visitor-friendly parking:" : `Parking for a ${label} permit:`,
      ...lots.map((l) => `- ${l.name} lot (${l.permit} permit)`),
      ...levels.map(({ g, l }) => `- ${g.name}, ${l.label}: ${openSpaces(l)} open`),
      lotNote,
    ],
    refs: [...lots.map((l) => ref("lot", l.id, `${l.name} lot`)), ...[...new Set(levels.map((x) => x.g))].map((g) => ref("garage", g.id, g.name))],
  };
}

const HELP: Answer = {
  lines: ["I can answer questions about the garages, lots and accessible parking shown on the map. Try:", ...SUGGESTED_QUESTIONS.map((q) => `- ${q}`)],
  refs: [],
};

export interface AnswerContext {
  /** The permit the user picked in the app; a permit named in the question itself wins over it. */
  permit?: PermitChoice | null;
}

export function answerQuestion(question: string, ctx: AnswerContext = {}): Answer {
  const q = norm(question);
  if (!q) return HELP;
  const place = findPlace(question);
  const asked = detectPermit(q);
  const permit = asked ?? ctx.permit ?? null;
  const ada = /\b(accessible|accessibility|ada|handicap\w*|wheelchair|disab\w*)\b/.test(q);
  const near = /\b(near|nearest|closest|close|around|walk\w*|by)\b/.test(q);
  const most = /\bmost\b|\bhighest\b|\bbiggest\b|\bmore open\b/.test(q);
  if (ada) return adaAnswer(place); // accessible parking never depends on permit
  if (most && /\b(garage|garages|open|spots|spaces|available|parking)\b/.test(q)) return mostOpenAnswer(permit);
  if (place && near) return nearestAnswer(place, permit);
  if (place) return placeStatusAnswer(place, permit);
  if (asked) return permitAnswer(asked);
  if (/\b(open|available|free|full|space|spaces|spot|spots)\b/.test(q) && /\b(garage|garages)\b/.test(q)) return mostOpenAnswer(permit);
  return HELP;
}

export const localAnswerer: Answerer = async (question) => answerQuestion(question);

/** Local answerer that also honors the permit chosen in the UI (read at ask time, so changes apply immediately). */
export const makeLocalAnswerer = (getPermit: () => PermitChoice | null): Answerer => async (question) => answerQuestion(question, { permit: getPermit() });
