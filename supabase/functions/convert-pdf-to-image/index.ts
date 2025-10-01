import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: {
          persistSession: false,
        },
      }
    );

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabaseClient.auth.getUser(token);

    if (!user) {
      throw new Error('Unauthorized');
    }

    const { filePath, receiptId } = await req.json();

    if (!filePath) {
      throw new Error('File path is required');
    }

    console.log('Converting PDF to image:', filePath);

    // Download the PDF from storage
    const { data: fileData, error: downloadError } = await supabaseClient.storage
      .from('receipt-images')
      .download(filePath);

    if (downloadError) {
      console.error('Error downloading file:', downloadError);
      throw downloadError;
    }

    console.log('PDF downloaded, size:', fileData.size);

    // Convert PDF to image using CloudConvert API (or similar service)
    // For now, we'll use a simpler approach: convert first page to image using ImageMagick via API
    
    // Alternative: Use pdf2pic or similar service
    // For demonstration, we'll use a FormData approach with a conversion service
    
    const formData = new FormData();
    formData.append('file', fileData, 'receipt.pdf');
    
    // Use a free PDF to image API service (like api2pdf, cloudmersive, etc.)
    // For this example, we'll use a direct approach with Deno's built-in capabilities
    
    // Since we can't easily convert PDF in Deno without external services,
    // let's use the ConvertAPI service (you'll need to add the API key)
    const convertApiKey = Deno.env.get('CONVERTAPI_SECRET');
    
    if (!convertApiKey) {
      throw new Error('CONVERTAPI_SECRET not configured. Please add it in Edge Function Secrets.');
    }

    // Convert PDF to JPG using ConvertAPI
    const convertFormData = new FormData();
    convertFormData.append('File', fileData, 'receipt.pdf');
    convertFormData.append('ScaleImage', 'true');
    convertFormData.append('ImageResolution', '200');

    const convertResponse = await fetch(
      `https://v2.convertapi.com/convert/pdf/to/jpg?Secret=${convertApiKey}`,
      {
        method: 'POST',
        body: convertFormData,
      }
    );

    if (!convertResponse.ok) {
      const errorText = await convertResponse.text();
      console.error('ConvertAPI error:', errorText);
      throw new Error('Failed to convert PDF to image');
    }

    const convertResult = await convertResponse.json();
    console.log('Conversion successful');

    // Download the converted image
    const imageUrl = convertResult.Files[0].Url;
    const imageResponse = await fetch(imageUrl);
    const imageBlob = await imageResponse.blob();

    console.log('Image downloaded, size:', imageBlob.size);

    // Upload the converted image to storage
    const newFileName = filePath.replace('.pdf', '.jpg');
    
    const { error: uploadError } = await supabaseClient.storage
      .from('receipt-images')
      .upload(newFileName, imageBlob, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error('Error uploading converted image:', uploadError);
      throw uploadError;
    }

    console.log('Converted image uploaded:', newFileName);

    // Update the receipt record with the new file path
    if (receiptId) {
      const { error: updateError } = await supabaseClient
        .from('receipt_imports')
        .update({
          raw_file_url: newFileName,
          file_name: newFileName.split('/').pop(),
        })
        .eq('id', receiptId);

      if (updateError) {
        console.error('Error updating receipt record:', updateError);
      }
    }

    // Delete the original PDF
    const { error: deleteError } = await supabaseClient.storage
      .from('receipt-images')
      .remove([filePath]);

    if (deleteError) {
      console.error('Error deleting original PDF:', deleteError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        newFilePath: newFileName,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in convert-pdf-to-image:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
