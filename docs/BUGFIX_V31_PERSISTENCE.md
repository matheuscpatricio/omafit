# Bug Fix v31: Persistência de Scale e WearZ na Calibração de Óculos

**Data:** 2026-05-20  
**Tipo:** Bug Fix Crítico  
**Afeta:** v30 (profundidade) e v31 (escala)

## Problema

Após implementar os sliders de profundidade (v30) e escala (v31) na página de calibração de óculos, os valores **não estavam sendo persistidos**. Ao salvar, os sliders voltavam aos valores anteriores (defaults) ao recarregar a página, impossibilitando que o merchant ajustasse profundidade e tamanho dos óculos.

### Comportamento Observado

1. Merchant abre página de calibração
2. Ajusta "Tamanho do óculos" para `120%` (scale: `1.2`)
3. Ajusta "Profundidade" para `-10mm` (wearZ: `-0.01`)
4. Clica em "Salvar"
5. **Após salvar, os valores voltam para `100%` e `0mm`**
6. Widget AR não reflete as mudanças salvas

### Impacto

- **Severity:** Alta
- **User Impact:** Merchant não consegue ajustar tamanho ou profundidade de óculos via calibração
- **Workaround:** Nenhum (funcionalidade completamente quebrada)

## Causa Raiz

### Código Problemático

No arquivo `app/ar-calibration.shared.js`, a função `buildCalibrationForRotationEditor` tinha um comentário explícito:

```javascript
/** Só a rotação vem do metafield guardado; posição/escala usam sempre os defaults do tipo. */
export function buildCalibrationForRotationEditor(defaultCal, saved, accessoryType) {
  const type = normalizeAccessoryType(accessoryType) || AR_ACCESSORY_TYPE_DEFAULT;
  const merged = sanitizeArCalibrationInput(
    {
      ...defaultCal,
      rx: saved && Number.isFinite(Number(saved.rx)) ? Number(saved.rx) : defaultCal.rx,
      ry: saved && Number.isFinite(Number(saved.ry)) ? Number(saved.ry) : defaultCal.ry,
      rz: saved && Number.isFinite(Number(saved.rz)) ? Number(saved.rz) : defaultCal.rz,
      // ❌ scale e wearZ NÃO eram copiados do saved
    },
    type,
  );
  // ...
}
```

### Por que aconteceu?

Essa função foi criada **antes** de existirem os sliders de scale e wearZ para óculos. Na época, apenas **rotação** (`rx`, `ry`, `rz`) era ajustável para óculos. Scale e wearZ eram **sempre defaults fixos**.

Quando adicionamos os sliders em v30/v31, **esquecemos de atualizar essa função** para também carregar `scale` e `wearZ` do metafield salvo.

### Fluxo Quebrado

1. **Salvar (action):** ✅ Funciona — `scale` e `wearZ` são salvos no metafield Shopify
2. **Carregar (loader):** ✅ Funciona — `scale` e `wearZ` são lidos do metafield
3. **Hidratar UI (buildCalibrationForRotationEditor):** ❌ **QUEBRADO** — `scale` e `wearZ` eram descartados, sempre usando defaults

Resultado: após salvar e recarregar, os valores voltavam aos defaults.

## Solução

### Código Corrigido

Atualizada a função `buildCalibrationForRotationEditor` para também carregar `scale` e `wearZ` do metafield **apenas para óculos**:

```javascript
/**
 * Rotação sempre vem do metafield guardado.
 * Para óculos: scale e wearZ também vêm do metafield (v31).
 * Para outros tipos: posição/escala usam defaults do tipo.
 */
export function buildCalibrationForRotationEditor(defaultCal, saved, accessoryType) {
  const type = normalizeAccessoryType(accessoryType) || AR_ACCESSORY_TYPE_DEFAULT;
  const merged = sanitizeArCalibrationInput(
    {
      ...defaultCal,
      rx: saved && Number.isFinite(Number(saved.rx)) ? Number(saved.rx) : defaultCal.rx,
      ry: saved && Number.isFinite(Number(saved.ry)) ? Number(saved.ry) : defaultCal.ry,
      rz: saved && Number.isFinite(Number(saved.rz)) ? Number(saved.rz) : defaultCal.rz,
      ...(type === "glasses" && {
        scale: saved && Number.isFinite(Number(saved.scale)) ? Number(saved.scale) : defaultCal.scale,
        wearZ: saved && Number.isFinite(Number(saved.wearZ)) ? Number(saved.wearZ) : defaultCal.wearZ,
      }),
    },
    type,
  );
  if (type === "bracelet") {
    return sanitizeArCalibrationInput({ ...merged, rx: 0, ry: 0 }, type);
  }
  return merged;
}
```

### Mudanças

1. **Comentário atualizado:** Explica que óculos agora também persistem `scale` e `wearZ`
2. **Spread condicional:** Usa `...(type === "glasses" && { scale, wearZ })` para adicionar os campos apenas para óculos
3. **Validação:** Mesma lógica de `Number.isFinite` usada para rotação
4. **Fallback:** Se `saved.scale` ou `saved.wearZ` não existirem, usa `defaultCal` (para compatibilidade backward)

### Por que condicional para óculos?

Outros accessory types (relógio, pulseira, colar) **não devem** persistir `scale` e `wearZ` da calibração. Para eles:
- **Scale:** vem dos defaults por tipo (ex: pulseira = 1.1)
- **wearY:** vem dos defaults por tipo (ex: colar = -0.12)

Apenas óculos precisam de `scale` e `wearZ` ajustáveis e persistidos.

## Impacto da Correção

### Antes (Quebrado)

```
Merchant ajusta:
  scale: 1.2 (120%)
  wearZ: -0.01 (-10mm)

↓ Salvar

Metafield: { rx: 0, ry: 0, rz: 0, scale: 1.2, wearZ: -0.01 } ✅

↓ Recarregar página

buildCalibrationForRotationEditor ignora scale/wearZ
UI mostra: scale: 1.0 (100%), wearZ: 0 (0mm) ❌

Widget AR usa: scale: 1.0, wearZ: 0 ❌
```

### Depois (Corrigido)

```
Merchant ajusta:
  scale: 1.2 (120%)
  wearZ: -0.01 (-10mm)

↓ Salvar

Metafield: { rx: 0, ry: 0, rz: 0, scale: 1.2, wearZ: -0.01 } ✅

↓ Recarregar página

buildCalibrationForRotationEditor carrega scale/wearZ do saved
UI mostra: scale: 1.2 (120%), wearZ: -0.01 (-10mm) ✅

Widget AR usa: scale: 1.2, wearZ: -0.01 ✅
```

## Testes Recomendados

### Manual

1. Abrir página de calibração para produto com óculos
2. Ajustar "Tamanho do óculos" para `80%`
3. Ajustar "Profundidade" para `+15mm`
4. Clicar em "Salvar"
5. **Recarregar a página** (F5)
6. ✅ Verificar que sliders mostram `80%` e `+15mm` (não voltaram aos defaults)
7. Abrir widget AR no storefront
8. ✅ Verificar que óculos estão visivelmente menores e mais afastados do rosto

### Edge Cases

- **Calibração antiga (antes de v31):** Se `saved.scale` não existir, deve usar `defaultCal.scale` (1.0)
- **Calibração antiga (antes de v30):** Se `saved.wearZ` não existir, deve usar `defaultCal.wearZ` (0)
- **Pulseiras/Relógios:** `scale` e `wearZ` **não** devem ser carregados do saved (devem usar defaults)

### Verificação de Regressão

- [ ] Rotação (rx, ry, rz) continua persistindo para óculos
- [ ] Rotação continua persistindo para relógios
- [ ] Rotação continua persistindo para pulseiras (apenas rz)
- [ ] Scale de pulseiras continua usando default (1.1), não metafield
- [ ] wearY de colares continua usando default (-0.12), não metafield

## Histórico de Versões Afetadas

| Versão | Data | Status | Notas |
|--------|------|--------|-------|
| v30 | 2026-05-20 | ❌ Quebrado | Slider de profundidade implementado mas não persistia |
| v31 | 2026-05-20 | ❌ Quebrado | Slider de escala implementado mas não persistia |
| v31-fix | 2026-05-20 | ✅ Corrigido | Ambos agora persistem corretamente |

## Compatibilidade

### Backward

✅ **Totalmente compatível:**
- Calibrações antigas sem `scale`/`wearZ` usam defaults (1.0 e 0)
- Calibrações novas com `scale`/`wearZ` são carregadas corretamente

### Forward

✅ **Compatível:**
- Se reverter para código antigo, `scale`/`wearZ` salvos serão ignorados (mas não causam erro)
- Merchant pode re-salvar no código antigo sem perder rotação

## Lições Aprendidas

1. **Quando adicionar novos campos ajustáveis:**
   - Verificar **todo o fluxo**: UI → action → metafield → loader → `buildCalibrationForRotationEditor` → UI
   - Não assumir que "se salvou, vai carregar"

2. **Comentários de código desatualizados:**
   - O comentário "Só a rotação vem do metafield guardado" estava **tecnicamente correto** quando foi escrito
   - Precisamos atualizar comentários ao mudar comportamento

3. **Testes de persistência:**
   - Não basta testar "salvar funcionou"
   - **Sempre testar recarregar página** após salvar para verificar se valores persistem

4. **Scoped changes:**
   - Usar spread condicional `...(type === "glasses" && { ... })` permite mudar comportamento apenas para um tipo
   - Evita regressions em outros accessory types

## Próximos Passos

- [ ] Deploy urgente para produção (bug crítico)
- [ ] Adicionar teste automatizado para persistência de calibração
- [ ] Documentar fluxo completo de calibração no README
- [ ] Considerar refatorar `buildCalibrationForRotationEditor` para ser mais explícito

## Referências

- Issue original: (adicionar link se existir)
- PR: (adicionar link após criar)
- Commits relacionados:
  - v30: profundidade implementada
  - v31: escala implementada
  - v31-fix: persistência corrigida
