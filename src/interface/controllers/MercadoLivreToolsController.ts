import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { MercadoLivreService } from '../../application/services/MercadoLivreService.js';
import type { MercadoLivreCartService } from '../../application/services/MercadoLivreCartService.js';

export class MercadoLivreToolsController {
  constructor(
    private server: McpServer,
    private service: MercadoLivreService,
    private cartService: MercadoLivreCartService,
  ) {
    this.registerTools();
  }

  private registerTools() {
    this.registerGetStockToolHandler();
    this.registerAddToCartToolHandler();
    this.registerRemoveFromCartToolHandler();
    this.registerGetCartSummaryToolHandler();
  }

  private registerGetStockToolHandler(): void {
    const toolConfig = {
      description:
        'Buscar productos, precios, envíos y links en Mercado Libre Argentina',
      inputSchema: {
        products: z
          .array(z.string())
          .describe('Lista de términos o nombres de productos a buscar'),
        onlyFull: z
          .boolean()
          .optional()
          .describe('Filtrar únicamente productos con envío FULL local (excluye Full internacional de China)'),
        excludeInternational: z
          .boolean()
          .optional()
          .describe(
            'Excluir productos de Compra Internacional (CBT / envíos desde China o USA que suman impuestos aduaneros en el checkout y demoran semanas)',
          ),
      },
    };

    const handler = async ({
      products,
      onlyFull,
      excludeInternational,
    }: {
      products: string[];
      onlyFull?: boolean;
      excludeInternational?: boolean;
    }) => {
      const infos = await this.service.getProducts({
        products,
        onlyFull,
        excludeInternational,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(infos, null, 2),
          },
        ],
      };
    };

    this.server.registerTool('buscar-productos', toolConfig, handler);
  }

  private registerAddToCartToolHandler(): void {
    const toolConfig = {
      description:
        'Agregar un producto al carrito de compras de Mercado Libre Argentina (acepta ID MLA de publicación, URL clásica, o URLs de catálogo /p/MLA... y /up/MLAU... que se resuelven automáticamente vía Mago)',
      inputSchema: {
        itemId: z
          .string()
          .describe(
            'ID de la publicación de Mercado Libre (ej: "MLA1234567890" o "MLA-1234567890") o URL del producto',
          ),
        quantity: z
          .number()
          .optional()
          .describe('Cantidad de unidades a agregar al carrito (por defecto: 1)'),
        customCookies: z
          .string()
          .optional()
          .describe(
            'Cadena de cookies opcional si se desea sobreescribir la sesión configurada',
          ),
      },
    };

    const handler = async ({
      itemId,
      quantity,
      customCookies,
    }: {
      itemId: string;
      quantity?: number;
      customCookies?: string;
    }) => {
      const result = await this.cartService.addToCart({
        itemId,
        quantity,
        customCookies,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    };

    this.server.registerTool('agregar-al-carrito', toolConfig, handler);
  }

  private registerRemoveFromCartToolHandler(): void {
    const toolConfig = {
      description:
        'Eliminar o quitar un producto del carrito de compras de Mercado Libre Argentina (usando ID de publicación ej: MLA1234567890 o el link de la publicación)',
      inputSchema: {
        itemId: z
          .string()
          .describe(
            'ID de la publicación de Mercado Libre (ej: "MLA1234567890" o "MLA-1234567890") o URL del producto a eliminar',
          ),
        customCookies: z
          .string()
          .optional()
          .describe(
            'Cadena de cookies opcional si se desea sobreescribir la sesión configurada',
          ),
      },
    };

    const handler = async ({
      itemId,
      customCookies,
    }: {
      itemId: string;
      customCookies?: string;
    }) => {
      const result = await this.cartService.removeFromCart({
        itemId,
        customCookies,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    };

    this.server.registerTool('eliminar-del-carrito', toolConfig, handler);
  }

  private registerGetCartSummaryToolHandler(): void {
    const toolConfig = {
      description:
        'Obtener el resumen completo del carrito de compras de Mercado Libre: totales, costos de envío, descuentos acumulados, productos y grupos de compra.',
      inputSchema: {
        customCookies: z
          .string()
          .optional()
          .describe(
            'Cadena de cookies opcional si se desea sobreescribir la sesión configurada',
          ),
      },
    };

    const handler = async ({
      customCookies,
    }: {
      customCookies?: string;
    }) => {
      const result = await this.cartService.getCartSummary(customCookies);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    };

    this.server.registerTool('resumen-carrito', toolConfig, handler);
  }
}
