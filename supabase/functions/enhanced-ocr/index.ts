import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { InferenceClient } from "https://esm.sh/@huggingface/inference";

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
    
    // Initialize HuggingFace client with the correct token name
    const client = new InferenceClient(Deno.env.get('HUGGINGFACE_API_TOKEN'));

    // Convert base64 to blob
    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const imageBlob = new Blob([bytes], { type: 'image/jpeg' });

    console.log('📸 Calling HuggingFace imageToText API');

    // Use the proper HuggingFace client method for image-to-text
    const result = await client.imageToText({
      model: model,
      data: imageBlob,
    });

    console.log('✅ Enhanced OCR completed:', result);
    
    // Extract text from the response
    const extractedText = result.generated_text || result.text || '';
    const confidence = 0.85; // Higher confidence for enhanced OCR

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
      error: (error as Error).message,
      source: 'huggingface'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});