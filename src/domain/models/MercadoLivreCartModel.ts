export interface AddToCartInput {
  itemId: string;
  quantity?: number;
  customCookies?: string;
}

export interface AddToCartOutput {
  success: boolean;
  itemId: string;
  resolvedFrom?: string;
  quantity: number;
  totalCartQuantity?: number;
  itemPrice?: {
    current: number;
    original?: number;
  };
  cartStatus?: {
    status: string;
    displayQuantity: number;
  };
  directCheckoutUrl?: string;
  status?: string;
  message?: string;
}

export interface RemoveFromCartInput {
  itemId: string;
  customCookies?: string;
}

export interface RemoveFromCartOutput {
  success: boolean;
  itemId: string;
  totalCartQuantity?: number;
  message: string;
}

export interface CartItem {
  itemId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  url?: string;
}

export interface CartGroup {
  groupId: string;
  groupName: string;
  itemCount: number;
  shippingText?: string;
  shippingCost?: number;
  checkoutUrl?: string;
  items: CartItem[];
}

export interface CartSummaryOutput {
  success: boolean;
  totalItemsCount: number;
  productsSubtotal: number;
  discountAmount: number;
  shippingCost: number;
  totalToPay: number;
  savingsAmount: number;
  checkoutUrl?: string;
  allCheckoutUrl?: string;
  groups: CartGroup[];
  message?: string;
}
