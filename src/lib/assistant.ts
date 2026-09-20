import { BUILDINGS, GARAGES, LOTS } from "../data/index.ts";
import { buildingFromText } from "./search.ts";
import type { Garage, Lot, SelectionKind } from "../types.ts";
import { formatMeters, nearest, walkMinutes } from "./nearby.ts";
import { garageStatus, garageTotals, levelStatus, openAdaSpaces, openSpaces, STATUS_LABEL } from "./occupancy.ts";
import { classSummary, garageAccess, lotAccess, PERMIT_LABEL, SIGNAGE_NOTE, VERDICT_LABEL, type PermitId, type Verdict } from "./permits.ts";

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
// "visitor(s)" is stopped alongside "student" so a real lot name that happens to contain it (e.g.
// "Old Visitors Center") doesn't hijack the generic "where can visitors park?" intent (see assistant.test.ts).
const STOP = new Set(["hall", "center", "centre", "student", "visitor", "visitors", "the", "of", "and", "building", "lot", "garage", "parking", "street", "st", "wing", "east", "north", "south", "west"]);
const sigTokens = (name: string) => norm(name).split(" ").filter((t) => t.length >= 3 && !STOP.has(t));

/** Best place mentioned in the question: most matching distinctive name tokens wins; `prefer` breaks ties. */
export function findPlace(question: string): Place | null {
  const normalized = norm(question);
  const codedBuilding = /\b(?:lots?|garages?)\b/.test(normalized) ? null : buildingFromText(BUILDINGS, question);
  if (codedBuilding) return { kind: "building", id: codedBuilding.id, name: codedBuilding.name, lat: codedBuilding.lat, lon: codedBuilding.lon };
  const q = new Set(normalized.split(" "));
  const prefer: SelectionKind[] = /\blots?\b/.test(normalized) ? ["lot", "building", "garage"] : /\bgarages?\b/.test(normalized) ? ["garage", "building", "lot"] : ["building", "garage", "lot"];
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
const lotNote = "Lot space counts are demo data too, not from live sensors.";
const ref = (kind: SelectionKind, id: string, label: string): AnswerRef => ({ kind, id, label });

function adaAnswer(place: Place | null): Answer {
  const refs: AnswerRef[] = [];
  const lines: string[] = [];
  const from = place ?? { lat: 37.2285, lon: -80.4225 }; // Drillfield centre when no place is named
  const adaLots = nearest(LOTS.filter((l) => l.hasADA), from, 2);
  const adaGarages = nearest(GARAGES.filter((g) => garageTotals(g).adaOpen > 0), from, 1);
  lines.push(place ? `Accessible parking near ${place.name}:` : "Accessible parking on campus:");
  for (const { item, meters } of adaLots) {
    lines.push(`- ${item.name} lot: ${place ? distText(meters) + ", " : ""}${item.adaSpaces} designated accessible spaces (${classSummary(item.classes)}).`);
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

/**
 * What the driver holds, from the permit chooser. With nothing held (and no accessible credential) the assistant
 * answers exactly as before; with something held, every answer is judged by lib/permits (the same rules the map,
 * list and sheet use) and never says "yes" where the rules say "no" or "check".
 */
export interface AnswerContext {
  permits?: PermitId[];
  ada?: boolean;
}
const filtering = (c: AnswerContext) => (c.permits?.length ?? 0) > 0 || c.ada === true;
const held = (c: AnswerContext) => c.permits ?? [];
const who = (c: AnswerContext) => [...held(c).map((p) => PERMIT_LABEL[p]), ...(c.ada ? ["accessible credentials"] : [])].join(" + ");
const levelVerdict = (l: Garage["levels"][number], c: AnswerContext): Verdict => lotAccess({ classes: l.classes }, held(c), { ada: c.ada }).verdict;
const lotVerdict = (l: Lot, c: AnswerContext): Verdict => lotAccess(l, held(c), { ada: c.ada }).verdict;
const garageVerdict = (g: Garage, c: AnswerContext): Verdict => garageAccess(g.levels, held(c), { ada: c.ada }).verdict;
/** Open spaces on levels the rules say the driver CAN use ("yes" only; "check" levels are never counted as usable). */
const usableOpen = (g: Garage, c: AnswerContext) => g.levels.filter((l) => levelVerdict(l, c) === "yes").reduce((n, l) => n + openSpaces(l), 0);
const PERMIT_FOOTER = [SIGNAGE_NOTE];

/** Permits named in the question itself ("with a commuter permit"). Beats the chooser: the user just said what they hold. */
export function detectPermits(normalizedQuestion: string): PermitId[] {
  const q = normalizedQuestion;
  const out: PermitId[] = [];
  // "graduate" alone is NOT a trigger: it is part of the place name "Graduate Life Center".
  if (/\bperry (street )?permits?\b/.test(q)) out.push("cg-perry");
  else if (/\b(commuter|commuters|commute|commuting)\b|\bc g\b|\bgraduate (student )?permits?\b/.test(q)) out.push("cg");
  if (/\b(faculty|staff|professor|employee|employees)\b/.test(q)) out.push("fs");
  if (/\b(resident|residents|dorm|dorms)\b/.test(q)) out.push("resident");
  if (/\b(visitor|visitors|guest|guests|tour|visiting)\b/.test(q)) out.push("visitor");
  if (/\bevening\b/.test(q)) out.push("evening");
  if (/\bstudent remote\b/.test(q)) out.push("student-remote");
  if (/\b(f s|fs|faculty staff) remote\b|\bchicken hill remote\b/.test(q)) out.push("fs-remote");
  return out;
}

function nearestAnswer(place: Place, c: AnswerContext = {}): Answer {
  const refs: AnswerRef[] = [];
  if (!filtering(c)) {
    const lines = [`Closest parking to ${place.name}:`];
    const openGarages = nearest(GARAGES.filter((g) => garageTotals(g).open > 0), place, 1);
    const fullGarages = GARAGES.filter((g) => garageTotals(g).open === 0);
    for (const { item, meters } of openGarages) {
      lines.push(`- ${garageLine(item)} - ${distText(meters)}.`);
      refs.push(ref("garage", item.id, item.name));
    }
    for (const g of fullGarages) lines.push(`- ${g.name} is full right now.`);
    for (const { item, meters } of nearest(LOTS, place, 2)) {
      lines.push(`- ${item.name} lot (${classSummary(item.classes)}${item.hasADA ? ", accessible spaces" : ""}) - ${distText(meters)}.`);
      refs.push(ref("lot", item.id, `${item.name} lot`));
    }
    lines.push(lotNote);
    return { lines, refs };
  }

  const lines = [`Closest parking for ${who(c)} to ${place.name}:`];
  const withUse = GARAGES.map((g) => ({ ...g, verdict: garageVerdict(g, c), usable: usableOpen(g, c) }));
  // Every garage with usable open spaces is listed (nearest first); the rest are explained by their verdict.
  const usableGarages = nearest(withUse.filter((g) => g.usable > 0), place, GARAGES.length);
  for (const { item, meters } of usableGarages) {
    const g = GARAGES.find((x) => x.id === item.id)!;
    const t = garageTotals(g);
    lines.push(`- ${g.name}: ${item.usable} open on levels your permit covers (${t.open} of ${t.capacity} open overall), ${t.adaOpen} accessible open - ${distText(meters)}.`);
    refs.push(ref("garage", g.id, g.name));
  }
  const listed = new Set(usableGarages.map((x) => x.item.id));
  for (const g of withUse.filter((x) => !listed.has(x.id))) {
    if (g.verdict === "no") lines.push(`- ${g.name}: not valid for your permit.`);
    else if (g.verdict === "check") lines.push(`- ${g.name}: we can't confirm your permit here - check the posted sign.`);
    else lines.push(`- ${g.name} has no open spaces on levels your permit covers right now.`);
  }
  const lots = nearest(LOTS.filter((l) => lotVerdict(l, c) !== "no"), place, 2);
  for (const { item, meters } of lots) {
    lines.push(`- ${item.name} lot (${classSummary(item.classes)}) - ${distText(meters)}${lotVerdict(item, c) === "check" ? " - confirm at the sign" : ""}.`);
    refs.push(ref("lot", item.id, `${item.name} lot`));
  }
  if (!lots.length) lines.push(`- No lot in the demo data is valid for ${who(c)}.`);
  lines.push(lotNote, ...PERMIT_FOOTER);
  return { lines, refs };
}

function mostOpenAnswer(c: AnswerContext = {}): Answer {
  if (filtering(c)) {
    const ranked = [...GARAGES].sort((a, b) => usableOpen(b, c) - usableOpen(a, c));
    const top = ranked[0]!;
    const refs = ranked.map((g) => ref("garage", g.id, g.name));
    if (usableOpen(top, c) === 0) return { lines: [`Neither garage has open spaces on levels ${who(c)} can use right now.`, ...PERMIT_FOOTER], refs };
    return {
      lines: [
        `${top.name} has the most open spaces on levels your permit covers: ${usableOpen(top, c)} (of ${garageTotals(top).open} open overall).`,
        ...ranked.map((g) => `- ${g.name}: ${usableOpen(g, c)} on your permit's levels (${garageTotals(g).open} of ${garageTotals(g).capacity} open overall)`),
        ...PERMIT_FOOTER,
      ],
      refs,
    };
  }
  const ranked = [...GARAGES].sort((a, b) => garageTotals(b).open - garageTotals(a).open);
  const top = ranked[0]!;
  const t = garageTotals(top);
  if (t.open === 0) return { lines: ["Both garages are full right now."], refs: ranked.map((g) => ref("garage", g.id, g.name)) };
  return {
    lines: [`${top.name} has the most open spaces right now: ${t.open} of ${t.capacity}.`, ...ranked.map((g) => `- ${garageLine(g)}`)],
    refs: ranked.map((g) => ref("garage", g.id, g.name)),
  };
}

const VERDICT_WORD: Record<Verdict, string> = { yes: "valid for your permit", no: "not valid for your permit", check: "check the sign" };

function placeStatusAnswer(place: Place, c: AnswerContext = {}): Answer {
  const f = filtering(c);
  if (place.kind === "garage") {
    const g = GARAGES.find((x) => x.id === place.id)!;
    const gv = f ? garageAccess(g.levels, held(c), { ada: c.ada }) : null;
    return {
      lines: [
        garageLine(g),
        ...(gv ? [`Your permit: ${VERDICT_LABEL[gv.verdict]}${gv.note ? ` - ${gv.note}` : ""}`] : []),
        ...g.levels.map((l) => `- ${l.label}: ${openSpaces(l)} open of ${l.capacity} (${STATUS_LABEL[levelStatus(l)]}), ${openAdaSpaces(l)} accessible open${f ? ` - ${VERDICT_WORD[levelVerdict(l, c)]}` : ""}`),
        ...(f ? PERMIT_FOOTER : []),
      ],
      refs: [ref("garage", g.id, g.name)],
    };
  }
  if (place.kind === "lot") {
    const l = LOTS.find((x) => x.id === place.id) as Lot;
    const lv = f ? lotAccess(l, held(c), { ada: c.ada }) : null;
    return {
      lines: [
        `${l.name} lot: ${classSummary(l.classes)}, status ${l.status}${l.hasADA ? `, ${l.adaSpaces} designated accessible spaces` : ", no designated accessible spaces"}.`,
        ...(lv ? [`Your permit: ${VERDICT_LABEL[lv.verdict]}${lv.note ? ` - ${lv.note}` : ""}`] : []),
        lotNote,
        ...(f ? PERMIT_FOOTER : []),
      ],
      refs: [ref("lot", l.id, `${l.name} lot`)],
    };
  }
  return nearestAnswer(place, c);
}

/** "Where can <permit holders> park?" - what the rules say is valid, plus what needs a sign check. */
function permitAnswer(permit: PermitId): Answer {
  const label = PERMIT_LABEL[permit];
  const c: AnswerContext = { permits: [permit] };
  const lots = LOTS.filter((l) => lotVerdict(l, c) === "yes");
  const maybe = LOTS.filter((l) => lotVerdict(l, c) === "check" && l.classes.length > 0);
  const levels = GARAGES.flatMap((g) => g.levels.filter((l) => levelVerdict(l, c) === "yes").map((l) => ({ g, l })));
  if (!lots.length && !levels.length && !maybe.length) return { lines: [`Nothing in the demo data is listed as valid for a ${label} permit.`, ...PERMIT_FOOTER], refs: [] };
  return {
    lines: [
      permit === "visitor" ? "Visitor-friendly parking:" : `Parking for a ${label} permit:`,
      ...lots.map((l) => `- ${l.name} lot (${classSummary(l.classes)})`),
      ...levels.map(({ g, l }) => `- ${g.name}, ${l.label}: ${openSpaces(l)} open`),
      ...maybe.map((l) => `- ${l.name} lot (${classSummary(l.classes)}) - confirm at the sign`),
      lotNote,
      ...PERMIT_FOOTER,
    ],
    refs: [
      ...lots.map((l) => ref("lot", l.id, `${l.name} lot`)),
      ...[...new Set(levels.map((x) => x.g))].map((g) => ref("garage", g.id, g.name)),
    ],
  };
}

const HELP: Answer = {
  lines: ["I can answer questions about the garages, lots and accessible parking shown on the map. Try:", ...SUGGESTED_QUESTIONS.map((q) => `- ${q}`)],
  refs: [],
};

export function answerQuestion(question: string, ctx: AnswerContext = {}): Answer {
  const q = norm(question);
  if (!q) return HELP;
  // A permit named in the question overrides the one saved in the chooser.
  const named = detectPermits(q);
  const c: AnswerContext = named.length ? { permits: named, ada: ctx.ada } : ctx;
  const place = findPlace(question);
  // "ADA" inside a place name ("Stanger St. ADA lot") is the name, not a request for accessible parking.
  const qNoName = place ? q.replace(norm(place.name), " ") : q;
  const ada = /\b(accessible|accessibility|ada|handicap\w*|wheelchair|disab\w*)\b/.test(qNoName);
  const near = /\b(near|nearest|closest|close|around|walk\w*|by)\b/.test(q);
  const most = /\bmost\b|\bhighest\b|\bbiggest\b|\bmore open\b/.test(q);
  if (ada) {
    const a = adaAnswer(place);
    if (filtering(c)) a.lines.push(`Accessible spaces need a valid state accessible plate or placard${c.ada ? "" : " (you haven't marked that you have one)"}.`, ...PERMIT_FOOTER);
    return a;
  }
  if (most && /\b(garage|garages|open|spots|spaces|available|parking)\b/.test(q)) return mostOpenAnswer(c);
  if (place && near) return nearestAnswer(place, c);
  if (place) return placeStatusAnswer(place, c);
  if (named.length) return permitAnswer(named[0]!);
  if (/\b(open|available|free|full|space|spaces|spot|spots)\b/.test(q) && /\b(garage|garages)\b/.test(q)) return mostOpenAnswer(c);
  return HELP;
}

export const localAnswerer: Answerer = async (question) => answerQuestion(question);

/** Local answerer that reads the driver's permits at ask time, so changing the chooser applies to the very next question. */
export const makeLocalAnswerer = (getContext: () => AnswerContext): Answerer => async (question) => answerQuestion(question, getContext());

const sameQuestion = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Up to three "ask this next" questions drawn from what the answer actually referenced, so the
 * chips change with the conversation instead of sitting there as a fixed bar. Anything already
 * asked is skipped; the starter questions backfill when an answer referenced nothing.
 */
export function followUpQuestions(a: Answer, asked: Iterable<string> = [], limit = 3, fallback: readonly string[] = SUGGESTED_QUESTIONS): string[] {
  const seen = new Set([...asked].map(sameQuestion));
  const out: string[] = [];
  const push = (q: string) => {
    const key = sameQuestion(q);
    if (out.length < limit && !seen.has(key)) {
      seen.add(key);
      out.push(q);
    }
  };
  for (const r of a.refs) {
    if (r.kind === "garage") push(`Is ${r.label} full?`);
    else if (r.kind === "lot") push(`Tell me about ${r.label}`);
    else push(`Where's the closest open parking to ${r.label}?`);
  }
  for (const q of fallback) push(q);
  return out;
}
