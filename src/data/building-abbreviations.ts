import timetableCodes from "../../data/timetable-building-codes.json" with { type: "json" };

/**
 * Official Virginia Tech Banner building abbreviations keyed by the GIS building number used by the map.
 * The timetable mapping supplies class destinations; EXTRA_CODES adds other mapped campus buildings from
 * https://selfservice.banner.vt.edu/ssb/hzskvtsc.P_DispBldgList. Facilities absent from this map are omitted.
 */
const EXTRA_CODES: Record<string, string[]> = {
  "0033": ["AJ E"],
  "0032": ["AJ W"],
  "0037": ["CAM E"],
  "0036": ["CAM M"],
  "0187": ["COL"],
  "0038": ["CHRNE"],
  "0175": ["LARTS"],
  "0189": ["DTRIK"],
  "0023": ["EGG E"],
  "0021": ["EGG M"],
  "0022": ["EGG W"],
  "0251": ["DB", "DBHCC"],
  "0158": ["HAHN N"],
  "0157": ["HAHN S"],
  "0042": ["HARP"],
  "0030": ["HOGE"],
  "0116": ["ICTS2"],
  "0301": ["ISCE"],
  "0028": ["JOHN"],
  "0187A": ["MRYMN"],
  "0027": ["MILES"],
  "0203": ["MIL"],
  "0055": ["NHW"],
  "0040": ["NRH E"],
  "0024": ["NEW"],
  "0195": ["OWENS"],
  "0041": ["PY"],
  "0202": ["POWER"],
  "0031": ["PRT E", "PRT W"],
  "0035": ["SL TW", "SLUSH"],
  "0194": ["SM CC"],
  "0192": ["SSB"],
  "0185": ["STAD"],
  "0178": ["BOOK"],
  "0014": ["UQHN"],
  "0025": ["VAW"],
  "0181": ["CHAP"],
  "0201": ["SEC"],
  "0026": ["WHRST"],
  "0276": ["WRGHT"],
};

const byNumber = new Map<string, string[]>();
const add = (num: string, code: string) => {
  const codes = byNumber.get(num) ?? [];
  if (!codes.includes(code)) codes.push(code);
  byNumber.set(num, codes);
};

for (const [code, value] of Object.entries(timetableCodes as Record<string, { num: string }>)) add(value.num, code);
for (const [num, codes] of Object.entries(EXTRA_CODES)) for (const code of codes) add(num, code);

export const buildingCodes = (buildingNumber: string): readonly string[] => byNumber.get(buildingNumber) ?? [];

