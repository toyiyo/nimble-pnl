interface ProductLookupResult {
  gtin: string;
  gtin14: string;
  product_name: string;
  brand?: string;
  package_size?: string;
  package_size_value?: number;
  package_size_unit?: string;
  package_qty?: number;
  category?: string;
  image_url?: string;
  confidence_score?: number;
  source: 'upcitemdb' | 'openfoodfacts' | 'local' | 'manual' | 'ocr' | 'visual';
  resolution: 'catalog' | 'external' | 'unknown';
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

// Enhanced GTIN normalization
const toGTIN14 = (barcode: string): string => {
  const digits = barcode.replace(/\D/g, '');
  return digits.padStart(14, '0');
};

// Enhanced fetch with timeout and proper error handling
const fetchJson = async (url: string, init: RequestInit = {}, timeoutMs = 4000): Promise<any> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'InventoryApp/1.0',
        ...(init.headers || {})
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
};

class ProductLookupService {
  private cache = new Map<string, ProductLookupResult>();
  private readonly CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

  // Enhanced lookup with multiple resolution strategies
  async lookupProduct(gtin: string, catalogLookup?: (gtin14: string) => Promise<any | null>): Promise<ProductLookupResult | null> {
    const gtin14 = toGTIN14(gtin);
    
    // 1. Check local catalog first
    if (catalogLookup) {
      try {
        const localResult = await catalogLookup(gtin14);
        if (localResult) {
          console.log('📦 Found in local catalog:', localResult.name);
          return {
            ...localResult,
            gtin,
            gtin14,
            product_name: localResult.name,
            source: 'local',
            resolution: 'catalog',
            confidence_score: 1.0
          };
        }
      } catch (error) {
        console.warn('❌ Local catalog lookup failed:', error);
      }
    }
    
    // 2. Check cache
    const cached = this.getCachedProduct(gtin14);
    if (cached) {
      console.log('📦 Found cached product:', cached.product_name);
      return cached;
    }

    // 3. Try external APIs in priority order
    try {
      // UPCItemDB first (better for general products)
      const upcResult = await this.lookupUPCItemDB(gtin);
      if (upcResult) {
        const enhanced = { ...upcResult, gtin14, resolution: 'external' as const };
        this.cacheProduct(enhanced);
        return enhanced;
      }

      // Open Food Facts fallback (better for food products)
      const offResult = await this.lookupOpenFoodFacts(gtin);
      if (offResult) {
        const enhanced = { ...offResult, gtin14, resolution: 'external' as const };
        this.cacheProduct(enhanced);
        return enhanced;
      }

      console.log('❌ Product not found in any external database');
      return { 
        gtin, 
        gtin14, 
        product_name: '', 
        source: 'manual', 
        resolution: 'unknown',
        confidence_score: 0
      };
    } catch (error) {
      console.error('🚨 Product lookup error:', error);
      return null;
    }
  }

  private async lookupUPCItemDB(gtin: string): Promise<ProductLookupResult | null> {
    try {
      console.log('🔍 Querying UPCItemDB for:', gtin);
      
      const data = await fetchJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(gtin)}`);
      
      if (data.total > 0 && data.items && data.items.length > 0) {
        const item = data.items[0];
        console.log('✅ Found in UPCItemDB:', item.title);
        
        // Parse package size if available
        const sizeMatch = item.size?.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/);
        
        return {
          gtin,
          gtin14: toGTIN14(gtin),
          product_name: item.title,
          brand: item.brand,
          package_size: item.size,
          package_size_value: sizeMatch ? parseFloat(sizeMatch[1]) : undefined,
          package_size_unit: sizeMatch ? sizeMatch[2] : undefined,
          category: item.category,
          image_url: item.images?.[0],
          source: 'upcitemdb',
          confidence_score: Math.min(0.7 + (item.title ? 0.1 : 0) + (item.brand ? 0.05 : 0) + (item.size ? 0.05 : 0) + (item.category ? 0.05 : 0) + (item.images?.[0] ? 0.05 : 0), 0.95),
          resolution: 'external'
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
      
      const data = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(gtin)}.json`);
      
      if (data.product) {
        const product = data.product;
        console.log('✅ Found in Open Food Facts:', product.product_name);
        
        // Parse package size
        const sizeMatch = product.quantity?.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/);
        
        return {
          gtin,
          gtin14: toGTIN14(gtin),
          product_name: product.product_name || product.generic_name,
          brand: product.brands?.split(',')[0]?.trim(),
          package_size: product.quantity,
          package_size_value: sizeMatch ? parseFloat(sizeMatch[1]) : undefined,
          package_size_unit: sizeMatch ? sizeMatch[2] : undefined,
          category: product.categories?.split(',')[0]?.trim(),
          image_url: product.image_front_url,
          source: 'openfoodfacts',
          confidence_score: 0.85,
          resolution: 'external'
        };
      }

      return null;
    } catch (error) {
      console.error('❌ Open Food Facts lookup failed:', error);
      return null;
    }
  }

  // Enhanced OCR-based product identification
  async identifyFromImage(imageBlob: Blob, ocrService?: any): Promise<ProductLookupResult | null> {
    if (!ocrService) {
      console.warn('OCR service not available');
      return null;
    }

    try {
      console.log('🔍 Analyzing image with OCR...');
      const ocrResult = await ocrService.extractText(imageBlob);
      
      if (!ocrResult.text || ocrResult.text.trim().length === 0) {
        return null;
      }

      // Parse OCR text for product information
      const productInfo = this.parseOCRText(ocrResult.text);
      
      if (productInfo.brand || productInfo.name) {
        return {
          gtin: '',
          gtin14: '',
          product_name: productInfo.name || 'Unknown Product',
          brand: productInfo.brand,
          package_size: productInfo.size,
          package_size_value: productInfo.sizeValue,
          package_size_unit: productInfo.sizeUnit,
          package_qty: productInfo.qty,
          source: 'ocr',
          resolution: 'unknown',
          confidence_score: ocrResult.confidence || 0.5
        };
      }

      return null;
    } catch (error) {
      console.error('❌ OCR identification failed:', error);
      return null;
    }
  }

  private parseOCRText(text: string): any {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    
    // Brand detection (usually largest, topmost text)
    const brandCandidates = lines.filter(line => 
      line.length > 2 && line.length < 30 && /^[A-Z][A-Za-z\s]+$/.test(line)
    );
    
    // Size extraction
    const sizeRegex = /(\d+(?:\.\d+)?)\s*(mL|L|oz|fl\s?oz|g|kg|lb|ct|count|pk|pack)\b/i;
    const sizeMatches = text.match(sizeRegex);
    
    // Quantity extraction
    const qtyRegex = /(\d+)\s*(ct|count|pcs|pieces|tabs|sticks|pack)\b/i;
    const qtyMatches = text.match(qtyRegex);
    
    return {
      brand: brandCandidates[0] || null,
      name: lines.find(line => line.length > 10 && line.length < 50) || null,
      size: sizeMatches ? sizeMatches[0] : null,
      sizeValue: sizeMatches ? parseFloat(sizeMatches[1]) : null,
      sizeUnit: sizeMatches ? sizeMatches[2] : null,
      qty: qtyMatches ? parseInt(qtyMatches[1]) : null
    };
  }

  private getCachedProduct(gtin: string): ProductLookupResult | null {
    const cached = this.cache.get(gtin);
    if (cached) {
      // Check if cache is still valid (using cached_at timestamp)
      const cacheData = localStorage.getItem(`product_cache_${gtin}`);
      if (cacheData) {
        try {
          const parsed = JSON.parse(cacheData);
          const cacheAge = Date.now() - new Date(parsed.cached_at).getTime();
          if (cacheAge < this.CACHE_DURATION) {
            return cached;
          }
        } catch (error) {
          console.warn('Cache timestamp parsing failed:', error);
        }
      }
      this.cache.delete(gtin);
      localStorage.removeItem(`product_cache_${gtin}`);
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