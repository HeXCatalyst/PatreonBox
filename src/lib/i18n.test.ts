import { describe, it, expect } from "vitest";
import { translations, type Language } from "./i18n";

// CLAUDE.md requires every user-facing string to exist in both locales. The
// Translations interface catches a *missing* key, but not a key that was added
// to one locale and left as a copy-pasted placeholder in the other, and not a
// formatter whose argument count drifted between the two.

type Shape = Map<string, "string" | `fn:${number}`>;

function shapeOf(obj: unknown, prefix = "", out: Shape = new Map()): Shape {
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "function") {
      out.set(path, `fn:${value.length}`);
    } else if (typeof value === "object" && value !== null) {
      shapeOf(value, path, out);
    } else {
      out.set(path, "string");
    }
  }
  return out;
}

const LOCALES = Object.keys(translations) as Language[];

describe("translations", () => {
  it("ships the locales the app advertises", () => {
    expect(LOCALES.sort()).toEqual(["en", "zh"]);
  });

  it("has the same key set in every locale", () => {
    const [first, ...rest] = LOCALES;
    const base = [...shapeOf(translations[first]).keys()].sort();
    for (const lang of rest) {
      expect([...shapeOf(translations[lang]).keys()].sort(), `locale ${lang}`).toEqual(base);
    }
  });

  it("keeps formatters as formatters, with the same arity", () => {
    const [first, ...rest] = LOCALES;
    const base = shapeOf(translations[first]);
    for (const lang of rest) {
      const other = shapeOf(translations[lang]);
      for (const [path, kind] of base) {
        expect(other.get(path), `${lang} → ${path}`).toBe(kind);
      }
    }
  });

  it("has no empty strings", () => {
    for (const lang of LOCALES) {
      for (const [path, kind] of shapeOf(translations[lang])) {
        if (kind !== "string") continue;
        const value = path
          .split(".")
          .reduce<any>((acc, k) => acc[k], translations[lang]);
        expect(String(value).trim(), `${lang} → ${path}`).not.toBe("");
      }
    }
  });

  // Not a hard rule — some keys are proper nouns or deliberately identical
  // ("English", "PatreonBOX") — but a *block* of identical values means a
  // section was pasted across without being translated.
  it("has no wholly untranslated section", () => {
    const zh = shapeOf(translations.zh);
    const identicalBySection = new Map<string, { same: number; total: number }>();

    for (const [path, kind] of zh) {
      if (kind !== "string") continue;
      const section = path.split(".")[0];
      const read = (lang: Language) =>
        path.split(".").reduce<any>((acc, k) => acc[k], translations[lang]);
      const bucket = identicalBySection.get(section) ?? { same: 0, total: 0 };
      bucket.total += 1;
      if (read("zh") === read("en")) bucket.same += 1;
      identicalBySection.set(section, bucket);
    }

    for (const [section, { same, total }] of identicalBySection) {
      if (total < 4) continue;
      expect(same, `section "${section}" looks untranslated`).toBeLessThan(total);
    }
  });
});
