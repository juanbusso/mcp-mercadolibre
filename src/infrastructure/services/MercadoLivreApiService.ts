import voca from 'voca';

import type { GetApiProductInput } from '../../domain/models/MercadoLivreServiceModel.js';

export class MercadoLivreApiService {
  private readonly API_BASE = 'https://listado.mercadolibre.com.ar';
  private readonly HEADERS = {
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'es-AR,es;q=0.9',
    'Cache-Control': 'no-cache',
    'User-Agent':
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  };

  async makeTextRequest<T>(
    endpoint: string,
    headers: Record<string, string>,
  ): Promise<T | null> {
    const url = `${this.API_BASE}${endpoint}`;

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return (await response.text()) as T;
    } catch (error) {
      console.error('Error making API request:', error);
      return null;
    }
  }

  getUrlBase(): string {
    return this.API_BASE;
  }

  async getProduct(input: GetApiProductInput): Promise<string | null> {
    const { product, page = 1, onlyFull = false } = input;
    const search = voca.slugify(product);
    const limit = 50;
    const newPage = page > 1 ? `_Desde_${limit * (page - 1) + 1}` : '';
    const fullFilter = onlyFull ? '_Envio_Full' : '';

    const headers = {
      ...this.HEADERS,
      Referer: `${this.API_BASE}/${search}`,
    };

    const data = await this.makeTextRequest<string>(
      `/${search}${fullFilter}${newPage}_NoIndex_True`,
      headers,
    );
    if (!data) return null;
    return data;
  }
}
