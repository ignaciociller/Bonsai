# Bonsai 🌱

Seguimiento mensual de ingresos, gastos e inversiones, pensado para el móvil.
Es una web estática (HTML + CSS + JavaScript, sin dependencias ni compilación) lista para GitHub Pages,
y se puede instalar en el teléfono como app (PWA) que funciona sin conexión.

## Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub (por ejemplo `bonsai`).
2. Sube **el contenido** de esta carpeta a la raíz del repositorio (que `index.html` quede en la raíz).
   ```bash
   git init && git add . && git commit -m "Bonsai"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/bonsai.git
   git push -u origin main
   ```
3. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `/ (root)`** → Save.
4. En un minuto estará en `https://TU_USUARIO.github.io/bonsai/`.

### Instalarla en el móvil
- **iPhone (Safari):** botón Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome):** menú ⋮ → *Instalar aplicación*.

### Actualizar la app
Tras cambiar archivos, sube la versión en `sw.js` (`const CACHE = 'bonsai-v1.0.1'`) para que los
móviles descarguen la versión nueva. Si añades archivos, inclúyelos también en la lista `ASSETS`.

## Estructura

```
index.html              Pantalla única de la app
manifest.webmanifest    Datos de instalación (nombre, icono, colores)
sw.js                   Service worker: modo sin conexión
.nojekyll               Indica a GitHub Pages que sirva los archivos tal cual
css/styles.css          Estilos (tema claro/oscuro, gris + verde)
js/app.js               Pantallas: Resumen, Registrar mes, Inversiones y Ajustes
js/store.js             Almacenamiento local y cifrado con PIN
js/charts.js            Gráficos SVG propios (sin librerías)
js/theme-boot.js        Aplica el tema antes de pintar
fonts/                  Manrope + Instrument Serif (incluidas, sin llamadas externas)
icons/                  Icono del bonsái (SVG y PNG)
```

Todas las rutas son relativas, así que funciona igual en `usuario.github.io/bonsai/` o en un dominio propio.

## Privacidad y seguridad
- Los datos se guardan **sólo en el navegador del dispositivo** (`localStorage`). No hay servidor ni analítica.
  La política de seguridad de contenido (CSP) impide que la página se conecte a ningún otro sitio.
- Con el **PIN** activado (Ajustes → Seguridad) los datos se cifran con AES‑GCM de 256 bits; la clave se deriva
  del PIN con PBKDF2 (310.000 iteraciones). La app se bloquea tras 1 minuto en segundo plano.
  Usa 6 cifras o más: un PIN corto protege frente a alguien que coja el móvil, pero no frente a un análisis a fondo.
- Si olvidas el PIN no hay recuperación posible: exporta copias (Ajustes → Datos) de vez en cuando.
- Los datos son de cada dispositivo/navegador: el móvil y el ordenador no se sincronizan solos. Para pasar
  los datos de uno a otro, exporta la copia en uno e impórtala en el otro.

## Cómo calcula las cosas
- **Ahorro del mes** = ingresos − gastos.
- **Patrimonio** = patrimonio inicial + ahorro acumulado de todos los meses + ganancia de las inversiones
  (valor − aportado). Las aportaciones a inversiones no se apuntan como gasto: es dinero que ya forma parte del ahorro.
- **Rendimiento de inversiones** por periodo (1S, 1M, 3M, 1A, Todo) sin contar nuevas aportaciones.
  Los valores se introducen a mano (botón *Actualizar*), porque desde una web estática no hay una fuente
  de cotizaciones gratuita y fiable sin clave de API.
- En los importes del formulario puedes escribir sumas: `45+30,5+12`.
