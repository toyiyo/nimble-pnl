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
      
      // Optimize for package text recognition with enhanced settings
      await this.worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,%-&()[]/$',
        tessedit_pageseg_mode: '11', // Sparse text - better for scattered text like labels
        load_system_dawg: '0', // Disable dictionary for better accuracy on brands/product names
        load_freq_dawg: '0', // Disable frequency dictionary
        tessedit_ocr_engine_mode: '1', // LSTM neural net only (most accurate)
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
      
      // Preprocess the image for better OCR accuracy
      const processedImageBlob = await this.preprocessImage(imageBlob);
      
      const result = await this.worker.recognize(processedImageBlob);
      
      const words = result.data.words?.map((word: any) => ({
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox
      })) || [];

      const confidence = result.data.confidence / 100; // Convert to 0-1 range
      console.log(`✅ OCR completed. Confidence: ${result.data.confidence}%`);
      console.log('📝 Extracted text:', result.data.text);
      
      // If confidence is low, try enhanced OCR fallback
      if (confidence < 0.6 || !result.data.text?.trim()) {
        console.log('🚀 Confidence low, trying enhanced OCR fallback...');
        try {
          const enhancedResult = await this.tryEnhancedOCR(processedImageBlob);
          if (enhancedResult && enhancedResult.text?.trim()) {
            console.log('✅ Enhanced OCR provided better result');
            return enhancedResult;
          }
        } catch (enhancedError) {
          console.warn('⚠️ Enhanced OCR failed, using original result:', enhancedError);
        }
      }
      
      return {
        text: result.data.text || '',
        confidence,
        words
      };
    } catch (error) {
      console.error('❌ OCR text extraction failed:', error);
      throw error;
    }
  }

  private async tryEnhancedOCR(imageBlob: Blob): Promise<OCRResult | null> {
    try {
      // Convert blob to base64 for the API
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const img = new Image();
      
      return new Promise((resolve, reject) => {
        img.onload = async () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          
          const imageData = canvas.toDataURL('image/png');
          
          // Import supabase client
          const { supabase } = await import('@/integrations/supabase/client');
          
          console.log('🚀 Trying Grok OCR via OpenRouter...');
          const response = await supabase.functions.invoke('grok-ocr', {
            body: { imageData }
          });
          
          if (response.error) {
            console.error('Grok OCR error:', response.error);
            reject(new Error(response.error.message));
            return;
          }
          
          const result = response.data;
          console.log('✅ Grok OCR result:', result);
          
          resolve({
            text: result.text || '',
            confidence: result.confidence || 0.8,
            words: [] // Grok doesn't return word-level data, focus on text extraction
          });
        };
        
        img.onerror = () => reject(new Error('Failed to load image for Grok OCR'));
        img.src = URL.createObjectURL(imageBlob);
      });
    } catch (error) {
      console.error('❌ Grok OCR failed:', error);
      return null;
    }
  }

  private async preprocessImage(imageBlob: Blob): Promise<Blob> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const img = new Image();
      
      img.onload = () => {
        // Scale image for better OCR (aim for ~300 DPI equivalent, characters ~30px tall)
        const minHeight = 600;
        let scale = img.height < minHeight ? minHeight / img.height : 1;
        // Cap scaling to avoid excessive memory usage
        scale = Math.min(scale, 3);
        
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        
        // Draw scaled image with slight blur to smooth jagged edges
        ctx.filter = 'blur(0.5px)';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none';
        
        // Get image data for processing
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Calculate histogram for Otsu's thresholding
        const histogram = new Array(256).fill(0);
        const grayData = [];
        
        for (let i = 0; i < data.length; i += 4) {
          const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
          grayData.push(gray);
          histogram[gray]++;
        }
        
        // Otsu's thresholding for optimal binarization
        const threshold = this.calculateOtsuThreshold(histogram, grayData.length);
        
        // Check if image appears to be inverted (white text on dark background)
        const avgBrightness = grayData.reduce((sum, val) => sum + val, 0) / grayData.length;
        const isInverted = avgBrightness < 100;
        
        // Apply adaptive contrast enhancement and binarization
        for (let i = 0; i < data.length; i += 4) {
          const gray = grayData[i / 4];
          
          let processed;
          if (isInverted) {
            // Invert for white text on dark background
            processed = gray > threshold ? 0 : 255;
          } else {
            // Normal: black text on white background
            processed = gray < threshold ? 0 : 255;
          }
          
          data[i] = processed;     // Red
          data[i + 1] = processed; // Green  
          data[i + 2] = processed; // Blue
          // Alpha stays the same
        }
        
        // Apply morphological operations to reduce noise
        this.applyMorphologicalClean(imageData);
        
        // Put processed data back
        ctx.putImageData(imageData, 0, 0);
        
        // Convert to blob
        canvas.toBlob((blob) => {
          resolve(blob!);
        }, 'image/png');
      };
      
      img.src = URL.createObjectURL(imageBlob);
    });
  }

  private calculateOtsuThreshold(histogram: number[], totalPixels: number): number {
    let sumTotal = 0;
    for (let i = 0; i < 256; i++) {
      sumTotal += i * histogram[i];
    }

    let sumBackground = 0;
    let weightBackground = 0;
    let weightForeground = 0;
    let maxVariance = 0;
    let threshold = 0;

    for (let i = 0; i < 256; i++) {
      weightBackground += histogram[i];
      if (weightBackground === 0) continue;

      weightForeground = totalPixels - weightBackground;
      if (weightForeground === 0) break;

      sumBackground += i * histogram[i];
      const meanBackground = sumBackground / weightBackground;
      const meanForeground = (sumTotal - sumBackground) / weightForeground;

      const variance = weightBackground * weightForeground * 
        Math.pow(meanBackground - meanForeground, 2);

      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = i;
      }
    }

    return threshold;
  }

  private applyMorphologicalClean(imageData: ImageData): void {
    const { data, width, height } = imageData;
    const cleaned = new Uint8ClampedArray(data);
    
    // Simple morphological opening (erosion followed by dilation) to remove noise
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        
        // Check 3x3 neighborhood for isolated noise pixels
        let whiteNeighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nIdx = ((y + dy) * width + (x + dx)) * 4;
            if (data[nIdx] > 128) whiteNeighbors++;
          }
        }
        
        // Remove isolated white pixels (noise)
        if (data[idx] > 128 && whiteNeighbors < 3) {
          cleaned[idx] = cleaned[idx + 1] = cleaned[idx + 2] = 0;
        }
      }
    }
    
    // Copy cleaned data back
    data.set(cleaned);
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