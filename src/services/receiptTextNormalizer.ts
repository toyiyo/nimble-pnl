import { supabase } from '@/integrations/supabase/client';

// Common OCR abbreviations that can be expanded
const commonAbbreviations: Record<string, string> = {
  // Produce
  'bn': 'banana',
  'bna': 'banana', 
  'dna': 'banana', // OCR often misreads 'B' as 'D'
  'org': 'organic',
  'bnch': 'bunch',
  
  // Meat & Dairy
  'chkn': 'chicken',
  'chk': 'chicken',
  'bf': 'beef',
  'pk': 'pork',
  'mlk': 'milk',
  
  // Beverages
  'bln': 'blanco',
  'tq': 'tequila',
  'wn': 'wine',
  'br': 'beer',
  'sda': 'soda',
  
  // Pantry
  'flr': 'flour',
  'sgr': 'sugar',
  'slt': 'salt',
  'ol': 'oil',
  'vng': 'vinegar',
  
  // Units (common OCR misreads)
  'lb': 'pound',
  'lbs': 'pounds',
  'gal': 'gallon',
  'qt': 'quart',
  'pt': 'pint',
  'oz': 'ounce',
  
  // Brands (add your restaurant's common ones)
  'heb': 'h-e-b',
  'wmt': 'walmart',
  'tgt': 'target'
};

export interface AbbreviationMapping {
  id: string;
  restaurant_id: string;
  abbreviation: string;
  full_term: string;
  created_at: string;
}

export class ReceiptTextNormalizer {
  private static customMappings: Map<string, string> = new Map();

  /**
   * Load custom abbreviation mappings for a restaurant
   */
  static async loadCustomMappings(restaurantId: string): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('product_abbreviations')
        .select('*')
        .eq('restaurant_id', restaurantId);

      if (error) {
        console.error('Error loading custom abbreviations:', error);
        return;
      }

      this.customMappings.clear();
      data?.forEach(mapping => {
        this.customMappings.set(mapping.abbreviation.toLowerCase(), mapping.full_term.toLowerCase());
      });
    } catch (error) {
      console.error('Error loading custom mappings:', error);
    }
  }

  /**
   * Add a custom abbreviation mapping
   */
  static async addCustomMapping(
    restaurantId: string, 
    abbreviation: string, 
    fullTerm: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('product_abbreviations')
        .upsert({
          restaurant_id: restaurantId,
          abbreviation: abbreviation.toLowerCase(),
          full_term: fullTerm.toLowerCase()
        });

      if (error) {
        console.error('Error adding custom mapping:', error);
        return false;
      }

      // Update local cache
      this.customMappings.set(abbreviation.toLowerCase(), fullTerm.toLowerCase());
      return true;
    } catch (error) {
      console.error('Error adding custom mapping:', error);
      return false;
    }
  }

  /**
   * Normalize OCR text for better matching
   */
  static normalizeText(text: string): string {
    if (!text) return '';

    // Step 1: Basic cleanup
    const normalized = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove special chars except word chars and spaces
      .replace(/\s+/g, ' ')      // Collapse multiple spaces
      .trim();

    // Step 2: Apply abbreviation expansion
    const words = normalized.split(' ');
    const expandedWords = words.map(word => {
      // Check custom mappings first (restaurant-specific)
      if (this.customMappings.has(word)) {
        return this.customMappings.get(word)!;
      }
      
      // Check common abbreviations
      if (commonAbbreviations[word]) {
        return commonAbbreviations[word];
      }
      
      return word;
    });

    return expandedWords.join(' ');
  }

  /**
   * Generate search variants for a receipt item
   */
  static generateSearchVariants(receiptText: string): string[] {
    const variants = new Set<string>();
    
    // Original text (cleaned)
    const cleaned = receiptText.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    variants.add(cleaned);
    
    // Normalized with abbreviation expansion
    const normalized = this.normalizeText(receiptText);
    variants.add(normalized);
    
    // Try removing common OCR artifacts
    const withoutNumbers = cleaned.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
    if (withoutNumbers.length > 2) {
      variants.add(withoutNumbers);
      variants.add(this.normalizeText(withoutNumbers));
    }
    
    // Try individual significant words (3+ chars)
    const words = normalized.split(' ').filter(w => w.length >= 3);
    words.forEach(word => variants.add(word));
    
    // Remove empty variants
    return Array.from(variants).filter(v => v.length > 1);
  }

  /**
   * Learn from user corrections to improve future matches
   */
  static async learnFromCorrection(
    restaurantId: string,
    receiptText: string,
    selectedProductName: string
  ): Promise<void> {
    try {
      // Extract potential abbreviations from the receipt text
      const receiptWords = receiptText.toLowerCase().split(/\s+/);
      const productWords = selectedProductName.toLowerCase().split(/\s+/);
      
      // Find words in receipt that might be abbreviations for product words
      for (const receiptWord of receiptWords) {
        if (receiptWord.length <= 4) { // Potential abbreviation
          for (const productWord of productWords) {
            if (productWord.length > 4 && 
                productWord.startsWith(receiptWord.substring(0, 2))) {
              // This looks like an abbreviation - store it
              await this.addCustomMapping(restaurantId, receiptWord, productWord);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error learning from correction:', error);
    }
  }

  /**
   * Get current custom mappings for display/management
   */
  static async getCustomMappings(restaurantId: string): Promise<AbbreviationMapping[]> {
    try {
      const { data, error } = await supabase
        .from('product_abbreviations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching custom mappings:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching custom mappings:', error);
      return [];
    }
  }

  /**
   * Delete a custom mapping
   */
  static async deleteCustomMapping(mappingId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('product_abbreviations')
        .delete()
        .eq('id', mappingId);

      if (error) {
        console.error('Error deleting custom mapping:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error deleting custom mapping:', error);
      return false;
    }
  }
}

export { commonAbbreviations };