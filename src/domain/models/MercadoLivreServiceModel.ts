export interface GetApiProductInput {
  product: string;
  page: number;
  onlyFull?: boolean;
}

export interface GetProductsInput {
  products: string[];
  onlyFull?: boolean;
  excludeInternational?: boolean;
}

export interface MercadoLivreCrawlerOutput {
  itemId?: string;
  name: string;
  price: number;
  originalPrice?: number;
  discount?: string;
  queryMatchRatio: number;
  url: string;
  directCheckoutUrl?: string;
  isFull: boolean;
  isInternational: boolean;
  internationalOrigin?: string;
  freeShipping: boolean;
  shippings: Array<{
    name: string;
    price: number;
    deliveryDays: number;
    originalDescription: string;
  }> | null;
  source?: 'mago' | 'html';
}

