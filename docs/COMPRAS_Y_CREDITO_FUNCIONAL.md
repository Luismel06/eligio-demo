# Compras, suplidores y ventas a crédito

Este documento fija el alcance funcional aprobado para la primera versión. La
moneda operativa es exclusivamente DOP (RD$).

## Rol Contador

El rol `ACCOUNTANT` reutiliza la membresía existente de Ramón Rivas; no crea un
quinto usuario.

- Consulta facturas de venta, productos, clientes, inventario, caja, cuentas por
  cobrar, cuentas por pagar y suplidores.
- Suplidores: solo lectura.
- Órdenes de compra: prepara y solicita órdenes de compra.
- Facturas de suplidores, pagos, confirmación de entrada y abonos de clientes:
  puede registrarlos.
- No aprueba ventas a crédito, no aprueba/emite/pausa/cancela órdenes y no
  cancela ni revierte operaciones.

Administrador, `SUPER_ADMIN` y `QORVEX_SUPER_ADMIN` conservan acceso completo.

## Suplidores y compras

Un suplidor puede suministrar varios productos y un producto puede tener
varios suplidores. La asociación conserva código del suplidor, costos neto y
con ITBIS, tiempo de entrega y suplidor principal. Los suplidores se
desactivan; no se eliminan.

Flujo de la orden de compra:

`BORRADOR → SOLICITADA → EMITIDA → PARCIALMENTE_RECIBIDA → RECIBIDA`

Al crear una orden, el sistema la mantiene internamente en `BORRADOR` mientras
se agregan o corrigen productos. El usuario no necesita guardar un borrador de
forma separada: el siguiente paso visible es **Solicitar orden de compra**.
El administrador valida la solicitud y la **emite** directamente. Los estados
anteriores `EN_REVISIÓN` y `APROBADA` se conservan solo para consultar órdenes
históricas, sin formar parte del flujo nuevo.

### Secuencia obligatoria y control de duplicados

`EMITIDA` no significa que la compra terminó: confirma que la orden fue
validada y enviada al suplidor. Para una orden vinculada, la continuación
obligatoria y visible es:

`ORDEN EMITIDA → FACTURA DEL SUPLIDOR + ENTRADA CONFIRMADA → CUENTA POR PAGAR + INVENTARIO / ORDEN PARCIAL O RECIBIDA`

- Una factura solo puede vincularse a una orden en estado `EMITIDA`; una orden
  tiene como máximo una factura vinculada.
- Al digitar la factura, puede incluir solo los productos y cantidades realmente
  facturados. Si falta una línea de la orden o cambia una cantidad, el sistema
  muestra una advertencia y exige confirmar **Actualizar factura con lo
  recibido**; la cuenta por pagar se calcula únicamente con ese total real.
- La confirmación de **Factura y entrada de mercancía** es atómica: para una
  factura nueva registra la factura, crea la cuenta por pagar, crea el
  comprobante interno de entrada y actualiza inventario en una sola operación.
  Si un paso falla, no queda una compra parcialmente registrada.
- No existe una pantalla independiente de recepciones. El comprobante interno
  se conserva dentro del detalle de la factura para auditoría, entregas
  parciales y reversión.
- Solo la confirmación de la entrada aumenta inventario y cambia la orden a
  `PARCIALMENTE_RECIBIDA` o `RECIBIDA`.
- Una orden con factura activa no se puede cancelar. Primero se cancela la
  factura (sin pagos ni entradas confirmadas) y luego la orden. La factura
  cancelada conserva el historial, por lo que una compra que deba reiniciarse
  se registra en una orden nueva.

Una factura sin orden previa sigue el flujo corto
`FACTURA + ENTRADA CONFIRMADA → CUENTA POR PAGAR + INVENTARIO`. Los pagos al
suplidor son una rama financiera opcional después de esa confirmación; no
sustituyen la entrada física.

También existen `PAUSADA` y `CANCELADA`. El retraso se calcula cuando vence la
fecha estimada y la orden aún no está recibida ni cancelada.

- Contador y administrador pueden preparar y solicitar una orden.
- Solo un administrador puede validar/emitir, pausar, reanudar o cancelar.
- Una orden admite entregas parciales, pero se vincula como máximo a una
  factura de suplidor.
- La orden se puede imprimir o guardar como PDF mediante la vista de impresión.

## Facturas de suplidores y cuentas por pagar

Una factura puede estar relacionada con una orden o registrarse sin orden. Se
impiden números de factura o NCF duplicados para el mismo suplidor.

Estados persistidos:

`BORRADOR → PENDIENTE → PARCIALMENTE_PAGADA → PAGADA`

También existe `CANCELADA`; `VENCIDA` es una condición calculada para una
factura pendiente con saldo y fecha vencida.

Los pagos admiten:

- Efectivo: queda registrado como método de pago contable y no afecta una caja ni el efectivo esperado.
- Transferencia.
- Cheque.

Un pago solo se puede registrar después de que exista al menos una entrada de
mercancía confirmada para la factura. Esta regla se valida tanto en la
interfaz como en la API para impedir saltarse el flujo.

Contador y administrador registran facturas y pagos. Solo un administrador
puede cancelar una factura o un pago. La captura OCR se hace con la cámara y
se procesa localmente en el navegador: la imagen no se sube ni se conserva.

## Entrada de mercancía e inventario

Toda factura, incluso una factura sin orden previa, se confirma desde su propio
detalle antes de incrementar el inventario. La interfaz une la factura y la
entrada; el registro interno de entrada se conserva para control y auditoría.

- Contador y administrador confirman entradas desde la factura.
- Solo un administrador cancela un borrador histórico o revierte una entrada
  confirmada.
- Se guardan cantidades ordenada, facturada y recibida.
- Una diferencia exige confirmación explícita y explicación.
- Lote, serie y vencimiento son opcionales.
- Al confirmar se actualizan stock y costos neto/con ITBIS, y se registra el
  movimiento de inventario.

Cuando cambia el costo, se elige por producto:

- Mantener el precio de venta.
- Recalcularlo con el margen existente y confirmar el precio sugerido.
- Indicar un precio manual.

Si no hay stock suficiente para revertir una entrada, o existen entradas
posteriores que hacen insegura la restauración del costo, la reversión se
bloquea y la diferencia debe resolverse mediante un ajuste auditado.

## Crédito y cuentas por cobrar

El crédito solo está disponible para clientes registrados que un administrador
haya habilitado. Cada cliente conserva límite, días por defecto, balance y
estado activo/bloqueado.

La modalidad `CONTADO` o `FIADO` se fija al crear la orden o cotización y no se
puede cambiar al llegar a caja. Descuentos y crédito son independientes.

Iniciales disponibles:

- Sin inicial.
- 30 %.
- 50 %.
- 70 %.

Vencimientos disponibles:

- Días configurados en el cliente.
- 15 días.
- 30 días.
- 45 días.
- Fecha personalizada.

El cajero u ordenanza solicita la venta fiada. No se reserva inventario hasta
que un administrador la aprueba. Si la deuda proyectada supera el límite, la
aprobación exige autorización explícita y una nota. Tras aprobar, el cajero
cobra la inicial en efectivo, tarjeta o transferencia y emite la factura.

Los abonos posteriores:

- Son únicamente en efectivo.
- Los registra un contador o administrador seleccionando una caja abierta.
- Incrementan el efectivo esperado de esa caja.
- Generan un recibo numerado y auditan al usuario.
- Solo un administrador puede anularlos, registrando el movimiento inverso.

La vista de cuentas por cobrar se ordena así:

1. Vencidas.
2. Vencen hoy.
3. Vencen dentro de los próximos 7 días.
4. Al día.
5. Pagadas.

Incluye resumen por cliente y estado de cuenta imprimible.

En una devolución de venta fiada, el importe reduce primero el saldo pendiente.
Solo se devuelve efectivo por la parte que exceda la deuda restante.

## Captura OCR de facturas de suplidores

La captura OCR es una ayuda local de revisión, nunca un registro automático.
La cámara puede reunir hasta diez páginas o imágenes temporales; se normalizan
orientación, escala, contraste y sombras antes de procesarlas en el navegador.
No se suben, adjuntan ni conservan las imágenes ni el texto bruto reconocido.

El lector diferencia explícitamente dos fechas:

- **Vencimiento comercial:** alimenta la cuenta por pagar.
- **Vigencia fiscal del NCF/e-NCF:** se conserva como referencia fiscal y nunca
  reemplaza el vencimiento comercial.

El OCR sugiere suplidor/RNC, NCF, número de factura, emisión, vencimiento,
totales y líneas de productos. Puede usar el QR como señal adicional de
verificación. Las líneas se vinculan primero por código de suplidor/SKU y luego
por nombre exacto; no se crean productos automáticamente. Cualquier dato con
baja confianza, diferencia matemática o diferencia con la orden exige revisión
explícita antes de guardar. El ingreso manual siempre permanece disponible.

### Datos inexistentes y prevención de duplicados

La captura manual y el OCR terminan en el mismo formulario de factura. Cuando
el suplidor detectado no existe, un administrador puede registrarlo sin salir
del documento, con los datos OCR como propuesta. El RNC o la cédula se validan
con la regla dominicana y son únicos dentro de la empresa. Si el documento ya
pertenece a un suplidor activo, se reutiliza; si pertenece a uno inactivo, se
ofrece reactivarlo explícitamente en vez de crear un duplicado.

Cuando una línea no coincide con el catálogo, el administrador puede seleccionar
un producto existente o crear uno desde la misma línea. La creación exige precio
de venta, costo, ITBIS y unidad; verifica coincidencias exactas por nombre, SKU
y código de barras. El nuevo producto inicia con stock cero y se vincula al
suplidor con su código y costo de factura. Así el inventario solo aumenta al
confirmar la entrada, no al capturar OCR. El contador conserva los permisos de
registro contable aprobados, pero no puede crear ni reactivar suplidores o
productos maestros.
