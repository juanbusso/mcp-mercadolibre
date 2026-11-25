import fs from 'fs';
import path from 'path';
import os from 'os';
import type {
  AddToCartInput,
  AddToCartOutput,
  CartGroup,
  CartItem,
  CartSummaryOutput,
  RemoveFromCartInput,
  RemoveFromCartOutput,
} from '../../domain/models/MercadoLivreCartModel.js';
import type { MagoMaxwellService } from './MagoMaxwellService.js';

export class MercadoLivreCartApiService {
  constructor(private magoService?: MagoMaxwellService) {}

  private readonly CART_API_URL =
    'https://www.mercadolibre.com.ar/gz/cart/v3/api/add-to-cart';

  private readonly CART_LIST_URL =
    'https://www.mercadolibre.com.ar/gz/cart/v3/api/cart-list';

  private readonly CART_DELETE_URL =
    'https://www.mercadolibre.com.ar/gz/cart/v3/api/delete';

  private readonly ALLOWED_COOKIES = new Set([
    'ssid',
    'cp',
    '_csrf',
    'orguserid',
    '_d2id',
    'x-meli-session-id',
  ]);

  private readonly DEFAULT_SESSION_PATH = path.join(
    os.homedir(),
    '.config/mcp-mercadolibre/session.json',
  );

  /**
   * Cleans a raw cookie string or dictionary, leaving ONLY essential session cookies
   * and removing all third-party analytics/tracking cookies.
   */
  cleanCookies(rawCookies: string): string {
    if (!rawCookies) return '';
    const pairs = rawCookies.split(';').map((p) => p.trim()).filter(Boolean);
    const cleaned: string[] = [];
    const seen = new Set<string>();

    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const key = pair.slice(0, eqIdx).trim();
      const val = pair.slice(eqIdx + 1).trim();

      if (this.ALLOWED_COOKIES.has(key) && !seen.has(key)) {
        cleaned.push(`${key}=${val}`);
        seen.add(key);
      }
    }

    return cleaned.join('; ');
  }

  /**
   * Resolves the session cookies to use, prioritizing custom cookies,
   * then environment variables, then the persistent config file, and finally fallback.
   */
  resolveCookies(customCookies?: string): string {
    if (customCookies && customCookies.trim()) {
      return this.cleanCookies(customCookies);
    }

    // Check environment variables
    if (process.env.MELI_COOKIE) {
      return this.cleanCookies(process.env.MELI_COOKIE);
    }

    if (process.env.MELI_SSID) {
      const parts = [`ssid=${process.env.MELI_SSID.trim()}`];
      if (process.env.MELI_CP) parts.push(`cp=${process.env.MELI_CP.trim()}`);
      if (process.env.MELI_CSRF) parts.push(`_csrf=${process.env.MELI_CSRF.trim()}`);
      return parts.join('; ');
    }

    // Check config file ~/.config/mcp-mercadolibre/session.json (strictly prefer personal account)
    try {
      if (fs.existsSync(this.DEFAULT_SESSION_PATH)) {
        const raw = fs.readFileSync(this.DEFAULT_SESSION_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        const source =
          parsed?.accounts?.personal && typeof parsed.accounts.personal === 'object'
            ? parsed.accounts.personal
            : parsed;
        const parts: string[] = [];
        for (const [k, v] of Object.entries(source)) {
          if (this.ALLOWED_COOKIES.has(k) && v && typeof v === 'string') {
            parts.push(`${k}=${v}`);
          }
        }
        if (parts.length > 0) {
          return parts.join('; ');
        }
      }
    } catch (err) {
      console.error('Error reading session file:', err);
    }

    return '';
  }

  /**
   * Checks if input is a catalog (/p/MLA...) or user-product (/up/MLAU...) URL without explicit seller item_id
   */
  private isUnresolvedCatalogInput(input: string): boolean {
    if (!input) return false;
    const decoded = (() => {
      try {
        return decodeURIComponent(input);
      } catch {
        return input;
      }
    })();
    if (/(?:item_id[:=]|wid=)MLA-?\d{6,}/i.test(decoded)) return false;
    return /\/p\/MLA\d+|\/up\/MLAU\d+|^MLAU\d+$/i.test(decoded.trim());
  }

  /**
   * Normalizes an item ID or Mercado Libre URL into a canonical MLA ID.
   * Prioritizes explicit seller item_id/wid query params over catalog /p/MLA... IDs.
   */
  cleanItemId(input: string): string {
    if (!input) return '';
    const trimmed = input.trim();
    const decoded = (() => {
      try {
        return decodeURIComponent(trimmed);
      } catch {
        return trimmed;
      }
    })();
    const explicit = decoded.match(/(?:item_id[:=]|wid=)MLA-?(\d{6,})/i);
    if (explicit) {
      return `MLA${explicit[1]}`;
    }
    const match = decoded.match(/MLA[-]?(\d+)/i);
    if (match) {
      return `MLA${match[1]}`;
    }
    if (/^\d+$/.test(trimmed)) {
      return `MLA${trimmed}`;
    }
    return trimmed.replace(/-/g, '');
  }

  /**
   * Generates a clean direct checkout URL from items
   */
  buildCheckoutUrl(items: CartItem[]): string {
    const encoded = items
      .filter((it) => it.itemId)
      .map((it) => `${this.cleanItemId(it.itemId)}-Q${it.quantity || 1}`);
    if (encoded.length === 0) return 'https://www.mercadolibre.com.ar/gz/cart';
    return `https://www.mercadolibre.com.ar/gz/checkout/cart/buy?site_id=MLA&items=${encoded.join('%2C')}`;
  }

  /**
   * Extracts clean checkout URL from raw front event URL
   */
  cleanCheckoutUrl(rawUrl: string): string {
    if (!rawUrl) return '';
    const match = rawUrl.match(/items=([^&]+)/);
    if (match) {
      return `https://www.mercadolibre.com.ar/gz/checkout/cart/buy?site_id=MLA&items=${match[1]}`;
    }
    return rawUrl;
  }

  /**
   * Sends the add-to-cart request to Mercado Libre's front API.
   * Automatically resolves catalog (/p/MLA...) and user-product (/up/MLAU...) URLs via Mago when needed.
   */
  async addToCart(input: AddToCartInput): Promise<AddToCartOutput> {
    const rawId = input.itemId;
    const quantity = input.quantity && input.quantity > 0 ? input.quantity : 1;
    let cleanedItemId = this.cleanItemId(rawId);
    let resolvedFrom: string | undefined;

    if (this.isUnresolvedCatalogInput(rawId) && this.magoService) {
      const resolved = await this.magoService.resolveCatalogToItemId(rawId);
      if (resolved?.itemId) {
        resolvedFrom = rawId;
        cleanedItemId = resolved.itemId;
      }
    }

    if (!cleanedItemId) {
      return {
        success: false,
        itemId: rawId,
        quantity,
        status: 'error',
        message: `ID de producto inválido: "${rawId}". Debe ser un ID MLA (ej. MLA1234567890) o link del producto.`,
      };
    }

    const cookieHeader = this.resolveCookies(input.customCookies);
    if (!cookieHeader) {
      return {
        success: false,
        itemId: cleanedItemId,
        quantity,
        status: 'error',
        message:
          'No se encontró sesión de Mercado Libre configurada. Configure la variable de entorno MELI_SSID o cree el archivo ~/.config/mcp-mercadolibre/session.json.',
      };
    }

    const attemptAdd = async (targetItemId: string): Promise<AddToCartOutput & { _needsResolve?: boolean }> => {
      const headers: Record<string, string> = {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        origin: 'https://www.mercadolibre.com.ar',
        referer: 'https://www.mercadolibre.com.ar/',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
        'x-requested-with': 'XMLHttpRequest',
        Cookie: cookieHeader,
      };

      const payload: Record<string, unknown> = {
        item_id: targetItemId,
        quantity,
      };

      const varMatch = rawId.match(/(?:searchVariation=|VAR)(\d+)/);
      if (varMatch?.[1]) {
        payload.variation_id = varMatch[1];
      }

      try {
        const response = await fetch(this.CART_API_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let parsedError: any = null;
          try {
            parsedError = JSON.parse(errorText);
          } catch {}

          const msg =
            parsedError?.message ||
            parsedError?.error ||
            `HTTP ${response.status}: ${response.statusText}`;

          return {
            success: false,
            itemId: targetItemId,
            resolvedFrom,
            quantity,
            status: 'error',
            message: `Error al agregar al carrito: ${msg}`,
            _needsResolve: response.status === 422 || response.status === 400,
          };
        }

        const data: any = await response.json();

        // Detect Mercado Libre HTTP 200 logical errors (e.g. CAR14 on catalog IDs)
        const errMsg = data?.message;
        if (
          errMsg &&
          (errMsg.criticality === 'error' || Boolean(errMsg.error_code))
        ) {
          return {
            success: false,
            itemId: targetItemId,
            resolvedFrom,
            quantity,
            status: errMsg.error_code || 'error',
            message: `Mercado Libre rechazó agregar ${targetItemId}: ${errMsg.label || errMsg.error_code} (${errMsg.error_code || 'error'}).`,
            _needsResolve: errMsg.error_code === 'CAR14',
          };
        }

        const cartStatus = data.cart_status || {};
        const tabbarInfo = data.tabbar_info || {};
        const itemStatus = data.item_status || {};

        const currentPrice = itemStatus.price?.current;
        const originalPrice = itemStatus.price?.original;

        return {
          success: true,
          itemId: targetItemId,
          resolvedFrom,
          quantity,
          totalCartQuantity: tabbarInfo.quantity,
          itemPrice: currentPrice
            ? {
                current: currentPrice,
                original: originalPrice,
              }
            : undefined,
          cartStatus: {
            status: cartStatus.status || 'enabled',
            displayQuantity: cartStatus.display_quantity || quantity,
          },
          directCheckoutUrl: `https://www.mercadolibre.com.ar/gz/checkout/cart/buy?site_id=MLA&items=${targetItemId}-Q${quantity}`,
          message: `Producto ${targetItemId} agregado exitosamente al carrito (${quantity} unidad${quantity > 1 ? 'es' : ''}). Total de artículos en carrito: ${tabbarInfo.quantity ?? 'N/A'}.`,
        };
      } catch (err: any) {
        console.error('Error in addToCart:', err);
        return {
          success: false,
          itemId: targetItemId,
          resolvedFrom,
          quantity,
          status: 'error',
          message: `Error de red al conectar con Mercado Libre: ${err.message}`,
        };
      }
    };

    const firstTry = await attemptAdd(cleanedItemId);
    if (firstTry.success) {
      const { _needsResolve: _, ...clean } = firstTry;
      return clean;
    }

    // If Mercado Libre returned CAR14 / 422 (likely a catalog ID) and we haven't resolved via Mago yet, try once
    if (firstTry._needsResolve && !resolvedFrom && this.magoService) {
      const resolved = await this.magoService.resolveCatalogToItemId(rawId);
      if (resolved?.itemId && resolved.itemId !== cleanedItemId) {
        resolvedFrom = rawId;
        const secondTry = await attemptAdd(resolved.itemId);
        const { _needsResolve: _, ...clean } = secondTry;
        return clean;
      }
    }

    const { _needsResolve: _, ...clean } = firstTry;
    return clean;
  }

  /**
   * Fetches the full cart summary, including totals, discounts, shipping fees, and items
   */
  async getCartSummary(customCookies?: string): Promise<CartSummaryOutput> {
    const cookieHeader = this.resolveCookies(customCookies);
    if (!cookieHeader) {
      return {
        success: false,
        totalItemsCount: 0,
        productsSubtotal: 0,
        discountAmount: 0,
        shippingCost: 0,
        totalToPay: 0,
        savingsAmount: 0,
        groups: [],
        message:
          'No se encontró sesión de Mercado Libre configurada. Configure la variable de entorno MELI_SSID o cree el archivo ~/.config/mcp-mercadolibre/session.json.',
      };
    }

    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
      origin: 'https://www.mercadolibre.com.ar',
      referer: 'https://www.mercadolibre.com.ar/gz/cart/v2',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      Cookie: cookieHeader,
    };

    try {
      const response = await fetch(this.CART_LIST_URL, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          totalItemsCount: 0,
          productsSubtotal: 0,
          discountAmount: 0,
          shippingCost: 0,
          totalToPay: 0,
          savingsAmount: 0,
          groups: [],
          message: `Error al consultar carrito (HTTP ${response.status}): ${errorText.slice(0, 150)}`,
        };
      }

      const data: any = await response.json();
      const summary = data.summary || {};
      const ticketRows = summary.ticket_rows || [];

      let productsSubtotal = 0;
      let discountAmount = 0;
      let shippingCost = 0;

      const parseTicketRow = (rowObj: any) => {
        const vals: any[] = rowObj?.value?.values || [];
        let isFree = false;
        let isMeliPlus = Boolean(rowObj?.is_free_shipping_by_meli_plus);
        let originalCost: number | undefined;
        let currentCost: number | undefined;

        for (const v of vals) {
          if (v?.is_meli_plus) isMeliPlus = true;
          if (v?.type === 'label') {
            const lbl = String(v?.label?.text || '').toLowerCase();
            if (lbl.includes('gratis') || lbl.includes('free')) {
              isFree = true;
              currentCost = 0;
            }
          } else if (v?.price && typeof v.price.value === 'number') {
            if (
              v.price.previous ||
              v.key === 'original' ||
              v.key === 'offer_price'
            ) {
              originalCost = v.price.value;
            } else {
              currentCost = v.price.value;
            }
          }
        }
        if (isFree) currentCost = 0;
        return { currentCost, originalCost, isFree, isMeliPlus };
      };

      for (const row of ticketRows) {
        const parsed = parseTicketRow(row);
        if (row.id === 'item') productsSubtotal = parsed.currentCost ?? 0;
        else if (row.id === 'discount')
          discountAmount = Math.abs(parsed.currentCost ?? 0);
        else if (row.id === 'shipping') {
          const labelFree = String(row.label?.text || '')
            .toLowerCase()
            .includes('gratis');
          shippingCost =
            parsed.isFree || labelFree ? 0 : (parsed.currentCost ?? 0);
        }
      }

      const totalToPay =
        summary.total_row?.value?.values?.find((v: any) => v.key === "price" || !v.price?.previous)?.price
          ?.value ?? (productsSubtotal - discountAmount + shippingCost);

      const savingsAmount =
        summary.rabbit_hole?.savings_text?.values?.[0]?.price?.value ??
        discountAmount;

      const checkoutUrl =
        summary.button?.event?.fallback?.url ||
        'https://www.mercadolibre.com.ar/gz/cart';

      const groups: CartGroup[] = [];
      let totalItemsCount = 0;

      for (const g of data.grouped_items || []) {
        const groupId = g.name || 'desconocido';
        const cards = g.polycards || [];
        const items: CartItem[] = [];

        for (const card of cards) {
          const meta = card.metadata || {};
          const itemId = meta.id || '';
          const qty = parseInt(meta.quantity || '1', 10);
          const unitPrice = parseFloat(meta.unit_price || '0');
          const titleComp = card.components?.find((c: any) => c.type === 'title');
          const title = titleComp?.title?.text || 'Producto sin título';
          const url = meta.url
            ? meta.url.startsWith('http')
              ? meta.url
              : `https://${meta.url}`
            : '';

          totalItemsCount += qty;
          items.push({
            itemId,
            title,
            quantity: qty,
            unitPrice,
            subtotal: unitPrice * qty,
            url,
          });
        }

        const footerRow = g.footer?.ticket_row;
        const parsedFooter = parseTicketRow(footerRow);
        const groupShippingVal = parsedFooter.isFree
          ? 0
          : parsedFooter.currentCost;
        const groupShippingText = parsedFooter.isFree
          ? parsedFooter.isMeliPlus
            ? 'Envío GRATIS (Meli+)'
            : 'Envío GRATIS'
          : footerRow?.label?.text || '';

        const groupCheckout = this.buildCheckoutUrl(items);
        groups.push({
          groupId,
          groupName:
            groupId === 'full_super'
              ? 'Supermercado Full'
              : `Vendedor ${groupId}`,
          itemCount: items.length,
          shippingText: groupShippingText,
          shippingCost: groupShippingVal,
          checkoutUrl: groupCheckout,
          items,
        });
      }

      const cleanUrl = this.cleanCheckoutUrl(
        summary.button?.event?.fallback?.url || ''
      );
      const allItems = groups.flatMap((g) => g.items);
      const allCheckoutUrl = this.buildCheckoutUrl(allItems);

      return {
        success: true,
        totalItemsCount,
        productsSubtotal,
        discountAmount,
        shippingCost,
        totalToPay,
        savingsAmount,
        checkoutUrl: cleanUrl || allCheckoutUrl,
        allCheckoutUrl,
        groups,
        message: `Carrito cargado exitosamente con ${totalItemsCount} productos. Total a pagar: $${totalToPay.toLocaleString('es-AR')} ARS.`,
      };
    } catch (err: any) {
      console.error('Error in getCartSummary:', err);
      return {
        success: false,
        totalItemsCount: 0,
        productsSubtotal: 0,
        discountAmount: 0,
        shippingCost: 0,
        totalToPay: 0,
        savingsAmount: 0,
        groups: [],
        message: `Error de red al consultar el carrito: ${err.message}`,
      };
    }
  }

  /**
   * Removes an item from the cart using Mercado Libre front API delete endpoint
   */
  async removeFromCart(
    input: RemoveFromCartInput,
  ): Promise<RemoveFromCartOutput> {
    const rawId = input.itemId;
    const cleanedItemId = this.cleanItemId(rawId);

    if (!cleanedItemId) {
      return {
        success: false,
        itemId: rawId,
        message: `ID de producto inválido: "${rawId}".`,
      };
    }

    const cookieHeader = this.resolveCookies(input.customCookies);
    if (!cookieHeader) {
      return {
        success: false,
        itemId: cleanedItemId,
        message:
          'No se encontró sesión de Mercado Libre configurada. Configure la variable de entorno MELI_SSID o cree el archivo ~/.config/mcp-mercadolibre/session.json.',
      };
    }
    const deleteUrl = `${this.CART_DELETE_URL}?itemId=${encodeURIComponent(cleanedItemId)}`;

    const headers: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      origin: "https://www.mercadolibre.com.ar",
      referer: "https://www.mercadolibre.com.ar/gz/cart/v2",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
      "x-requested-with": "XMLHttpRequest",
      Cookie: cookieHeader,
    };

    try {
      const response = await fetch(deleteUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ _action: "delete" }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          itemId: cleanedItemId,
          message: `Error al eliminar el producto (HTTP ${response.status}): ${errorText.slice(0, 150)}`,
        };
      }

      const data: any = await response.json();
      const snackbarMsg = data?.snackbar?.message || "¡Listo! Eliminaste el producto.";

      return {
        success: true,
        itemId: cleanedItemId,
        message: snackbarMsg,
      };
    } catch (err: any) {
      console.error("Error in removeFromCart:", err);
      return {
        success: false,
        itemId: cleanedItemId,
        message: `Error de red al eliminar el producto: ${err.message}`,
      };
    }
  }

}
