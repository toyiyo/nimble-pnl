import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OCRRequest {
  imageData: string; // base64 encoded image
  model?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageData, model = 'microsoft/trocr-base-printed' }: OCRRequest = await req.json();
    
    if (!imageData) {
      throw new Error('No image data provided');
    }

    console.log(`🔍 Starting enhanced OCR with HuggingFace model: ${model}`);
    
    // Convert base64 to binary data for HuggingFace API
    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    
    // Call HuggingFace Inference API for OCR - send as binary data
    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('HUGGING_FACE_ACCESS_TOKEN')}`,
        'Content-Type': 'image/png',
      },
      body: binaryData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ HuggingFace API error:', response.status, errorText);
      throw new Error(`HuggingFace API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Enhanced OCR completed:', result);
    
    // Handle different response formats
    let extractedText = '';
    let confidence = 1.0;
    
    if (Array.isArray(result) && result.length > 0) {
      // Some models return array with generated_text
      extractedText = result[0].generated_text || result[0].text || '';
    } else if (result.generated_text) {
      extractedText = result.generated_text;
    } else if (result.text) {
      extractedText = result.text;
    } else if (typeof result === 'string') {
      extractedText = result;
    }

    return new Response(JSON.stringify({
      text: extractedText,
      confidence: confidence,
      source: 'huggingface',
      model: model
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Enhanced OCR error:', error);
    return new Response(JSON.stringify({
      error: error.message,
      source: 'huggingface'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});