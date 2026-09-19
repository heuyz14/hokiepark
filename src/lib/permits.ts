/**
 * Permit eligibility, straight from VT Parking Services' 2026-27 Parking Quick Guide and the
 * official campus parking-lot map that ships with it. Every rule below cites the source line,
 * because a wrong "yes" here is a $35-$300 citation (Quick Guide, Citations/Appeals).
 *
 * Two vocabularies:
 *  - `LotClass`  - what a lot/garage section IS, taken from the printed map's legend.
 *  - `PermitId`  - what a driver BOUGHT, taken from the Quick Guide's permit sections.
 */

/** Lot categories, named exactly as the official map legend names them. */
export type LotClass =
  | "any-permit" // "Any University Permit (Does not include Remote)"
  | "fs-remote" // "* FS Remote (Chicken Hill Only)"
  | "ada-service-24" // "ADA/Service 24 hour"
  | "fs-24" // "Faculty/Staff 24-hour"
  | "fsv" // "Faculty/Staff/Visitor"
  | "perry-fs" // "F/S and Perry Street Permit" - the garage's Faculty/Staff sections
  | "perry-cg" // the C/G sections inside Perry Street Garage, which only the Perry permit opens
  | "cg" // "Commuter/Graduate"
  | "graduate" // "Graduate"
  | "student-remote"; // "C/G STUDENT REMOTE" (Smoot & Innovation Drive)

export const LOT_CLASS_LABEL: Record<LotClass, string> = {
  "any-permit": "Any University permit",
  "fs-remote": "F/S Remote (Chicken Hill only)",
  "ada-service-24": "ADA / Service, 24 hour",
  "fs-24": "Faculty/Staff 24-hour",
  fsv: "Faculty/Staff/Visitor",
  "perry-fs": "Faculty/Staff (Perry Street Garage)",
  "perry-cg": "Commuter/Graduate (Perry Street permit)",
  cg: "Commuter/Graduate",
  graduate: "Graduate",
  "student-remote": "Student Remote",
};

export type PermitId = "fs" | "cg" | "cg-perry" | "resident" | "fs-remote" | "student-remote" | "evening" | "visitor";

export interface PermitInfo {
  id: PermitId;
  /** Short name for the chooser. */
  label: string;
  /** One line of plain English about who buys it. */
  detail: string;
}

/** Offered in the order a driver is most likely to hold one. */
export const PERMITS: PermitInfo[] = [
  { id: "cg", label: "Commuter/Graduate", detail: "C/G areas and Resident spaces. Not valid in Perry Street Garage." },
  { id: "cg-perry", label: "C/G + Perry Street", detail: "C/G areas, Resident spaces, and the C/G sections of Perry Street Garage." },
  { id: "fs", label: "Faculty/Staff", detail: "F/S, C/G and Resident spaces, plus designated F/S 24-hour spaces." },
  { id: "resident", label: "Resident", detail: "Designated Resident areas: Stadium, Chicken Hill, Duck Pond Dr (R side)." },
  { id: "visitor", label: "Visitor", detail: "Visitor spaces, including the V in Faculty/Staff/Visitor lots." },
  { id: "evening", label: "Evening only", detail: "After 5 p.m., in regular F/S (not 24-hour) and student spaces." },
  { id: "fs-remote", label: "F/S Remote", detail: "Chicken Hill lot only - not valid in other campus lots." },
  { id: "student-remote", label: "Student Remote", detail: "Smoot & Innovation Drive (CRC) only - not valid in other campus lots." },
];

export const PERMIT_LABEL = Object.fromEntries(PERMITS.map((p) => [p.id, p.label])) as Record<PermitId, string>;

/**
 * `yes` park here, `no` you will be ticketed, `check` the guide does not settle it - the app must
 * say so rather than guess. `note` explains a condition or the doubt; it is always shown with the verdict.
 */
export type Verdict = "yes" | "no" | "check";
export interface Eligibility {
  verdict: Verdict;
  note?: string;
}

const YES: Eligibility = { verdict: "yes" };

/**
 * A refusal always says what the space IS, so the driver can tell whether they're in the wrong
 * place or holding the wrong permit. "No" with no reason is how people talk themselves into a ticket.
 */
const refuse = (lotClass: LotClass): Eligibility => ({
  verdict: "no",
  note: `This one is signed ${LOT_CLASS_LABEL[lotClass]}, which your permit doesn't cover.`,
});

/**
 * Can one permit park in one lot class? The caller adds ADA credentials separately, because the
 * Quick Guide treats "ADA accessible spaces without valid credentials" as a restriction that
 * applies on top of every permit type.
 */
export function canPark(lotClass: LotClass, permit: PermitId): Eligibility {
  switch (lotClass) {
    // "Faculty and staff may park in: F/S, C/G, R." Visitors are the V. Evening-only permits are
    // "Valid in regular F/S (not 24-hour) and student spaces".
    case "fsv":
      if (permit === "fs") return YES;
      if (permit === "visitor") return YES;
      if (permit === "evening") return { verdict: "yes", note: "Evening Only permits are valid here after 5 p.m." };
      return refuse(lotClass);

    // "With a valid Faculty/Staff permit, employees may also park in designated F/S 24-Hour
    // spaces on campus unless otherwise posted." Evening Only is explicitly NOT valid in 24-hour.
    case "fs-24":
      if (permit === "fs") return { verdict: "yes", note: "Signed 24-hour lot: a Faculty/Staff permit is required at all hours." };
      if (permit === "evening") return { verdict: "no", note: "Evening Only permits are not valid in 24-hour spaces." };
      return refuse(lotClass);

    // "Commuter/Graduate permits are valid in: Designated C/G areas; Resident (R) spaces not
    // otherwise restricted." F/S may park in C/G.
    case "cg":
      if (permit === "cg" || permit === "cg-perry" || permit === "fs") return YES;
      if (permit === "evening") return { verdict: "yes", note: "Evening Only permits are valid in student spaces after 5 p.m." };
      return refuse(lotClass);

    // The map lists "Graduate" as its own category, separate from "Commuter/Graduate". The guide
    // never says who may use a graduate-only space, so we refuse to guess.
    case "graduate":
      if (permit === "cg" || permit === "cg-perry")
        return { verdict: "check", note: "Signed Graduate parking. A Commuter/Graduate permit covers graduate spaces only if your permit is a graduate permit - check the posted sign." };
      if (permit === "fs") return { verdict: "check", note: "Faculty/Staff may park in C/G areas, but this lot is signed Graduate specifically - check the posted sign." };
      return refuse(lotClass);

    // Perry Street Garage, Faculty/Staff sections. The map signs the garage "F/S and Perry Street
    // Permit"; the Perry permit buys the C/G sections specifically, not these levels.
    case "perry-fs":
      if (permit === "fs") return YES;
      if (permit === "cg-perry") return { verdict: "no", note: "The Perry Street permit covers the garage's Commuter/Graduate sections, not the Faculty/Staff levels." };
      if (permit === "cg") return { verdict: "no", note: "A Commuter/Graduate permit is not valid in Perry Street Garage unless you bought the Perry Street permit." };
      // The printed map signs this garage F/S + Perry only; it shows no visitor category, but
      // garages usually sell hourly parking, so we send visitors to the entrance rather than guess.
      if (permit === "visitor") return { verdict: "check", note: "VT's map signs this garage for Faculty/Staff and Perry Street permits, and doesn't show visitor spaces - check at the entrance." };
      return refuse(lotClass);

    // The Commuter/Graduate sections inside Perry Street Garage. Only the Perry permit opens these
    // to a commuter; a plain C/G permit is not valid anywhere in this garage.
    case "perry-cg":
      if (permit === "cg-perry") return YES;
      if (permit === "fs") return YES; // Faculty/Staff may park in C/G areas
      if (permit === "cg") return { verdict: "no", note: "A Commuter/Graduate permit is not valid in Perry Street Garage unless you bought the Perry Street permit." };
      if (permit === "visitor") return { verdict: "check", note: "VT's map signs this garage for Faculty/Staff and Perry Street permits, and doesn't show visitor spaces - check at the entrance." };
      return refuse(lotClass);

    // "Any University Permit (Does not include Remote)".
    case "any-permit":
      if (permit === "fs" || permit === "cg" || permit === "cg-perry" || permit === "resident") return YES;
      if (permit === "fs-remote" || permit === "student-remote") return { verdict: "no", note: "Remote permits are excluded from Any University Permit lots." };
      if (permit === "evening") return { verdict: "check", note: "Evening Only permits cover F/S and student spaces after 5 p.m.; check the posted sign here." };
      return refuse(lotClass); // visitor: a visitor holds no university permit

    // "Faculty/Staff Remote: Chicken Hill Lot", and Resident permits are valid in "Chicken Hill Lot".
    case "fs-remote":
      if (permit === "fs-remote" || permit === "resident") return YES;
      if (permit === "fs") return { verdict: "check", note: "This lot is signed F/S Remote. A standard Faculty/Staff permit may not cover it - check the posted sign." };
      return refuse(lotClass);

    // "Student Remote: Smoot & Innovation Drive (CRC)"; remote permits are valid nowhere else.
    case "student-remote":
      if (permit === "student-remote") return YES;
      return refuse(lotClass);

    // "ADA accessible spaces without valid credentials" are never permitted. Credentials are
    // handled by the caller, so no permit on its own gets in.
    case "ada-service-24":
      return { verdict: "no", note: "ADA / Service spaces require valid accessible credentials." };
  }
}

export interface AccessOptions {
  /** State-issued accessible plate or placard. The guide bars ADA spaces "without valid credentials". */
  ada?: boolean;
}

/**
 * Best verdict across everything the driver holds. `yes` beats `check` beats `no`, and the note
 * that comes back belongs to the verdict that won, so the UI never pairs a "yes" with a "no" note.
 */
export function access(classes: LotClass[], permits: PermitId[], opts: AccessOptions = {}): Eligibility {
  const results: Eligibility[] = [];
  for (const c of classes) {
    if (c === "ada-service-24") {
      results.push(
        opts.ada
          ? { verdict: "yes", note: "Accessible credentials required, and they must be displayed." }
          : { verdict: "no", note: "ADA / Service spaces require valid accessible credentials." },
      );
      continue;
    }
    for (const p of permits) results.push(canPark(c, p));
  }
  if (!classes.length) return { verdict: "check", note: "We don't know how this one is signed - read the posted sign before you leave the car." };
  // No results means no permit was chosen (ADA lots answer on credentials alone, so they land above).
  if (!results.length) return { verdict: "check", note: "Choose the permit you hold to see whether you can park here." };
  return results.find((r) => r.verdict === "yes") ?? results.find((r) => r.verdict === "check") ?? results[0]!;
}

/** Plain-English summary of who a lot is for, e.g. "Faculty/Staff/Visitor - Commuter/Graduate". */
export const classSummary = (classes: LotClass[]): string => classes.map((c) => LOT_CLASS_LABEL[c]).join(" · ");

/** Structural shapes, so this pure module never has to import the data types back. */
interface ClassedLot {
  classes: LotClass[];
  needsConfirm?: boolean;
}

/**
 * A lot's verdict. A lot whose category we inferred from map position rather than a printed label
 * can never return a confident "yes" - the worst outcome of this app is a confident wrong answer.
 */
export function lotAccess(lot: ClassedLot, permits: PermitId[], opts: AccessOptions = {}): Eligibility {
  const base = access(lot.classes, permits, opts);
  if (lot.needsConfirm && base.verdict === "yes") {
    return { verdict: "check", note: "This lot's permit type isn't printed on VT's map, so we inferred it from the lots around it - confirm at the sign." };
  }
  return base;
}

/** Best verdict across a garage's levels: a garage is usable if any one level is. */
export function garageAccess(levels: ClassedLot[], permits: PermitId[], opts: AccessOptions = {}): Eligibility {
  const each = levels.map((l) => lotAccess(l, permits, opts));
  return each.find((r) => r.verdict === "yes") ?? each.find((r) => r.verdict === "check") ?? each[0] ?? { verdict: "check" };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  yes: "You can park here",
  no: "Not valid for your permit",
  check: "Check the posted sign",
};

/** Shown wherever a verdict is: VT's own standing instruction, and our liability line. */
export const SIGNAGE_NOTE = "Always check posted signage - restricted spaces (service, reserved, timed, 24-hour) exist inside otherwise open lots.";

/** Quick Guide: "Permits are required 7 a.m. - 10 p.m. unless otherwise posted." */
export const HOURS_NOTE = "Permits are required 7 a.m. - 10 p.m., except in signed 24-hour lots and North End Garage, which require one at all hours.";
