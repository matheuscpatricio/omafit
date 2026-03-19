# Correção: "Não conseguimos detectar seu corpo na foto" aparecendo em excesso

## Problema

A mensagem "Não conseguimos detectar seu corpo na foto. Envie outra imagem frontal com melhor iluminação." aparece em praticamente todas as imagens, inclusive com boa iluminação.

## Onde a mensagem pode estar

A mensagem **não está neste repositório** (app Shopify). Ela provavelmente está em:

1. **Edge Function `virtual-try-on`** (Supabase) – ao tratar erros da fal.ai
2. **Widget frontend** (omafit.netlify.app) – validação antes de enviar ou ao exibir erro da API

## O que verificar

### 1. Edge Function `virtual-try-on`

No Supabase Dashboard → Edge Functions → `virtual-try-on`:

- Procure por strings como:
  - `"detectar seu corpo"`
  - `"detect your body"`
  - `"body not detected"`
  - `"person not found"`
- Veja como os erros da fal.ai são mapeados para mensagens em português
- Verifique se há validação de imagem antes de chamar a fal.ai (tamanho, formato, etc.)

### 2. Resposta da fal.ai

A fal.ai pode retornar erros quando:
- Não detecta uma pessoa na imagem
- A imagem está em formato/resolução inadequada
- A pose não é frontal o suficiente

**Parâmetros do modelo fal-ai/image-apps-v2/virtual-try-on:**
- `person_image_url` (obrigatório)
- `clothing_image_url` (obrigatório)
- `preserve_pose` (boolean, default: true)
- `aspect_ratio` (opcional)

Não há parâmetro de threshold de detecção na API pública.

### 3. Possíveis causas e soluções

| Causa | Solução |
|------|---------|
| **Imagem muito pequena** | Garantir resolução mínima (ex: 512x512 ou 640x640) antes de enviar |
| **Formato incorreto** | Validar que a imagem é JPEG/PNG e não está corrompida |
| **Base64 truncado** | Verificar se o base64 está completo ao enviar |
| **Modelo fal.ai sensível** | Considerar pré-processar a imagem (redimensionar, normalizar) |
| **Validação client-side excessiva** | Se o widget valida antes de enviar, relaxar ou remover |
| **Mensagem genérica demais** | A fal.ai pode retornar erro genérico; não assumir sempre "iluminação" |

### 4. Ajustes sugeridos na Edge Function

Se a Edge Function traduz o erro da fal.ai para essa mensagem:

```typescript
// ANTES (exemplo hipotético) - muito genérico
if (error.message?.includes('person') || error.message?.includes('body')) {
  return { success: false, error: 'Não conseguimos detectar seu corpo na foto. Envie outra imagem frontal com melhor iluminação.' };
}

// DEPOIS - retornar erro original ou ser mais específico
// Opção A: Repassar o erro da fal.ai para o frontend decidir
return { success: false, error: error.message || 'Erro ao processar imagem.' };

// Opção B: Só mostrar mensagem de iluminação se o erro indicar isso
const lowerMsg = (error.message || '').toLowerCase();
const isLighting = lowerMsg.includes('light') || lowerMsg.includes('dark') || lowerMsg.includes('bright');
const isDetection = lowerMsg.includes('detect') || lowerMsg.includes('person') || lowerMsg.includes('body');
if (isLighting) {
  return { success: false, error: '...melhor iluminação.' };
}
if (isDetection) {
  return { success: false, error: 'Não conseguimos detectar uma pessoa na foto. Envie uma foto frontal, de corpo inteiro ou até o peito.' };
}
return { success: false, error: error.message || 'Erro ao processar. Tente outra foto.' };
```

### 5. Pré-processamento de imagem (se aplicável)

Antes de enviar para a fal.ai, considerar:

- Redimensionar para resolução padrão (ex: 768x1024 ou 512x768)
- Garantir que a imagem não está rotacionada incorretamente
- Converter para JPEG com qualidade 85–90 se for PNG muito grande

### 6. Testar com imagens de referência

Use imagens que funcionam no playground da fal.ai:
- https://fal.ai/models/fal-ai/image-apps-v2/virtual-try-on/playground

Compare o formato e resolução das imagens que funcionam com as que falham.

## Próximos passos

1. Localizar o código da Edge Function `virtual-try-on` (em outro repositório ou no Supabase)
2. Verificar o código do widget em omafit.netlify.app
3. Checar logs da fal.ai no Supabase para ver o erro exato retornado
4. Aplicar os ajustes sugeridos e testar
