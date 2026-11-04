import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAICall, extractTokenUsage, type AICallMetadata } from "../_shared/braintrust.ts";
import {
  authorizeDocumentRequest,
  BANK_STATEMENT_PROCESS_ROLES,
  createDocumentAuthDeps,
  downloadDocumentAsDataUrl,
  isAllowedStorageUrl,
  MAX_BANK_STATEMENT_BYTES,
} from "../_shared/documentProcessingAuth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BankStatementProcessRequest {
  statementUploadId: string;
  pdfUrl?: string; // Old clients only. The server loads the row's file and never fetches this URL.
}

interface StatementRecord {
  restaurant_id: string;
  file_size: number | null;
  raw_file_url: string | null;
}

const DOWNLOAD_FAILED_MESSAGE = "Failed to download the bank statement file. Please upload it again.";

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  transactionType: 'debit' | 'credit' | 'unknown';
  balance?: number;
  confidenceScore: number;
}

interface ValidationResult {
  transactions: any[];
  validCount: number;
  invalidCount: number;
  warnings: string[];
}

/**
 * Validates transactions extracted from bank statements
 * Adds validation error details to each transaction instead of filtering them out
 * Returns all transactions with validation_errors field populated where needed
 */
function validateTransactions(transactions: any[]): ValidationResult {
  const allTransactions: any[] = [];
  const warnings: string[] = [];
  let validCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const txIndex = i + 1;
    const validationErrors: Record<string, string> = {};
    
    // Check for null/missing amount
    if (tx.amount === null || tx.amount === undefined) {
      validationErrors.amount = 'Missing or null amount';
      warnings.push(`Transaction #${txIndex} "${tx.description || 'Unknown'}" on ${tx.date || 'unknown date'} - no amount found`);
    } else if (typeof tx.amount !== 'number' || isNaN(tx.amount)) {
      // Check for invalid amount (not a number or NaN)
      validationErrors.amount = `Invalid amount format: ${tx.amount}`;
      warnings.push(`Transaction #${txIndex} "${tx.description || 'Unknown'}" - invalid amount: ${tx.amount}`);
    }

    // Check for required fields
    if (!tx.date) {
      validationErrors.date = 'Missing date';
      warnings.push(`Transaction #${txIndex} - missing date`);
    } else {
      // Validate date format (basic check)
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      if (!datePattern.test(tx.date)) {
        validationErrors.date = `Invalid date format: ${tx.date} (expected YYYY-MM-DD)`;
        warnings.push(`Transaction #${txIndex} "${tx.description || 'Unknown'}" - invalid date format: ${tx.date}`);
      }
    }
    
    if (!tx.description) {
      validationErrors.description = 'Missing description';
      warnings.push(`Transaction #${txIndex} - missing description`);
    }

    // Check confidence score format (must be 0-0.99 for NUMERIC(3,2))
    // Cap at 0.99 if >= 1.0 to satisfy database constraint
    if (tx.confidenceScore !== null && tx.confidenceScore !== undefined) {
      if (typeof tx.confidenceScore === 'number' && tx.confidenceScore >= 1.0) {
        tx.confidenceScore = 0.99; // Cap at 0.99 for database constraint
      }
    }

    // Add transaction with validation info
    const hasErrors = Object.keys(validationErrors).length > 0;
    allTransactions.push({
      ...tx,
      has_validation_error: hasErrors,
      validation_errors: hasErrors ? validationErrors : null,
      originalIndex: txIndex,
    });
    
    if (hasErrors) {
      invalidCount++;
    } else {
      validCount++;
    }
  }

  return { transactions: allTransactions, validCount, invalidCount, warnings };
}

// Bank statement analysis prompt
const BANK_STATEMENT_ANALYSIS_PROMPT = `ANALYSIS TARGET: This is a bank statement PDF containing transaction history.

CRITICAL REQUIREMENTS:
1. Extract EVERY SINGLE TRANSACTION from the statement - even if some fields are missing or unclear
2. Capture transaction dates, descriptions, amounts (debits/credits), and running balance if available
3. Identify the bank name and statement period
4. **EXTRACT ALL TRANSACTIONS** - Include transactions even if the amount is unclear. Use null for missing amounts so the user can review and correct them.

EXTRACTION METHODOLOGY:
1. **Scan the ENTIRE document** - Read all pages from start to finish
2. **Extract ALL transactions** - Every debit and credit transaction, even partial ones
3. **Identify key components** (use null if field cannot be determined):
   - Transaction date (in format YYYY-MM-DD, or null if unclear)
   - Description/Payee (always try to capture this, even if other fields are missing)
   - Amount (with sign: negative for debits, positive for credits, or null if cannot determine)
   - Transaction type (debit, credit, or unknown)
   - Running balance (if shown, otherwise null)
4. **Handle various formats**: Different banks use different layouts - be flexible
5. **Preserve order**: Transactions should be in chronological order
6. **When in doubt, include it**: Better to extract a transaction with some null fields than to skip it entirely

AMOUNT EXTRACTION EXAMPLES:
- Format 1: "09/19 DEPOSIT $1,234.56" → amount: 1234.56, type: credit
- Format 2: "Payment to VENDOR -$500.00" → amount: -500.00, type: debit
- Format 3: "ACH TRANSFER 250.00 DR" → amount: -250.00, type: debit
- Format 4: "Interest Earned 15.23 CR" → amount: 15.23, type: credit
- Format 5: "CHECK #1234    $75.00-" → amount: -75.00, type: debit
- Format 6: "Wire Transfer    1,500.00+" → amount: 1500.00, type: credit
- Format 7: "08/06 ACH Deposit EPSG 1,154.63" → amount: 1154.63, type: credit
- Format 8: "08/31 OD Interest Charge" → amount: null (missing), description: "OD Interest Charge"

CONFIDENCE SCORING:
- 0.90-0.95: Crystal clear, all fields present
- 0.80-0.89: Readable, minor ambiguity
- 0.65-0.79: Partially clear, some interpretation
- 0.40-0.64: Challenging to read
- 0.20-0.39: Very unclear
- 0.10-0.19: Missing critical fields (e.g., amount is null)

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
      "date": "YYYY-MM-DD" or null,
      "description": "Transaction description/payee",
      "amount": numeric_amount (negative for debits, positive for credits) or null if cannot determine,
      "transactionType": "debit" | "credit" | "unknown",
      "balance": numeric_running_balance or null,
      "confidenceScore": 0.0-1.0
    }
  ]
}

IMPORTANT: 
- Return ONLY valid, complete JSON
- Include ALL transactions from ALL pages
- Negative amounts = money out (debits), Positive amounts = money in (credits)
- **USE NULL for missing/unclear fields** - DO NOT skip transactions just because amount is missing
- The user will review all transactions and can fix/skip problematic ones`;

// Model configurations (same as receipt processing)
const MODELS = [
  {
    name: "Gemini 2.5 Flash",
    id: "google/gemini-2.5-flash",
    systemPrompt: "You are an expert bank statement parser. Extract transaction data precisely and return valid JSON only.",
    maxRetries: 2,
  },
  {
    name: "Llama 4 Maverick",
    id: "meta-llama/llama-4-maverick",
    systemPrompt: "You are an expert bank statement parser. Extract transaction data precisely and return valid JSON only.",
    maxRetries: 2,
  },
  {
    name: "Gemma 3 27B",
    id: "google/gemma-3-27b-it",
    systemPrompt: "You are an expert bank statement parser. Extract transaction data precisely and return valid JSON only.",
    maxRetries: 2,
  },
];

const MODEL_TOKEN_LIMITS: Record<string, number> = {
  "google/gemini-2.5-flash": 8192,
  "meta-llama/llama-4-maverick": 4096,
  "google/gemma-3-27b-it": 4096,
};

const DEFAULT_MAX_TOKENS = 4096;

// File size limits to prevent resource exhaustion
const MAX_FILE_SIZE_BYTES = MAX_BANK_STATEMENT_BYTES;
const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);

function buildRequestBody(modelId: string, systemPrompt: string, pdfData: string, isBase64: boolean = false): any {
  const requestedMax = 8000; // Increased from 2500 to 8000 for large statements
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
              file_data: pdfData,
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
  const MAX_CONTENT_SIZE = 500000; // Increased to 500KB for large bank statements
  const CHUNK_PROCESS_INTERVAL = 50; // Process chunks more frequently
  let chunkCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      chunkCount++;

      // Process buffer more frequently to avoid accumulation
      if (chunkCount % CHUNK_PROCESS_INTERVAL === 0 && buffer.length > 10000) {
        console.log(`⚙️ Processing large buffer (${buffer.length} bytes) at chunk ${chunkCount}`);
      }

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
                console.warn(`⚠️ Accumulated ${completeContent.length} bytes before truncation`);
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
      
      // Periodically clear buffer if it's getting too large but we haven't processed everything
      if (buffer.length > 100000) {
        console.warn(`⚠️ Buffer size exceeded 100KB, clearing to prevent memory issues`);
        buffer = '';
      }
    }

    console.log(`✅ Stream completed. Total content length: ${completeContent.length} bytes from ${chunkCount} chunks`);
    return completeContent;
    
  } catch (error) {
    console.error('❌ Error processing stream:', error);
    throw error;
  } finally {
    try {
      await reader.cancel();
    } catch (e) {
      // Ignore cancel errors
    }
  }
}

async function callModel(
  modelConfig: (typeof MODELS)[0],
  pdfData: string,
  openRouterApiKey: string,
  restaurantId?: string,
  isBase64: boolean = false,
): Promise<{ response: Response; modelConfig: typeof MODELS[0] } | null> {
  let retryCount = 0;

  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);

      const requestBody = buildRequestBody(modelConfig.id, modelConfig.systemPrompt, pdfData, isBase64);

      const metadata: AICallMetadata = {
        model: modelConfig.id,
        provider: 'openrouter',
        restaurant_id: restaurantId,
        edge_function: 'process-bank-statement',
        temperature: requestBody.temperature,
        max_tokens: requestBody.max_tokens,
        stream: requestBody.stream || false,
        attempt: retryCount + 1,
        success: false,
      };

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
        
        // Log successful bank statement processing
        logAICall(
          'process-bank-statement:success',
          { 
            model: modelConfig.id, 
            pdfSource: isBase64 ? 'base64' : 'url',
            pdfSizeApprox: Math.round(pdfData.length / 1024) + 'KB'
          },
          { status: 'success' },
          { ...metadata, success: true, status_code: 200 },
          null // Token usage will be tracked via streaming
        );
        
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
        'process-bank-statement:exception',
        { model: modelConfig.id },
        null,
        { 
          model: modelConfig.id,
          provider: 'openrouter',
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // The service role bypasses RLS, so check the caller before any read or write.
    const auth = await authorizeDocumentRequest<StatementRecord>(
      {
        authHeader: req.headers.get("Authorization"),
        recordId: statementUploadId,
        allowedRoles: BANK_STATEMENT_PROCESS_ROLES,
      },
      createDocumentAuthDeps<StatementRecord>(supabase, "bank_statement_uploads", "restaurant_id, file_size, raw_file_url"),
    );
    if (!auth.ok) {
      return jsonResponse({ error: auth.error }, auth.status);
    }

    const statementInfo = auth.record;
    const restaurantId = statementInfo.restaurant_id;

    // Old clients send a signed storage URL. Reject any other URL. The server never fetches it.
    if (pdfUrl && !isAllowedStorageUrl(pdfUrl, supabaseUrl)) {
      console.error("📄 Rejected PDF source that is not a project storage URL");
      return jsonResponse({ error: "Unsupported document source" }, 400);
    }

    // Validate file size to prevent resource exhaustion
    if (statementInfo.file_size && statementInfo.file_size > MAX_FILE_SIZE_BYTES) {
      const fileSizeMB = (statementInfo.file_size / (1024 * 1024)).toFixed(2);
      console.error(`❌ File too large: ${fileSizeMB}MB exceeds ${MAX_FILE_SIZE_MB}MB limit`);
      
      // Update statement with error
      await supabase
        .from("bank_statement_uploads")
        .update({
          status: "error",
          error_message: `File is too large (${fileSizeMB}MB). Maximum file size is ${MAX_FILE_SIZE_MB}MB. Please split your statement into smaller PDFs or contact support.`
        })
        .eq("id", statementUploadId);
      
      return new Response(
        JSON.stringify({
          error: `File is too large (${fileSizeMB}MB). Maximum file size is ${MAX_FILE_SIZE_MB}MB.`,
          suggestion: "Please split your statement into smaller PDFs or contact support for assistance."
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 413, // Payload Too Large
        }
      );
    }

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      return jsonResponse({ error: "OpenRouter API key not configured" }, 500);
    }

    // Load the row's own file from storage. The download checks the real size,
    // because the client writes file_size.
    const startTime = Date.now();
    const download = await downloadDocumentAsDataUrl(supabase, {
      path: statementInfo.raw_file_url,
      restaurantId,
      maxBytes: MAX_FILE_SIZE_BYTES,
      mime: "application/pdf",
    });
    if (!download.ok) {
      const tooLarge = download.reason === "too_large";
      const message = tooLarge
        ? `File is too large. Maximum file size is ${MAX_FILE_SIZE_MB}MB. Please split your statement into smaller PDFs.`
        : DOWNLOAD_FAILED_MESSAGE;

      await supabase
        .from("bank_statement_uploads")
        .update({ status: "error", error_message: message })
        .eq("id", statementUploadId);

      return jsonResponse({ error: message }, tooLarge ? 413 : 400);
    }
    const pdfBase64Data = download.dataUrl;
    console.log(`✅ PDF loaded from storage: ${(download.byteLength / (1024 * 1024)).toFixed(2)}MB in ${Date.now() - startTime}ms`);

    console.log("🏦 Processing bank statement with multi-model fallback...");

    let finalResponse: Response | undefined;
    let usedModelConfig: typeof MODELS[0] | undefined;

    for (const modelConfig of MODELS) {
      console.log(`🚀 Trying ${modelConfig.name}...`);

      const result = await callModel(modelConfig, pdfBase64Data, openRouterApiKey, restaurantId, true);

      if (result) {
        finalResponse = result.response;
        usedModelConfig = result.modelConfig;
        break;
      }

      console.log(`⚠️ ${modelConfig.name} failed, trying next model...`);
    }

    if (!finalResponse || !finalResponse.ok || !usedModelConfig) {
      console.error("❌ All models failed");
      
      // Update statement with error
      await supabase
        .from("bank_statement_uploads")
        .update({
          status: "error",
          error_message: "All AI models failed to process the bank statement. Please try again later or contact support."
        })
        .eq("id", statementUploadId);

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
    let totalDebits = 0;
    let totalCredits = 0;
    let validationResult: ValidationResult | null = null;
    
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
      jsonContent = jsonContent.replace(/,(\s*[}\]])/g, "$1"); // Remove trailing commas
      jsonContent = jsonContent.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3'); // Quote unquoted keys
      
      // Fix incomplete transaction arrays by finding last complete transaction
      const transactionsMatch = jsonContent.match(/"transactions"\s*:\s*\[/);
      if (transactionsMatch) {
        const transactionsStartIndex = transactionsMatch.index! + transactionsMatch[0].length;
        const afterTransactions = jsonContent.substring(transactionsStartIndex);
        
        // Find the last complete transaction object
        let lastCompleteIndex = -1;
        let braceCount = 0;
        for (let i = 0; i < afterTransactions.length; i++) {
          if (afterTransactions[i] === '{') braceCount++;
          if (afterTransactions[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              lastCompleteIndex = i;
            }
          }
        }
        
        if (lastCompleteIndex > -1) {
          // Truncate at last complete transaction
          const beforeTransactions = jsonContent.substring(0, transactionsStartIndex);
          const transactions = afterTransactions.substring(0, lastCompleteIndex + 1);
          jsonContent = beforeTransactions + transactions + ']}';
        }
      }

      parsedData = JSON.parse(jsonContent);

      if (!parsedData.transactions || !Array.isArray(parsedData.transactions)) {
        throw new Error("Invalid JSON structure: missing or invalid transactions array");
      }

      if (parsedData.transactions.length === 0) {
        throw new Error("No transactions found in bank statement");
      }

      // Validate transactions and add error details
      console.log("🔍 Validating transactions...");
      validationResult = validateTransactions(parsedData.transactions);
      
      // Calculate totals for logging and database update (only from valid transactions with amounts)
      totalDebits = validationResult.transactions
        .filter((t: any) => !t.has_validation_error && typeof t.amount === 'number' && t.amount < 0)
        .reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);
      
      totalCredits = validationResult.transactions
        .filter((t: any) => !t.has_validation_error && typeof t.amount === 'number' && t.amount > 0)
        .reduce((sum: number, t: any) => sum + t.amount, 0);

      console.log(`✅ Successfully parsed ${parsedData.transactions.length} transactions`);
      console.log(`📊 Bank: ${parsedData.bankName}, Period: ${parsedData.statementPeriodStart} to ${parsedData.statementPeriodEnd}`);
      console.log(`💰 Totals - Debits: $${totalDebits.toFixed(2)}, Credits: $${totalCredits.toFixed(2)}`);
      
      console.log(`✅ Validation complete: ${validationResult.validCount} valid, ${validationResult.invalidCount} invalid`);
      
      if (validationResult.warnings.length > 0) {
        console.log("⚠️ Validation warnings:");
        validationResult.warnings.forEach(warning => console.log(`  - ${warning}`));
      }
      
      // Log successful parsing to Braintrust
      logAICall(
        'process-bank-statement:parse_success',
        {
          model: usedModelConfig.id,
          promptSummary: 'Bank statement OCR extraction',
          pdfSizeKB: Math.round(pdfBase64Data.length / 1024),
          responseSizeBytes: content.length,
        },
        {
          bankName: parsedData.bankName,
          transactionCount: parsedData.transactions.length,
          validTransactionCount: validationResult.validCount,
          invalidTransactionCount: validationResult.invalidCount,
          periodStart: parsedData.statementPeriodStart,
          periodEnd: parsedData.statementPeriodEnd,
          totalDebits: totalDebits,
          totalCredits: totalCredits,
          sampleTransactions: validationResult.transactions.slice(0, 3).map((t: any) => ({
            date: t.date,
            description: t.description?.substring(0, 30),
            amount: t.amount,
            hasError: t.has_validation_error,
          })),
          validationWarnings: validationResult.warnings.slice(0, 5), // Log first 5 warnings
        },
        {
          model: usedModelConfig.id,
          provider: 'openrouter',
          restaurant_id: restaurantId,
          edge_function: 'process-bank-statement',
          stream: true,
          attempt: 1,
          success: true,
        },
        null // Token usage not available in streaming
      );
    } catch (parseError) {
      console.error("Failed to parse JSON from AI response:", parseError);
      console.error("Content that failed to parse:", content.substring(0, 1000) + "...");
      
      // Log parsing failure to Braintrust
      logAICall(
        'process-bank-statement:parse_error',
        {
          model: usedModelConfig?.id || 'unknown',
          responseSizeBytes: content.length,
          contentPreview: content.substring(0, 500),
        },
        null,
        {
          model: usedModelConfig?.id || 'unknown',
          provider: 'openrouter',
          restaurant_id: restaurantId,
          edge_function: 'process-bank-statement',
          stream: true,
          attempt: 1,
          success: false,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        },
        null
      );
      
      // Update statement with error
      await supabase
        .from("bank_statement_uploads")
        .update({
          status: "error",
          error_message: "Failed to read the bank statement. Please try again or upload a clearer PDF."
        })
        .eq("id", statementUploadId);

      return new Response(
        JSON.stringify({
          error: "Failed to parse bank statement data",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 422,
        },
      );
    }

    // Ensure validationResult is available (should always be set if we reach here without early return)
    if (!validationResult) {
      console.error("Validation result is null - this should not happen");
      return new Response(
        JSON.stringify({
          error: "Internal error: validation result not available",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        },
      );
    }

    // Update statement upload with parsed data and validation results
    const finalStatus = validationResult.invalidCount > 0 && validationResult.validCount > 0 
      ? 'partial_success' 
      : validationResult.validCount > 0 
        ? 'processed' 
        : 'error';
    
    const errorMessage = validationResult.invalidCount > 0
      ? `${validationResult.invalidCount} transaction(s) have validation errors that need user review and correction.`
      : null;

    const { error: updateError } = await supabase
      .from("bank_statement_uploads")
      .update({
        bank_name: parsedData.bankName,
        statement_period_start: parsedData.statementPeriodStart,
        statement_period_end: parsedData.statementPeriodEnd,
        raw_ocr_data: parsedData,
        status: finalStatus,
        processed_at: new Date().toISOString(),
        transaction_count: validationResult.transactions.length,
        successful_transaction_count: validationResult.validCount,
        failed_transaction_count: validationResult.invalidCount,
        total_debits: totalDebits,
        total_credits: totalCredits,
        error_message: errorMessage,
      })
      .eq("id", statementUploadId);

    if (updateError) {
      console.error("Error updating statement upload:", updateError);
      return new Response(JSON.stringify({ error: "Failed to update statement upload" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Filter out transactions with validation errors before insertion
    // Only insert valid transactions - invalid ones are stored in error_message for user review
    const validTransactionsForInsert = validationResult.transactions.filter((tx: any) => !tx.has_validation_error);
    
    const BATCH_SIZE = 50;
    const totalValidTransactions = validTransactionsForInsert.length;
    
    console.log(`💾 Inserting ${totalValidTransactions} valid transactions (${validationResult.invalidCount} skipped due to validation errors) in batches of ${BATCH_SIZE}...`);
    
    let insertedCount = 0;
    for (let i = 0; i < totalValidTransactions; i += BATCH_SIZE) {
      const endIndex = Math.min(i + BATCH_SIZE, totalValidTransactions);
      const batchTransactions = validTransactionsForInsert.slice(i, endIndex);
      
      // Map to database schema just for this batch
      const batch = batchTransactions.map((transaction: any, batchIndex: number) => ({
        statement_upload_id: statementUploadId,
        transaction_date: transaction.date || null,
        description: transaction.description || 'Unknown',
        amount: (typeof transaction.amount === 'number' && !isNaN(transaction.amount)) ? transaction.amount : null,
        transaction_type: transaction.transactionType || 'unknown',
        balance: transaction.balance,
        line_sequence: i + batchIndex + 1,
        confidence_score: transaction.confidenceScore,
        has_validation_error: transaction.has_validation_error || false,
        validation_errors: transaction.validation_errors || null,
      }));
      
      const { error: linesError } = await supabase
        .from("bank_statement_lines")
        .insert(batch);

      if (linesError) {
        console.error(`Error inserting transaction batch ${Math.floor(i / BATCH_SIZE) + 1}:`, linesError);
        
        // Update statement with error status
        await supabase
          .from("bank_statement_uploads")
          .update({
            status: "error",
            error_message: `Failed to insert transactions after processing ${insertedCount} of ${totalValidTransactions}. ${validationResult.invalidCount} transactions were skipped due to validation errors.`
          })
          .eq("id", statementUploadId);
        
        return new Response(JSON.stringify({ 
          error: "Failed to insert transaction lines",
          insertedCount,
          totalValidTransactions,
          totalTransactions: validationResult.transactions.length,
          invalidCount: validationResult.invalidCount,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
      
      insertedCount += batch.length;
      if (insertedCount % 100 === 0 || insertedCount === totalValidTransactions) {
        console.log(`✅ Inserted ${insertedCount}/${totalValidTransactions} valid transactions`);
      }
    }

    console.log(`✅ Successfully inserted ${totalValidTransactions} valid transactions`);
    
    if (validationResult.invalidCount > 0) {
      console.log(`⚠️ ${validationResult.invalidCount} transaction(s) were skipped due to validation errors and need manual review`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        bankName: parsedData.bankName,
        transactionCount: validationResult.transactions.length,
        validTransactionCount: validationResult.validCount,
        invalidTransactionCount: validationResult.invalidCount,
        warnings: validationResult.warnings,
        totalDebits,
        totalCredits,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error in process-bank-statement function:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : 'No stack trace');
    
    // Log unexpected error to Braintrust
    logAICall(
      'process-bank-statement:unexpected_error',
      { 
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      null,
      {
        model: 'unknown',
        provider: 'openrouter',
        edge_function: 'process-bank-statement',
        stream: false,
        attempt: 1,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null
    );
    
    return new Response(
      JSON.stringify({
        error: "An unexpected error occurred while processing the bank statement",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
