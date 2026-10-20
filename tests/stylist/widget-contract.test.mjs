import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchProductDetailByHandle } from "../../app/widget-catalog-search.server.js";
import { runStylistCatalogSearch } from "../../app/stylist/catalog.server.js";
import { fakeAdmin, fakePrisma } from "./fakes.mjs";

test("/api/widget/product-by-handle mantém o formato público", async () => {
  const { product, error } = await fetchProductDetailByHandle(
    fakeAdmin("shop-a.myshopify.com"),
    "calca-linho"
  );
  assert.equal(error, null);
  assert.deepEqual(Object.keys(product).sort(), [
    "catalog",
    "collection_handles",
    "handle",
    "id",
    "image_url",
    "images",
    "product_type",
    "title",
    "url",
  ]);
  assert.deepEqual(Object.keys(product.catalog.variants[0]).sort(), [
    "available",
    "featured_image",
    "id",
    "option1",
    "selectedOptions",
    "title",
  ]);
  assert.equal("status" in product, false);
});

test("/api/widget/product-by-handle devolve not_found", async () => {
  const r = await fetchProductDetailByHandle(fakeAdmin("shop-a.myshopify.com"), "segredo-b");
  assert.deepEqual(r, { product: null, error: "not_found" });
});

test("pipeline do catalog-search devolve campos usados pela rota", async () => {
  const params = { user_message: "calça", exclude_handle: "", collection_type: "upper" };
  const out = await runStylistCatalogSearch({
    prisma: fakePrisma(),
    admin: fakeAdmin("shop-a.myshopify.com"),
    shopDomain: "shop-a.myshopify.com",
    params,
  });
  assert.ok(Array.isArray(out.candidates));
  assert.ok(Array.isArray(out.scoredTop));
  assert.ok(out.storeProfile && typeof out.storeProfile.audience === "string");
  for (const k of ["candidatesRaw", "filtered", "queries", "resolvedCollectionHandles"]) {
    assert.ok(Array.isArray(out.diagnostics[k]), k);
  }
});
