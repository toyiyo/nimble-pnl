import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAICall, type AICallMetadata } from "../_shared/braintrust.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BankStatementProcessRequest {
  statementUploadId: string;
  pdfUrl: string; // Signed URL to the PDF
}

interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  transactionType: 'debit' | 'credit' | 'unknown';
  balance?: number;
  confidenceScore: number;
}

// Bank statement analysis prompt
const BANK_STATEMENT_ANALYSIS_PROMPT = `ANALYSIS TARGET: This is a bank statement PDF containing transaction history.

CRITICAL REQUIREMENTS:
1. Extract EVERY SINGLE TRANSACTION from the statement
2. Capture transaction dates, descriptions, amounts (debits/credits), and running balance if available
3. Identify the bank name and statement period

EXTRACTION METHODOLOGY:
1. **Scan the ENTIRE document** - Read all pages from start to finish
2. **Extract ALL transactions** - Every debit and credit transaction
3. **Identify key components**:
   - Transaction date (in format YYYY-MM-DD)
   - Description/Payee
   - Amount (with sign: negative for debits, positive for credits)
   - Transaction type (debit, credit, or unknown)
   - Running balance (if shown)
4. **Handle various formats**: Different banks use different layouts
5. **Preserve order**: Transactions should be in chronological order

CONFIDENCE SCORING:
- 0.90-0.95: Crystal clear, all fields present
- 0.80-0.89: Readable, minor ambiguity
- 0.65-0.79: Partially clear, some interpretation
- 0.40-0.64: Challenging to read
- 0.20-0.39: Very unclear

RESPONSE FORMAT (JSON ONLY - NO EXTRA TEXT):
{
  "bankName": "Name of the bank from statement header",
  "statementPeriodStart": "YYYY-MM-DD",
  "statementPeriodEnd": "YYYY-MM-DD",
  "accountNumber": "Last 4 digits only if visible",
  "openingBalance": numeric_amount,
  "closingBalance": numeric_amount,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "Transaction description/payee",
      "amount": numeric_amount (negative for debits, positive for credits),
      "transactionType": "debit" | "credit" | "unknown",
      "balance": numeric_running_balance,
      "confidenceScore": 0.0-1.0
    }
  ]
}

IMPORTANT: 
- Return ONLY valid, complete JSON
- Include ALL transactions from ALL pages
- Negative amounts = money out (debits), Positive amounts = money in (credits)`;

// Model configurations (same as receipt processing)
const MODELS = [
  {
    name: "Gemini 2.5 Flash",
    id: "google/gemini-2.5-flash",
    systemPrompt: "You are an expert bank statement parser. Extract transaction data precisely and return valid JSON only.",
    maxRetries: 2,
  },
  {
    name: "Llama 4 Maverick Free",
    id: "meta-llama/llama-4-maverick:free",
    systemPrompt: "You are an expert bank statement parser. Extract transaction data precisely and return valid JSON only.",
    maxRetries: 2,
  },
  {
    name: "Gemma 3 27B Free",
    id: "google/gemma-3-27b-it:free",
    systemPrompt: "You are an expert bank statement parser. Extract transaction data precisely and return valid JSON only.",
    maxRetries: 2,
  },
];

const MODEL_TOKEN_LIMITS: Record<string, number> = {
  "google/gemini-2.5-flash": 32768,
  "meta-llama/llama-4-maverick:free": 8192,
  "google/gemma-3-27b-it:free": 16384,
};

const DEFAULT_MAX_TOKENS = 8192;

function buildRequestBody(modelId: string, systemPrompt: string, pdfUrl: string): any {
  const requestedMax = 4000; // Reduced to 4000 to prevent memory issues
  const modelMaxLimit = MODEL_TOKEN_LIMITS[modelId] || DEFAULT_MAX_TOKENS;
  const clampedMaxTokens = Math.min(requestedMax, modelMaxLimit);
  
  console.log(`📊 Token limit for ${modelId}: ${clampedMaxTokens} (model max: ${modelMaxLimit})`);

  return {
    model: modelId,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: BANK_STATEMENT_ANALYSIS_PROMPT,
          },
          {
            type: "file",
            file: {
              file_data: pdfUrl,
              filename: "bank_statement.pdf",
            },
          },
        ],
      },
    ],
    max_tokens: clampedMaxTokens,
    temperature: 0.1,
    stream: true,
    plugins: [
      {
        id: "file-parser",
        pdf: {
          engine: "mistral-ocr",
        },
      },
    ],
  };
}

async function processStreamedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let completeContent = '';
  let isComplete = false;
  const MAX_CONTENT_SIZE = 150000; // 150KB limit to prevent memory overflow

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd === -1) break;

        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        if (!line || line.startsWith(':')) {
          continue;
        }

        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          if (data === '[DONE]') {
            isComplete = true;
            break;
          }

          try {
            const parsed = JSON.parse(data);

            if (parsed.error) {
              throw new Error(`Stream error: ${parsed.error.message || 'Unknown error'}`);
            }

            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              // Safety check: prevent memory overflow
              if (completeContent.length + content.length > MAX_CONTENT_SIZE) {
                console.warn('⚠️ Content size limit reached, truncating response');
                await reader.cancel();
                break;
              }
              completeContent += content;
            }

            if (parsed.choices?.[0]?.finish_reason === 'error') {
              throw new Error('Stream terminated with error');
            }
          } catch (e) {
            if (e instanceof SyntaxError) {
              continue;
            }
            throw e;
          }
        }
      }

      if (isComplete) break;
    }

    console.log(`✅ Stream completed. Total content length: ${completeContent.length}`);
    return completeContent;
    
  } catch (error) {
    console.error('❌ Error processing stream:', error);
    throw error;
  } finally {
    reader.cancel();
  }
}

async function callModel(
  modelConfig: (typeof MODELS)[0],
  pdfUrl: string,
  openRouterApiKey: string,
  restaurantId?: string,
): Promise<{ response: Response; modelConfig: typeof MODELS[0] } | null> {
  let retryCount = 0;

  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);

      const requestBody = buildRequestBody(modelConfig.id, modelConfig.systemPrompt, pdfUrl);

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://app.easyshifthq.com",
          "X-Title": "EasyShiftHQ Bank Statement Parser",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        console.log(`✅ ${modelConfig.name} succeeded`);
        return { response, modelConfig };
      }

      if (response.status === 429 && retryCount < modelConfig.maxRetries - 1) {
        console.log(`🔄 ${modelConfig.name} rate limited, waiting before retry...`);
        
        logAICall(
          'process-bank-statement:rate_limit',
          { model: modelConfig.id },
          null,
          { ...metadata, success: false, status_code: 429, error: 'Rate limited' },
          null
        );
        
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount + 1) * 1000));
        retryCount++;
      } else {
        const errorText = await response.text();
        console.error(`❌ ${modelConfig.name} failed:`, response.status, errorText);
        
        logAICall(
          'process-bank-statement:error',
          { model: modelConfig.id },
          null,
          { ...metadata, success: false, status_code: response.status, error: errorText },
          null
        );
        
        break;
      }
    } catch (error) {
      console.error(`❌ ${modelConfig.name} error:`, error);
      
      logAICall(
        'process-bank-statement:error',
        { model: modelConfig.id },
        null,
        { 
          model: modelConfig.id,
          provider: "openrouter",
          restaurant_id: restaurantId,
          edge_function: 'process-bank-statement',
          stream: false,
          attempt: retryCount + 1,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        },
        null
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
    const { statementUploadId, pdfUrl }: BankStatementProcessRequest = await req.json();

    if (!statementUploadId || !pdfUrl) {
      return new Response(JSON.stringify({ error: "Statement upload ID and PDF URL are required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get statement info to find restaurant_id
    const { data: statementInfo, error: statementInfoError } = await supabase
      .from("bank_statement_uploads")
      .select("restaurant_id")
      .eq("id", statementUploadId)
      .single();

    if (statementInfoError || !statementInfo) {
      console.error("Error fetching statement info:", statementInfoError);
      return new Response(JSON.stringify({ error: "Failed to fetch statement info" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const restaurantId = statementInfo.restaurant_id;

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      return new Response(JSON.stringify({ error: "OpenRouter API key not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    console.log("🏦 Processing bank statement with multi-model fallback...");

    let finalResponse: Response | undefined;
    let usedModelConfig: typeof MODELS[0] | undefined;

    for (const modelConfig of MODELS) {
      console.log(`🚀 Trying ${modelConfig.name}...`);

      const result = await callModel(modelConfig, pdfUrl, openRouterApiKey, restaurantId);

      if (result) {
        finalResponse = result.response;
        usedModelConfig = result.modelConfig;
        break;
      }

      console.log(`⚠️ ${modelConfig.name} failed, trying next model...`);
    }

    if (!finalResponse || !finalResponse.ok || !usedModelConfig) {
      console.error("❌ All models failed");

      return new Response(
        JSON.stringify({
          error: "Bank statement processing temporarily unavailable. All AI models failed.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 503,
        },
      );
    }

    const content = await processStreamedResponse(finalResponse);

    if (!content || content.trim().length === 0) {
      console.error("Empty content from streamed response");
      return new Response(JSON.stringify({ error: "No content received from AI service" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    console.log("✅ AI parsing completed. Response length:", content.length);

    let parsedData;
    try {
      let jsonContent = content.trim();

      // Remove markdown code blocks if present
      jsonContent = jsonContent.replace(/```json\s*/, "").replace(/```\s*$/, "");
      jsonContent = jsonContent.replace(/```[\w]*\s*/, "").replace(/```\s*$/, "");

      // Extract JSON between first { and last }
      const firstBrace = jsonContent.indexOf("{");
      const lastBrace = jsonContent.lastIndexOf("}");

      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error("No JSON structure found in response");
      }

      jsonContent = jsonContent.substring(firstBrace, lastBrace + 1);

      // Fix common JSON issues
      jsonContent = jsonContent.replace(/,(\s*[}\]])/g, "$1");
      jsonContent = jsonContent.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

      parsedData = JSON.parse(jsonContent);

      if (!parsedData.transactions || !Array.isArray(parsedData.transactions)) {
        throw new Error("Invalid JSON structure: missing or invalid transactions array");
      }

      if (parsedData.transactions.length === 0) {
        throw new Error("No transactions found in bank statement");
      }

      // Calculate totals for logging
      const totalDebits = parsedData.transactions
        .filter((t: any) => t.amount < 0)
        .reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);
      
      const totalCredits = parsedData.transactions
        .filter((t: any) => t.amount > 0)
        .reduce((sum: number, t: any) => sum + t.amount, 0);

      console.log(`✅ Successfully parsed ${parsedData.transactions.length} transactions`);

      // Log successful AI call to Braintrust with full details
      const requestBody = buildRequestBody(usedModelConfig.id, usedModelConfig.systemPrompt, pdfUrl);
      logAICall(
        `process-bank-statement:${usedModelConfig.name}`,
        {
          prompt: BANK_STATEMENT_ANALYSIS_PROMPT,
          pdfUrl: pdfUrl.substring(0, 100) + '...', // Truncate URL for readability
          model: usedModelConfig.id,
        },
        {
          bankName: parsedData.bankName,
          statementPeriod: `${parsedData.statementPeriodStart} to ${parsedData.statementPeriodEnd}`,
          transactionCount: parsedData.transactions.length,
          totalDebits,
          totalCredits,
          sampleTransactions: parsedData.transactions.slice(0, 3), // First 3 for preview
        },
        {
          model: usedModelConfig.id,
          provider: 'openrouter',
          restaurant_id: restaurantId,
          edge_function: 'process-bank-statement',
          temperature: requestBody.temperature,
          max_tokens: requestBody.max_tokens,
          stream: true,
          attempt: 1,
          success: true,
          status_code: 200,
        },
        null // Token usage not available from streaming response
      );
    } catch (parseError) {
      console.error("Failed to parse JSON from AI response:", parseError);
      console.error("Content that failed to parse:", content.substring(0, 1000) + "...");

      return new Response(
        JSON.stringify({
          error: "Failed to parse bank statement data",
          details: parseError instanceof Error ? parseError.message : String(parseError),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 422,
        },
      );
    }

    // Update statement upload with parsed data
    const { error: updateError } = await supabase
      .from("bank_statement_uploads")
      .update({
        bank_name: parsedData.bankName,
        statement_period_start: parsedData.statementPeriodStart,
        statement_period_end: parsedData.statementPeriodEnd,
        raw_ocr_data: parsedData,
        status: "processed",
        processed_at: new Date().toISOString(),
        transaction_count: parsedData.transactions.length,
        total_debits: totalDebits,
        total_credits: totalCredits,
      })
      .eq("id", statementUploadId);

    if (updateError) {
      console.error("Error updating statement upload:", updateError);
      return new Response(JSON.stringify({ error: "Failed to update statement upload" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Insert transaction lines with sequence in batches to avoid memory issues
    const transactionLines = parsedData.transactions.map((transaction: any, index: number) => ({
      statement_upload_id: statementUploadId,
      transaction_date: transaction.date,
      description: transaction.description,
      amount: transaction.amount,
      transaction_type: transaction.transactionType || 'unknown',
      balance: transaction.balance,
      line_sequence: index + 1,
      confidence_score: transaction.confidenceScore,
    }));

    // Insert in batches of 100 to prevent memory overflow
    const BATCH_SIZE = 100;
    for (let i = 0; i < transactionLines.length; i += BATCH_SIZE) {
      const batch = transactionLines.slice(i, i + BATCH_SIZE);
      const { error: linesError } = await supabase
        .from("bank_statement_lines")
        .insert(batch);

      if (linesError) {
        console.error(`Error inserting transaction batch ${i / BATCH_SIZE + 1}:`, linesError);
        return new Response(JSON.stringify({ error: "Failed to insert transaction lines" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        bankName: parsedData.bankName,
        transactionCount: parsedData.transactions.length,
        totalDebits,
        totalCredits,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error in process-bank-statement function:", error);
    return new Response(
      JSON.stringify({
        error: "An unexpected error occurred while processing the bank statement",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
