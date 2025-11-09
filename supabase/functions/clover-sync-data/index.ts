import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getEncryptionService } from "../_shared/encryption.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
/**
 * Helper function to refresh Clover access token
 */ async function refreshCloverToken(connection, supabase) {
  console.log("Attempting to refresh Clover token...");
  if (!connection.refresh_token) {
    throw new Error("No refresh token available. Please reconnect your Clover account.");
  }
  const encryption = await getEncryptionService();
  const decryptedRefreshToken = await encryption.decrypt(connection.refresh_token);
  // Use production credentials only
  const CLOVER_APP_ID = Deno.env.get("CLOVER_APP_ID");
  const CLOVER_APP_SECRET = Deno.env.get("CLOVER_APP_SECRET");
  // Use production API domains
  const regionAPIDomains = {
    na: "api.clover.com",
    eu: "api.eu.clover.com",
    latam: "api.la.clover.com",
    apac: "api.clover.com",
  };
  const CLOVER_API_DOMAIN = regionAPIDomains[connection.region] || "api.clover.com";
  const tokenRefreshUrl = `https://${CLOVER_API_DOMAIN}/oauth/v2/refresh`;
  const refreshResponse = await fetch(tokenRefreshUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: CLOVER_APP_ID,
      client_secret: CLOVER_APP_SECRET,
      refresh_token: decryptedRefreshToken,
    }),
  });
  if (!refreshResponse.ok) {
    const errorText = await refreshResponse.text();
    console.error("Token refresh failed:", errorText);
    throw new Error("Failed to refresh Clover token. Please reconnect your account.");
  }
  const refreshData = await refreshResponse.json();
  console.log("Token refresh successful");
  // Calculate new expiry
  let newExpiresAt = null;
  if (refreshData.expires_in) {
    newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
  } else {
    // Default to 1 year if not provided
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    newExpiresAt = oneYearFromNow.toISOString();
  }
  // Encrypt new tokens
  const encryptedAccessToken = await encryption.encrypt(refreshData.access_token);
  let encryptedRefreshToken = connection.refresh_token;
  if (refreshData.refresh_token) {
    encryptedRefreshToken = await encryption.encrypt(refreshData.refresh_token);
  }
  // Update the connection with new tokens
  await supabase
    .from("clover_connections")
    .update({
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
  console.log("Connection updated with refreshed token, expires:", newExpiresAt);
  // Return the new decrypted access token
  return refreshData.access_token;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders,
    });
  }
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { restaurantId, action, dateRange } = await req.json();
    if (!restaurantId) {
      throw new Error("Restaurant ID is required");
    }
    // Get Clover connection and restaurant timezone
    const { data: connection, error: connError } = await supabase
      .from("clover_connections")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .single();
    if (connError || !connection) {
      throw new Error("Clover connection not found");
    }
    // Get restaurant timezone
    const { data: restaurant } = await supabase.from("restaurants").select("timezone").eq("id", restaurantId).single();
    const restaurantTimezone = restaurant?.timezone || "America/Chicago";
    // Check if token is expired or will expire soon (within 7 days)
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    if (connection.expires_at && new Date(connection.expires_at) < sevenDaysFromNow) {
      console.log("Clover token expired or expiring soon, attempting refresh:", {
        expires_at: connection.expires_at,
        now: new Date().toISOString(),
      });
      if (!connection.refresh_token) {
        console.error("No refresh token available");
        throw new Error("Clover access token has expired. Please reconnect your Clover account.");
      }
      // Attempt to refresh the token
      try {
        const encryption = await getEncryptionService();
        const decryptedRefreshToken = await encryption.decrypt(connection.refresh_token);
        // Use production credentials only
        const CLOVER_APP_ID = Deno.env.get("CLOVER_APP_ID");
        const CLOVER_APP_SECRET = Deno.env.get("CLOVER_APP_SECRET");
        // Use production API domains
        const regionAPIDomains = {
          na: "api.clover.com",
          eu: "api.eu.clover.com",
          latam: "api.la.clover.com",
          apac: "api.clover.com",
        };
        const CLOVER_API_DOMAIN = regionAPIDomains[connection.region] || regionAPIDomains.na;
        const tokenRefreshUrl = `https://${CLOVER_API_DOMAIN}/oauth/v2/refresh`;
        const refreshResponse = await fetch(tokenRefreshUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: CLOVER_APP_ID,
            client_secret: CLOVER_APP_SECRET,
            refresh_token: decryptedRefreshToken,
          }),
        });
        if (!refreshResponse.ok) {
          const errorText = await refreshResponse.text();
          console.error("Token refresh failed:", errorText);
          throw new Error("Failed to refresh Clover token. Please reconnect your account.");
        }
        const refreshData = await refreshResponse.json();
        console.log("Token refresh successful");
        // Calculate new expiry
        let newExpiresAt = null;
        if (refreshData.expires_in) {
          newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
        } else {
          // Default to 1 year if not provided
          const oneYearFromNow = new Date();
          oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
          newExpiresAt = oneYearFromNow.toISOString();
        }
        // Update the connection with new tokens
        const encryptedAccessToken = await encryption.encrypt(refreshData.access_token);
        let encryptedRefreshToken = connection.refresh_token; // Keep old one unless we get a new one
        if (refreshData.refresh_token) {
          encryptedRefreshToken = await encryption.encrypt(refreshData.refresh_token);
        }
        await supabase
          .from("clover_connections")
          .update({
            access_token: encryptedAccessToken,
            refresh_token: encryptedRefreshToken,
            expires_at: newExpiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", connection.id);
        console.log("Connection updated with refreshed token, new expiry:", newExpiresAt);
        // Update connection object for use in this request
        connection.access_token = encryptedAccessToken;
        connection.expires_at = newExpiresAt;
      } catch (refreshError) {
        console.error("Error refreshing token:", refreshError);
        throw new Error("Failed to refresh Clover token. Please reconnect your account.");
      }
    }
    // Decrypt access token
    const encryption = await getEncryptionService();
    let accessToken = await encryption.decrypt(connection.access_token);
    console.log("Token info:", {
      hasToken: !!accessToken,
      tokenLength: accessToken?.length,
      environment: connection.environment,
      merchantId: connection.merchant_id,
      expiresAt: connection.expires_at,
      isExpired: connection.expires_at ? new Date(connection.expires_at) < new Date() : "unknown",
    });
    // Use production API domains
    const regionAPIDomains = {
      na: "api.clover.com",
      eu: "api.eu.clover.com",
      latam: "api.la.clover.com",
      apac: "api.clover.com",
    };
    const CLOVER_API_DOMAIN = regionAPIDomains[connection.region] || "api.clover.com";
    const BASE_URL = `https://${CLOVER_API_DOMAIN}/v3/merchants/${connection.merchant_id}`;
    console.log("Using Clover API:", {
      environment: "production",
      domain: CLOVER_API_DOMAIN,
      region: connection.region,
    });
    // Calculate date range
    let startDate, endDate;
    if (dateRange) {
      startDate = new Date(dateRange.startDate);
      endDate = new Date(dateRange.endDate);
    } else if (action === "initial_sync") {
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(endDate.getDate() - 90);
    } else {
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(endDate.getDate() - 1);
    }
    console.log("Syncing Clover data from", startDate.toISOString(), "to", endDate.toISOString());
    let ordersSynced = 0;
    let errors = [];
    try {
      // Fetch orders with pagination
      let offset = 0;
      const limit = 100;
      let hasMore = true;
      let maxIterations = 50; // Safety limit to prevent infinite loops
      let iterations = 0;
      while (hasMore && iterations < maxIterations) {
        iterations++;
        const ordersUrl = new URL(`${BASE_URL}/orders`);
        // Clover API expects Unix timestamps in SECONDS (not milliseconds)
        const startTimestamp = Math.floor(startDate.getTime() / 1000);
        const endTimestamp = Math.floor(endDate.getTime() / 1000);
        // Use modifiedTime which is more commonly supported in Clover API
        ordersUrl.searchParams.set("filter", `modifiedTime>=${startTimestamp}`);
        // Only expand fields that are covered by basic Orders read permission
        // Tax, tips, and totals are available on the order object without expansion
        // Note: No spaces after commas - Clover API requires proper formatting
        ordersUrl.searchParams.set(
          "expand",
          "lineItems, employee, refunds, credits, voids, customers, serviceCharge, discounts, orderType",
        );
        ordersUrl.searchParams.set("limit", limit.toString());
        ordersUrl.searchParams.set("offset", offset.toString());
        console.log("Fetching orders:", ordersUrl.toString());
        console.log("Date range:", {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          startTimestamp,
          endTimestamp,
          note: "Using modifiedTime filter instead of createdTime",
        });
        // Add timeout and abort controller to prevent hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        let ordersResponse;
        let tokenRefreshed = false;
        try {
          ordersResponse = await fetch(ordersUrl.toString(), {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          // If we get a 401, try refreshing the token and retry once
          if (ordersResponse.status === 401) {
            console.log("Received 401 Unauthorized - attempting token refresh");
            try {
              accessToken = await refreshCloverToken(connection, supabase);
              tokenRefreshed = true;
              console.log("Token refreshed successfully, retrying request");
              // Retry the request with new token
              const retryController = new AbortController();
              const retryTimeoutId = setTimeout(() => retryController.abort(), 30000);
              ordersResponse = await fetch(ordersUrl.toString(), {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
                signal: retryController.signal,
              });
              clearTimeout(retryTimeoutId);
              console.log("Retry request completed with status:", ordersResponse.status);
            } catch (refreshError) {
              console.error("Failed to refresh token:", refreshError.message);
              errors.push(`Token refresh failed: ${refreshError.message}`);
              break;
            }
          }
        } catch (fetchError) {
          clearTimeout(timeoutId);
          console.error("Fetch timeout or error:", fetchError.message);
          errors.push(`Fetch error: ${fetchError.message}`);
          break;
        }
        if (!ordersResponse.ok) {
          const errorText = await ordersResponse.text();
          console.error("Failed to fetch orders - Status:", ordersResponse.status, "Response:", errorText);
          console.error("Request details:", {
            url: ordersUrl.toString(),
            merchantId: connection.merchant_id,
            environment: connection.environment,
            region: connection.region,
            tokenLength: accessToken?.length,
            tokenRefreshed,
            expiresAt: connection.expires_at,
          });
          errors.push(`Failed to fetch orders: ${errorText}`);
          break;
        }
        const ordersData = await ordersResponse.json();
        const orders = ordersData.elements || [];
        if (orders.length === 0) {
          hasMore = false;
          break;
        }
        console.log(`Processing ${orders.length} orders`);
        for (const order of orders) {
          try {
            // Store order - convert UTC timestamp to restaurant's local timezone for service_date
            let serviceDate = null;
            if (order.createdTime) {
              const utcDate = new Date(order.createdTime);
              // Convert to restaurant timezone using Intl API
              const localDateStr = new Intl.DateTimeFormat("en-CA", {
                timeZone: restaurantTimezone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(utcDate);
              serviceDate = localDateStr; // Already in YYYY-MM-DD format from 'en-CA' locale
            }

            // Fetch payments for this order (authoritative source for taxes/tips)
            const paysUrl = `${BASE_URL}/orders/${order.id}/payments?limit=1000`;
            let taxCents = 0;
            let tipCents = 0;
            let paidCents = 0;

            try {
              const paysResp = await fetch(paysUrl, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });

              if (paysResp.ok) {
                const paysData = await paysResp.json();
                const payments = paysData.elements ?? [];

                // Sum tips and amounts from payments (source of truth)
                // Note: taxAmount is not provided by Clover API - we calculate it later from order total
                tipCents = payments.reduce((s, p) => s + (p.tipAmount ?? 0), 0);
                paidCents = payments.reduce((s, p) => s + (p.amount ?? 0), 0); // includes tax, excludes tip

                console.log(`Order ${order.id} payments:`, {
                  paymentCount: payments.length,
                  taxCents,
                  tipCents,
                  paidCents,
                  orderTotalCents: order.total ?? 0,
                });

                // Reconciliation check: payment amounts should match order total (±1 cent tolerance)
                const orderTotalCents = order.total ?? 0;
                const delta = Math.abs(orderTotalCents - paidCents);
                if (delta > 1 && paidCents > 0) {
                  console.warn(
                    `Order ${order.id} mismatch: order.total=${orderTotalCents}, sum(payment.amount)=${paidCents}`,
                  );
                }
              } else {
                console.warn(`Failed to fetch payments for order ${order.id}:`, await paysResp.text());
                // Fallback to order-level fields if payment fetch fails
                tipCents = order.tipAmount ?? 0;
              }
            } catch (paymentError) {
              console.error(`Error fetching payments for order ${order.id}:`, paymentError.message);
              // Fallback to order-level fields
              tipCents = order.tipAmount ?? 0;
            }

            // Only calculate tax if not provided by payments
            // Payment tax is the authoritative source from Clover
            if (taxCents === 0) {
              // Calculate tax from order total minus line items subtotal
              const revenueSubtotal = order.lineItems?.elements
                ?.filter(li => li.isRevenue)
                .reduce((sum, li) => {
                  const qty = (li.unitQty ?? 1000) / 1000;
                  const price = li.price ?? 0;
                  return sum + (price * qty);
                }, 0) ?? 0;

              // Use paidCents if available (paid orders), otherwise use order.total (unpaid orders)
              const totalForTaxCalc = paidCents > 0 ? paidCents : (order.total ?? 0);

              // Tax = total - revenueSubtotal - serviceCharge + discount
              taxCents = Math.max(0, 
                totalForTaxCalc
                - revenueSubtotal 
                - (order.serviceCharge?.amount ?? 0)
                + (order.discount?.amount ?? 0)
              );

              console.log(`Order ${order.id} calculated tax (no payment tax):`, {
                orderTotal: order.total,
                paidCents,
                totalForTaxCalc,
                revenueSubtotal,
                serviceCharge: order.serviceCharge?.amount ?? 0,
                discount: order.discount?.amount ?? 0,
                calculatedTaxCents: taxCents,
              });
            } else {
              console.log(`Order ${order.id} using payment tax: ${taxCents / 100}`);
            }

            await supabase.from("clover_orders").upsert(
              {
                restaurant_id: restaurantId,
                order_id: order.id,
                merchant_id: connection.merchant_id,
                employee_id: order.employee?.id,
                state: order.state,
                total: order.total ? order.total / 100 : null,
                tax_amount: taxCents ? taxCents / 100 : null,
                service_charge_amount: order.serviceCharge ? order.serviceCharge.amount / 100 : null,
                discount_amount: order.discount ? order.discount.amount / 100 : null,
                tip_amount: tipCents ? tipCents / 100 : null,
                created_time: order.createdTime ? new Date(order.createdTime).toISOString() : null,
                modified_time: order.modifiedTime ? new Date(order.modifiedTime).toISOString() : null,
                closed_time: order.clientCreatedTime
                  ? new Date(order.clientCreatedTime).toISOString()
                  : order.createdTime
                    ? new Date(order.createdTime).toISOString()
                    : null,
                service_date: serviceDate,
                raw_json: order,
              },
              {
                onConflict: "restaurant_id,order_id",
              },
            );
            // Store line items (discounts will be handled separately from order.discounts array)
            if (order.lineItems?.elements) {
              for (const lineItem of order.lineItems.elements) {
                // Clover stores quantities in thousands (1000 = 1 item) and prices in cents (3000 = $30.00)
                const actualQuantity = lineItem.unitQty ? lineItem.unitQty / 1000 : 1;
                const actualPrice = lineItem.price ? lineItem.price / 100 : null;
                await supabase.from("clover_order_line_items").upsert(
                  {
                    restaurant_id: restaurantId,
                    order_id: order.id,
                    line_item_id: lineItem.id,
                    item_id: lineItem.item?.id,
                    name: lineItem.name || "Unknown Item",
                    alternate_name: lineItem.alternateName,
                    price: actualPrice,
                    unit_quantity: actualQuantity,
                    is_revenue: lineItem.isRevenue ?? null,
                    note: lineItem.note,
                    printed: lineItem.printed || false,
                    category_id: lineItem.item?.categories?.elements?.[0]?.id,
                    raw_json: lineItem,
                  },
                  {
                    onConflict: "restaurant_id,order_id,line_item_id",
                  },
                );
              }
            }

            // Calculate closed time for adjustments
            // Extract date object for time extraction
            const closedDateTime = order.clientCreatedTime
              ? new Date(order.clientCreatedTime)
              : order.createdTime
                ? new Date(order.createdTime)
                : null;
            
            // Extract just the time portion in HH:MM:SS format for sale_time column
            // Convert to restaurant timezone to match local order time
            let closedTime = null;
            if (closedDateTime) {
              const localTimeStr = new Intl.DateTimeFormat("en-US", {
                timeZone: restaurantTimezone,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              }).format(closedDateTime);
              // Format is "HH:MM:SS"
              closedTime = localTimeStr;
            }

            // Extract and store adjustments (don't create fake line items)
            // This keeps revenue metrics clean and accounting-compliant
            const adjustments = [];

            // Tax (calculated from order total)
            // Respect taxRemoved flag - if true, tax was removed and should be 0
            if (taxCents > 0 && !order.taxRemoved) {
              // Check if this is a VAT order (tax included in prices)
              const taxLabel = order.isVat ? "VAT" : "Sales Tax";
              adjustments.push({
                restaurant_id: restaurantId,
                pos_system: "clover",
                external_order_id: order.id,
                external_item_id: `${order.id}_tax`,
                item_name: taxLabel,
                item_type: "tax",
                adjustment_type: "tax",
                total_price: taxCents / 100,
                sale_date: serviceDate,
                sale_time: closedTime,
                raw_data: {
                  from: "payments",
                  taxCents,
                  isVat: order.isVat ?? false,
                  taxRemoved: order.taxRemoved ?? false,
                },
              });
            }

            // Tips (from payments - source of truth)
            if (tipCents > 0) {
              adjustments.push({
                restaurant_id: restaurantId,
                pos_system: "clover",
                external_order_id: order.id,
                external_item_id: `${order.id}_tip`,
                item_name: "Tips",
                item_type: "tip",
                adjustment_type: "tip",
                total_price: tipCents / 100,
                sale_date: serviceDate,
                sale_time: closedTime,
                raw_data: {
                  from: "payments",
                  tipCents,
                },
              });
            }

            // Service Charge
            if (order.serviceCharge?.amount) {
              adjustments.push({
                restaurant_id: restaurantId,
                pos_system: "clover",
                external_order_id: order.id,
                external_item_id: `${order.id}_service_charge`,
                item_name: order.serviceCharge.name || "Service Charge",
                item_type: "service_charge",
                adjustment_type: "service_charge",
                total_price: order.serviceCharge.amount / 100,
                sale_date: serviceDate,
                sale_time: closedTime,
                raw_data: {
                  serviceCharge: order.serviceCharge,
                },
              });
            }

            // Process all discounts from order.discounts array
            // This handles both order-level and line-item level discounts
            if (order.discounts?.elements) {
              for (const disc of order.discounts.elements) {
                const amountOff = disc.amount ? disc.amount / 100 : 0;
                if (amountOff <= 0) continue; // Skip zero or no-amount discounts

                // Determine if discount is tied to a specific line item
                let itemName = null;
                if (disc.lineItemRef?.id) {
                  // Find the line item name by matching the ID
                  const li = order.lineItems?.elements?.find((li) => li.id === disc.lineItemRef.id);
                  if (li) itemName = li.name;
                }

                // Construct entry name
                const discountName = disc.name || "Discount";
                const entryName = itemName ? `${itemName} - ${discountName}` : discountName;

                adjustments.push({
                  restaurant_id: restaurantId,
                  pos_system: "clover",
                  external_order_id: order.id,
                  external_item_id: `${order.id}_discount_${disc.id}`,
                  item_name: entryName,
                  item_type: "discount",
                  adjustment_type: "discount",
                  total_price: -amountOff, // Discounts as negative revenue
                  sale_date: serviceDate,
                  sale_time: closedTime,
                  raw_data: {
                    discount: disc,
                    lineItemRef: disc.lineItemRef,
                    lineItemName: itemName,
                  },
                });
              }
            }

            // Upsert all adjustments
            if (adjustments.length > 0) {
              const { error: adjustmentError } = await supabase
                .from("unified_sales")
                .upsert(adjustments, {
                  ignoreDuplicates: false,
                });
              
              if (adjustmentError) {
                console.error("Failed to upsert adjustments:", adjustmentError);
                errors.push(`Adjustment sync error: ${adjustmentError.message}`);
              }
            }
            ordersSynced++;
          } catch (orderError) {
            console.error(`Error processing order ${order.id}:`, orderError);
            errors.push(`Order ${order.id}: ${orderError.message}`);
          }
        }
        offset += limit;
        if (orders.length < limit) {
          hasMore = false;
        }
      }
      // Debug: Check what orders we have before sync
      const { data: ordersCheck } = await supabase
        .from("clover_orders")
        .select("order_id, state, service_date, closed_time")
        .eq("restaurant_id", restaurantId);
      const { data: lineItemsCheck } = await supabase
        .from("clover_order_line_items")
        .select("line_item_id, is_revenue, price")
        .eq("restaurant_id", restaurantId);
      console.log("Orders before sync:", ordersCheck);
      console.log("Line items before sync:", lineItemsCheck);
      // Sync to unified_sales table
      const { data: syncResult, error: syncError } = await supabase.rpc("sync_clover_to_unified_sales", {
        p_restaurant_id: restaurantId,
      });
      if (syncError) {
        console.error("Error syncing to unified sales:", syncError);
        errors.push(`Unified sales sync error: ${syncError.message}`);
      } else {
        console.log(`Synced ${syncResult} items to unified_sales`);
        // Debug: Check what got synced
        const { data: syncedItems } = await supabase
          .from("unified_sales")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .eq("pos_system", "clover");
        console.log("Items in unified_sales after sync:", syncedItems?.length || 0);
      }
    } catch (syncError) {
      console.error("Sync error:", syncError);
      errors.push(syncError.message);
    }
    return new Response(
      JSON.stringify({
        success: true,
        results: {
          ordersSynced,
          paymentsSynced: 0,
          refundsSynced: 0,
          teamMembersSynced: 0,
          shiftsSynced: 0,
          catalogSynced: false,
          errors,
        },
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("Clover sync error:", error);
    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
