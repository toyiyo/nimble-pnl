interface ProductLookupResult {
  gtin: string;
  product_name: string;
  brand?: string;
  package_size?: string;
  category?: string;
  image_url?: string;
  source: 'upcitemdb' | 'openfoodfacts' | 'local' | 'manual';
}

interface UPCItemDBResponse {
  code: string;
  total: number;
  items?: Array<{
    title: string;
    brand: string;
    size: string;
    category: string;
    images?: string[];
  }>;
}

interface OpenFoodFactsResponse {
  status: number;
  product?: {
    product_name: string;
    brands: string;
    quantity: string;
    categories: string;
    image_url: string;
  };
}

class ProductLookupService {
  private cache = new Map<string, ProductLookupResult>();
  private readonly CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

  async lookupProduct(gtin: string): Promise<ProductLookupResult | null> {
    // Check cache first
    const cached = this.getCachedProduct(gtin);
    if (cached) {
      console.log('📦 Found cached product:', cached.product_name);
      return cached;
    }

    // Try external APIs in priority order
    try {
      // 1. Try UPCItemDB first (better for general products)
      const upcResult = await this.lookupUPCItemDB(gtin);
      if (upcResult) {
        this.cacheProduct(upcResult);
        return upcResult;
      }

      // 2. Try Open Food Facts (better for food products)
      const offResult = await this.lookupOpenFoodFacts(gtin);
      if (offResult) {
        this.cacheProduct(offResult);
        return offResult;
      }

      console.log('❌ Product not found in any external database');
      return null;
    } catch (error) {
      console.error('🚨 Product lookup error:', error);
      return null;
    }
  }

  private async lookupUPCItemDB(gtin: string): Promise<ProductLookupResult | null> {
    try {
      console.log('🔍 Querying UPCItemDB for:', gtin);
      
      // UPCItemDB free API endpoint
      const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${gtin}`);
      
      if (!response.ok) {
        throw new Error(`UPCItemDB API error: ${response.status}`);
      }

      const data: UPCItemDBResponse = await response.json();
      
      if (data.total > 0 && data.items && data.items.length > 0) {
        const item = data.items[0];
        console.log('✅ Found in UPCItemDB:', item.title);
        
        return {
          gtin,
          product_name: item.title,
          brand: item.brand,
          package_size: item.size,
          category: item.category,
          image_url: item.images?.[0],
          source: 'upcitemdb'
        };
      }

      return null;
    } catch (error) {
      console.error('❌ UPCItemDB lookup failed:', error);
      return null;
    }
  }

  private async lookupOpenFoodFacts(gtin: string): Promise<ProductLookupResult | null> {
    try {
      console.log('🔍 Querying Open Food Facts for:', gtin);
      
      // Open Food Facts API endpoint
      const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${gtin}.json`);
      
      if (!response.ok) {
        throw new Error(`Open Food Facts API error: ${response.status}`);
      }

      const data: OpenFoodFactsResponse = await response.json();
      
      if (data.status === 1 && data.product) {
        const product = data.product;
        console.log('✅ Found in Open Food Facts:', product.product_name);
        
        return {
          gtin,
          product_name: product.product_name,
          brand: product.brands?.split(',')[0]?.trim(),
          package_size: product.quantity,
          category: product.categories?.split(',')[0]?.trim(),
          image_url: product.image_url,
          source: 'openfoodfacts'
        };
      }

      return null;
    } catch (error) {
      console.error('❌ Open Food Facts lookup failed:', error);
      return null;
    }
  }

  private getCachedProduct(gtin: string): ProductLookupResult | null {
    const cached = this.cache.get(gtin);
    if (cached) {
      // Check if cache is still valid
      const cacheAge = Date.now() - new Date(cached.gtin).getTime();
      if (cacheAge < this.CACHE_DURATION) {
        return cached;
      } else {
        this.cache.delete(gtin);
      }
    }
    return null;
  }

  private cacheProduct(product: ProductLookupResult): void {
    this.cache.set(product.gtin, product);
    
    // Also save to localStorage for persistence
    try {
      const cacheData = {
        ...product,
        cached_at: new Date().toISOString()
      };
      localStorage.setItem(`product_cache_${product.gtin}`, JSON.stringify(cacheData));
    } catch (error) {
      console.warn('Failed to save product to localStorage:', error);
    }
  }

  // Load cache from localStorage on initialization
  loadCacheFromStorage(): void {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('product_cache_')) {
          const data = localStorage.getItem(key);
          if (data) {
            const product = JSON.parse(data);
            const cacheAge = Date.now() - new Date(product.cached_at).getTime();
            
            if (cacheAge < this.CACHE_DURATION) {
              this.cache.set(product.gtin, product);
            } else {
              localStorage.removeItem(key);
            }
          }
        }
      }
      console.log(`📦 Loaded ${this.cache.size} products from cache`);
    } catch (error) {
      console.warn('Failed to load cache from localStorage:', error);
    }
  }
}

export const productLookupService = new ProductLookupService();

// Initialize cache on module load
productLookupService.loadCacheFromStorage();

export type { ProductLookupResult };