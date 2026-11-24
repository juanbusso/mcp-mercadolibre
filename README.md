# Mercado Libre Argentina - MCP Server 🇦🇷

Servidor de **Model Context Protocol (MCP)** de alto rendimiento para conectar modelos de inteligencia artificial (Claude Desktop, Antigravity, Cursor, Continue, VS Code, Roo Code) directamente con **Mercado Libre Argentina**.

Permite a cualquier agente o LLM buscar productos en vivo sin bloqueos antibot, aplicar filtros logísticos (FULL local, exclusión de compras internacionales), gestionar el carrito de compras en tiempo real y generar enlaces directos de checkout.

---

## 🚀 Características Principales

### 1. 🔍 Búsqueda de Productos con Bypass Anti-Bot
* **Evasión de CAPTCHAs & Cloudflare:** Headers y User-Agent emulados (`Googlebot`) para scrapear el catálogo oficial de Mercado Libre Argentina de manera veloz, estable y **sin necesidad de iniciar sesión**.
* **Precios precisos en ARS:** Parseo nativo de monedas, descuentos y promociones en Pesos Argentinos.
* **Filtros Avanzados:**
  * `onlyFull`: Filtra estrictamente artículos con almacenamiento y envío **FULL local** (depósitos de Argentina con entrega rápida en el día/24hs).
  * `excludeInternational`: Excluye publicaciones de **Compra Internacional** (CBT / envíos desde China o EE.UU. que agregan impuestos aduaneros sorpresivos en el checkout y demoran semanas).

### 2. 🛒 Carrito de Compras en Vivo
* **Agregar productos (`agregar-al-carrito`):** Admite IDs de publicación (ej. `MLA1234567890`) o URLs completas de Mercado Libre, con selector de cantidad.
* **Eliminar productos (`eliminar-del-carrito`):** Remueve artículos del carrito activo al instante.
* **Resumen consolidado (`resumen-carrito`):** Devuelve totales a pagar, productos agrupados por vendedor (ej. *Supermercado Full* vs *Vendedores independientes*), costo de envío discriminado y ahorros aplicados.

### 3. ⚡ Enlaces Directos de Checkout (1-Click Buy)
* El servidor genera automáticamente URLs estructuradas de checkout con todos los ítems y cantidades listas para pagar:
  `https://www.mercadolibre.com.ar/gz/checkout/cart/buy?site_id=MLA&items=MLA123-Q1%2CMLA456-Q2`
* Permite al usuario finalizar la compra con un solo clic en su celular o PC.

### 4. 🔒 Seguridad y Manejo Limpio de Cookies
* **Filtro de Cookies Sanas:** El motor `cleanCookies` purga automáticamente cookies publicitarias, trackers de analítica y telemetría de terceros, reteniendo únicamente las credenciales esenciales (`ssid`, `cp`, `_csrf`, `orguserid`).
* **Privacidad Primero:** Las credenciales nunca quedan guardadas en el código fuente. Se leen dinámicamente desde variables de entorno o desde la carpeta de configuración local del usuario.
* **Búsquedas 100% Públicas:** Si no configurás sesión, las búsquedas de productos funcionan sin ningún problema ni restricción.

---

## 📦 Instalación

### Requisitos Previos
* **Node.js** v18 o superior
* **npm**, **pnpm** o **yarn**

### Paso a Paso

```bash
# 1. Clonar el repositorio
git clone https://github.com/YOUR_GITHUB_USER/mcp-mercadolibre.git
cd mcp-mercadolibre

# 2. Instalar dependencias
npm install

# 3. Compilar el servidor TypeScript
npm run build
```

El ejecutable quedará listo en `build/main.js`.

---

## ⚙️ Configuración en Clientes de IA

### 1. Claude Desktop

Editá tu archivo de configuración de Claude Desktop:
* **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
* **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mercadolibre": {
      "command": "node",
      "args": [
        "/RUTA/ABSOLUTA/A/mcp-mercadolibre/build/main.js"
      ],
      "env": {
        "MELI_SSID": "tu_ssid_opcional_aqui",
        "MELI_CP": "1000"
      }
    }
  }
}
```

### 2. Antigravity / Gemini CLI

Editá `~/.gemini/config/mcp_config.json` (o el archivo `.mcp.json` en la raíz de tu proyecto):

```json
{
  "mcpServers": {
    "mercadolibre": {
      "command": "node",
      "args": [
        "/RUTA/ABSOLUTA/A/mcp-mercadolibre/build/main.js"
      ]
    }
  }
}
```

### 3. Cursor / VS Code

Agregalo en la configuración de servidores MCP de Cursor (`Settings > Features > MCP` o `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "mercadolibre": {
      "command": "node",
      "args": [
        "/RUTA/ABSOLUTA/A/mcp-mercadolibre/build/main.js"
      ]
    }
  }
}
```

---

## 🔑 Autenticación de Sesión (Opcional - Solo para Carrito)

> **Nota:** Para buscar productos (`buscar-productos`) **NO se requiere ninguna sesión ni cookie**.

Para usar las herramientas de carrito (`agregar-al-carrito`, `resumen-carrito`, `eliminar-del-carrito`), podés configurar tu sesión de dos formas:

### Opción A: Archivo de Configuración Local (Recomendada)
Creá el archivo `~/.config/mcp-mercadolibre/session.json` en tu computadora:

```json
{
  "ssid": "tu_cookie_ssid_de_mercadolibre",
  "cp": "1000",
  "_csrf": "tu_cookie_csrf_opcional"
}
```

### Opción B: Variables de Entorno
Configurá en tu entorno o en el bloque `"env"` del cliente MCP:
* `MELI_SSID`: El valor de la cookie `ssid`.
* `MELI_CP`: Código postal de envío (ej. `1000`, `1425`).
* `MELI_CSRF`: (Opcional) Token CSRF si es requerido.

### ¿Cómo obtener tu `ssid` de Mercado Libre?
1. Ingresá a [mercadolibre.com.ar](https://www.mercadolibre.com.ar) con tu cuenta en Google Chrome / Firefox / Safari.
2. Presioná `F12` o clic derecho > **Inspeccionar**.
3. Andá a la pestaña **Application** (o Almacenamiento) > **Cookies** > `https://www.mercadolibre.com.ar`.
4. Buscá la clave **`ssid`** y copiá su contenido.

---

## 🛠️ Herramientas Disponibles (Tools Reference)

### 1. `buscar-productos`
Busca artículos en vivo en Mercado Libre Argentina con soporte de filtros.

* **Parámetros:**
  * `products` *(array de strings, requerido)*: Términos o nombres de productos a buscar.
  * `onlyFull` *(boolean, opcional)*: Filtrar únicamente productos con envío FULL local.
  * `excludeInternational` *(boolean, opcional)*: Excluir productos de Compra Internacional.
* **Ejemplo de uso:**
  ```json
  {
    "products": ["yerba mate playadito 1kg", "cafe molido cabrales 500g"],
    "onlyFull": true,
    "excludeInternational": true
  }
  ```

### 2. `agregar-al-carrito`
Añade un producto al changuito de Mercado Libre.

* **Parámetros:**
  * `itemId` *(string, requerido)*: ID de publicación (ej. `MLA1234567890`, `MLA-1234567890`) o link del producto.
  * `quantity` *(number, opcional, por defecto 1)*: Cantidad de unidades.
  * `customCookies` *(string, opcional)*: Cadena de cookies para sobreescribir la sesión por llamada.

### 3. `eliminar-del-carrito`
Quita un producto del carrito.

* **Parámetros:**
  * `itemId` *(string, requerido)*: ID de publicación o URL a remover.
  * `customCookies` *(string, opcional)*.

### 4. `resumen-carrito`
Obtiene el desglose total del carrito: productos agrupados, costos de envío, totales en Pesos y link directo de checkout.

* **Parámetros:**
  * `customCookies` *(string, opcional)*.

---

## 🧱 Arquitectura

El proyecto sigue una arquitectura limpia inspirada en **Domain-Driven Design (DDD)**:

```text
src/
├── domain/                  # Entidades, modelos Zod e interfaces de dominio
│   ├── models/              # Tipos de Mercado Libre y Carrito
│   └── utils/crawler/       # Matching de palabras, sanitización y normalización
├── infrastructure/          # Conexión externa con Mercado Libre
│   └── services/
│       ├── MercadoLivreApiService.ts     # Scraper HTTP con bypass de antibot
│       └── MercadoLivreCartApiService.ts # Cliente de API interna de carrito y checkout
├── application/             # Capa de lógica de negocio y formateo
│   └── services/
├── interface/               # Controladores MCP
│   └── controllers/
│       └── MercadoLivreToolsController.ts # Definición y registro de tools MCP
└── main.ts                  # Punto de entrada y servidor stdio MCP
```

---

## 🧪 Pruebas Locales

Podés probar que el servidor responde correctamente ejecutando en tu terminal:

```bash
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' | node build/main.js
```

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT**. Podés usarlo, modificarlo y distribuirlo libremente.
