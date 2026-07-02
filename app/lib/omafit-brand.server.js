/** Paleta e tipografia Omafit (identidade omafit-widget / partners dashboard). */
export const OMAFIT_BRAND = {
  brown: "#16100a",
  brownMid: "#241a10",
  cream: "#f6f0e2",
  orange: "#d96845",
  orangeDark: "#b8522e",
  green: "#5baf8a",
  muted: "#a8947e",
  instagramHandle: "omafit.co",
  youtubeHandle: "omafit-g3d",
  youtubeUrl: "https://www.youtube.com/@omafit-g3d",
  instagramUrl: "https://www.instagram.com/omafit.co/",
};

/**
 * Variantes de slide — verde (#5baf8a) sempre só em detalhes.
 * Alterna fundo marrom / creme e combinações de título.
 */
export const OMAFIT_SLIDE_THEMES = [
  {
    bg: OMAFIT_BRAND.brown,
    title: OMAFIT_BRAND.orange,
    body: OMAFIT_BRAND.cream,
    accent: OMAFIT_BRAND.green,
    label: "Marrom + laranja",
  },
  {
    bg: OMAFIT_BRAND.cream,
    title: OMAFIT_BRAND.brown,
    body: OMAFIT_BRAND.brownMid,
    accent: OMAFIT_BRAND.green,
    label: "Creme + marrom",
  },
  {
    bg: OMAFIT_BRAND.brownMid,
    title: OMAFIT_BRAND.cream,
    body: OMAFIT_BRAND.muted,
    accent: OMAFIT_BRAND.green,
    label: "Marrom escuro + creme",
  },
  {
    bg: OMAFIT_BRAND.brown,
    title: OMAFIT_BRAND.cream,
    body: OMAFIT_BRAND.muted,
    accent: OMAFIT_BRAND.green,
    label: "Marrom + creme",
  },
];

export const INSTAGRAM_CAROUSEL_SIZE = 1080;
