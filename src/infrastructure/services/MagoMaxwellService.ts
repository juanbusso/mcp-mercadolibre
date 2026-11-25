import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { MercadoLivreCrawlerOutput } from '../../domain/models/MercadoLivreServiceModel.js';

export interface MagoAskResult {
  success: boolean;
  reply: string;
  conversationId?: string;
  error?: string;
}

export interface MagoSearchOptions {
  onlyFull?: boolean;
  excludeInternational?: boolean;
  limit?: number;
}

export interface MagoResolvedItem {
  itemId: string;
  title?: string;
  price?: number;
  isFull?: boolean;
  isInternational?: boolean;
  url?: string;
}

interface RawMagoItem {
  item_id?: string;
  itemId?: string;
  id?: string;
  title?: string;
  name?: string;
  price?: number | string;
  original_price?: number | string | null;
  is_full?: boolean;
  is_international?: boolean;
  free_shipping?: boolean;
  shipping?: string;
  url?: string;
}

export class MagoMaxwellService {
  private readonly MAXWELL_URL = 'https://www.mercadopago.com.ar/maxwell/api/sse';

  private readonly SESSION_PATH = path.join(
    os.homedir(),
    '.config/mcp-mercadolibre/session.json',
  );

  private readonly COOKIE_CANDIDATES = [
    path.join(os.homedir(), '.config/mcp-mercadolibre/mago_cookie.txt'),
    path.join(os.homedir(), 'dev/jarvis/data/test_curl.sh'),
    path.join(os.homedir(), 'dev/jarvis/data/mp_cookie.txt'),
  ];

  resolveUserId(): string {
    if (process.env.MELI_USER_ID?.trim()) {
      return process.env.MELI_USER_ID.trim();
    }
    try {
      if (fs.existsSync(this.SESSION_PATH)) {
        const parsed = JSON.parse(fs.readFileSync(this.SESSION_PATH, 'utf-8'));
        const personal = parsed?.accounts?.personal;
        if (personal?.userId) return String(personal.userId);
        if (parsed?.userId) return String(parsed.userId);
      }
    } catch {
      // ignore and fall back
    }
    return '184860017';
  }

  resolveCookie(): string | null {
    if (process.env.MP_MAXWELL_COOKIE?.trim()) {
      return process.env.MP_MAXWELL_COOKIE.trim();
    }
    if (process.env.MP_COOKIE?.trim()) {
      return process.env.MP_COOKIE.trim();
    }

    for (const candidate of this.COOKIE_CANDIDATES) {
      try {
        if (!fs.existsSync(candidate)) continue;
        const raw = fs.readFileSync(candidate, 'utf-8').trim();
        if (!raw) continue;

        if (candidate.endsWith('.sh')) {
          const match = raw.match(/(?:-b|--cookie)\s+'([^']+)'/);
          if (match?.[1]) return match[1].trim();
        } else {
          return raw;
        }
      } catch {
        // try next candidate
      }
    }
    return null;
  }

  extractSellerItemId(raw?: string | null): string | null {
    if (!raw) return null;
    const decoded = (() => {
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    })();

    // Always prioritize explicit seller item_id / wid query parameter over catalog /p/MLA...
    const explicit = decoded.match(/(?:item_id[:=]|wid=)MLA-?(\d{6,})/i);
    if (explicit) return `MLA${explicit[1]}`;

    // Classic listing URL (/MLA-1234567890-...)
    const classic = decoded.match(/\/MLA-(\d{6,})/i);
    if (classic) return `MLA${classic[1]}`;

    // Bare MLA item ID (not /p/MLA... or /up/MLAU...)
    if (!/\/p\/MLA|\/up\/MLAU/i.test(decoded)) {
      const bare = decoded.match(/\bMLA-?(\d{6,})\b/i);
      if (bare) return `MLA${bare[1]}`;
    }

    return null;
  }

  private parsePrice(val: number | string | undefined | null): number {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val !== 'string') return 0;
    const cleaned = val
      .replace(/[$\sARS]/gi, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  private extractJsonPayload(text: string): unknown {
    const trimmed = text.trim();
    if (!trimmed) return null;

    // 1. Direct JSON parse
    try {
      return JSON.parse(trimmed);
    } catch {
      // continue
    }

    // 2. Fenced code block ```json ... ```
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // continue
      }
    }

    // 3. First JSON array or object in text
    const arrStart = trimmed.indexOf('[');
    const arrEnd = trimmed.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      try {
        return JSON.parse(trimmed.slice(arrStart, arrEnd + 1));
      } catch {
        // continue
      }
    }

    const objStart = trimmed.indexOf('{');
    const objEnd = trimmed.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      try {
        return JSON.parse(trimmed.slice(objStart, objEnd + 1));
      } catch {
        // continue
      }
    }

    return null;
  }

  async ask(
    prompt: string,
    conversationId?: string,
    timeoutMs = 45000,
  ): Promise<MagoAskResult> {
    const cookie = this.resolveCookie();
    if (!cookie) {
      return {
        success: false,
        reply: '',
        error:
          'No se encontró sesión de Mago (MP_COOKIE / ~/.config/mcp-mercadolibre/mago_cookie.txt / jarvis/data/test_curl.sh).',
      };
    }

    const userId = this.resolveUserId();
    const payload: Record<string, unknown> = {
      type: 'message',
      message: {
        id: crypto.randomUUID(),
        type: 'user',
        content_parts: [{ type: 'text', text: prompt }],
        user_id: userId,
        sent_at: new Date().toISOString(),
      },
    };

    if (conversationId) {
      payload.conversation_id = conversationId;
    }

    const headers: Record<string, string> = {
      accept: '*/*',
      'accept-language': 'es-AR,es;q=0.9,en-US;q=0.8',
      'content-type': 'application/json',
      origin: 'https://www.mercadopago.com.ar',
      referer: conversationId
        ? `https://www.mercadopago.com.ar/chat?origin=help&flavor=mp_assistant&conversation_id=${conversationId}`
        : 'https://www.mercadopago.com.ar/chat?origin=help&flavor=mp_assistant',
      'sec-ch-ua':
        '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'same-origin',
      'sec-fetch-site': 'same-origin',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
      'x-browser-assessment-execution': 'success',
      'x-execution-time-browser-assessment': '516',
      'x-flavor-identifier': 'mp_assistant',
      'x-origin': 'help',
      'x-owner-id': userId,
      'x-time-zone': 'America/Buenos_Aires',
      cookie,
    };

    try {
      const response = await fetch(this.MAXWELL_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => '');
        return {
          success: false,
          reply: '',
          error: `Maxwell HTTP ${response.status}: ${errText.slice(0, 180)}`,
        };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentReply = '';
      const completedMessages: string[] = [];
      let resolvedConvId = conversationId;
      let done = false;

      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            const et = evt?.type;
            if (et === 'chat.execution.started' && evt?.data?.conversation_id) {
              resolvedConvId = String(evt.data.conversation_id);
            } else if (et === 'chat.message.delta') {
              currentReply += String(evt?.data?.text_delta ?? '');
            } else if (et === 'chat.message.done') {
              const trimmedMsg = currentReply.trim();
              if (trimmedMsg) completedMessages.push(trimmedMsg);
              currentReply = '';
            } else if (et === 'chat.execution.done') {
              const trimmedMsg = currentReply.trim();
              if (trimmedMsg) completedMessages.push(trimmedMsg);
              currentReply = '';
              done = true;
              await reader.cancel().catch(() => {});
              break;
            }
          } catch {
            // ignore non-JSON SSE keepalives
          }
        }
      }

      if (currentReply.trim()) {
        completedMessages.push(currentReply.trim());
      }
      const finalReply =
        completedMessages.length > 0
          ? completedMessages[completedMessages.length - 1]
          : '';
      if (!finalReply) {
        return {
          success: false,
          reply: '',
          conversationId: resolvedConvId,
          error: 'Maxwell devolvió un stream vacío.',
        };
      }

      return {
        success: true,
        reply: finalReply,
        conversationId: resolvedConvId,
      };
    } catch (err: any) {
      return {
        success: false,
        reply: '',
        error: `Error conectando con Mago/Maxwell: ${err?.message || String(err)}`,
      };
    }
  }

  async searchProducts(
    query: string,
    opts: MagoSearchOptions = {},
  ): Promise<MercadoLivreCrawlerOutput[]> {
    const onlyFull = !!opts.onlyFull;
    const excludeInternational = opts.excludeInternational ?? onlyFull;
    const limit = opts.limit ?? 8;

    const filterHints: string[] = [];
    if (excludeInternational) {
      filterHints.push(
        'SOLO publicaciones locales en Argentina (descarta Compra Internacional / envios desde el exterior)',
      );
    }
    if (onlyFull) {
      filterHints.push('SOLO publicaciones con envio FULL local');
    }
    const filterSentence =
      filterHints.length > 0 ? ` Filtros obligatorios: ${filterHints.join(' y ')}.` : '';

    const prompt =
      `Buscame en Mercado Libre Argentina "${query}".${filterSentence} ` +
      `Devolveme EXCLUSIVAMENTE un array JSON valido (sin markdown ni texto extra) con hasta ${limit} resultados reales ordenados por mejor precio. ` +
      `Cada objeto debe tener exactamente estas claves: ` +
      `item_id (codigo MLA del vendedor, ej "MLA1234567890"), title (string), price (numero ARS), ` +
      `original_price (numero o null), is_full (boolean), is_international (boolean), free_shipping (boolean), ` +
      `shipping (string breve con tipo/plazo de envio), url (link directo de mercadolibre.com.ar). ` +
      `Si no hay resultados que cumplan los filtros devolve [].`;

    const res = await this.ask(prompt);
    if (!res.success) {
      console.error('[MagoMaxwellService] searchProducts error:', res.error);
      return [];
    }

    const parsed = this.extractJsonPayload(res.reply);
    if (!Array.isArray(parsed)) {
      console.error(
        '[MagoMaxwellService] Unexpected non-array JSON reply:',
        res.reply.slice(0, 200),
      );
      return [];
    }

    const results: MercadoLivreCrawlerOutput[] = [];
    const seen = new Set<string>();

    for (const raw of parsed as RawMagoItem[]) {
      const title = String(raw.title || raw.name || '').trim();
      const price = this.parsePrice(raw.price);
      if (!title || price <= 0) continue;

      const url = String(raw.url || '').trim();
      const itemId =
        this.extractSellerItemId(raw.item_id || raw.itemId || raw.id) ||
        this.extractSellerItemId(url) ||
        undefined;

      const dedupeKey = itemId || url || `${title}-${price}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const shippingText = String(raw.shipping || '').trim();
      const isInternational =
        Boolean(raw.is_international) ||
        /internacional|ee\.?\s*uu\.?|china|exterior/i.test(shippingText);
      const isFull = !isInternational && Boolean(raw.is_full);
      const freeShipping =
        Boolean(raw.free_shipping) || /gratis|free/i.test(shippingText);
      const originalPrice = raw.original_price
        ? this.parsePrice(raw.original_price)
        : undefined;

      if (excludeInternational && isInternational) continue;
      if (onlyFull && !isFull) continue;

      results.push({
        itemId,
        name: title,
        price,
        originalPrice:
          originalPrice && originalPrice > price ? originalPrice : undefined,
        queryMatchRatio: 1,
        url:
          url ||
          (itemId
            ? `https://articulo.mercadolibre.com.ar/${itemId.replace(/^MLA/i, 'MLA-')}`
            : ''),
        directCheckoutUrl: itemId
          ? `https://www.mercadolibre.com.ar/gz/checkout/cart/buy?site_id=MLA&items=${itemId}-Q1`
          : undefined,
        isFull,
        isInternational,
        internationalOrigin: isInternational ? 'Internacional' : undefined,
        freeShipping,
        shippings: shippingText
          ? [
              {
                name: isFull ? 'Envío Full' : freeShipping ? 'Envío gratis' : 'Envío estándar',
                price: 0,
                deliveryDays: /hoy/i.test(shippingText)
                  ? 0
                  : /mañana/i.test(shippingText)
                    ? 1
                    : 3,
                originalDescription: shippingText,
              },
            ]
          : null,
        source: 'mago',
      });
    }

    results.sort((a, b) => a.price - b.price);
    return results;
  }

  async resolveCatalogToItemId(
    catalogUrlOrId: string,
  ): Promise<MagoResolvedItem | null> {
    const direct = this.extractSellerItemId(catalogUrlOrId);
    if (direct) {
      return { itemId: direct, url: catalogUrlOrId };
    }

    const prompt =
      `Necesito resolver esta publicacion o catalogo de Mercado Libre Argentina al codigo item_id real del vendedor ganador (local en Argentina, prefiriendo envio Full) para poder sumarlo al carrito: ${catalogUrlOrId}. ` +
      `Devolveme EXCLUSIVAMENTE un objeto JSON valido (sin markdown ni texto extra) con claves: ` +
      `item_id (ej "MLA1234567890", o null si no existe/no hay stock), title, price (numero), is_full (boolean), is_international (boolean), url.`;

    const res = await this.ask(prompt);
    if (!res.success) return null;

    const parsed = this.extractJsonPayload(res.reply);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const obj = parsed as RawMagoItem;
    const resolvedId =
      this.extractSellerItemId(obj.item_id || obj.itemId || obj.id) ||
      this.extractSellerItemId(obj.url);
    if (!resolvedId) return null;

    return {
      itemId: resolvedId,
      title: obj.title || obj.name,
      price: this.parsePrice(obj.price) || undefined,
      isFull: Boolean(obj.is_full),
      isInternational: Boolean(obj.is_international),
      url: obj.url,
    };
  }
}
