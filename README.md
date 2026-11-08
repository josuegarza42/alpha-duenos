# Alpha Dueños

Una mesa de trabajo para proponer mejoras del gimnasio y acordar las responsabilidades de los tres socios de Alpha Gym: Josue Garza, Brandon y Toño.

Página: https://josuegarza42.github.io/alpha-duenos/

## Qué permite

- Acceso con una clave privada por socio, verificada en la base de datos.
- Proponer mejoras de equipo, instalaciones, servicios y experiencia de los clientes en **Nuevas propuestas**, con descripción, beneficio y costo opcional, sin asignar roles.
- Consultar **En discusión**, **Aprobadas** y **Negadas** con el contenido completo, los votos y los comentarios conservados. Las decisiones anteriores mantienen su resultado.
- Apelar decisiones aprobadas o negadas con un motivo. La apelación abre una nueva discusión con votos independientes; dos votos coincidentes fijan el nuevo resultado. La decisión vigente se mantiene mientras se revisa, y todas las rondas anteriores siguen disponibles en el historial. Se evita abrir apelaciones duplicadas o de versiones superadas.
- Proponer funciones con titular, área, frecuencia, alcance y entregable; distinguir obligaciones como socio, trabajo remunerado y apoyo puntual.
- Votar nuevas funciones, cambios de responsable o alcance y retiros. Un socio tiene un voto; tres votos a favor aprueban, dos a favor y uno en contra abren una discusión, y dos en contra niegan la propuesta. Dos votos a favor sin el tercer voto mantienen la propuesta abierta. Proponer no cuenta como votar.
- Cambiar el voto mientras la decisión siga abierta. La unanimidad a favor o dos votos en contra cierran la votación inicial. En discusión se conservan los votos iniciales y los comentarios; una segunda votación con motivo requiere dos socios para aprobar o negar.
- Mantener vigente una función mientras se vota su cambio o retiro. Los tres tienen permisos de administrador y pueden cancelar propuestas pendientes; las discusiones se resuelven por votación final; el historial se conserva.
- Definir una penalización por incumplimiento y una métrica con indicador, meta numérica, unidad y criterio mínimo o máximo. Se aprueban con la misma mayoría que la función y se incluyen en el PDF.
- Registrar resultados por periodo y evidencia. Cada resultado conserva su meta y responsable originales; para corregirlo se añade otro registro.
- Registrar incumplimientos con fecha y evidencia, y documentar su resolución o descarte. Se conserva la penalización vigente al registrarlos. No se generan cobros automáticos.
- Administrar las claves de los tres desde **Accesos**. Cada clave debe ser distinta y tener al menos seis caracteres; cambiarla invalida el enlace anterior y cierra las otras sesiones de ese socio.
- Generar versiones inmutables del acuerdo, con votos y un PDF para imprimir y firmar a mano los tres. Debe existir al menos una función aprobada y no quedar votaciones o discusiones de funciones abiertas. Las mejoras del gimnasio se llevan por separado del acuerdo de responsabilidades. Descargar el PDF no lo marca como firmado.
- Eliminar propuestas, funciones retiradas, registros de incumplimiento y acuerdos con una papelera recuperable. Las funciones vigentes se retiran mediante una propuesta aprobada; quitar una penalización acordada también se vota. Restaurar no reactiva funciones ni reabre votos. Eliminar un acuerdo no invalida documentos ya firmados.
- Ver las funciones aprobadas y las propuestas pendientes en tres columnas, con una distinción visible de estado.
- Filtrar las propuestas por responsable y ver cuántas tiene cada socio.
- Descargar un respaldo JSON sin claves ni sesiones, incluidos los elementos en papelera.

## Alojamiento

**GitHub Pages** sirve la interfaz estática desde `site/`. **Supabase** guarda los datos compartidos en Postgres. El PDF se genera en el navegador con jsPDF y tipografía local. No se necesita Railway ni un servidor propio.

El repositorio público contiene únicamente código. Las responsabilidades, votos y acuerdos viven en el esquema privado `alpha_private`. RLS y permisos impiden la lectura directa. La única función pública, `alpha_api`, valida la sesión y ejecuta las operaciones. La clave publicable de Supabase identifica el proyecto y es apta para el navegador; nunca se usa una clave `service_role` en la página.

Las claves iniciales se generan al azar y se pueden simplificar desde Accesos; solo sus hashes SHA-256 se almacenan en la base. Las sesiones aleatorias duran 30 días. La página consulta cambios cada diez segundos y al regresar a ella. Las decisiones se serializan dentro de una transacción para evitar resultados contradictorios con votos simultáneos.

## Configurar una instancia

1. Crear un proyecto Supabase en el plan gratuito. Mantener `alpha_private` fuera de los esquemas expuestos por la API.
2. Ejecutar `python3 tools/provision.py`. Conserva las claves existentes y produce `.private/supabase-setup.sql` , `.private/accesos-socios.html` y `.private/ACCESOS ALPHA DUENOS.txt`.
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

Las pruebas ejecutan el SQL de producción sin cambios en Postgres mediante PGlite, con la extensión real `pgcrypto` y el rol `anon`. Cubren identidad, permisos, unanimidad, discusión 2–1, comentarios, mayoría final, apelaciones de mejoras, funciones, cambios y retiros, restauración de versiones previas, propuestas de mejoras, voto único, cambios y retiros, cancelación, versiones inmutables y ausencia de credenciales en las exportaciones.

Si se cambiaron claves desde la web, actualizar primero el archivo local privado `.private/access.json` y regenerar los enlaces con `python3 tools/provision.py`. El administrador con los accesos locales vigentes puede ejecutar `npm run verify:live` para comprobar los tres accesos contra Supabase, el cierre de sesión y que el esquema privado no esté expuesto. Esta verificación no crea propuestas ni votos.

Para una vista previa desechable, abrir dos terminales:

```sh
npm run preview
python3 -m http.server 8018 --directory site --bind 127.0.0.1
```

Abrir `http://127.0.0.1:8018`. Las claves de prueba son `test-josue`, `test-brandon` y `test-tono`. Los ejemplos y votos de esta vista previa existen solo en memoria local y nunca se publican en la base real.

## Datos privados y mantenimiento

`.private/`, `tmp/`, `output/` y las bases locales están ignoradas por Git. El comando de provisión no rota las claves existentes. Si se pierde una clave, otro socio puede cambiarla desde Accesos. Si los tres pierden sus claves, el administrador del proyecto puede generar otra, reemplazar su hash en `alpha_private.partners` y revocar las sesiones de ese socio en `alpha_private.sessions`, desde el panel privado de Supabase.

Las dependencias del PDF y sus licencias están incluidas en `site/vendor/` y `site/fonts/` para evitar depender de una CDN al imprimir.
