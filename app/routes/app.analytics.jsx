import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { redirect } from "react-router";
import { Buffer } from "node:buffer";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Select,
  Spinner,
  Banner,
  DataTable,
  Box
} from '@shopify/polaris';
import { getShopDomain } from '../utils/getShopDomain';
import { useAppI18n } from '../contexts/AppI18n';
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const check = await ensureShopHasActiveBilling(admin, session.shop);
  if (!check.active) {
    const url = new URL(request.url);
    const hostFromQuery = url.searchParams.get("host") || "";
    const shopHandle = String(session.shop || "").replace(/\.myshopify\.com$/i, "");
    const derivedHost = shopHandle
      ? Buffer.from(`admin.shopify.com/store/${shopHandle}`, "utf8").toString("base64")
      : "";
    const qs = new URLSearchParams();
    if (session.shop) qs.set("shop", session.shop);
    if (hostFromQuery || derivedHost) qs.set("host", hostFromQuery || derivedHost);
    return redirect(`/app/billing?${qs.toString()}`);
  }
  return null;
};

function normalizeGender(g) {
  if (g == null || g === '') return null;
  const s = String(g).toLowerCase();
  if (s === 'male' || s === 'masculino' || s === 'm') return 'male';
  if (s === 'female' || s === 'feminino' || s === 'f') return 'female';
  return g;
}

function getMeasurements(session) {
  let m = null;
  if (session.user_measurements) {
    if (typeof session.user_measurements === 'string') {
      try {
        m = JSON.parse(session.user_measurements);
      } catch (e) {
        m = null;
      }
    } else {
      m = session.user_measurements;
    }
  }
  if (!m && (session.gender || session.recommended_size != null || session.body_type_index !== undefined || session.fit_preference_index !== undefined)) {
    m = {
      gender: session.gender,
      recommended_size: session.recommended_size,
      body_type_index: session.body_type_index,
      fit_preference_index: session.fit_preference_index,
      height: session.height,
      weight: session.weight,
      collection_handle: session.collection_handle
    };
  }
  if (!m) return null;
  
  // Normaliza o gênero de múltiplas fontes
  const gender = normalizeGender(m.gender ?? session.gender);
  if (!gender || (gender !== 'male' && gender !== 'female')) {
    // Se não conseguiu normalizar, tenta outras variações
    const altGender = normalizeGender(session.gender);
    if (!altGender || (altGender !== 'male' && altGender !== 'female')) {
      return null;
    }
    // Usa o gênero alternativo se encontrado
    return {
      gender: altGender,
      recommended_size: m.recommended_size ?? m.recommendedSize ?? session.recommended_size,
      body_type_index: m.body_type_index ?? m.bodyType ?? session.body_type_index,
      fit_preference_index: m.fit_preference_index ?? m.fitPreference ?? session.fit_preference_index,
      height: m.height ?? session.height,
      weight: m.weight ?? session.weight,
      collection_handle: m.collection_handle ?? m.collectionHandle ?? session.collection_handle
    };
  }
  
  return {
    gender,
    recommended_size: m.recommended_size ?? m.recommendedSize ?? session.recommended_size,
    body_type_index: m.body_type_index ?? m.bodyType ?? session.body_type_index,
    fit_preference_index: m.fit_preference_index ?? m.fitPreference ?? session.fit_preference_index,
    height: m.height ?? session.height,
    weight: m.weight ?? session.weight,
    collection_handle: m.collection_handle ?? m.collectionHandle ?? session.collection_handle
  };
}

function getCollectionKey(session) {
  // Tenta obter collection_handle de múltiplas fontes
  const m = getMeasurements(session);
  let handle = m?.collection_handle ?? session.collection_handle ?? '';
  
  // Se não encontrou, tenta em user_measurements se for objeto
  if (!handle && session.user_measurements) {
    try {
      const um = typeof session.user_measurements === 'string' 
        ? JSON.parse(session.user_measurements) 
        : session.user_measurements;
      handle = um?.collection_handle ?? um?.collectionHandle ?? '';
    } catch (e) {
      // Ignora erro de parse
    }
  }
  
  return handle || 'geral';
}

export default function AnalyticsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, locale } = useAppI18n();
  const shopDomain = getShopDomain(searchParams);

  const BODY_TYPE_NAMES = useMemo(() => ({
    0: t('analytics.bodyType0'),
    1: t('analytics.bodyType1'),
    2: t('analytics.bodyType2'),
    3: t('analytics.bodyType3'),
    4: t('analytics.bodyType4')
  }), [t]);

  const FIT_PREFERENCE_NAMES = useMemo(() => ({
    0: t('analytics.fit0'),
    1: t('analytics.fit1'),
    2: t('analytics.fit2')
  }), [t]);

  const GENDER_LABELS = useMemo(() => ({
    male: t('analytics.male'),
    female: t('analytics.female')
  }), [t]);
  const generalCollectionLabel = t();
}
