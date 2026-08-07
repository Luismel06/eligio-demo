# Endurecimiento basado en OWASP

Este proyecto usa una primera capa de endurecimiento basada en recomendaciones OWASP para una plataforma interna. Este documento describe controles concretos; no representa una certificacion de cumplimiento OWASP.

## Configuracion obligatoria

En produccion el API se niega a iniciar cuando:

- `JWT_SECRET` falta, usa un placeholder conocido o tiene menos de 32 caracteres.
- `CORS_ORIGIN` esta vacio, contiene `*`, conserva un placeholder o incluye un origen sin HTTPS.

Genera un secreto independiente del secreto de Supabase:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Acceso interno

`INTERNAL_ALLOWED_IPS` permite limitar el acceso al web y al API por IP publica o rango CIDR.

Ejemplo:

```env
INTERNAL_ALLOWED_IPS="203.0.113.10,198.51.100.0/24"
```

Si la variable esta vacia, no se aplica restriccion por IP. Esto mantiene comodo el desarrollo local.

## API

- Helmet habilita cabeceras HTTP defensivas.
- `X-Robots-Tag: noindex, nofollow` evita indexacion accidental.
- Rate limit global reduce abuso general del API.
- Rate limit especifico para `/auth/login` reduce fuerza bruta de credenciales.
- La captura OCR desde teléfono usa un token opaco de un solo uso, almacenado solo como hash, con vigencia de 10 minutos. Sus dos rutas públicas están limitadas a 30 intentos por IP cada 10 minutos y no aceptan imágenes.
- CORS solo acepta los origenes configurados en `CORS_ORIGIN`.
- El body parser tiene limites configurables con `API_JSON_BODY_LIMIT` y `API_FORM_BODY_LIMIT`.
- Importaciones aceptan solo `.xlsx`, con limite de 10 MB.
- Las respuestas de autenticacion usan `Cache-Control: no-store`.
- El inicio de sesion limita email y contrasena antes de ejecutar bcrypt.

## Web

- `poweredByHeader` esta desactivado.
- Se aplica CSP con nonce unico por solicitud, `strict-dynamic`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y `X-Robots-Tag`.
- `/robots.txt` bloquea indexacion.
- El middleware valida `INTERNAL_ALLOWED_IPS` antes de resolver login o rutas protegidas.
- `/ocr/capture/:id` es una excepción deliberada al filtro IP para permitir abrir el QR desde un teléfono. No entrega datos de negocio sin el token efímero que viaja en el fragmento de la URL y se elimina del navegador al leerlo.
- La cookie indicadora de sesion usa `SameSite=Strict` y `Secure` sobre HTTPS. No contiene el JWT.

## Sesion actual

El access token todavia se conserva en `localStorage` porque web y API estan desplegados como proyectos/origenes separados y el navegador debe enviar `Authorization: Bearer`. La CSP con nonce reduce el riesgo XSS, pero no elimina el riesgo inherente de un token accesible desde JavaScript.

La migracion recomendada es introducir un Backend for Frontend bajo el mismo origen del web y guardar access/refresh tokens exclusivamente en cookies `HttpOnly`, `Secure` y `SameSite=Strict`. No se debe afirmar que esta migracion esta aplicada hasta completar ese cambio arquitectonico.

## Produccion

La proteccion en memoria del API complementa, pero no sustituye, controles de borde. En ambos proyectos Vercel se debe:

1. Configurar una regla de rate limit para `/auth/login`.
2. Configurar una regla de rate limit general para el API.
3. Activar alertas del Firewall.
4. Aplicar allowlist/VPN/Zero Trust si el sistema seguira siendo interno.

Opciones de cierre:

- Vercel Firewall con allowlist de IPs.
- VPN corporativa y permitir solo la salida publica de esa VPN.
- Cloudflare Access, Tailscale, Zero Trust o una capa similar delante de Vercel.

## Verificacion antes de cada despliegue

```powershell
pnpm audit --prod
pnpm lint
pnpm build
```

Despues del despliegue, comprobar cabeceras, reglas del Firewall, variables de entorno y que el login responda `429` al superar el limite configurado. Nunca ejecutar pruebas de fuerza bruta contra datos reales sin una ventana de mantenimiento.
