# Qyrex Obfuscator (GitHub Pages)

Ofuscador polimórfico de Lua/Luau reconstruido del pack original.

## Uso en GitHub Pages

1. Crea un repo (público o privado).
2. Sube estos archivos a la rama `main` (o `gh-pages`):
   - `index.html`
   - `obfuscator.js`
   - `README.md` (opcional)
3. En el repo: **Settings → Pages → Source: Deploy from a branch → main / root**.
4. Espera 1–2 minutos y abre la URL que te da GitHub.

Todo corre en el navegador. No hay backend.

## Archivos

| Archivo         | Descripción                          |
|-----------------|--------------------------------------|
| `index.html`    | Interfaz web                         |
| `obfuscator.js` | Lógica del packer (localObfuscate)   |

## Nota

El Env Gate es opcional (checkbox en la UI). El packer no reescribe tokens del código fuente.
