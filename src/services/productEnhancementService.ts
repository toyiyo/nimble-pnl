import { Product } from '@/hooks/useProducts';

interface EnhancedProductData {
  description?: string;
  brand?: string;
  category?: string;
  nutritionalInfo?: string;
  ingredients?: string[];
  packageSize?: string;
  manufacturer?: string;
}

interface SearchResult {
  title: string;
  snippet: string;
  link: string;
}

export class ProductEnhancementService {
  private static cache = new Map<string, EnhancedProductData>();

  static async enhanceProduct(product: Product): Promise<EnhancedProductData | null> {
    const cacheKey = `${product.name}_${product.brand || ''}`.toLowerCase();
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      // Create search query
      const searchQuery = this.buildSearchQuery(product);
      console.log('🔍 Searching for product info:', searchQuery);

      // Perform web search
      const searchResults = await this.performWebSearch(searchQuery);
      
      if (searchResults.length === 0) {
        return null;
      }

      // Extract enhanced data from search results
      const enhancedData = await this.extractEnhancedData(searchResults, product);
      
      // Cache the result
      if (enhancedData) {
        this.cache.set(cacheKey, enhancedData);
      }

      return enhancedData;
    } catch (error) {
      console.error('Product enhancement error:', error);
      return null;
    }
  }

  private static buildSearchQuery(product: Product): string {
    const parts = [];
    
    if (product.brand) parts.push(`"${product.brand}"`);
    parts.push(`"${product.name}"`);
    
    // Add GTIN if available
    if (product.gtin) {
      parts.push(`UPC ${product.gtin}`);
    }
    
    // Add category context
    if (product.category) {
      parts.push(product.category.toLowerCase());
    }
    
    return parts.join(' ') + ' product information ingredients nutrition';
  }

  private static async performWebSearch(query: string): Promise<SearchResult[]> {
    // This would typically use a web search API
    // For now, we'll simulate search results with common product databases
    const mockResults: SearchResult[] = [
      {
        title: `${query} - Product Information`,
        snippet: "Product details, ingredients, nutrition facts, and manufacturer information. High-quality product with detailed specifications.",
        link: "https://example.com/product"
      },
      {
        title: `${query} - Nutrition Database`,
        snippet: "Complete nutritional information, ingredient list, allergen warnings, and dietary information for this product.",
        link: "https://example.com/nutrition"
      }
    ];

    return mockResults;
  }

  private static async extractEnhancedData(
    searchResults: SearchResult[], 
    originalProduct: Product
  ): Promise<EnhancedProductData | null> {
    try {
      // Combine all search result snippets
      const combinedText = searchResults
        .map(result => `${result.title} ${result.snippet}`)
        .join(' ');

      // Use AI to extract structured data
      const enhancedData = await this.extractWithAI(combinedText, originalProduct);
      
      return enhancedData;
    } catch (error) {
      console.error('Enhanced data extraction error:', error);
      return null;
    }
  }

  private static async extractWithAI(
    text: string, 
    originalProduct: Product
  ): Promise<EnhancedProductData | null> {
    // This would typically call an AI service to extract structured information
    // For now, we'll provide enhanced mock data based on the product
    
    const enhanced: EnhancedProductData = {};
    
    // Generate enhanced description if not present
    if (!originalProduct.description || originalProduct.description.length < 20) {
      enhanced.description = this.generateEnhancedDescription(originalProduct, text);
    }

    // Enhanced brand information
    if (originalProduct.brand && !originalProduct.brand.includes('Brand')) {
      enhanced.brand = originalProduct.brand;
    }

    // Enhanced category
    if (originalProduct.category) {
      enhanced.category = this.refineCategory(originalProduct.category);
    }

    // Mock nutritional info for food items
    if (this.isFoodProduct(originalProduct)) {
      enhanced.nutritionalInfo = "Contains detailed nutritional information. Check packaging for complete facts.";
    }

    return Object.keys(enhanced).length > 0 ? enhanced : null;
  }

  private static generateEnhancedDescription(product: Product, searchText: string): string {
    const baseDescription = product.description || product.name;
    
    // Generate contextual description based on category
    if (product.category?.toLowerCase().includes('beverage')) {
      return `${baseDescription}. Premium beverage product with quality ingredients and packaging.`;
    } else if (product.category?.toLowerCase().includes('meat')) {
      return `${baseDescription}. Fresh, high-quality meat product. Store refrigerated and follow food safety guidelines.`;
    } else if (product.category?.toLowerCase().includes('produce')) {
      return `${baseDescription}. Fresh produce item. Store according to product guidelines for optimal freshness.`;
    } else if (product.category?.toLowerCase().includes('dairy')) {
      return `${baseDescription}. Dairy product requiring refrigeration. Check expiration date and storage instructions.`;
    }
    
    return `${baseDescription}. Quality product with detailed specifications and proper storage requirements.`;
  }

  private static refineCategory(category: string): string {
    const categoryMap: { [key: string]: string } = {
      'beverages': 'Beverages & Drinks',
      'meat': 'Meat & Poultry',
      'produce': 'Fresh Produce',
      'dairy': 'Dairy & Refrigerated',
      'dry goods': 'Pantry & Dry Goods',
      'cleaning': 'Cleaning & Maintenance Supplies',
      'paper': 'Paper Products & Disposables'
    };
    
    const lowerCategory = category.toLowerCase();
    for (const [key, value] of Object.entries(categoryMap)) {
      if (lowerCategory.includes(key)) {
        return value;
      }
    }
    
    return category;
  }

  private static isFoodProduct(product: Product): boolean {
    const foodCategories = ['beverages', 'meat', 'produce', 'dairy', 'dry goods'];
    const category = product.category?.toLowerCase() || '';
    return foodCategories.some(cat => category.includes(cat));
  }

  static clearCache(): void {
    this.cache.clear();
  }
}

export const productEnhancementService = new ProductEnhancementService();