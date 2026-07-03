#!/usr/bin/env node
/**
 * Gera token de Página (não expira) para Instagram Graph API.
 *
 * Uso:
 *   META_APP_ID=... META_APP_SECRET=... node scripts/instagram-page-token.mjs EAAG...
 *
 * Ou cole o token curto quando solicitado.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function getEnv(name) {
  return (process.env[name] || "").trim();
}

async function graphGet(path, params) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `HTTP ${response.status}`);
  }
  return data;
}

async function main() {
  const appId = getEnv("META_APP_ID") || getEnv("FACEBOOK_APP_ID");
  const appSecret = getEnv("META_APP_SECRET") || getEnv("FACEBOOK_APP_SECRET");
  if (!appId || !appSecret) {
    console.error("Defina META_APP_ID e META_APP_SECRET no ambiente.");
    process.exit(1);
  }

  let shortToken = process.argv[2]?.trim();
  if (!shortToken) {
    const rl = createInterface({ input, output });
    shortToken = (await rl.question("Cole o token curto do Graph API Explorer: ")).trim();
    rl.close();
  }

  const longLived = await graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });

  const pages = await graphGet("/me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: longLived.access_token,
  });

  const withIg = (pages.data || []).filter((p) => p.instagram_business_account?.id);
  if (!withIg.length) {
    console.error("Nenhuma Página com Instagram vinculado. Verifique pages_show_list e o vínculo @omafit.co.");
    process.exit(1);
  }

  const page = withIg.find((p) => p.instagram_business_account.username === "omafit.co") || withIg[0];
  const ig = page.instagram_business_account;

  console.log("\n--- Cole no Railway ---\n");
  console.log(`INSTAGRAM_ACCESS_TOKEN=${page.access_token}`);
  console.log(`INSTAGRAM_BUSINESS_ACCOUNT_ID=${ig.id}`);
  console.log(`\nPágina: ${page.name} · @${ig.username}`);
  console.log("Token de Página — não expira (enquanto a Página existir).\n");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
