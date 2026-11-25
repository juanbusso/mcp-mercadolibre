import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import voca from 'voca';

import type {
  GetProductsInput,
  MercadoLivreCrawlerOutput,
} from '../../domain/models/MercadoLivreServiceModel.js';
import { wordsMatching } from '../../domain/utils/crawler/words-matching.js';
import type { MagoMaxwellService } from '../../infrastructure/services/MagoMaxwellService.js';
import type { MercadoLivreApiService } from '../../infrastructure/services/MercadoLivreApiService.js';

export class MercadoLivreService {
  url: string | null = null;
  pageContent: cheerio.CheerioAPI | null = null;
  products: MercadoLivreCrawlerOutput[] = [];
  page: number = 1;

  constructor(
    private apiService: MercadoLivreApiService,
    private magoService?: MagoMaxwellService,
  ) {}

  async getProducts(input: string[] | GetProductsInput) {
    const products = Array.isArray(input) ? input : input.products;
    const onlyFull = Array.isArray(input) ? false : !!input.onlyFull;
    const excludeInternational = Array.isArray(input)
      ? false
      : (input.excludeInternational ?? onlyFull);

    this.page = 1;
    this.products = [];

    if (products && products.length > 0) {
      // 1. Primary search engine: Mago / Maxwell (returns real prices, Full/local flags & concrete seller MLA item_ids)
      if (this.magoService) {
        const magoResults: MercadoLivreCrawlerOutput[] = [];
        for (const term of products.slice(0, 3)) {
          const found = await this.magoService.searchProducts(term, {
            onlyFull,
            excludeInternational,
            limit: 8,
          });
          magoResults.push(...found);
        }
        if (magoResults.length > 0) {
          this.products = magoResults;
          return this.getLowestValueItem(onlyFull, excludeInternational);
        }
      }

      // 2. Fallback: legacy HTML crawler
      await this.getItems(products[0], onlyFull);
    }

    const lowestValueItem = this.getLowestValueItem(
      onlyFull,
      excludeInternational,
    );

    return lowestValueItem;
  }

  private getLowestValueItem = (
    onlyFull: boolean = false,
    excludeInternational: boolean = false,
  ): MercadoLivreCrawlerOutput[] => {
    let items: MercadoLivreCrawlerOutput[] = [...this.products];

    if (onlyFull) {
      items = items.filter((p) => p.isFull);
    }

    if (excludeInternational) {
      items = items.filter((p) => !p.isInternational);
    }

    items.sort((a, b) => a.price - b.price);

    return items;
  };

  private getItems = async (product: string, onlyFull: boolean = false): Promise<void> => {
    const body = await this.request(product, onlyFull);
    if (body) {
      const hasItems = this.hasItems();

      if (hasItems) {
        this.parseHTML(product, onlyFull);

        const hasPagination = this.hasPagination();
        if (hasPagination) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await this.getItems(product, onlyFull);
        }
      }
    }
  };

  private hasItems = (): boolean => {
    const $ = this.pageContent;
    if (!$) {
      return false;
    }
    return (
      $('.ui-search-layout__item').length > 0 ||
      $('.poly-card').length > 0 ||
      $('.ui-search-result__wrapper').length > 0
    );
  };

  private hasPagination = (): boolean => {
    const $ = this.pageContent;
    if (!$) {
      return false;
    }
    const buttonNext = $('[class*="andes-pagination__button--next"]').length > 0;
    if (buttonNext) {
      this.page++;
    }

    if (this.page > 2) {
      return false;
    }

    return buttonNext;
  };

  private request = async (query: string, onlyFull: boolean = false): Promise<string | null> => {
    const search = voca.slugify(query);

    const html = await this.apiService
      .getProduct({
        product: search,
        page: this.page,
        onlyFull,
      })
      .then((response) => {
        if (response) {
          this.pageContent = cheerio.load(response);
          return response;
        }
        return null;
      })
      .catch((error) => {
        console.error('Error fetching product:', error);
        return null;
      });

    if (!html) {
      console.error('Error fetching product:', html);
      return null;
    }

    return html;
  };

  private parseHTML = (product: string, onlyFull: boolean = false): void => {
    const $ = this.pageContent;
    if (!$) {
      console.error('Error parsing HTML: No content available');
      return;
    }

    const uiSearchLayoutItem = this.layoutItems();

    if (uiSearchLayoutItem) {
      uiSearchLayoutItem.each((_, element) => {
        const uiSearchItemTitle =
          $(element).find('.poly-component__title').text() ||
          $(element).find('div[class="poly-card__content"] h3').text() ||
          $(element).find('h2.ui-search-item__title').text() ||
          $(element).find('h3').text();
        const productOriginalName = voca(uiSearchItemTitle).trim().value();
        const price = this.getPrice(element);
        const originalPrice = this.getOriginalPrice(element);
        const discount = this.getDiscount(element);

        const matching = wordsMatching({
          originalName: productOriginalName,
          querySearchByFilter: product,
          price,
          debug: false,
        });

        if (matching.queryMatchRatio >= 0.3 || !productOriginalName) {
          if (price) {
            const productUrl = this.getUrl(element);
            if (productUrl && this.products.some((p) => p.url === productUrl)) {
              return;
            }
            const { isInternational, origin: internationalOrigin } =
              this.checkIsInternational(element);
            const isFull = isInternational ? false : (this.checkIsFull(element) || onlyFull);
            const freeShipping = this.checkFreeShipping(element);
            const shippings = this.getShippings(
              element,
              isFull,
              freeShipping,
              isInternational,
              internationalOrigin,
            );

            this.products.push({
              name: productOriginalName,
              price,
              originalPrice,
              discount,
              queryMatchRatio: matching.queryMatchRatio,
              url: productUrl,
              isFull,
              isInternational,
              internationalOrigin,
              freeShipping,
              shippings,
            });
          }
        }
      });
    }
  };

  private layoutItems = () => {
    const $ = this.pageContent;
    if (!$) {
      return null;
    }

    if ($('.poly-card').length > 0) {
      return $('.poly-card');
    }
    if ($('.ui-search-layout__item').length > 0) {
      return $('.ui-search-layout__item');
    }
    if ($('.ui-search-result__wrapper').length > 0) {
      return $('.ui-search-result__wrapper');
    }
    return null;
  };

  private getPrice = (element: Element): number | undefined => {
    const $ = this.pageContent;
    if (!$) {
      return undefined;
    }

    // Prioritize current price container, explicitly ignoring previous/strikethrough prices
    const currentPriceText =
      $(element)
        .find('.poly-price__current .andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__fraction')
        .first()
        .text() ||
      $(element)
        .find('.ui-search-price__second-line .andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__fraction')
        .first()
        .text() ||
      $(element)
        .find('.andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__fraction')
        .first()
        .text() ||
      $(element)
        .find('div[class*="poly-price__current"] .andes-money-amount__fraction')
        .first()
        .text() ||
      $(element).find('.andes-money-amount__fraction:first').text();

    if (!currentPriceText) {
      return undefined;
    }

    return parseFloat(
      currentPriceText
        .replace(/[$R\s]/g, '')
        .replace(/\./g, '')
        .replace(',', '.'),
    );
  };

  private getOriginalPrice = (element: Element): number | undefined => {
    const $ = this.pageContent;
    if (!$) {
      return undefined;
    }

    const prevPriceText = $(element)
      .find('.andes-money-amount--previous .andes-money-amount__fraction, s .andes-money-amount__fraction')
      .first()
      .text();

    if (!prevPriceText) {
      return undefined;
    }

    return parseFloat(
      prevPriceText
        .replace(/[$R\s]/g, '')
        .replace(/\./g, '')
        .replace(',', '.'),
    );
  };

  private getDiscount = (element: Element): string | undefined => {
    const $ = this.pageContent;
    if (!$) {
      return undefined;
    }

    const discountText = $(element)
      .find('.poly-price__discount-polylabel, .andes-money-amount__discount, .poly-price__discount, [class*="discount"]')
      .first()
      .text()
      .trim();

    return discountText || undefined;
  };

  private getUrl = (element: Element): string => {
    const $ = this.pageContent;
    if (!$) {
      return '';
    }
    const productUrl =
      $(element).find('a.poly-component__title').attr('href') ||
      $(element).find('a[class="poly-component__title"]').attr('href') ||
      $(element).find('a.ui-search-link').attr('href') ||
      $(element).find('a').attr('href');
    if (!productUrl) {
      return '';
    }
    return productUrl;
  };

  private checkIsInternational = (
    element: Element,
  ): { isInternational: boolean; origin?: string } => {
    const $ = this.pageContent;
    if (!$) return { isInternational: false };

    const $el = $(element);

    // 1. Check CBT elements / classes (spans, divs, labels)
    const cbtEl = $el.find(
      '.poly-component__cbt, span[class*="poly-component__cbt"], div[class*="poly-component__cbt"], .ui-search-item__cbt, [class*="cbt"]',
    );
    if (cbtEl.length > 0) {
      const text = cbtEl.first().text().trim();
      return { isInternational: true, origin: text || 'Internacional' };
    }

    // 2. Check full element text for international indicators
    const fullText = $el.text();
    if (/desde china/i.test(fullText)) {
      return { isInternational: true, origin: 'China' };
    }
    if (/desde usa|desde estados unidos/i.test(fullText)) {
      return { isInternational: true, origin: 'USA' };
    }
    if (
      /compra internacional|env[ií]o internacional|desde el exterior/i.test(
        fullText,
      )
    ) {
      return { isInternational: true, origin: 'Internacional' };
    }

    // 3. Check shipping labels
    const shippingText = $el
      .find(
        '.poly-component__shipping, .poly-shipping, [class*="shipping"]',
      )
      .text();
    if (/internacional|china|exterior/i.test(shippingText)) {
      return { isInternational: true, origin: 'Internacional' };
    }

    return { isInternational: false };
  };

  private checkIsFull = (
    element: Element,
    isInternational: boolean = false,
  ): boolean => {
    // If it is an international CBT item, it cannot be in the Argentine domestic Full warehouse
    if (isInternational) return false;

    const $ = this.pageContent;
    if (!$) return false;

    const $el = $(element);

    // Check SVG use tags referencing full (e.g. #poly_full, #fulfillment)
    const hasFullSvg = $el
      .find('svg use')
      .toArray()
      .some((useEl) => {
        const href =
          $(useEl).attr('href') || $(useEl).attr('xlink:href') || '';
        return href.toLowerCase().includes('full');
      });
    if (hasFullSvg) return true;

    // Check class names related to Full / fulfillment
    const hasFullClass =
      $el.find(
        '.poly-component__shipped-from, .poly-component__icon-full, .ui-search-item__fulfillment, [class*="fulfillment" i], .poly-shipping--fulfillment',
      ).length > 0;
    if (hasFullClass) return true;

    // Check aria-labels or titles or alt attributes
    const hasFullAttr =
      $el.find(
        '[aria-label*="Full" i], [title*="Full" i], [alt*="Full" i]',
      ).length > 0;
    if (hasFullAttr) return true;

    // Check text inside shipping or badge elements
    const shippingText = $el
      .find(
        '.poly-component__shipping, .poly-component__shipped-from, .ui-search-item__shipping, .ui-search-item__fulfillment, .poly-shipping',
      )
      .text();
    if (/\bfull\b/i.test(shippingText)) return true;

    return false;
  };

  private checkFreeShipping = (element: Element): boolean => {
    const $ = this.pageContent;
    if (!$) return false;

    const $el = $(element);
    const shippingText = $el
      .find(
        '.poly-component__shipping, .ui-search-item__shipping, .poly-shipping, .ui-search-item__shipping--free',
      )
      .text()
      .toLowerCase();

    return (
      shippingText.includes('gratis') ||
      shippingText.includes('grátis') ||
      shippingText.includes('free') ||
      $el.find('.ui-search-item__shipping--free').length > 0
    );
  };

  private getShippings = (
    element: Element,
    isFull: boolean,
    freeShipping: boolean,
    isInternational: boolean = false,
    internationalOrigin?: string,
  ): Array<{
    name: string;
    price: number;
    deliveryDays: number;
    originalDescription: string;
  }> => {
    const $ = this.pageContent;
    if (!$) {
      return [];
    }
    const productShipping: {
      name: string;
      price: number;
      deliveryDays: number;
      originalDescription: string;
    }[] = [];

    const shippingFreeText = $(element)
      .find('div[class*="poly-component__shipping"], .ui-search-item__shipping')
      .text()
      .trim();

    if (freeShipping || shippingFreeText) {
      productShipping.push({
        name: freeShipping ? 'Envío gratis' : 'Envío',
        price: 0,
        deliveryDays: 0,
        originalDescription: shippingFreeText || (freeShipping ? 'Envío gratis' : 'Envío estándar'),
      });
    }

    const shippingFullText = $(element)
      .find(
        'span[class*="poly-component__shipped-from"], .ui-search-item__fulfillment',
      )
      .text()
      .trim();

    if (isFull) {
      productShipping.push({
        name: 'FULL',
        price: 0,
        deliveryDays: 0,
        originalDescription: shippingFullText || 'Enviado por Full',
      });
    }

    const shippingInternationalText = $(element)
      .find(
        '.poly-component__cbt, span[class*="poly-component__cbt"], div[class*="poly-component__cbt"], .ui-search-item__cbt, [class*="cbt"]',
      )
      .text()
      .trim();

    if (isInternational || shippingInternationalText) {
      const origin = internationalOrigin || shippingInternationalText || 'el exterior';
      productShipping.push({
        name: 'Compra Internacional',
        price: 0,
        deliveryDays: 0,
        originalDescription: `Envío desde ${origin} (Compra Internacional - demora más tiempo y puede sumar impuestos de aduana en checkout)`,
      });
    }

    return productShipping;
  };
}
