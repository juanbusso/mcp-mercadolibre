import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { MercadoLivreService } from './application/services/MercadoLivreService.js';
import { MercadoLivreCartService } from './application/services/MercadoLivreCartService.js';
import { MercadoLivreApiService } from './infrastructure/services/MercadoLivreApiService.js';
import { MercadoLivreCartApiService } from './infrastructure/services/MercadoLivreCartApiService.js';
import { MercadoLivreToolsController } from './interface/controllers/MercadoLivreToolsController.js';

async function main() {
  const server = new McpServer(
    {
      name: 'mercadolibre',
      version: '1.2.0',
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    },
  );

  const apiService = new MercadoLivreApiService();
  const service = new MercadoLivreService(apiService);

  const cartApiService = new MercadoLivreCartApiService();
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
