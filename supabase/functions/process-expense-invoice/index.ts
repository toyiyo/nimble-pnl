import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import { logAICall, extractTokenUsage, type AICallMetadata } from "../_shared/braintrust.ts";
import { normalizeDate, normalizePdfInput } from "../_shared/expenseInvoiceUtils.ts";

interface ExpenseInvoiceProcessRequest {
  invoiceUploadId: string;
  imageData: string; // base64 encoded image OR URL for PDF
  isPDF?: boolean;
}

const INVOICE_ANALYSIS_PROMPT = `ANALYSIS TARGET: This document is a vendor invoice/bill that represents an expense.

CRITICAL REQUIREMENTS:
1. Extract key invoice fields only (no line items needed)
2. Use ISO dates (YYYY-MM-DD)
3. Return null for any field that is missing or unclear
4. Provide per-field confidence scores (0.0-1.0)

FIELDS TO EXTRACT:
- vendorName (supplier or vendor name)
- invoiceNumber (invoice/bill number)
- invoiceDate (date on invoice, bill date, order date)
- dueDate (payment due date if present)
- totalAmount (total due, amount payable)
- currency (3-letter code if visible, otherwise null)
- taxAmount (tax total if visible, otherwise null)

CONFIDENCE SCORING:
- 0.90-0.99: Clear and explicit
- 0.70-0.89: Readable with minor ambiguity
- 0.50-0.69: Some uncertainty or inferred placement
- 0.20-0.49: Hard to read or guessed

RESPONSE FORMAT (JSON ONLY - NO EXTRA TEXT):
{
  "vendorName": "string or null",
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "totalAmount": numeric or null,
  "currency": "USD or null",
  "taxAmount": numeric or null,
  "fieldConfidence": {
    "vendorName": 0.0-1.0,
    "invoiceNumber": 0.0-1.0,
    "invoiceDate": 0.0-1.0,
    "dueDate": 0.0-1.0,
    "totalAmount": 0.0-1.0
  }
}

IMPORTANT: Return ONLY valid, complete JSON.`;

const MODELS = [
  {
    name: "Gemini 2.5 Flash",
    id: "google/gemini-2.5-flash",
    systemPrompt: "You are an expert invoice parser. Extract fields precisely and return valid JSON only.",
    maxRetries: 2,
  },
  {
    name: "Llama 4 Maverick",
    id: "meta-llama/llama-4-maverick",
    systemPrompt: "You are an expert invoice parser. Extract fields precisely and return valid JSON only.",
    maxRetries: 2,
  },
  {
    name: "Gemma 3 27B",
    id: "google/gemma-3-27b-it",
    systemPrompt: "You are an expert invoice parser. Extract fields precisely and return valid JSON only.",
    maxRetries: 1,
  },
];

const MODEL_TOKEN_LIMITS: Record<string, number> = {
  "google/gemini-2.5-flash": 8192,
  "meta-llama/llama-4-maverick": 4096,
  "google/gemma-3-27b-it": 4096,
};

const DEFAULT_MAX_TOKENS = 4096;

function buildRequestBody(modelId: string, systemPrompt: string, isPDF: boolean, mediaData: string): any {
  const requestedMax = 4000;
  const modelMaxLimit = MODEL_TOKEN_LIMITS[modelId] || DEFAULT_MAX_TOKENS;
  const clampedMaxTokens = Math.min(requestedMax, modelMaxLimit);

  const requestBody: any = {
    model: modelId,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: INVOICE_ANALYSIS_PROMPT },
          isPDF
            ? {
                type: "file",
                file: {
                  file_data: mediaData,
                  filename: "invoice.pdf",
                },
              }
            : {
                type: "image_url",
                image_url: { url: mediaData },
              },
        ],
      },
    ],
    max_tokens: clampedMaxTokens,
    temperature: 0.1,
  };

  if (isPDF) {
    requestBody.plugins = [
      {
        id: "file-parser",
        pdf: { engine: "mistral-ocr" },
      },
    ];
  }

  return requestBody;
}

function cleanJsonContent(content: string): string {
  let jsonContent = content.trim();
  jsonContent = jsonContent.replace(/```json\s*/g, "").replace(/```\s*$/g, "");
  jsonContent = jsonContent.replace(/```[\w]*\s*/g, "").replace(/```\s*$/g, "");

  const firstBrace = jsonContent.indexOf("{");
  const lastBrace = jsonContent.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    jsonContent = jsonContent.substring(firstBrace, lastBrace + 1);
  }

  jsonContent = jsonContent.replace(/,(\s*[}\]])/g, "$1");
  jsonContent = jsonContent.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
  return jsonContent;
}

function extractDateFromFilename(filename: string | null): string | null {
  if (!filename) return null;
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");

  const isValidParts = (y: number, m: number, d: number): boolean => {
    const date = new Date(y, m, d);
    return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d;
  };

  const isoPattern = /(\d{4})[-_.\/](\d{1,2})[-_.\/](\d{1,2})/;
  const isoMatch = nameWithoutExt.match(isoPattern);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const y = parseInt(year, 10);
    const m = parseInt(month, 10) - 1;
    const d = parseInt(day, 10);
    if (isValidParts(y, m, d)) {
      return new Date(y, m, d).toISOString().split("T")[0];
    }
  }

  const usPattern = /(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{4})/;
  const usMatch = nameWithoutExt.match(usPattern);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const y = parseInt(year, 10);
    const m = parseInt(month, 10) - 1;
    const d = parseInt(day, 10);
    if (isValidParts(y, m, d)) {
      return new Date(y, m, d).toISOString().split("T")[0];
    }
  }

  return null;
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.min(Math.max(value, 0), 0.99);
}

async function callModel(
  modelConfig: (typeof MODELS)[0],
  isPDF: boolean,
  mediaData: string,
  openRouterApiKey: string,
  restaurantId: string,
): Promise<string | null> {
  let retryCount = 0;

  while (retryCount < modelConfig.maxRetries) {
    const requestBody = buildRequestBody(modelConfig.id, modelConfig.systemPrompt, isPDF, mediaData);
    const metadata: AICallMetadata = {
      model: modelConfig.id,
      provider: "openrouter",
      restaurant_id: restaurantId,
      edge_function: "process-expense-invoice",
      temperature: requestBody.temperature,
      max_tokens: requestBody.max_tokens,
      stream: false,
      attempt: retryCount + 1,
      success: false,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://app.easyshifthq.com",
          "X-Title": "EasyShiftHQ Invoice Parser",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseData = await response.json().catch(() => ({}));
      const tokenUsage = extractTokenUsage(responseData);

      if (response.ok) {
        const content = responseData?.choices?.[0]?.message?.content;

        logAICall(
          "process-expense-invoice:success",
          { model: modelConfig.id, isPDF },
          { status: "success" },
          { ...metadata, success: true, status_code: 200 },
          tokenUsage,
        );

        return typeof content === "string" ? content : null;
      }

      logAICall(
        "process-expense-invoice:error",
        { model: modelConfig.id },
        null,
        {
          ...metadata,
          success: false,
          status_code: response.status,
          error: responseData?.error?.message || response.statusText,
        },
        tokenUsage,
      );

      if ((response.status === 429 || response.status >= 500) && retryCount < modelConfig.maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount + 1) * 1000));
        retryCount++;
        continue;
      }

      break;
    } catch (error) {
      logAICall(
        "process-expense-invoice:error",
        { model: modelConfig.id },
        null,
        {
          ...metadata,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
      );

      retryCount++;
      if (retryCount < modelConfig.maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { invoiceUploadId, imageData, isPDF }: ExpenseInvoiceProcessRequest = await req.json();

    if (!invoiceUploadId || !imageData) {
      return new Response(JSON.stringify({ error: "Invoice upload ID and image data are required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: uploadInfo, error: uploadError } = await supabase
      .from("expense_invoice_uploads")
      .select("restaurant_id, file_name")
      .eq("id", invoiceUploadId)
      .single();

    if (uploadError || !uploadInfo) {
      return new Response(JSON.stringify({ error: "Failed to fetch invoice upload info" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const { data: membership, error: membershipError } = await userClient
      .from("user_restaurants")
      .select("id")
      .eq("restaurant_id", uploadInfo.restaurant_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError || !membership) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      return new Response(JSON.stringify({ error: "OpenRouter API key not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const isProcessingPDF = isPDF || false;
    let pdfBase64Data = imageData;

    if (isProcessingPDF) {
      const normalizedPdfInput = normalizePdfInput(imageData);
      pdfBase64Data = normalizedPdfInput.value;

      if (normalizedPdfInput.isRemote) {
        try {
          const url = new URL(normalizedPdfInput.value);
          
          if (url.protocol !== 'https:') {
            throw new Error('Only HTTPS URLs are allowed');
          }

          const allowedHosts = [
            supabaseUrl ? new URL(supabaseUrl).hostname : null,
            'supabase.co',
            'supabase.in',
          ].filter(Boolean);

          const isAllowed = allowedHosts.some(host => 
            host && (url.hostname === host || url.hostname.endsWith(`.${host}`))
          );

          if (!isAllowed) {
            throw new Error('URL host not allowed');
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000);

          const pdfResponse = await fetch(normalizedPdfInput.value, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (!pdfResponse.ok) {
            throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
          }

          const pdfBlob = await pdfResponse.arrayBuffer();
          const uint8Array = new Uint8Array(pdfBlob);
          const chunkSize = 32768;
          let binaryString = "";
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
            binaryString += String.fromCharCode(...chunk);
          }
          const base64 = btoa(binaryString);
          pdfBase64Data = `data:application/pdf;base64,${base64}`;
        } catch (fetchError) {
          clearTimeout(timeoutId);
          await supabase
            .from("expense_invoice_uploads")
            .update({
              status: "error",
              error_message: fetchError instanceof Error ? fetchError.message : String(fetchError),
            })
            .eq("id", invoiceUploadId);

          return new Response(
            JSON.stringify({
              error: "Failed to fetch PDF for processing",
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    let content: string | null = null;
    for (const modelConfig of MODELS) {
      content = await callModel(modelConfig, isProcessingPDF, pdfBase64Data, openRouterApiKey, uploadInfo.restaurant_id);
      if (content) break;
    }

    if (!content) {
      await supabase
        .from("expense_invoice_uploads")
        .update({ status: "error", error_message: "All AI models failed" })
        .eq("id", invoiceUploadId);

      return new Response(
        JSON.stringify({
          error: "Invoice processing temporarily unavailable. All AI models failed.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    let parsedData: any;
    try {
      const jsonContent = cleanJsonContent(content);
      parsedData = JSON.parse(jsonContent);
    } catch (parseError) {
      await supabase
        .from("expense_invoice_uploads")
        .update({
          status: "error",
          error_message: parseError instanceof Error ? parseError.message : String(parseError),
        })
        .eq("id", invoiceUploadId);

      return new Response(
        JSON.stringify({
          error: "Failed to parse invoice data.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 },
      );
    }

    const vendorName =
      typeof parsedData.vendorName === "string" && parsedData.vendorName.trim().length > 0
        ? parsedData.vendorName.trim()
        : null;
    const invoiceNumber =
      typeof parsedData.invoiceNumber === "string" && parsedData.invoiceNumber.trim().length > 0
        ? parsedData.invoiceNumber.trim()
        : null;
    let invoiceDate = normalizeDate(parsedData.invoiceDate);
    const dueDate = normalizeDate(parsedData.dueDate, true);

    if (!invoiceDate) {
      invoiceDate = extractDateFromFilename(uploadInfo.file_name);
    }

    const totalAmountRaw = parsedData.totalAmount;
    const parsedAmount =
      typeof totalAmountRaw === "number"
        ? totalAmountRaw
        : typeof totalAmountRaw === "string"
          ? parseFloat(totalAmountRaw.replace(/[^0-9.-]/g, ""))
          : null;
    const totalAmount = typeof parsedAmount === "number" && !Number.isNaN(parsedAmount) ? parsedAmount : null;

    const fieldConfidence = parsedData.fieldConfidence || {};
    const normalizedConfidence = {
      vendorName: normalizeConfidence(fieldConfidence.vendorName),
      invoiceNumber: normalizeConfidence(fieldConfidence.invoiceNumber),
      invoiceDate: normalizeConfidence(fieldConfidence.invoiceDate),
      dueDate: normalizeConfidence(fieldConfidence.dueDate),
      totalAmount: normalizeConfidence(fieldConfidence.totalAmount),
    };

    const { error: updateError } = await supabase
      .from("expense_invoice_uploads")
      .update({
        vendor_name: vendorName,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        total_amount: totalAmount,
        raw_ocr_data: parsedData,
        field_confidence: normalizedConfidence,
        status: "processed",
        processed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", invoiceUploadId);

    if (updateError) {
      return new Response(JSON.stringify({ error: "Failed to update invoice upload" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        vendorName,
        invoiceNumber,
        invoiceDate,
        dueDate,
        totalAmount,
        fieldConfidence: normalizedConfidence,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "An unexpected error occurred while processing the invoice",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
