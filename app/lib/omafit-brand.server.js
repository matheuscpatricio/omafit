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

/**
 * Uma paleta por posição de slide — laranja como destaque principal.
 * Verde reservado só para um slide de contraste sutil.
 */
export const OMAFIT_SLIDE_THEMES = [
  {
    bg: OMAFIT_BRAND.brown,
    title: OMAFIT_BRAND.cream,
    body: OMAFIT_BRAND.muted,
    accent: OMAFIT_BRAND.orange,
    accentSoft: OMAFIT_BRAND.orangeDark,
    label: "Marrom + laranja",
  },
  {
    bg: OMAFIT_BRAND.cream,
    title: OMAFIT_BRAND.brown,
    body: OMAFIT_BRAND.brownMid,
    accent: OMAFIT_BRAND.orange,
    accentSoft: OMAFIT_BRAND.orangeLight,
    label: "Creme + laranja",
  },
  {
    bg: OMAFIT_BRAND.orange,
    title: OMAFIT_BRAND.cream,
    body: OMAFIT_BRAND.brown,
    accent: OMAFIT_BRAND.brown,
    accentSoft: OMAFIT_BRAND.orangeDark,
    label: "Laranja invertido",
  },
  {
    bg: OMAFIT_BRAND.brownMid,
    title: OMAFIT_BRAND.orange,
    body: OMAFIT_BRAND.cream,
    accent: OMAFIT_BRAND.orangeLight,
    accentSoft: OMAFIT_BRAND.orange,
    label: "Marrom escuro + laranja",
  },
  {
    bg: OMAFIT_BRAND.cream,
    title: OMAFIT_BRAND.orangeDark,
    body: OMAFIT_BRAND.brown,
    accent: OMAFIT_BRAND.orange,
    accentSoft: OMAFIT_BRAND.brownMid,
    label: "Creme + título laranja",
  },
  {
    bg: OMAFIT_BRAND.brown,
    title: OMAFIT_BRAND.orange,
    body: OMAFIT_BRAND.cream,
    accent: OMAFIT_BRAND.orangeLight,
    accentSoft: OMAFIT_BRAND.orange,
    label: "Marrom + título laranja",
  },
  {
    bg: OMAFIT_BRAND.orangeDark,
    title: OMAFIT_BRAND.cream,
    body: OMAFIT_BRAND.cream,
    accent: OMAFIT_BRAND.brown,
    accentSoft: OMAFIT_BRAND.orange,
    label: "Laranja escuro",
  },
];

export const INSTAGRAM_CAROUSEL_SIZE = 1080;
