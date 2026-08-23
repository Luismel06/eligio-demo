# Validación de identidad DGII en producción

Esta integración valida RNC/cédulas contra el padrón oficial sincronizado de DGII en los flujos de
Caja, Clientes y Suplidores. No habilita la emisión electrónica E31/E32: RIVNU continúa emitiendo
NCF locales B01/B02 mientras no exista certificación e-CF.

## Reglas operativas

- Producción usa exclusivamente `DGII_OFFICIAL`; nunca se permiten fixtures ni seeds.
- Caja puede solicitar a Administración la aprobación manual de una identidad no encontrada.
- Clientes y Suplidores permiten registro manual explícito según sus permisos existentes, sin crear
  aprobaciones de Caja.
- Liberar una orden o dejar vencer su claim elimina cualquier snapshot fiscal; el siguiente cajero
  debe confirmar la identidad nuevamente.
- Una confirmación fiscal en Caja vence a los 30 minutos y nunca consume un NCF hasta facturar.

## Preparación y sincronización

El secreto `/opt/corestack/apps/rivnu/secrets/api.env` debe tener modo `0600`, apuntar con el rol
`rivnu_runtime` a `rivnu_production` y contener un `TAX_IDENTITY_HMAC_SECRET` independiente del JWT.
La configuración inicial se aplica sin mostrar el secreto:

```bash
./deploy/admin/configure-rivnu-dgii-production-env.sh
```

El wrapper productivo no contiene acciones destructivas. Valida secretos, URLs, imágenes, estado de
los contenedores y checksums de las migraciones aprobadas:

```bash
./deploy/scripts/rivnu-dgii-production.sh check
./deploy/scripts/rivnu-dgii-production.sh sync-official
```

Durante una promoción puede usarse una imagen candidata local antes del corte:

```bash
./deploy/scripts/rivnu-dgii-production.sh --image-tag SHA check
./deploy/scripts/rivnu-dgii-production.sh --image-tag SHA sync-official
```

La descarga acepta únicamente el ZIP HTTPS oficial de DGII, exige `Last-Modified`, limita tamaños,
rechaza rutas ZIP inseguras, verifica checksum y activa el nuevo dataset de forma atómica. Si el
checksum no cambió, no reimporta. Producción permanece en servicio durante la importación.

El cron versionado reintenta domingo y lunes a las 04:15. Debe instalarse solo después de que el
repositorio canónico esté en el release productivo y debe reemplazar la tarea del preview, no
ejecutarse junto con ella:

```bash
crontab deploy/cron/rivnu-dgii-production-sync.crontab
```

## Despliegue y reversión

Antes de cualquier migración se requiere un `pg_dump` custom-format verificado. Las migraciones se
ejecutan con `rivnu_migrator`; la API siempre conserva `rivnu_runtime`. En esta infraestructura el
migrador se conecta mediante un túnel SSH temporal a loopback de VM3, por lo que no se abre su acceso
permanente en `pg_hba.conf`.

El orden del corte compatible es API nueva y luego Web nueva. La reversión de aplicación usa el
orden contrario: Web anterior y luego API anterior. Las tablas DGII son aditivas y pueden permanecer
si se revierte solo la aplicación; restaurar la base se reserva para corrupción confirmada y debe
considerar las transacciones ocurridas después del respaldo.

Después del corte se comprueba: salud de API/Web, tres migraciones DGII finalizadas, un solo dataset
`DGII_OFFICIAL` activo, coincidencia entre `recordCount` y filas reales, ausencia de fixtures y una
consulta autenticada desde cada módulo aplicable.
