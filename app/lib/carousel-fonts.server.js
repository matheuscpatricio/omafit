/** Fontes Omafit embutidas em SVG (base64) para renderização com sharp/librsvg. */

const FONT_CSS_URLS = {
  gloock:
    "https://fonts.googleapis.com/css2?family=Gloock&display=swap",
  bricolage:
    "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500&display=swap",
  dmMono:
    "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap",
  rasbora:
    "https://fonts.cdnfonts.com/css/jhc-rasbora",
};

export const FONT_FAMILY = {
  brand: "OmafitRasbora",
  title: "OmafitGloock",
  body: "OmafitBricolage",
  mono: "OmafitDMMono",
};

const cache = {
  defs: null,
  loading: null,
};

function extractWoff2Urls(cssText) {
  const urls = [];
  const re = /url\((https:\/\/[^)]+\.woff2)\)/g;
  let match = re.exec(cssText);
  while (match) {
    urls.push(match[1]);
    match = re.exec(cssText);
  }
  return [...new Set(urls)];
}

async function fetchCss(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; OmafitCarousel/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`font_css_failed:${url}`);
  return response.text();
}

async function fetchFontBase64(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`font_download_failed:${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}

async function loadFontFamily(cssUrl, familyName, weight = 400, style = "normal") {
  const css = await fetchCss(cssUrl);
  const woffUrls = extractWoff2Urls(css);
  if (!woffUrls.length) throw new Error(`no_woff2_in_css:${cssUrl}`);

  const faces = [];
  for (let i = 0; i < woffUrls.length; i += 1) {
    const base64 = await fetchFontBase64(woffUrls[i]);
    const suffix = woffUrls.length > 1 ? `-${i}` : "";
    faces.push(`@font-face {
  font-family: '${familyName}';
  font-style: ${style};
  font-weight: ${weight};
  src: url(data:font/woff2;base64,${base64}) format('woff2');
  font-display: block;
}`);
  }
  return faces.join("\n");
}

async function buildFontDefs() {
  try {
    const [rasbora, gloock, bricolage, mono] = await Promise.all([
      loadFontFamily(FONT_CSS_URLS.rasbora, FONT_FAMILY.brand, 800),
      loadFontFamily(FONT_CSS_URLS.gloock, FONT_FAMILY.title, 400),
      loadFontFamily(FONT_CSS_URLS.bricolage, FONT_FAMILY.body, 400),
      loadFontFamily(FONT_CSS_URLS.dmMono, FONT_FAMILY.mono, 400),
    ]);
    return `<defs><style>${rasbora}\n${gloock}\n${bricolage}\n${mono}</style></defs>`;
  } catch (err) {
    console.warn("[carousel-fonts] fallback to system fonts:", err?.message);
    return "";
  }
}

export async function getCarouselFontFaceDefs() {
  if (cache.defs) return cache.defs;
  if (!cache.loading) {
    cache.loading = buildFontDefs().then((defs) => {
      cache.defs = defs;
      return defs;
    });
  }
  return cache.loading;
}

export function getActiveFontFamily() {
  if (cache.defs) return FONT_FAMILY;
  return {
    brand: "DejaVu Sans, Liberation Sans, Arial, sans-serif",
    title: "DejaVu Serif, Liberation Serif, Georgia, serif",
    body: "DejaVu Sans, Liberation Sans, Arial, sans-serif",
    mono: "DejaVu Sans Mono, Liberation Mono, monospace",
  };
}
