# Cartelería SMT

Visualizador estático de documentación sobre cartelería urbana para San Miguel de Tucumán.

## Desarrollo

```bash
npm install
npm run dev
```

Los datos de la biblioteca están definidos en `data/documents.ts`. Los PDF se sirven desde `public/docs`; esta versión no requiere backend, login ni variables de entorno.

## Identidad visual obligatoria

- Logo oficial: `public/logo-municipalidad-smt.png`.
- El mismo símbolo se utiliza como favicon desde `app/icon.png`.
- Colores de marca: azul `#0868F7`, celeste `#31ADEF` y amarillo `#FFDA00`.
- Toda página o módulo nuevo debe reutilizar los tokens `municipal` y `brandYellow` definidos en `tailwind.config.ts`.
- No sustituir, recolorear ni deformar el logo.
