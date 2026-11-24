import type {
  AddToCartInput,
  AddToCartOutput,
  CartSummaryOutput,
  RemoveFromCartInput,
  RemoveFromCartOutput,
} from '../../domain/models/MercadoLivreCartModel.js';
import type { MercadoLivreCartApiService } from '../../infrastructure/services/MercadoLivreCartApiService.js';

export class MercadoLivreCartService {
  constructor(private cartApiService: MercadoLivreCartApiService) {}

  async addToCart(input: AddToCartInput): Promise<AddToCartOutput> {
    return await this.cartApiService.addToCart(input);
  }

  async removeFromCart(
    input: RemoveFromCartInput,
  ): Promise<RemoveFromCartOutput> {
    return await this.cartApiService.removeFromCart(input);
  }

  async getCartSummary(customCookies?: string): Promise<CartSummaryOutput> {
    return await this.cartApiService.getCartSummary(customCookies);
  }
}
