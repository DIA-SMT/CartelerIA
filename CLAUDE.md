# CartelerIA — contexto para agentes

Visualizador de cartelería urbana de la Municipalidad de San Miguel de Tucumán.
Next.js 14 (App Router) + Tailwind 3 + Supabase + Leaflet + RAG documental con
OCR propio. Todo en español (UI, comentarios, commits).

## Comandos

```bash
npm run dev                                # dev server (o .claude/launch.json "carteleria-dev")
npx tsc --noEmit                           # typecheck (strict, cero `any` — mantenerlo)
npx tsx scripts/validate-query-counts.ts   # gate del motor de consultas del mapa
npx next build                             # build (First Load JS de / ≈ 202 kB — no engordarlo)
```

No hay tests ni config de ESLint (`next lint` dispara el wizard interactivo: no usarlo).

## Arquitectura

- **Árbol 100% cliente**: `app/page.tsx` → `components/dashboard.tsx` (`"use client"`).
  No hay Server Components reales. `Dashboard` es el dueño del estado compartido
  (visor PDF, cartel seleccionado) y de `useTerritorialMap()`.
- **Datos territoriales**: `loadTerritorialLayers()` en `data/territorial.ts` hace
  `fetch` de `/data/*.json` (solo navegador). **No volver a importar esos JSON
  estáticamente**: se sacaron del bundle a propósito (~300 KB). Los scripts Node
  leen por `fs` y aplican `applyReviewBuffer` exportado.
- **Sesión**: `AuthProvider` único montado en `app/layout.tsx`
  (`components/auth-provider.tsx`). `hooks/use-auth.ts` es solo re-export para
  compatibilidad. No instanciar estado de auth en componentes.
- **Repositorios** (`lib/*-repository.ts`): acceso a Supabase con fallback a datos
  estáticos de `data/` si no hay conexión. Ojo: el fallback enmascara caídas
  (el usuario ve datos viejos sin aviso) — deuda conocida.
- **APIs** (`app/api/ask`, `app/api/normativa`): llaman a OpenRouter. Toda API
  nueva debe replicar sus defensas: rate limit por IP (`lib/rate-limit.ts`),
  límite de longitud del input, `AbortSignal.timeout`, y nunca filtrar
  `error.message` al cliente. `/api/ask` traduce la pregunta a un `QueryIntent`
  que SIEMPRE se revalida con `parseQueryIntent` (no confiar en el LLM).
- **Motion**: tokens en `tailwind.config.ts` (duraciones fast/DEFAULT/slow,
  easings `out`/`spring`, keyframes) + `prefers-reduced-motion` global en
  `globals.css`. Overlays montados condicionalmente animan salida con
  `hooks/use-dismissible.ts` (patrón `data-state`). Animar solo
  transform/opacity; el spotlight del tour ya se migró a transform — no
  reintroducir animación de top/left/width/height/box-shadow.

## Identidad visual (obligatoria)

Tokens `municipal` y `brandYellow` de `tailwind.config.ts`; logo
`public/logo-municipalidad-smt.png` sin recolorear ni deformar. Ver README.

## Supabase

- Migraciones idempotentes en `supabase/migrations/` (correrlas a mano en el SQL
  Editor; no hay CLI vinculado). `schema.sql` + seeds para setup desde cero.
- Seguridad (migración 10): escritura en `carteles` exige rol operativo via
  `tiene_rol`; `anon` solo lee; cuentas nuevas nacen con rol `consulta`.
  No crear policies `to anon` de escritura ni defaults de rol altos.
- Plan free: se pausa a los ~7 días sin actividad (el subdominio deja de
  resolver → parece error de DNS). Lo evita `.github/workflows/supabase-keepalive.yml`
  (ping diario; los `schedule` solo corren desde `main`; secrets `SUPABASE_URL`
  y `SUPABASE_ANON_KEY` — la anon key legacy `eyJ...` de 208 chars, no la
  `sb_publishable_...`).

## Flujo de trabajo

- Rama de trabajo `lucas` → push → Lucas mergea a `main` por PR en GitHub.
- Commits en español, estilo `feat(scope): resumen` (ver `git log`).
- Verificación mínima antes de commitear: `tsc --noEmit` + build si se tocó
  el bundle + `validate-query-counts` si se tocó el motor de consultas.

## Gotchas del entorno

- La pestaña del Browser pane corre oculta (`document.hidden: true`):
  screenshots y `requestAnimationFrame` se cuelgan — verificar con
  `read_page`/`get_page_text`/`javascript_tool`, no con capturas.
- StrictMode en dev duplica efectos: los fetch de capas se ven repetidos (en
  prod es uno por capa).
- `python` no existe en esta máquina (alias de Microsoft Store); usar `node -e`.
  `gh` CLI tampoco está instalado.

## Deuda conocida (priorizada, no urgente)

1. Cero tests (la lógica pura de `lib/map-query-engine.ts` y `data/map-query.ts`
   es trivialmente testeable) y sin ESLint/CI de lint.
2. Monolitos con exceso de `useState`: `inspection-form` (542 líneas),
   `cartel-detail-panel` (502), `expediente-panel` (328) — candidatos a reducer.
3. Embeddings de `/api/normativa` corren en el request path (primera llamada
   fría descarga el modelo).
4. `xlsx@0.18.5` con CVEs sin fix; `target: es5` en tsconfig; `as unknown as`
   sin validación de esquema donde entran los GeoJSON.
