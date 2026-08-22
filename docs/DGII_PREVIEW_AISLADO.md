# Preview aislado de validación DGII

Este entorno existe para probar Caja, Clientes y Suplidores sin usar la base ni los contenedores de producción. Expone solamente:

- Web: `127.0.0.1:3101`
- API: `127.0.0.1:4101`
- PostgreSQL: sin puerto publicado

Usa el proyecto Compose `rivnu-dgii-preview`, la base `rivnu_dgii_preview`, el volumen `rivnu-dgii-preview-pgdata` y nombres de contenedor exclusivos. Los secretos viven fuera del repositorio en `/opt/corestack/apps/rivnu/secrets/preview-dgii`.

## Preparación inicial

Ejecuta todo desde la raíz del repositorio en VM2. No copies `.env`, `api.env` ni credenciales de producción.

```bash
./deploy/scripts/rivnu-dgii-preview.sh init-secrets
./deploy/scripts/rivnu-dgii-preview.sh check
./deploy/scripts/rivnu-dgii-preview.sh build
./deploy/scripts/rivnu-dgii-preview.sh initialize --confirm-preview-reset
```

`initialize` reinicia el esquema de la base aislada, reaplica sus migraciones, carga el seed de demostración, configura el emisor RIVNU con `40220429126`, alinea sus secuencias fiscales con vigencia hasta el cierre del próximo año calendario, instala un padrón DGII sintético y levanta Web/API. También comprueba que el seed haya dejado al menos una caja abierta y una orden lista para Caja. La confirmación literal es obligatoria porque recrea los datos del preview. La API y todas las tareas con acceso a datos rechazan `NODE_ENV=production` y cualquier URL que no apunte exactamente a `rivnu-dgii-preview-db:5432/rivnu_dgii_preview`; Web se ejecuta con su modo normal de producción, pero solo en el puerto local del preview.

Credenciales demo creadas por el seed; todos usan `DemoPassword123!`:

- Administración: `admin@rivnu.local`
- Caja: `cajero@rivnu.local`
- Toma de órdenes: `ordenanza@rivnu.local`

No se utiliza ni se copia información de clientes, ventas o usuarios de producción.

## Flujo de validación manual

Cuando un RNC o una cédula tiene un formato válido pero no puede verificarse con el padrón activo,
RIVNU no lo presenta como verificado por DGII. En Caja, Clientes o Suplidores, el usuario debe:

1. Digitar la razón social o el nombre fiscal manual.
2. Enviar una solicitud de validación al administrador.
3. Esperar la decisión, que se actualiza automáticamente en la misma pantalla.

Los administradores reciben una alerta en la campana y revisan las solicitudes en
`/tax-identity-approvals`. Allí pueden corregir el nombre fiscal, aprobarlo o rechazarlo con una
nota. La aprobación crea una autorización de uso único, vinculada al documento y al contexto que
la originó, y con vencimiento corto. No se solicita ni se comparte la contraseña del administrador.

Una aprobación se guarda y se muestra como **autorización manual por administrador**; nunca como
una verificación de DGII. En Caja, el nombre operativo recibido desde Toma de órdenes se conserva
como referencia independiente y no se crea automáticamente un registro en el módulo Clientes.

## Acceso desde otra computadora

Los puertos escuchan solo en loopback. Abre un túnel SSH hacia VM2:

```bash
ssh -N \
  -L 3101:127.0.0.1:3101 \
  -L 4101:127.0.0.1:4101 \
  USUARIO@VM2
```

Luego visita `http://127.0.0.1:3101/login`. Mantén el túnel abierto durante la prueba.

## Operación diaria

```bash
# Validar secretos, imágenes, guardas, recursos, servicios, puertos, redes y volumen
./deploy/scripts/rivnu-dgii-preview.sh check

# Aplicar migraciones y levantar el preview sin reiniciar sus datos
./deploy/scripts/rivnu-dgii-preview.sh up

# Consultar estado o logs
./deploy/scripts/rivnu-dgii-preview.sh status
./deploy/scripts/rivnu-dgii-preview.sh logs

# Detener o retirar los contenedores sin borrar datos
./deploy/scripts/rivnu-dgii-preview.sh stop
./deploy/scripts/rivnu-dgii-preview.sh down
```

Para recrear los datos de prueba:

```bash
./deploy/scripts/rivnu-dgii-preview.sh seed --confirm-preview-reset
./deploy/scripts/rivnu-dgii-preview.sh fixture
./deploy/scripts/rivnu-dgii-preview.sh up
```

El script no ofrece una acción para borrar el volumen. Si en el futuro se necesita eliminarlo, primero debe verificarse de forma independiente que el objetivo sea exactamente `rivnu-dgii-preview-pgdata`. `stop` y `down` también respetan el bloqueo del padrón: rechazan la operación si hay una fixture, importación o sincronización en curso.

## Registros sintéticos DGII

La fixture usa nombres y estados fiscales sintéticos. Incluye identificadores reservados para pruebas y el documento del emisor que fue proporcionado para configurar RIVNU; no representa una respuesta real de DGII:

| Documento     | Resultado esperado                |
| ------------- | --------------------------------- |
| `101010632`   | Empresa demo activa/verificada    |
| `40220429126` | Persona demo activa/verificada    |
| `02600787341` | Persona demo suspendida/no activa |

Un documento con checksum válido que no esté en esta lista permite probar “No encontrado”. La fixture solo puede ejecutarse con `DGII_ALLOW_TEST_FIXTURE=true` y `NODE_ENV=development`; ambos requisitos se aplican dentro del contenedor aislado.

La fixture es exclusivamente para este preview. Nunca debe cargarse en producción ni presentarse como información real de DGII.

## Sincronización del padrón oficial

DGII publica el listado de contribuyentes en TXT/CSV y comunica que se actualiza semanalmente. El preview descarga únicamente el [ZIP oficial publicado por DGII](https://dgii.gov.do/app/WebApps/Consultas/RNC/DGII_RNC.zip); no consulta el formulario web ni usa endpoints privados.

Para sincronizarlo en el momento:

```bash
./deploy/scripts/rivnu-dgii-preview.sh sync-official
```

El comando exige HTTPS y el host fijo de DGII, limita el ZIP a 64 MiB, valida que contenga solamente `DGII_RNC.TXT`, limita el TXT descomprimido, usa `Last-Modified` como fecha oficial, incorpora un fragmento del SHA-256 en la versión, comprueba estructura/cantidad de registros y activa el nuevo dataset de manera atómica. Si falla una validación, el padrón activo anterior permanece disponible.

Justo antes de ejecutar una fixture o una importación, el script pausa temporalmente API y Web para mantener el presupuesto del proyecto. Al terminar —también cuando el trabajo falla— restaura solamente los servicios que estaban ejecutándose antes de la operación. La interrupción afecta únicamente este preview local; producción no participa.

VM2 utiliza un cron versionado para ejecutar esa sincronización semanalmente. Antes de instalarlo se debe confirmar que el usuario no tenga otras tareas, porque `crontab ARCHIVO` reemplaza su tabla completa:

```bash
crontab -l
crontab deploy/cron/rivnu-dgii-preview-sync.crontab
crontab -l
```

La tarea corre los domingos a las 04:15 de `America/Santo_Domingo`. El propio script impide que dos importaciones compitan. Sus ejecuciones se consultan con:

```bash
journalctl -t rivnu-dgii-preview-sync --since '14 days ago'
```

### Importación manual del TXT oficial

Cuando se obtenga el TXT por el canal oficial permitido, puede cargarse manualmente al preview indicando la fecha real de actualización del archivo:

```bash
./deploy/scripts/rivnu-dgii-preview.sh import-official \
  /ruta/segura/DGII_RNC.TXT \
  2026-08-21T12:00:00Z \
  dgii-2026-08-21

./deploy/scripts/rivnu-dgii-preview.sh up
```

La ruta debe ser absoluta y apuntar a un archivo regular, legible y no enlazado. El archivo se monta en modo lectura dentro de un proceso transitorio protegido por las mismas guardas de base del preview. La versión es opcional.

La importación manual queda como alternativa operativa. Ejecutar `fixture` después de importar el TXT vuelve a activar el dataset sintético; `sync-official` o volver a importar el mismo TXT oficial reactiva el dataset oficial.

## Límites de recursos

En ejecución normal, el presupuesto máximo del preview es aproximadamente 1 GiB de RAM y 1 CPU:

- PostgreSQL: 256 MiB / 0.25 CPU
- API: 384 MiB / 0.45 CPU
- Web: 384 MiB / 0.30 CPU

Los trabajos de migración, seed, fixture e importación son transitorios y no permanecen ejecutándose. Fixture e importación se ejecutan con API/Web pausados, por lo que su máximo simultáneo es PostgreSQL más un trabajo transitorio (640 MiB o menos con los límites actuales), no 1 GiB más otro contenedor.

El driver local de Docker no ofrece una cuota dura portable para el volumen PostgreSQL. El importador conserva un número limitado de versiones anteriores y elimina las más antiguas; aun así, se debe vigilar el crecimiento junto con imágenes y caché:

```bash
docker system df
docker exec rivnu-dgii-preview-db \
  psql -U rivnu_preview -d rivnu_dgii_preview -c \
  "SELECT pg_size_pretty(pg_database_size(current_database()));"
```

No elimines volúmenes ni imágenes desde una tarea automática. Cualquier limpieza debe resolver primero objetivos exactos y confirmar que no son los contenedores activos de producción.
