import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { redirect } from "react-router";
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
    return redirect(`/app/billing?shop=${encodeURIComponent(session.shop)}`);
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
  const { t } = useAppI18n();
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

  const MANNEQUIN_IMAGES = useMemo(() => ({
    male: {
      0: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/Manequim%20Levemente%20Magro.jpg',
      1: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimmasatletico.jpg',
      2: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimmasgordinho.jpg',
      3: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimmasforte.jpg',
      4: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimmasgordo.jpg'
    },
    female: {
      0: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimfemmagra.jpg',
      1: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimfemombrolargo.jpg',
      2: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimfemquadrillargo.jpg',
      3: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimfemcinturalarga.jpg',
      4: 'https://lhkgnirolvbmomeduoaj.supabase.co/storage/v1/object/public/Manequins/manequimfembustolargo.jpg'
    }
  }), []);

  const getMannequinImageUrl = (bodyTypeIndex, gender) => {
    const normalizedGender = normalizeGender(gender);
    const index = Number(bodyTypeIndex);
    if (
      bodyTypeIndex == null ||
      Number.isNaN(index) ||
      (normalizedGender !== 'male' && normalizedGender !== 'female')
    ) {
      return null;
    }
    return MANNEQUIN_IMAGES[normalizedGender]?.[index] ?? null;
  };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('30');
  const [metrics, setMetrics] = useState(null);

  const toFriendlyAnalyticsError = (rawMessage) => {
    const message = String(rawMessage || '').trim();
    if (!message) return t('analytics.errorLoad');

    const lower = message.toLowerCase();
    const isRlsError =
      message.includes('"code":"42501"') ||
      lower.includes('row-level security policy') ||
      lower.includes('row level security policy');

    if (
      isRlsError &&
      (lower.includes('session_analytics') ||
        lower.includes('tryon_sessions') ||
        lower.includes('user_measurements') ||
        lower.includes('shopify_shops'))
    ) {
      return 'Permissão negada no Supabase (RLS) para tabelas de analytics. Execute o SQL: supabase_fix_analytics_rls.sql';
    }

    return message;
  };

  useEffect(() => {
    if (shopDomain) {
      loadAnalytics();
    } else {
      setError(t('analytics.errorShopDomain'));
      setLoading(false);
    }
  }, [timeRange, shopDomain, t]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);
      if (!shopDomain) {
        throw new Error('Shop domain não encontrado.');
      }

      const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase não configurado.');
      }

      // Para lojas novas, força um sync rápido para garantir bootstrap de shopify_shops.
      try {
        await fetch('/api/billing/sync', { credentials: 'include', cache: 'no-store' });
      } catch (_syncErr) {
        // non-blocking
      }

      // Preferir endpoint interno (mais resiliente a schema legado e RLS).
      let userId = null;
      let imagesUsedMonth = 0;

      try {
        const internalShopRes = await fetch(
          `/api/shopify-shop?shop=${encodeURIComponent(shopDomain)}`,
          { credentials: 'include', cache: 'no-store' }
        );
        if (internalShopRes.ok) {
          const internalShopData = await internalShopRes.json().catch(() => ({}));
          const row = internalShopData?.shop || null;
          userId = row?.user_id ?? null;
          imagesUsedMonth = row?.images_used_month ?? 0;
        }
      } catch (_internalErr) {
        // fallback abaixo
      }

      // Fallback para leitura direta no Supabase se endpoint interno não retornou linha.
      if (userId == null && imagesUsedMonth === 0) {
        try {
          const shopRes = await fetch(
            `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=user_id,images_used_month`,
            {
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              }
            }
          );
          if (shopRes.ok) {
            const shopData = await shopRes.json();
            userId = shopData?.[0]?.user_id ?? null;
            imagesUsedMonth = shopData?.[0]?.images_used_month ?? 0;
          } else {
            console.warn('[Analytics] shopify_shops read failed:', shopRes.status);
          }
        } catch (shopErr) {
          console.warn('[Analytics] erro ao buscar shopify_shops direto:', shopErr);
        }
      }

      let ordersData = {};
      try {
        const ordersRes = await fetch(`/api/analytics-orders?period=${timeRange}`, { credentials: 'include' });
        ordersData = ordersRes.ok ? await ordersRes.json().catch(() => ({})) : {};
      } catch (e) {
        console.warn('[Analytics] Erro ao buscar pedidos/devoluções:', e);
      }

      if (!userId) {
        setMetrics({
          totalImagesProcessed: imagesUsedMonth,
          avgByGender: { male: { height: null, weight: null }, female: { height: null, weight: null } },
          byCollectionGender: [],
          ordersBefore: ordersData.ordersBefore ?? null,
          ordersAfter: ordersData.ordersAfter ?? null,
          returnsBefore: ordersData.returnsBefore ?? null,
          returnsAfter: ordersData.returnsAfter ?? null,
          conversionBefore: ordersData.conversionBefore ?? null,
          conversionAfter: ordersData.conversionAfter ?? null,
          ordersError: ordersData.error ?? null
        });
        setLoading(false);
        return;
      }

      const dateFilter = new Date();
      dateFilter.setDate(dateFilter.getDate() - parseInt(timeRange, 10));

      // Prioridade 1: API no servidor (usa service role, ignora RLS)
      let sessionsData = [];
      const apiParams = new URLSearchParams({
        shop_domain: shopDomain,
        ...(userId ? { user_id: userId } : {}),
        ...(dateFilter ? { since: dateFilter.toISOString() } : {})
      });
      console.log('[Analytics] Starting data fetch:', {
        userId,
        shopDomain,
        timeRange,
        dateFilter: dateFilter.toISOString()
      });

      try {
        const apiRes = await fetch(`/api/analytics/sessions?${apiParams.toString()}`, { credentials: 'include' });
        if (apiRes.ok) {
          const json = await apiRes.json();
          const list = Array.isArray(json.sessions) ? json.sessions : [];
          if (list.length > 0) {
            sessionsData = list;
            console.log(`[Analytics] ✅ Loaded ${sessionsData.length} sessions via server API (session_analytics)`);
          } else {
            console.log('[Analytics] Server API OK but 0 sessions returned (shop_domain/user_id may have no data yet)');
          }
        } else {
          const body = await apiRes.text().catch(() => '');
          console.log('[Analytics] Server API returned', apiRes.status, body);
          if (apiRes.status === 500 && body.includes('Supabase not configured')) {
            console.warn('[Analytics] Configure SUPABASE_SERVICE_ROLE_KEY on the server to load session_analytics (avoids RLS).');
          }
        }
      } catch (e) {
        console.warn('[Analytics] Server API error:', e);
      }

      // Fallback: buscar direto no Supabase (pode retornar 0 por RLS em session_analytics)
      if (sessionsData.length === 0) {
        // session_analytics: user_id + created_at
        try {
          let sessionsRes = await fetch(
            `${supabaseUrl}/rest/v1/session_analytics?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=*&order=created_at.desc&limit=500`,
            {
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              }
            }
          );
          if (sessionsRes.ok) {
            const fetchedData = await sessionsRes.json();
            const byShop = fetchedData.filter((r) => r.shop_domain === shopDomain || !r.shop_domain);
            if (byShop.length > 0) {
              sessionsData = byShop;
              console.log(`[Analytics] Found ${sessionsData.length} sessions in session_analytics (fallback shop_domain)`);
            } else if (fetchedData.length > 0) {
              sessionsData = fetchedData;
              console.log(`[Analytics] Using all ${fetchedData.length} from session_analytics (fallback)`);
            }
          }
        } catch (err) {
          console.warn(`[Analytics] Error querying session_analytics:`, err);
        }
        // tryon_sessions: sem user_id/shop_domain na URL para evitar 400 se colunas não existirem
        if (sessionsData.length === 0) {
          try {
            let sessionsRes = await fetch(
              `${supabaseUrl}/rest/v1/tryon_sessions?select=*&order=session_start_time.desc&limit=500`,
              {
                headers: {
                  apikey: supabaseKey,
                  Authorization: `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            if (sessionsRes.ok) {
              const fetchedData = await sessionsRes.json();
              const byShop = fetchedData.filter((r) => r.shop_domain === shopDomain || r.user_id === userId || (!r.shop_domain && !r.user_id));
              if (byShop.length > 0) {
                sessionsData = byShop;
                console.log(`[Analytics] Found ${sessionsData.length} sessions in tryon_sessions (fallback)`);
              } else if (fetchedData.length > 0) {
                sessionsData = fetchedData;
                console.log(`[Analytics] Using all ${fetchedData.length} from tryon_sessions (no shop filter)`);
              }
            }
          } catch (err) {
            console.warn(`[Analytics] Error querying tryon_sessions:`, err);
          }
        }
      }

      // Último fallback: buscar session_analytics sem filtros (pode retornar 0 por RLS)
      if (sessionsData.length === 0) {
        console.log('[Analytics] No sessions from API or filtered Supabase, trying unfiltered session_analytics...');
        try {
          const sessionsRes = await fetch(
            `${supabaseUrl}/rest/v1/session_analytics?select=*&order=created_at.desc&limit=100`,
            {
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              }
            }
          );
          if (sessionsRes.ok) {
            const allData = await sessionsRes.json();
            console.log(`[Analytics] Table session_analytics exists with ${allData.length} total records`);
            if (allData.length > 0) {
              const sampleRecord = allData[0];
              console.log(`[Analytics] Sample data from session_analytics:`, {
                firstRecord: sampleRecord,
                columns: Object.keys(sampleRecord || {}),
                hasUserId: allData.some(r => r.user_id),
                hasShopDomain: allData.some(r => r.shop_domain),
                userIds: [...new Set(allData.map(r => r.user_id).filter(Boolean))],
                shopDomains: [...new Set(allData.map(r => r.shop_domain).filter(Boolean))],
                sampleUserId: sampleRecord?.user_id,
                sampleShopDomain: sampleRecord?.shop_domain,
                sampleGender: sampleRecord?.gender,
                sampleCollectionHandle: sampleRecord?.collection_handle
              });
              const matchingData = allData.filter(session => {
                const matchesUserId = userId && session.user_id &&
                  (String(session.user_id).toLowerCase() === String(userId).toLowerCase());
                const matchesShopDomain = session.shop_domain &&
                  session.shop_domain.toLowerCase() === shopDomain.toLowerCase();
                return matchesUserId || matchesShopDomain;
              });
              console.log(`[Analytics] Matching check:`, {
                totalRecords: allData.length,
                matchingCount: matchingData.length,
                searchUserId: userId,
                searchShopDomain: shopDomain,
                foundUserIds: [...new Set(allData.map(r => String(r.user_id)).filter(Boolean))],
                foundShopDomains: [...new Set(allData.map(r => r.shop_domain).filter(Boolean))],
                sampleSession: allData[0] ? {
                  user_id: allData[0].user_id,
                  shop_domain: allData[0].shop_domain,
                  gender: allData[0].gender,
                  collection_handle: allData[0].collection_handle
                } : null
              });
              if (matchingData.length > 0) {
                sessionsData = matchingData;
                console.log(`[Analytics] ✅ Found ${sessionsData.length} matching sessions in session_analytics (without date filter)`);
              } else if (allData.length > 0) {
                sessionsData = allData;
                console.log(`[Analytics] ⚠️ No exact match found, but using all ${allData.length} records for analysis`);
              } else {
                console.log(`[Analytics] ⚠️ No exact match found and no data available.`);
              }
            } else {
              console.log(`[Analytics] Table session_analytics exists but is empty`);
            }
          } else {
            const errorText = await sessionsRes.text().catch(() => '');
            console.log(`[Analytics] Cannot access session_analytics:`, sessionsRes.status, sessionsRes.statusText, errorText);
          }
        } catch (err) {
          console.warn('[Analytics] Error accessing session_analytics:', err);
        }
      }

      // Se ainda não encontrou e há dados em tryon_sessions, tenta buscar user_measurements e combinar
      if (sessionsData.length === 0) {
        console.log('[Analytics] Trying to fetch from tryon_sessions + user_measurements...');
        try {
          // Busca tryon_sessions com user_id ou relacionado
          const tryonRes = await fetch(
            `${supabaseUrl}/rest/v1/tryon_sessions?user_id=eq.${encodeURIComponent(userId)}&select=*&order=session_start_time.desc&limit=50`,
            {
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (tryonRes.ok) {
            const tryonSessions = await tryonRes.json();
            console.log(`[Analytics] Found ${tryonSessions.length} tryon_sessions`);
            
            if (tryonSessions.length > 0) {
              // Busca user_measurements para cada sessão
              const sessionIds = tryonSessions.map(s => s.id).filter(Boolean);
              if (sessionIds.length > 0) {
                const measurementsRes = await fetch(
                  `${supabaseUrl}/rest/v1/user_measurements?tryon_session_id=in.(${sessionIds.join(',')})&select=*`,
                  {
                    headers: {
                      apikey: supabaseKey,
                      Authorization: `Bearer ${supabaseKey}`,
                      'Content-Type': 'application/json'
                    }
                  }
                );
                
                if (measurementsRes.ok) {
                  const measurements = await measurementsRes.json();
                  console.log(`[Analytics] Found ${measurements.length} user_measurements`);
                  
                  // Combina tryon_sessions com user_measurements
                  sessionsData = tryonSessions.map(session => {
                    const measurement = measurements.find(m => m.tryon_session_id === session.id);
                    return {
                      ...session,
                      gender: measurement?.gender || null,
                      height: measurement?.height || null,
                      weight: measurement?.weight || null,
                      recommended_size: measurement?.recommended_size || null,
                      body_type_index: measurement?.body_type_index ?? null,
                      fit_preference_index: measurement?.fit_preference_index ?? null,
                      collection_handle: measurement?.collection_handle || null,
                      user_measurements: measurement ? JSON.stringify(measurement) : null,
                      created_at: session.session_start_time || session.created_at
                    };
                  });
                  
                  console.log(`[Analytics] ✅ Combined ${sessionsData.length} sessions from tryon_sessions + user_measurements`);
                }
              }
            }
          }
        } catch (err) {
          console.warn('[Analytics] Error combining tryon_sessions + user_measurements:', err);
        }
      }
      
      console.log(`[Analytics] Final sessionsData count: ${sessionsData.length}`);
      if (sessionsData.length > 0) {
        console.log(`[Analytics] Sample session data:`, {
          first: sessionsData[0],
          hasGender: sessionsData.some(s => s.gender),
          hasCollectionHandle: sessionsData.some(s => s.collection_handle),
          genders: [...new Set(sessionsData.map(s => s.gender).filter(Boolean))],
          collectionHandles: [...new Set(sessionsData.map(s => s.collection_handle).filter(Boolean))]
        });
      } else {
        console.log(`[Analytics] ❌ No sessions found. Possible reasons:`);
        console.log(`[Analytics]   1. Edge function not updated yet (check CORRECAO_EDGE_FUNCTION.md)`);
        console.log(`[Analytics]   2. No try-ons generated yet`);
        console.log(`[Analytics]   3. Data saved with different user_id or shop_domain`);
        console.log(`[Analytics]   4. Execute supabase_check_session_data.sql to verify`);
      }

      const totalImagesProcessed = imagesUsedMonth ?? 0;

      // Altura e peso médios apenas por gênero
      const heightWeightByGender = { male: { heights: [], weights: [] }, female: { heights: [], weights: [] } };
      sessionsData.forEach((session) => {
        const m = getMeasurements(session);
        if (!m || !m.gender || (m.gender !== 'male' && m.gender !== 'female')) return;
        const h = parseFloat(m.height);
        const w = parseFloat(m.weight);
        if (!isNaN(h)) heightWeightByGender[m.gender].heights.push(h);
        if (!isNaN(w)) heightWeightByGender[m.gender].weights.push(w);
      });

      const avg = (arr) => {
        if (!arr.length) return null;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
      };

      const avgByGender = {
        male: {
          height: avg(heightWeightByGender.male.heights),
          weight: avg(heightWeightByGender.male.weights)
        },
        female: {
          height: avg(heightWeightByGender.female.heights),
          weight: avg(heightWeightByGender.female.weights)
        }
      };

      // Por coleção e gênero: tamanho mais sugerido, ajuste mais escolhido, corpo mais escolhido
      const byKey = {};
      let sessionsWithValidGender = 0;
      let sessionsProcessed = 0;
      
      sessionsData.forEach((session) => {
        const m = getMeasurements(session);
        if (!m) {
          // Tenta usar dados diretos da sessão se getMeasurements retornou null
          const directGender = normalizeGender(session.gender);
          if (directGender && (directGender === 'male' || directGender === 'female')) {
            sessionsWithValidGender++;
            const coll = getCollectionKey(session);
            const key = `${coll}|${directGender}`;
            if (!byKey[key]) {
              byKey[key] = {
                collection: coll === 'geral' ? 'Geral' : coll,
                gender: directGender,
                sizes: {},
                fits: {},
                bodyTypes: {}
              };
            }
            const row = byKey[key];
            if (session.recommended_size != null && session.recommended_size !== '') {
              row.sizes[session.recommended_size] = (row.sizes[session.recommended_size] || 0) + 1;
            }
            if (session.fit_preference_index !== undefined && session.fit_preference_index !== null) {
              const f = Number(session.fit_preference_index);
              row.fits[f] = (row.fits[f] || 0) + 1;
            }
            if (session.body_type_index !== undefined && session.body_type_index !== null) {
              const b = Number(session.body_type_index);
              row.bodyTypes[b] = (row.bodyTypes[b] || 0) + 1;
            }
            sessionsProcessed++;
          }
          return;
        }
        
        if (!m.gender || (m.gender !== 'male' && m.gender !== 'female')) {
          return;
        }
        
        sessionsWithValidGender++;
        const coll = getCollectionKey(session);
        const key = `${coll}|${m.gender}`;
        if (!byKey[key]) {
          byKey[key] = {
            collection: coll === 'geral' ? 'Geral' : coll,
            gender: m.gender,
            sizes: {},
            fits: {},
            bodyTypes: {}
          };
        }
        const row = byKey[key];
        if (m.recommended_size != null && m.recommended_size !== '') {
          row.sizes[m.recommended_size] = (row.sizes[m.recommended_size] || 0) + 1;
        }
        if (m.fit_preference_index !== undefined && m.fit_preference_index !== null) {
          const f = Number(m.fit_preference_index);
          row.fits[f] = (row.fits[f] || 0) + 1;
        }
        if (m.body_type_index !== undefined && m.body_type_index !== null) {
          const b = Number(m.body_type_index);
          row.bodyTypes[b] = (row.bodyTypes[b] || 0) + 1;
        }
        sessionsProcessed++;
      });
      
      console.log('[Analytics] Sessions processed:', {
        total: sessionsData.length,
        withValidGender: sessionsWithValidGender,
        processed: sessionsProcessed,
        byCollectionGender: Object.keys(byKey).length,
        keys: Object.keys(byKey),
        sampleSessions: sessionsData.slice(0, 3).map(s => ({
          id: s.id,
          gender: s.gender,
          collection_handle: s.collection_handle,
          recommended_size: s.recommended_size,
          body_type_index: s.body_type_index,
          fit_preference_index: s.fit_preference_index,
          hasUserMeasurements: !!s.user_measurements,
          user_measurements_type: s.user_measurements ? (typeof s.user_measurements === 'string' ? 'string' : 'object') : 'null'
        })),
        sessionsWithoutGender: sessionsData.filter(s => {
          const m = getMeasurements(s);
          return !m || !m.gender || (m.gender !== 'male' && m.gender !== 'female');
        }).length
      });

      const mostFreq = (obj) => {
        if (!obj || !Object.keys(obj).length) return null;
        const ent = Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
        return { value: ent[0], count: ent[1] };
      };

      const byCollectionGender = Object.entries(byKey)
        .map(([, v]) => {
          const mostSize = mostFreq(v.sizes);
          const mostFit = mostFreq(v.fits);
          const mostBodyType = mostFreq(v.bodyTypes);
          
          // Debug log
          console.log('[Analytics] Processing collection/gender:', {
            collection: v.collection,
            gender: v.gender,
            sizes: Object.keys(v.sizes).length,
            fits: Object.keys(v.fits).length,
            bodyTypes: Object.keys(v.bodyTypes).length,
            mostSize,
            mostFit,
            mostBodyType
          });
          
          return {
            collection: v.collection,
            gender: v.gender,
            mostSize,
            mostFit,
            mostBodyType
          };
        })
        .filter((item) => {
          // Inclui se tiver pelo menos um dado (size, fit ou bodyType)
          const hasSize = item.mostSize !== null;
          const hasFit = item.mostFit !== null;
          const hasBodyType = item.mostBodyType !== null;
          const shouldInclude = hasSize || hasFit || hasBodyType;
          
          if (!shouldInclude) {
            console.log('[Analytics] Filtering out item (no data):', item);
          }
          
          return shouldInclude;
        });
      
      console.log('[Analytics] Final byCollectionGender:', {
        count: byCollectionGender.length,
        items: byCollectionGender
      });

      setMetrics({
        totalImagesProcessed,
        avgByGender,
        byCollectionGender,
        ordersBefore: ordersData.ordersBefore ?? null,
        ordersAfter: ordersData.ordersAfter ?? null,
        returnsBefore: ordersData.returnsBefore ?? null,
        returnsAfter: ordersData.returnsAfter ?? null,
        conversionBefore: ordersData.conversionBefore ?? null,
        conversionAfter: ordersData.conversionAfter ?? null,
        ordersError: ordersData.error ?? null,
        tableError: sessionsData.length === 0 ? 'No sessions found or table does not exist' : null
      });
    } catch (err) {
      console.error('[Analytics]', err);
      // Não define erro crítico se for apenas problema de tabela não encontrada
      if (err?.message?.includes('400') || err?.message?.includes('session_analytics') || err?.message?.includes('Failed to load resource')) {
        // Tenta obter imagesUsedMonth novamente se necessário
        let imagesUsedMonthFallback = 0;
        try {
          const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
          const supabaseKey = window.ENV?.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
          if (supabaseUrl && supabaseKey && shopDomain) {
            const shopRes = await fetch(
              `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=images_used_month`,
              {
                headers: {
                  apikey: supabaseKey,
                  Authorization: `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            if (shopRes.ok) {
              const shopData = await shopRes.json();
              imagesUsedMonthFallback = shopData?.[0]?.images_used_month ?? 0;
            }
          }
        } catch (e) {
          console.warn('[Analytics] Could not fetch imagesUsedMonth:', e);
        }
        
        setMetrics({
          totalImagesProcessed: imagesUsedMonthFallback,
          avgByGender: { male: { height: null, weight: null }, female: { height: null, weight: null } },
          byCollectionGender: [],
          ordersBefore: null,
          ordersAfter: null,
          returnsBefore: null,
          returnsAfter: null,
          conversionBefore: null,
          conversionAfter: null,
          ordersError: null,
          tableError: 'no_sessions'
        });
      } else {
        setError(toFriendlyAnalyticsError(err?.message || t('analytics.errorLoad')));
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Page title={t('analytics.title')} backAction={{ content: t('common.dashboard'), onAction: () => navigate(`/app?shop=${shopDomain || ''}`) }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyMd">{t('analytics.loadingAnalytics')}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const m = metrics ?? {};
  const rows = (m.byCollectionGender || []).map((r) => {
    const bodyLabel = r.mostBodyType != null ? (BODY_TYPE_NAMES[r.mostBodyType.value] ?? r.mostBodyType.value) : null;
    const mannequinUrl = bodyLabel != null ? getMannequinImageUrl(r.mostBodyType.value, r.gender) : null;
    const bodyTypeCell = bodyLabel != null ? (
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        {mannequinUrl && (
          <img
            src={mannequinUrl}
            alt=""
            style={{ width: 40, height: 56, objectFit: 'contain', flexShrink: 0 }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )}
        <Text as="span" variant="bodyMd">{bodyLabel}</Text>
      </InlineStack>
    ) : '—';
    return [
      r.collection,
      GENDER_LABELS[r.gender] || r.gender,
      r.mostSize ? r.mostSize.value : '—',
      r.mostFit != null ? (FIT_PREFERENCE_NAMES[r.mostFit.value] ?? r.mostFit.value) : '—',
      bodyTypeCell
    ];
  });

  const timeRangeOptions = [
    { label: t('analytics.last7Days'), value: '7' },
    { label: t('analytics.last30Days'), value: '30' },
    { label: t('analytics.last90Days'), value: '90' },
    { label: t('analytics.lastYear'), value: '365' }
  ];

  return (
    <Page
      title={t('analytics.title')}
      subtitle={t('analytics.subtitle')}
      backAction={{ content: t('common.dashboard'), onAction: () => navigate(`/app?shop=${shopDomain || ''}`) }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {m.ordersError && (
          <Layout.Section>
            <Banner tone="warning">
              <p>{t('analytics.ordersError')}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  {t('analytics.analysisPeriod')}
                </Text>
                <Box minWidth="200px">
                  <Select
                    label=""
                    options={timeRangeOptions}
                    value={timeRange}
                    onChange={setTimeRange}
                  />
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="bodyMd" tone="subdued">
                {t('analytics.imagesProcessed')}
              </Text>
              <Text variant="heading2xl" as="p">
                {m.totalImagesProcessed ?? 0}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            {t('analytics.returnsBeforeAfter')}
          </Text>
          <Text variant="bodyMd" tone="subdued">
            {t('analytics.returnsHelp')}
          </Text>
          <InlineStack gap="400" wrap>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">{t('analytics.beforeOmafit')}</Text>
                  <Text variant="headingXl" as="p">{m.returnsBefore != null ? m.returnsBefore : '—'}</Text>
                  <Text variant="bodyMd" tone="subdued">{t('analytics.returnsCount')}</Text>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">{t('analytics.afterOmafit')}</Text>
                  <Text variant="headingXl" as="p">{m.returnsAfter != null ? m.returnsAfter : '—'}</Text>
                  <Text variant="bodyMd" tone="subdued">{t('analytics.returnsCount')}</Text>
                </BlockStack>
              </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            {t('analytics.conversionRate')}
          </Text>
          <Text variant="bodyMd" tone="subdued">
            {t('analytics.conversionHelp')}
          </Text>
          <InlineStack gap="400" wrap>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">{t('analytics.beforeOmafit')}</Text>
                  <Text variant="headingXl" as="p">
                    {m.conversionBefore != null ? `${m.conversionBefore.toFixed(1)}%` : '—'}
                  </Text>
                  <Text variant="bodyMd" tone="subdued">{t('analytics.ordersKept')}</Text>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">{t('analytics.afterOmafit')}</Text>
                  <Text variant="headingXl" as="p">
                    {m.conversionAfter != null ? `${m.conversionAfter.toFixed(1)}%` : '—'}
                  </Text>
                  <Text variant="bodyMd" tone="subdued">{t('analytics.ordersKept')}</Text>
                </BlockStack>
              </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            {t('analytics.avgHeightWeight')}
          </Text>
          <BlockStack gap="300">
            <InlineStack gap="400" wrap>
              <div style={{ flex: '1 1 240px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">{t('analytics.male')}</Text>
                    <Text variant="bodyMd" tone="subdued">
                      {t('analytics.avgHeight')} {m.avgByGender?.male?.height != null ? `${m.avgByGender.male.height.toFixed(1)} cm` : '—'}
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      {t('analytics.avgWeight')} {m.avgByGender?.male?.weight != null ? `${m.avgByGender.male.weight.toFixed(1)} kg` : '—'}
                    </Text>
                  </BlockStack>
                </Card>
              </div>
              <div style={{ flex: '1 1 240px' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">{t('analytics.female')}</Text>
                    <Text variant="bodyMd" tone="subdued">
                      {t('analytics.avgHeight')} {m.avgByGender?.female?.height != null ? `${m.avgByGender.female.height.toFixed(1)} cm` : '—'}
                    </Text>
                    <Text variant="bodyMd" tone="subdued">
                      {t('analytics.avgWeight')} {m.avgByGender?.female?.weight != null ? `${m.avgByGender.female.weight.toFixed(1)} kg` : '—'}
                    </Text>
                  </BlockStack>
                </Card>
              </div>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Text variant="headingLg" as="h2">
            {t('analytics.byCollectionGender')}
          </Text>
          <Text variant="bodyMd" tone="subdued">
            {t('analytics.byCollectionHelp')}
          </Text>
          {rows.length > 0 ? (
            <Card>
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                headings={[t('analytics.headingsCollection'), t('analytics.headingsGender'), t('analytics.headingsMostSize'), t('analytics.headingsFit'), t('analytics.headingsBodyType')]}
                rows={rows}
              />
            </Card>
          ) : (
            <Card>
              <BlockStack gap="300">
                {m.tableError === 'no_sessions' ? (
                  <Banner tone="info">
                    <BlockStack gap="200">
                      <Text variant="bodyMd" fontWeight="semibold">
                        📊 Nenhuma sessão de try-on encontrada ainda
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        As tabelas <strong>session_analytics</strong> e <strong>tryon_sessions</strong> existem no Supabase, mas estão vazias.
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        Os dados aparecerão automaticamente quando:
                      </Text>
                      <BlockStack gap="100">
                        <Text variant="bodyMd" tone="subdued">
                          • Clientes usarem o widget de try-on virtual na sua loja
                        </Text>
                        <Text variant="bodyMd" tone="subdued">
                          • A edge function <strong>virtual-try-on</strong> salvar as sessões no Supabase
                        </Text>
                        <Text variant="bodyMd" tone="subdued">
                          • As sessões incluírem dados de gênero (male/female) e collection_handle
                        </Text>
                      </BlockStack>
                      <Text variant="bodyMd" tone="subdued">
                        💡 <strong>Dica:</strong> Teste o widget em uma página de produto da sua loja para gerar dados de teste.
                      </Text>
                      <Text variant="bodyMd" tone="subdued">
                        Se a tabela <strong>session_analytics</strong> permanecer vazia, execute o SQL <strong>supabase_fix_session_analytics_autosync.sql</strong> para sincronizar automaticamente a partir de <strong>tryon_sessions</strong>.
                      </Text>
                    </BlockStack>
                  </Banner>
                ) : (
                  <Text variant="bodyMd" tone="subdued">
                    {t('analytics.noDataByCollection')}
                  </Text>
                )}
              </BlockStack>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
