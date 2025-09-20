import { createWorker } from 'tesseract.js';

interface OCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

class OCRService {
  private worker: any = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('🔧 Initializing OCR worker...');
      // Use the simplified modern API
      this.worker = await createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${(m.progress * 100).toFixed(1)}%`);
          }
        }
      });
      
      // Optimize for package text recognition
      await this.worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,- %()/',
        tessedit_pageseg_mode: '6', // Uniform block of text
      });

      this.isInitialized = true;
      console.log('✅ OCR worker initialized');
    } catch (error) {
      console.error('❌ OCR initialization failed:', error);
      this.worker = null;
      this.isInitialized = false;
      throw error;
    }
  }

  async extractText(imageBlob: Blob): Promise<OCRResult> {
    await this.initialize();

    try {
      console.log('🔍 Running OCR on image...');
      const result = await this.worker.recognize(imageBlob);
      
      const words = result.data.words?.map((word: any) => ({
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox
      })) || [];

      console.log(`✅ OCR completed. Confidence: ${result.data.confidence}%`);
      
      return {
        text: result.data.text || '',
        confidence: result.data.confidence / 100, // Convert to 0-1 range
        words
      };
    } catch (error) {
      console.error('❌ OCR text extraction failed:', error);
      throw error;
    }
  }

  // Extract specific patterns for product information
  extractProductInfo(text: string): {
    brands: string[];
    sizes: Array<{ value: number; unit: string; text: string }>;
    quantities: Array<{ value: number; unit: string; text: string }>;
    keywords: string[];
  } {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    
    // Brand detection - usually capitalized, shorter lines
    const brands = lines.filter(line => 
      line.length >= 2 && 
      line.length <= 25 && 
      /^[A-Z][A-Za-z\s&'.-]+$/.test(line) &&
      !this.isCommonWord(line)
    );

    // Size patterns
    const sizeRegex = /(\d+(?:\.\d+)?)\s*(mL|L|oz|fl\s?oz|g|kg|lb|ct|count|pk|pack|lbs)\b/gi;
    const sizes: Array<{ value: number; unit: string; text: string }> = [];
    let match;
    while ((match = sizeRegex.exec(text)) !== null) {
      sizes.push({
        value: parseFloat(match[1]),
        unit: match[2].toLowerCase(),
        text: match[0]
      });
    }

    // Quantity patterns  
    const qtyRegex = /(\d+)\s*(ct|count|pcs|pieces|tabs|sticks|pack)\b/gi;
    const quantities: Array<{ value: number; unit: string; text: string }> = [];
    while ((match = qtyRegex.exec(text)) !== null) {
      quantities.push({
        value: parseInt(match[1]),
        unit: match[2].toLowerCase(),
        text: match[0]
      });
    }

    // Extract meaningful keywords
    const keywords = lines.filter(line => 
      line.length >= 3 && 
      line.length <= 40 &&
      !sizes.some(s => line.includes(s.text)) &&
      !quantities.some(q => line.includes(q.text))
    );

    return { brands, sizes, quantities, keywords };
  }

  private isCommonWord(word: string): boolean {
    const common = [
      'THE', 'AND', 'FOR', 'WITH', 'FROM', 'NEW', 'FRESH', 'NATURAL',
      'ORGANIC', 'BEST', 'GREAT', 'GOOD', 'MADE', 'USA', 'AMERICA'
    ];
    return common.includes(word.toUpperCase());
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      console.log('🛑 OCR worker terminated');
    }
  }
}

export const ocrService = new OCRService();
export type { OCRResult };