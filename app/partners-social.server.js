import { OMAFIT_BRAND } from "./lib/omafit-brand.server.js";
import {
  getInstagramEnvCredentials,
  isTokenExpiredError,
  fetchInstagramProfile,
} from "./meta-instagram.server.js";

const YOUTUBE_HANDLE = OMAFIT_BRAND.youtubeHandle;

export function isYoutubeApiConfigured() {
  return Boolean((process.env.YOUTUBE_API_KEY || "").trim());
}

export function isInstagramApiConfigured() {
  return Boolean(
    (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim() &&
      (process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "").trim(),
  );
}

function formatCount(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(value);
}

async function fetchYoutubeChannelStats() {
  const apiKey = (process.env.YOUTUBE_API_KEY || "").trim();
  if (!apiKey) {
    return {
      configured: false,
      handle: YOUTUBE_HANDLE,
      url: OMAFIT_BRAND.youtubeUrl,
      subscribers: null,
      views: null,
      videoCount: null,
      title: null,
      thumbnailUrl: null,
      error: null,
    };
  }

  try {
    const params = new URLSearchParams({
      part: "snippet,statistics",
      forHandle: YOUTUBE_HANDLE,
      key: apiKey,
    });
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?${params}`,
      { signal: AbortSignal.timeout(12000) },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = data?.error?.message || `HTTP ${response.status}`;
      return {
        configured: true,
        handle: YOUTUBE_HANDLE,
        url: OMAFIT_BRAND.youtubeUrl,
        subscribers: null,
        views: null,
        videoCount: null,
        title: null,
        thumbnailUrl: null,
        error: msg,
      };
    }
    const channel = data?.items?.[0];
    const stats = channel?.statistics || {};
    const snippet = channel?.snippet || {};
    return {
      configured: true,
      handle: YOUTUBE_HANDLE,
      url: OMAFIT_BRAND.youtubeUrl,
      subscribers: formatCount(stats.subscriberCount),
      views: formatCount(stats.viewCount),
      videoCount: formatCount(stats.videoCount),
      title: snippet.title || null,
      thumbnailUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || null,
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      handle: YOUTUBE_HANDLE,
      url: OMAFIT_BRAND.youtubeUrl,
      subscribers: null,
      views: null,
      videoCount: null,
      title: null,
      thumbnailUrl: null,
      error: err?.message || "youtube_fetch_failed",
    };
  }
}

async function fetchInstagramInsights() {
  const { accessToken: token, accountId } = getInstagramEnvCredentials();

  if (!token || !accountId) {
    return {
      configured: false,
      handle: OMAFIT_BRAND.instagramHandle,
      url: OMAFIT_BRAND.instagramUrl,
      followers: null,
      mediaCount: null,
      profilePictureUrl: null,
      tokenExpired: false,
      error: null,
    };
  }

  try {
    const data = await fetchInstagramProfile(token, accountId);
    return {
      configured: true,
      handle: data.username || OMAFIT_BRAND.instagramHandle,
      url: OMAFIT_BRAND.instagramUrl,
      followers: formatCount(data.followers_count),
      mediaCount: formatCount(data.media_count),
      profilePictureUrl: data.profile_picture_url || null,
      tokenExpired: false,
      error: null,
    };
  } catch (err) {
    const message = err?.message || "instagram_fetch_failed";
    return {
      configured: true,
      handle: OMAFIT_BRAND.instagramHandle,
      url: OMAFIT_BRAND.instagramUrl,
      followers: null,
      mediaCount: null,
      profilePictureUrl: null,
      tokenExpired: isTokenExpiredError(message),
      error: message,
    };
  }
}

/**
 * Métricas das redes sociais Omafit para a aba Partners.
 */
export async function fetchPartnersSocialStats() {
  const [youtube, instagram] = await Promise.all([
    fetchYoutubeChannelStats(),
    fetchInstagramInsights(),
  ]);

  return {
    youtube,
    instagram,
    links: {
      instagram: OMAFIT_BRAND.instagramUrl,
      youtube: OMAFIT_BRAND.youtubeUrl,
    },
  };
}
