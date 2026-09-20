export interface AccessibilityPreferences {
  autoRead: boolean;
  speechRate: 0.75 | 1 | 1.25 | 1.5;
  /** Empty/undefined means the browser's system default voice. */
  voiceURI?: string;
  largeText: boolean;
  reduceMotion: boolean;
}

export const ACCESSIBILITY_DEFAULTS: AccessibilityPreferences = { autoRead: false, speechRate: 1, largeText: false, reduceMotion: false };
const KEY = "hokiepark-accessibility-v1";
const rates = new Set<AccessibilityPreferences["speechRate"]>([0.75, 1, 1.25, 1.5]);

export function loadAccessibilityPreferences(storage: Storage | undefined = typeof localStorage === "undefined" ? undefined : localStorage): AccessibilityPreferences {
  if (!storage) return { ...ACCESSIBILITY_DEFAULTS };
  try {
    const raw: unknown = JSON.parse(storage.getItem(KEY) ?? "{}");
    const value = raw && typeof raw === "object" ? raw as Partial<AccessibilityPreferences> : {};
    return { autoRead: value.autoRead === true, speechRate: rates.has(value.speechRate as AccessibilityPreferences["speechRate"]) ? value.speechRate as AccessibilityPreferences["speechRate"] : 1, ...(typeof value.voiceURI === "string" && value.voiceURI.length <= 200 ? { voiceURI: value.voiceURI } : {}), largeText: value.largeText === true, reduceMotion: value.reduceMotion === true };
  } catch { return { ...ACCESSIBILITY_DEFAULTS }; }
}

export function saveAccessibilityPreferences(value: AccessibilityPreferences, storage: Storage | undefined = typeof localStorage === "undefined" ? undefined : localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify(value)); } catch { /* private browsing can deny storage */ }
}

export function applyAccessibilityPreferences(value: AccessibilityPreferences, root: HTMLElement | undefined = typeof document === "undefined" ? undefined : document.documentElement): void {
  root?.classList.toggle("a11y-large-text", value.largeText);
  root?.classList.toggle("a11y-reduce-motion", value.reduceMotion);
}
