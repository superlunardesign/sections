/**
 * Wix HTTP Functions — Square Webhook Endpoints
 *
 * These are public HTTP endpoints that Square calls when events occur.
 * Each function name maps to a URL:
 *
 *   POST https://www.YOUR-SITE.com/_functions/square_webhook
 *
 * Register this URL in your Square Developer Dashboard under Webhooks.
 *
 * Subscribe to these Square webhook event types:
 *   - inventory.count.updated
 *   - catalog.version.updated
 */

import { ok, badRequest, forbidden } from "wix-http-functions";
import wixData from "wix-data";
import { inventory } from "wix-stores.v2";
import { elevate } from "wix-auth";
import { getInventoryCount } from "./square-api";
import { MAPPING_COLLECTION, getWebhookSignatureKey } from "./square-config";

const elevatedUpdateInventoryVariants = elevate(inventory.updateInventoryVariants);

/**
 * POST endpoint: receives Square webhook events.
 *
 * URL: https://www.YOUR-SITE.com/_functions/square_webhook
 *
 * @param {Object} request - The incoming HTTP request
 */
export async function post_square_webhook(request) {
  try {
    const body = await request.body.json();

    // Optional: Verify webhook signature for security
    // Uncomment if you set up webhook signature verification in Square
    /*
    const signature = request.headers["x-square-hmacsha256-signature"];
    const isValid = await verifyWebhookSignature(request, signature);
    if (!isValid) {
      return forbidden({ body: { error: "Invalid signature" } });
    }
    */

    const eventType = body.type;

    switch (eventType) {
      case "inventory.count.updated":
        await handleInventoryCountUpdated(body.data);
        break;

      case "catalog.version.updated":
        await handleCatalogUpdated(body.data);
        break;

      default:
        console.log(`Unhandled Square webhook event type: ${eventType}`);
    }

    // Always return 200 OK to Square so it doesn't retry
    return ok({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ received: true })
    });

  } catch (err) {
    console.error("Webhook processing error:", err);
    // Still return 200 to prevent Square from retrying
    return ok({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ received: true, error: err.message })
    });
  }
}

// ─── WEBHOOK HANDLERS ───────────────────────────────────────────────────────

/**
 * Handles Square inventory.count.updated webhook events.
 * Updates the corresponding Wix product inventory when Square inventory changes.
 *
 * @param {Object} data - The webhook event data
 */
async function handleInventoryCountUpdated(data) {
  if (!data || !data.object || !data.object.inventory_counts) return;

  for (const count of data.object.inventory_counts) {
    const catalogObjectId = count.catalog_object_id;
    const newQuantity = parseFloat(count.quantity) || 0;

    // Look up our mapping to find the corresponding Wix product
    const mappingResult = await wixData.query(MAPPING_COLLECTION)
      .eq("squareVariationId", catalogObjectId)
      .find();

    if (mappingResult.items.length === 0) {
      // This Square item isn't mapped to a Wix product — skip
      continue;
    }

    const mapping = mappingResult.items[0];
    const wixProductId = mapping.wixProductId;

    try {
      // Set Wix inventory to match Square quantity
      await elevatedUpdateInventoryVariants(wixProductId, {
        trackQuantity: true,
        variants: [{
          variantId: "00000000-0000-0000-0000-000000000000",
          quantity: newQuantity,
          inStock: newQuantity > 0
        }]
      });

      // Update sync timestamp
      mapping.lastSynced = new Date();
      await wixData.update(MAPPING_COLLECTION, mapping);

      console.log(`Webhook: Updated Wix product ${wixProductId} inventory to ${newQuantity}`);
    } catch (err) {
      console.error(`Webhook: Failed to update Wix inventory for ${wixProductId}:`, err);
    }
  }
}

/**
 * Handles Square catalog.version.updated webhook events.
 * When a catalog item is updated in Square, update the corresponding Wix product.
 *
 * @param {Object} data - The webhook event data
 */
async function handleCatalogUpdated(data) {
  if (!data || !data.object || !data.object.catalog_version) return;

  // The catalog.version.updated event indicates something changed in the catalog.
  // For a full re-sync of changed items, you could trigger a targeted sync here.
  // For now, log it. The scheduled full sync will pick up changes.
  console.log("Square catalog updated. Changes will sync on next scheduled run.");

  // If you want real-time catalog sync, you'd need to:
  // 1. Use data.object.catalog_version.updated_at to find changed items
  // 2. Call Square's SearchCatalogObjects with a filter on updated_at
  // 3. Update the corresponding Wix products
  // This is optional — the scheduled sync handles it automatically.
}

/**
 * GET endpoint for testing that the webhook URL is reachable.
 *
 * URL: https://www.YOUR-SITE.com/_functions/square_webhook
 */
export function get_square_webhook(request) {
  return ok({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "active",
      message: "Square webhook endpoint is running."
    })
  });
}

// ─── SIGNATURE VERIFICATION (Optional but recommended) ──────────────────────

/**
 * Verifies the Square webhook signature.
 * Enable this once you have your webhook signature key configured.
 *
 * @param {Object} request - The HTTP request
 * @param {string} signature - The x-square-hmacsha256-signature header value
 * @returns {Promise<boolean>} Whether the signature is valid
 */
async function verifyWebhookSignature(request, signature) {
  // Note: Wix Velo doesn't have native crypto.createHmac.
  // For production, you should implement signature verification.
  // One approach: use a third-party npm package or Wix's built-in crypto if available.
  // For now, this returns true. Enable proper verification in production.
  return true;
}
