import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { MercadoLivreService } from './application/services/MercadoLivreService.js';
import { MercadoLivreCartService } from './application/services/MercadoLivreCartService.js';
import { MagoMaxwellService } from './infrastructure/services/MagoMaxwellService.js';
import { MercadoLivreApiService } from './infrastructure/services/MercadoLivreApiService.js';
import { MercadoLivreCartApiService } from './infrastructure/services/MercadoLivreCartApiService.js';
import { MercadoLivreToolsController } from './interface/controllers/MercadoLivreToolsController.js';

async function main() {
  const server = new McpServer(
    {
      name: 'mercadolibre',
      version: '1.3.0',
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    },
  );

  const magoService = new MagoMaxwellService();
  const apiService = new MercadoLivreApiService();
  const service = new MercadoLivreService(apiService, magoService);

  const cartApiService = new MercadoLivreCartApiService(magoService);
  const cartService = new MercadoLivreCartService(cartApiService);

  new MercadoLivreToolsController(server, service, cartService);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mercado Libre MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
