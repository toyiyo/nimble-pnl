import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import * as pdfjsLib from 'npm:pdfjs-dist@4.0.379';
import { Canvas } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

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

    // Convert Blob to ArrayBuffer
    const arrayBuffer = await fileData.arrayBuffer();
    
    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;
    
    console.log('PDF loaded, pages:', pdfDoc.numPages);

    // Get the first page
    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });

    // Create canvas
    const canvas = new Canvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    console.log('Page rendered to canvas');

    // Convert canvas to JPEG
    const imageBlob = await canvas.toBlob('image/jpeg', 0.95);

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
