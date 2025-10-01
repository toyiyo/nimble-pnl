import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's auth token to respect RLS
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Get receipt_id from query params
    const url = new URL(req.url);
    const receiptId = url.searchParams.get('receipt_id');

    if (!receiptId) {
      return new Response(
        JSON.stringify({ error: 'Missing receipt_id parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Proxying receipt file for receipt_id:', receiptId);

    // Fetch receipt details to get the file path and verify access
    const { data: receipt, error: receiptError } = await supabaseClient
      .from('receipt_imports')
      .select('raw_file_url, file_name')
      .eq('id', receiptId)
      .single();

    if (receiptError || !receipt) {
      console.error('Error fetching receipt:', receiptError);
      return new Response(
        JSON.stringify({ error: 'Receipt not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching file from storage:', receipt.raw_file_url);

    // Extract just the path if raw_file_url is a full URL
    let filePath = receipt.raw_file_url;
    
    // If it's a full URL, extract just the path part after the bucket name
    if (filePath.includes('http')) {
      // Match pattern: .../receipt-images/{path}
      const match = filePath.match(/\/receipt-images\/(.+)$/);
      if (match) {
        filePath = match[1];
        console.log('Extracted path from URL:', filePath);
      } else {
        console.error('Could not extract path from URL:', filePath);
        return new Response(
          JSON.stringify({ error: 'Invalid file URL format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Download file from storage using service role
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
    const { data: fileData, error: downloadError } = await supabaseService.storage
      .from('receipt-images')
      .download(filePath);

    if (downloadError || !fileData) {
      console.error('Error downloading file:', downloadError);
      return new Response(
        JSON.stringify({ error: 'Failed to download file' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('File downloaded successfully, size:', fileData.size);

    // Determine content type based on file extension
    const fileName = receipt.file_name || receipt.raw_file_url;
    const fileNameLower = fileName.toLowerCase();
    
    // Map file extensions to MIME types
    let contentType = 'application/octet-stream'; // Default fallback
    
    if (fileNameLower.endsWith('.pdf')) {
      contentType = 'application/pdf';
    } else if (fileNameLower.endsWith('.png')) {
      contentType = 'image/png';
    } else if (fileNameLower.endsWith('.webp')) {
      contentType = 'image/webp';
    } else if (fileNameLower.endsWith('.jpg') || fileNameLower.endsWith('.jpeg')) {
      contentType = 'image/jpeg';
    } else if (fileNameLower.endsWith('.gif')) {
      contentType = 'image/gif';
    } else if (fileNameLower.endsWith('.svg')) {
      contentType = 'image/svg+xml';
    } else if (fileNameLower.endsWith('.bmp')) {
      contentType = 'image/bmp';
    } else if (fileNameLower.endsWith('.tiff') || fileNameLower.endsWith('.tif')) {
      contentType = 'image/tiff';
    }

    // Return the file with proper headers
    return new Response(fileData, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, max-age=3600', // Private cache only - no intermediate caching of sensitive receipts
      },
    });
  } catch (error) {
    console.error('Error in proxy-receipt-file:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
