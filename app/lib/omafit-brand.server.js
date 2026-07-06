/** Paleta e tipografia Omafit (identidade omafit-widget / partners dashboard). */
export const OMAFIT_BRAND = {
  brown: "#16100a",
  brownMid: "#241a10",
  cream: "#f6f0e2",
  orange: "#d96845",
  orangeDark: "#b8522e",
  orangeLight: "#e88a6d",
  green: "#5baf8a",
  muted: "#a8947e",
  instagramHandle: "omafit.co",
  youtubeHandle: "omafit-g3d",
  youtubeUrl: "https://www.youtube.com/@omafit-g3d",
  instagramUrl: "https://www.instagram.com/omafit.co/",
};

/** Fundos apenas marrom/creme — laranja só em detalhes e destaques de texto. */
export const OMAFIT_SLIDE_THEMES = [
  {
    bg: OMAFIT_BRAND.brown,
    title: OMAFIT_BRAND.cream,
    body: OMAFIT_BRAND.muted,
    accent: OMAFIT_BRAND.orange,
    accentSoft: OMAFIT_BRAND.orangeDark,
    label: "Marrom + creme",
  },
  {
    bg: OMAFIT_BRAND.cream,
    title: OMAFIT_BRAND.brown,
    body: OMAFIT_BRAND.brownMid,
    accent: OMAFIT_BRAND.orange,
    accentSoft: OMAFIT_BRAND.orangeDark,
    label: "Creme + marrom",
  },
  {
    bg: OMAFIT_BRAND.brownMid,
    title: OMAFIT_BRAND.cream,
    body: OMAFIT_BRAND.muted,
    accent: OMAFIT_BRAND.orange,
    accentSoft: OMAFIT_BRAND.orangeLight,
    label: "Marrom escuro",
  },
  {
    bg: OMAFIT_BRAND.cream,
    title: OMAFIT_BRAND.brownMid,
    body: OMAFIT_BRAND.brown,
    accent: OMAFIT_BRAND.orangeDark,
    accentSoft: OMAFIT_BRAND.orange,
    label: "Creme editorial",
  },
  {
    bg: OMAFIT_BRAND.brown,
    title: OMAFIT_BRAND.cream,
    body: OMAFIT_BRAND.cream,
    accent: OMAFIT_BRAND.orange,
    accentSoft: OMAFIT_BRAND.orangeLight,
    label: "Marrom profundo",
  },
  {
    bg: OMAFIT_BRAND.brownMid,
    title: OMAFIT_BRAND.cream,
    body: OMAFIT_BRAND.muted,
    accent: OMAFIT_BRAND.orangeLight,
    accentSoft: OMAFIT_BRAND.orange,
    label: "Marrom + destaque",
  },
  {
    bg: OMAFIT_BRAND.cream,
    title: OMAFIT_BRAND.brown,
    body: OMAFIT_BRAND.muted,
    accent: OMAFIT_BRAND.orange,
    accentSoft: OMAFIT_BRAND.brownMid,
    label: "Creme suave",
  },
];

export const INSTAGRAM_CAROUSEL_SIZE = 1080;
