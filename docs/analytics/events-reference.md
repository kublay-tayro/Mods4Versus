# Referencia de eventos — Mods4Versus Analytics

Versión del sistema: 1.0.0 · App: Mods4Versus v1.2.0

## Estructura base de todos los eventos

```json
{
  "event_id":        "uuid-v4",
  "installation_id": "uuid-v4",
  "session_id":      "uuid-v4",
  "event_name":      "nombre_del_evento",
  "timestamp":       "2026-11-19T18:00:00.000Z",
  "app_version":     "1.2.0",
  "properties":      { }
}
```

> [!NOTE]
> `installation_id` y `session_id` son UUIDs v4 generados aleatoriamente de forma local. No están vinculados a ningún identificador de usuario, Steam ID, ni información del sistema.

---

## Eventos de actividad

### `first_open`
Se emite **una única vez** por instalación, la primera vez que el usuario abre la aplicación.

| Campo | Tipo | Descripción |
|---|---|---|
| *(sin propiedades adicionales)* | | |

```json
{ "event_name": "first_open", "properties": {} }
```

---

### `app_open`
Se emite **en cada apertura** de la aplicación.

| Propiedad | Tipo | Descripción |
|---|---|---|
| `is_first_open` | boolean | `true` si también se emite `first_open` en esta sesión |

```json
{ "event_name": "app_open", "properties": { "is_first_open": false } }
```

---

### `app_update`
Se emite cuando la versión almacenada localmente difiere de la versión actual.

| Propiedad | Tipo | Descripción |
|---|---|---|
| `from_version` | string | Versión anterior detectada en localStorage |
| `to_version` | string | Versión actual de la aplicación |

```json
{ "event_name": "app_update", "properties": { "from_version": "1.1.0", "to_version": "1.2.0" } }
```

---

### `app_session_activity`
Se emite en el evento `beforeunload` (cierre de la ventana o salida de la app).

| Propiedad | Tipo | Descripción |
|---|---|---|
| `duration_seconds` | integer | Segundos transcurridos desde `init()` hasta el cierre |

```json
{ "event_name": "app_session_activity", "properties": { "duration_seconds": 342 } }
```

> [!NOTE]
> Se envía mediante `navigator.sendBeacon` para garantizar el envío incluso durante el cierre.

---

## Eventos de gestión de mods

### `mods_scan`
Se emite cuando el escaneo del Workshop finaliza.

| Propiedad | Tipo | Descripción |
|---|---|---|
| `mod_count` | integer | Número de mods encontrados en la carpeta del Workshop |

```json
{ "event_name": "mods_scan", "properties": { "mod_count": 24 } }
```

---

### `mod_selected`
Se emite cuando el usuario hace clic en un mod para añadirlo a la selección.

| Propiedad | Tipo | Descripción |
|---|---|---|
| `mod_id` | string | ID del mod (nombre del archivo `.vpk` sin extensión) |
| `mod_title` | string | Título del mod extraído de `addoninfo.txt` |
| `total_selected` | integer | Total de mods seleccionados tras esta acción |

```json
{ "event_name": "mod_selected", "properties": { "mod_id": "123456789", "mod_title": "HD Survivors", "total_selected": 3 } }
```

> [!NOTE]
> `mod_id` es el ID numérico de Steam Workshop, **no** contiene ninguna información personal.

---

### `mod_deselected`
Se emite cuando el usuario hace clic en un mod ya seleccionado para quitarlo.

| Propiedad | Tipo | Descripción |
|---|---|---|
| `mod_id` | string | ID del mod |
| `mod_title` | string | Título del mod |
| `total_selected` | integer | Total de mods seleccionados tras esta acción |

```json
{ "event_name": "mod_deselected", "properties": { "mod_id": "123456789", "mod_title": "HD Survivors", "total_selected": 2 } }
```

---

### `vpk_merge_started`
Se emite cuando el usuario hace clic en FUSIONAR y comienza el proceso.

| Propiedad | Tipo | Descripción |
|---|---|---|
| `mod_count` | integer | Número de mods seleccionados para fusionar |
| `mod_ids` | string[] | Array de IDs de los mods seleccionados |

```json
{ "event_name": "vpk_merge_started", "properties": { "mod_count": 3, "mod_ids": ["111", "222", "333"] } }
```

---

### `vpk_merge_success`
Se emite cuando la fusión finaliza correctamente.

| Propiedad | Tipo | Descripción |
|---|---|---|
| `mod_count` | integer | Número de mods fusionados |
| `duration_ms` | integer | Duración total de la operación en milisegundos |

```json
{ "event_name": "vpk_merge_success", "properties": { "mod_count": 3, "duration_ms": 4521 } }
```

---

### `vpk_merge_error`
Se emite cuando la fusión falla, ya sea por error del backend o por excepción.

| Propiedad | Tipo | Descripción |
|---|---|---|
| `mod_count` | integer | Número de mods que se intentaron fusionar |
| `error_type` | string | `"backend_error"` (resultado `status: "error"`) o `"exception"` |

```json
{ "event_name": "vpk_merge_error", "properties": { "mod_count": 3, "error_type": "backend_error" } }
```

---

## Eventos de rendimiento

### `vpk_processing_duration`
Se emite siempre al finalizar el proceso de fusión (éxito o error), con la duración total.

| Propiedad | Tipo | Descripción |
|---|---|---|
| `duration_ms` | integer | Duración total en milisegundos |
| `mod_count` | integer | Número de mods procesados |

```json
{ "event_name": "vpk_processing_duration", "properties": { "duration_ms": 4521, "mod_count": 3 } }
```

---

### `app_error`
Se emite cuando ocurre una excepción inesperada en el flujo principal.

| Propiedad | Tipo | Descripción |
|---|---|---|
| `error_type` | string | Identificador del tipo de error |
| `context` | string | Nombre de la función donde ocurrió el error |

```json
{ "event_name": "app_error", "properties": { "error_type": "vpk_merge_exception", "context": "iniciarFusion" } }
```

> [!IMPORTANT]
> **Nunca** se almacena el mensaje de error completo ni stack traces, ya que pueden contener rutas del sistema de archivos del usuario.

---

## Campos enriquecidos por el Worker (nunca enviados por el cliente)

| Campo | Fuente | Descripción |
|---|---|---|
| `country` | `request.cf.country` (Cloudflare) | Código de país ISO 3166-1 alpha-2. La IP nunca se almacena. |
| `received_at` | SQLite `datetime('now')` | Timestamp de recepción en el servidor. |

---

## Límites y validaciones

| Límite | Valor |
|---|---|
| Eventos por lote (cliente) | Máximo 50 |
| Eventos por lote (Worker acepta) | Máximo 50 |
| Tamaño máximo del body | 100 KB |
| Tamaño máximo de `properties` | 2048 bytes (JSON) |
| Longitud máxima de `app_version` | 20 caracteres |
| Reintentos máximos en cliente | 3 (con backoff exponencial de 5s base) |
| Tamaño de cola local máxima | 50 eventos en memoria |
| Flush periódico | Cada 30 segundos |
