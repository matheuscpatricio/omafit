/**
 * Contratos públicos da camada comercial do AI Stylist.
 * Consumidores: orquestrador de IA (server-side) e `omafit-widget`.
 */

export type StylistErrorCode =
  | "invalid_body"
  | "missing_params"
  | "method_not_allowed"
  | "server_misconfigured"
  | "unauthorized"
  | "token_expired"
  | "bad_token"
  | "replay_detected"
  | "missing_nonce"
  | "rate_limited"
  | "shop_public_id_mismatch"
  | "plan_required"
  | "voice_plan_required"
  | "no_session"
  | "unknown_tool"
  | "invalid_arguments"
  | "tool_failed";

export interface StylistErrorResponse {
  ok: false;
  error: StylistErrorCode;
  /** Segundos até poder repetir (apenas `rate_limited`). */
  retry_after?: number;
}

/** POST /api/stylist/session */
export interface StylistSessionRequest {
  shop_domain: string;
  public_id: string;
  /** Pede o escopo de voz; só concedido em Enterprise. */
  voice?: boolean;
}

export type StylistScope = "stylist" | "voice";

export interface StylistSessionResponse {
  ok: true;
  token: string;
  /** Epoch seconds. */
  expires_at: number;
  scopes: StylistScope[];
  plan: string;
}

/** Payload assinado dentro do token (nunca contém segredos). */
export interface StylistTokenClaims {
  v: 1;
  shop: string;
  pid: string;
  sid: string;
  scopes: StylistScope[];
  iat: number;
  exp: number;
}

export type StylistToolName =
  | "search_products"
  | "get_product_details"
  | "get_available_variants"
  | "get_store_profile"
  | "validate_variant_for_purchase";

/**
 * POST /api/stylist/tools
 * Headers: `Authorization: Bearer <token>`, `X-Omafit-Nonce: <único por pedido>`.
 * A loja vem sempre do token; argumentos com `shop_domain` são rejeitados.
 */
export interface StylistToolRequest<N extends StylistToolName = StylistToolName> {
  tool: N;
  arguments: StylistToolArguments[N];
}

export interface StylistToolArguments {
  search_products: {
    query?: string;
    anchor_handle?: string;
    collection_type?: "upper" | "lower" | "full";
    shopper_gender?: string;
    limit?: number;
  };
  get_product_details: { handle: string };
  get_available_variants: { handle: string };
  get_store_profile: Record<string, never>;
  validate_variant_for_purchase: {
    variant_id: string;
    quantity?: number;
    /** Preço que o shopper viu; se divergir, `price_changed`. */
    expected_price?: string;
  };
}

export interface ProductSummary {
  handle: string;
  title: string;
  url: string;
  image_url: string;
  product_type: string;
  price_amount: number | null;
  currency_code: string | null;
  /** Há pelo menos uma variante `availableForSale`. Pode ser stale: valide antes de comprar. */
  in_stock: boolean;
}

export interface VariantInfo {
  id: string;
  title: string;
  price: string | null;
  available: boolean;
  options: Record<string, string>;
}

export interface ProductDetails {
  id: string;
  handle: string;
  title: string;
  product_type: string;
  url: string;
  images: string[];
  /** Produto ativo e publicado na Online Store. */
  recommendable: boolean;
  sizes: string[];
  colors: string[];
}

export interface StoreProfile {
  audience: string;
  price_band: string;
  primary_categories: string[];
  source: string;
}

export type PurchaseValidationReason =
  | "ok"
  | "variant_not_found"
  | "product_not_recommendable"
  | "out_of_stock"
  | "price_changed"
  | "invalid_quantity";

export interface PurchaseValidation {
  valid: boolean;
  reason: PurchaseValidationReason;
  variant_id: string;
  product_handle: string | null;
  current_price: string | null;
  currency_code: string | null;
  available: boolean;
}

export interface StylistToolResults {
  search_products: { products: ProductSummary[] };
  get_product_details: { product: ProductDetails | null; error: "not_found" | null };
  get_available_variants: {
    handle: string;
    variants: VariantInfo[];
    error: "not_found" | null;
  };
  get_store_profile: { profile: StoreProfile };
  validate_variant_for_purchase: PurchaseValidation;
}

export interface StylistToolResponse<N extends StylistToolName = StylistToolName> {
  ok: true;
  tool: N;
  result: StylistToolResults[N];
}
