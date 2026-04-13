# Bucket `self-hosted-results` privado (LGPD / acesso)

## 1. Supabase (SQL)

Executa no **SQL Editor** o ficheiro:

`supabase_storage_self_hosted_results_private.sql`

No **Dashboard → Storage →** bucket `self-hosted-results` confirma que **Public** está desligado.

## 2. Como servir imagens no widget

URLs `.../storage/v1/object/public/self-hosted-results/...` **deixam de funcionar** para anónimos.

Fluxo recomendado:

1. Guardar na base de dados o **caminho do objecto** (ex. `loja123/sessao/resultado.png`), não a URL pública.
2. No **servidor** que já tem `SUPABASE_SERVICE_ROLE_KEY` (worker self-hosted, app Omafit, Edge Function com secret), gerar URL assinada:

### Python (worker / pipeline)

```python
import os, requests
from urllib.parse import quote

def supabase_signed_url(bucket: str, object_path: str, expires_in: int = 3600) -> str:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    enc = "/".join(quote(seg, safe="") for seg in object_path.split("/") if seg)
    url = f"{base}/storage/v1/object/sign/{quote(bucket, safe='')}/{enc}"
    r = requests.post(
        url,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"expiresIn": expires_in},
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()
    signed = data.get("signedURL") or data.get("signedUrl")
    if not signed:
        raise RuntimeError("Resposta sem signedURL")
    return signed if signed.startswith("http") else f"{base}/storage/v1{signed}"
```

3. Entregar ao iframe/widget apenas essa **URL assinada** (TTL típico: 300–3600 s; podes subir para prova longa com custo de revogação menor).

## 3. App Omafit (admin embutido)

Para pré-visualização / ferramentas internas com sessão Shopify:

`GET /api/storage/signed-url?bucket=self-hosted-results&path=<path-relativo>&expiresIn=3600`

- Requer login no **admin da app** (embedded).
- `path` = caminho dentro do bucket (ex. `shop/session/out.png`), sem `..` nem prefixo `/`.

## 4. Não colocar `service_role` no browser

O widget na loja **não** deve chamar o Supabase com a service role. Quem assina é sempre o **teu backend** (try-on self-hosted ou esta app).
