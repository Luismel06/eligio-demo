# Validación del OCR de suplidores

El reconocimiento se ejecuta localmente en el navegador: corrección de iluminación,
reconstrucción de columnas por posición y relecturas acotadas del encabezado, tabla y
totales. Las pasadas alternativas se comparan; no se concatenan como productos nuevos.
La fotografía no se sube al servidor. La transferencia móvil existente conserva únicamente
los datos/texto reconocidos según su política de caducidad.

Las coincidencias por código están vinculadas al suplidor. Una diferencia de medida,
modelo o descripción exige confirmación; una semejanza textual no se presenta como
coincidencia exacta. Un producto faltante puede registrarse desde su línea y continuar
en la factura, después de elegir el suplidor. Docenas/cientos y otras presentaciones
distintas requieren confirmar la conversión antes de guardar; el alta no suma inventario.

## Regresiones sin base de datos

Desde la raíz, con Node 22 y dependencias instaladas:

```bash
packages/database/node_modules/.bin/tsx --test apps/web/test/*.test.ts
node --test apps/web/test/supplier-invoice-product-matching.test.cjs
packages/database/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test apps/api/test/supplier-invoice-ocr-precision.test.ts
pnpm lint
```

La integración optativa `apps/api/test/supplier-invoice-ocr-preview.integration.ts`
usa PostgreSQL real, crea/edita nueve líneas dentro de una transacción y la revierte
incluso si las verificaciones fallan. Requiere `NODE_ENV=test`,
`RIVNU_PREVIEW_GUARD=RIVNU_DGII_PREVIEW_ONLY`,
`RIVNU_OCR_PREVIEW_INTEGRATION_CONFIRM=rollback-only-preview` y la conexión aislada
en `RIVNU_OCR_PREVIEW_INTEGRATION_DATABASE_URL`; no carga `.env`. Sin esa URL se omite.
Primero ejecutar `pnpm --filter @qorvex/database build` para generar y sincronizar
el cliente Prisma. Nunca proporcionar una conexión de producción a pruebas.

La prueba optativa con la fotografía original exige Playwright y Chromium instalados
en un entorno de pruebas. Si Playwright está fuera del repositorio, indica su módulo
con `RIVNU_PLAYWRIGHT_MODULE`. No instala paquetes ni modifica producción:

```bash
node apps/web/test/supplier-invoice-ocr.browser.cjs 'docs/factura test.jpeg'
```

Esta prueba levanta un servidor temporal solo en loopback, ejecuta el motor real y
comprueba los nueve productos, códigos, cantidades, ITBIS, importes y fechas contra
valores transcritos manualmente. Falla si se intenta subir algún contenido. Requiere
conexión para descargar los recursos públicos del motor/modelos; no un proveedor de
OCR remoto. La foto es privada y está excluida del contexto de Docker, igual que las
fixtures. No debe publicarse como recurso de la aplicación.

## Contabilidad y revisión

Cuando el precio impreso incluye ITBIS, se calcula el costo neto con seis decimales,
pero bases, impuestos y totales de cada línea se redondean a centavos. La migración
`20260909000000_supplier_invoice_unit_cost_precision` amplía esa columna y conserva
los registros históricos y las restricciones contables.

Una lectura incompleta no inventa costos, cantidades ni exenciones. Se muestra para
revisión. Validar una foto concreta no garantiza exactitud en fotografías borrosas,
recortadas u otros formatos: siempre debe revisarse el documento antes de registrar
la cuenta por pagar y confirmar la entrada de mercancía.

El destino de estas pruebas es el preview aislado (`3101`/`4101`, base
`rivnu_dgii_preview`). No ejecutar `seed`, reinicios de esquema ni limpiezas de datos
para actualizar el OCR. Producción requiere un despliegue independiente autorizado.
