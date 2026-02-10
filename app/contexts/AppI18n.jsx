import { createContext, useContext, useMemo } from "react";
import en from "../translations/en.json";
import ptBR from "../translations/pt-BR.json";
import es from "../translations/es.json";

const translations = { en, "pt-BR": ptBR, es };

const AppI18nContext = createContext({ locale: "en", t: (key) => key });

function getNested(obj, path) {
  const keys = path.split(".");
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function interpolate(str, vars) {
  if (!vars || typeof str !== "string") return str;
  return str.replace(/\{(\w+)\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : `{${key}}`));
}

export function AppI18nProvider({ locale, children }) {
  const value = useMemo(() => {
    const lang = locale && locale.toLowerCase().startsWith("pt") ? "pt-BR" : locale && locale.toLowerCase().startsWith("es") ? "es" : "en";
    const dict = translations[lang] || translations.en;

    const t = (key, vars) => {
      const value = getNested(dict, key);
      const str = value != null ? value : getNested(translations.en, key) || key;
      return interpolate(str, vars);
    };

    return { locale: lang, t };
  }, [locale]);

  return (
    <AppI18nContext.Provider value={value}>
      {children}
    </AppI18nContext.Provider>
  );
}

export function useAppI18n() {
  const ctx = useContext(AppI18nContext);
  if (!ctx.t) {
    const dict = translations.en;
    return {
      locale: "en",
      t: (key, vars) => {
        const value = getNested(dict, key);
        const str = value != null ? value : key;
        return interpolate(str, vars);
      },
    };
  }
  return ctx;
}
