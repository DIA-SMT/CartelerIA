# Cartelería SMT

Visualizador estático de documentación sobre cartelería urbana para San Miguel de Tucumán.

## Desarrollo

```bash
npm install
npm run dev
```

Los datos de la biblioteca están definidos en `data/documents.ts`. Los PDF se sirven desde `public/docs`.

## Supabase

La aplicación usa Supabase cuando las tablas están disponibles y vuelve automáticamente a los datos estáticos si la conexión falla.

1. Copiar `.env.example` como `.env.local` y completar URL y clave anónima.
2. Ejecutar `supabase/schema.sql` en el SQL Editor de Supabase.
3. Ejecutar `supabase/seed_part_1.sql`, `seed_part_2.sql` y `seed_part_3.sql`, en ese orden, para importar los 249 carteles. `seed.sql` contiene la misma carga completa en un único archivo.
4. Reiniciar `npm run dev`.

La escritura sobre `carteles` exige sesión con rol operativo (migración 10); el rol anónimo solo lee. Las cuentas nuevas nacen con rol `consulta`: los ascensos los hace un administrador en `public.perfiles`. Recordá deshabilitar el registro público en Supabase Dashboard → Authentication → Sign In / Up.

## Identidad visual obligatoria

- Logo oficial: `public/logo-municipalidad-smt.png`.
- El mismo símbolo se utiliza como favicon desde `app/icon.png`.
- Colores de marca: azul `#0868F7`, celeste `#31ADEF` y amarillo `#FFDA00`.
- Toda página o módulo nuevo debe reutilizar los tokens `municipal` y `brandYellow` definidos en `tailwind.config.ts`.
- No sustituir, recolorear ni deformar el logo.
