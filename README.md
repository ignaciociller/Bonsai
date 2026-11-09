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
js/cloud.js             Cuenta, cifrado de extremo a extremo y sincronización
js/config.js            URL y clave pública de Supabase
supabase/functions/quote/index.ts   Función de cotizaciones (se pega en Supabase)
js/charts.js            Gráficos SVG propios (sin librerías)
js/theme-boot.js        Aplica el tema antes de pintar
fonts/                  Manrope + Instrument Serif (incluidas, sin llamadas externas)
icons/                  Icono del bonsái (SVG y PNG)
```

Todas las rutas son relativas, así que funciona igual en `usuario.github.io/bonsai/` o en un dominio propio.

## Cuenta y sincronización (Supabase)
Opcional. Desde Ajustes → Cuenta puedes crear una cuenta para usar Bonsai en varios dispositivos.
- `js/config.js` contiene la URL del proyecto de Supabase y su clave pública *anon* (es pública por diseño).
- En Supabase sólo hay una tabla, `vaults`, con una fila por usuario y reglas (RLS) para que cada
  cuenta sólo pueda leer y escribir la suya.
- **Cifrado de extremo a extremo:** la contraseña nunca sale del dispositivo. De ella se derivan
  (PBKDF2) un secreto de acceso para Supabase y, por separado, la clave que abre tu clave de datos
  (AES‑GCM 256). Supabase sólo guarda texto cifrado.
- **Código de recuperación:** se muestra una vez al crear la cuenta. Con él y el enlace de
  «¿Olvidaste la contraseña?» puedes poner una contraseña nueva sin perder los datos.
  Sin contraseña ni código, los datos no se pueden recuperar (ni siquiera desde Supabase).
- Los cambios se suben solos y se combinan entre dispositivos (cada mes y cada activo se fusiona por
  separado; gana el cambio más reciente). La app sigue funcionando sin conexión.
- Si cambias de proyecto de Supabase, actualiza `js/config.js` y el dominio en la CSP de `index.html`.

## Precios automáticos (función «quote» de Supabase)
Los activos en modo «Automático» se buscan por nombre, ticker o ISIN y su precio se actualiza solo
al abrir la app (como mucho cada 30 min). Para ello hay una pequeña función en tu Supabase que consulta
los datos públicos de Yahoo Finance y convierte el precio a tu moneda. Requiere tener la sesión iniciada.

Instalación (una vez, desde el panel de Supabase):
1. **Edge Functions → Deploy a new function → Via Editor**.
2. Nombre: `quote` (exactamente así).
3. Borra el código de ejemplo y pega el de `supabase/functions/quote/index.ts`.
4. **Deploy**. Deja activada la verificación de JWT (viene así por defecto).

Yahoo Finance no tiene una API oficial: si algún día deja de responder, los activos automáticos
avisan de que el precio no se ha actualizado y puedes pasarlos a «Lo pongo yo» desde «Editar activo».

## Inversiones
- **Último mes**: rendimiento de los últimos 30 días sin contar aportaciones nuevas.
- **Sobre lo invertido**: (valor − aportado) / aportado.
- **Aportación periódica** (en la ficha de cada activo): se suma sola en cada fecha (semanal, mensual,
  trimestral o anual). En activos automáticos compra participaciones al último precio. Si la enlazas con
  una etiqueta de inversión, el apartado «Invertido» del mes vendrá ya relleno.
- **Recordatorios**: si un activo manual no tiene valor de mercado del último periodo (el de su
  aportación, o un mes), aparece un aviso en Inversiones y un punto en la pestaña.

## Privacidad y seguridad
- Sin cuenta, los datos se guardan **sólo en el navegador del dispositivo** (`localStorage`). No hay analítica.
  La política de seguridad de contenido (CSP) sólo permite conectar con tu proyecto de Supabase.
- Con el **PIN** activado (Ajustes → Seguridad) los datos se cifran con AES‑GCM de 256 bits; la clave se deriva
  del PIN con PBKDF2 (310.000 iteraciones). La app se bloquea tras 1 minuto en segundo plano.
  Usa 6 cifras o más: un PIN corto protege frente a alguien que coja el móvil, pero no frente a un análisis a fondo.
- Si olvidas el PIN no hay recuperación posible: exporta copias (Ajustes → Datos) de vez en cuando.
- Sin cuenta, cada dispositivo tiene sus propios datos; con cuenta, se sincronizan cifrados.

## Cómo calcula las cosas
- **Ahorro del mes** = ingresos − gastos.
- **Invertido**: dinero que apartas cada mes (fondos, plan de pensiones…). No es gasto ni ingreso: sigue
  en tu patrimonio, pero deja de estar disponible. Patrimonio = **Disponible + Invertido**.
  En Ajustes puedes indicar cuánto de tu patrimonio inicial ya estaba invertido.
- **Media mensual por categoría**: total de cada categoría entre el número de meses registrados, comparado
  con el periodo que tengas seleccionado.
- **Patrimonio** = patrimonio inicial + ahorro acumulado de todos los meses + ganancia de las inversiones
  (valor − aportado). Las aportaciones a inversiones no se apuntan como gasto: es dinero que ya forma parte del ahorro.
- **Rendimiento de inversiones** por periodo (1S, 1M, 3M, 1A, Todo) sin contar nuevas aportaciones.
  Los valores se introducen a mano (botón *Actualizar*), porque desde una web estática no hay una fuente
  de cotizaciones gratuita y fiable sin clave de API.
- En los importes del formulario puedes escribir sumas: `45+30,5+12`.
