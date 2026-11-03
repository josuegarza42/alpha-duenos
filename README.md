# Alpha Dueños

Una mesa de trabajo para acordar las responsabilidades de los tres socios de Alpha Gym: Josue Garza, Brandon y Toño.

Página: https://josuegarza42.github.io/alpha-duenos/

## Qué permite

- Acceso con una clave privada por socio, verificada en la base de datos.
- Proponer funciones con titular, área, frecuencia, alcance y entregable; distinguir obligaciones como socio, trabajo remunerado y apoyo puntual.
- Votar nuevas funciones, cambios de responsable o alcance y retiros. Un socio tiene un voto; dos votos a favor aprueban y dos en contra rechazan. Proponer no cuenta como votar.
- Cambiar el voto mientras la decisión siga abierta. La mayoría cierra la votación y fija el resultado.
- Mantener vigente una función mientras se vota su cambio o retiro. Solo quien propone puede cancelar su propuesta abierta; el historial se conserva.
- Generar versiones inmutables del acuerdo, con votos y un PDF para imprimir y firmar a mano los tres. Debe existir al menos una función aprobada y no quedar votaciones abiertas. Descargar el PDF no lo marca como firmado.
- Descargar un respaldo JSON sin claves ni sesiones.

## Alojamiento

**GitHub Pages** sirve la interfaz estática desde `site/`. **Supabase** guarda los datos compartidos en Postgres. El PDF se genera en el navegador con jsPDF y tipografía local. No se necesita Railway ni un servidor propio.

El repositorio público contiene únicamente código. Las responsabilidades, votos y acuerdos viven en el esquema privado `alpha_private`. RLS y permisos impiden la lectura directa. La única función pública, `alpha_api`, valida la sesión y ejecuta las operaciones. La clave publicable de Supabase identifica el proyecto y es apta para el navegador; nunca se usa una clave `service_role` en la página.

Las claves personales se generan al azar; solo sus hashes SHA-256 se almacenan en la base. Las sesiones aleatorias duran 30 días. La página consulta cambios cada diez segundos y al regresar a ella. Las decisiones se serializan dentro de una transacción para evitar resultados contradictorios con votos simultáneos.

## Configurar una instancia

1. Crear un proyecto Supabase en el plan gratuito. Mantener `alpha_private` fuera de los esquemas expuestos por la API.
2. Ejecutar `python3 tools/provision.py`. Conserva las claves existentes y produce `.private/supabase-setup.sql` y `.private/accesos-socios.html`.
3. Ejecutar el SQL privado de configuración en el editor SQL del proyecto. Incluye `supabase/schema.sql` y los tres hashes privados. No subir ese archivo a GitHub.
4. Poner la URL del proyecto y su clave **publishable** o **anon** en `site/config.js`. No poner contraseñas de base de datos, claves secretas ni claves de socios en ese archivo.
5. Activar GitHub Pages con origen **GitHub Actions**. El workflow publica exclusivamente `site/` al hacer push a `main`.
6. Entregar a cada socio únicamente su enlace personal desde el HTML privado. Quien tenga ese enlace podrá actuar como el socio correspondiente.

Los enlaces personales utilizan un fragmento `#clave=` que la página retira al abrirse. El sitio no carga analítica ni recursos de terceros. La sesión se guarda en el navegador; usar **Salir** en dispositivos compartidos.

El plan gratuito de Supabase puede pausar proyectos inactivos; se reanudan desde su panel. Exportar respaldos periódicamente desde la página y conservar los PDF firmados por separado.

## Desarrollo y verificación

```sh
npm ci --ignore-scripts
npm test
node --check site/app.js
node --check site/pdf.js
```

Las pruebas ejecutan el SQL de producción sin cambios en Postgres mediante PGlite, con la extensión real `pgcrypto` y el rol `anon`. Cubren identidad, permisos, mayoría, voto único, cambios y retiros, cancelación, versiones inmutables y ausencia de credenciales en las exportaciones.

El administrador con los accesos locales puede ejecutar `npm run verify:live` para comprobar los tres accesos contra Supabase, el cierre de sesión y que el esquema privado no esté expuesto. Esta verificación no crea propuestas ni votos.

Para una vista previa desechable, abrir dos terminales:

```sh
npm run preview
python3 -m http.server 8018 --directory site --bind 127.0.0.1
```

Abrir `http://127.0.0.1:8018`. Las claves de prueba son `preview-access-only-josue-not-production`, `preview-access-only-brandon-not-production` y `preview-access-only-tono-not-production`. Los ejemplos y votos de esta vista previa existen solo en memoria local y nunca se publican en la base real.

## Datos privados y mantenimiento

`.private/`, `tmp/`, `output/` y las bases locales están ignoradas por Git. El comando de provisión no rota las claves existentes. Si se pierde una clave, el administrador puede generar otra, reemplazar su hash en `alpha_private.partners` y revocar las sesiones de ese socio en `alpha_private.sessions`, desde el panel privado de Supabase.

Las dependencias del PDF y sus licencias están incluidas en `site/vendor/` y `site/fonts/` para evitar depender de una CDN al imprimir.
