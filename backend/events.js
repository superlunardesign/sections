/**
 * Wix Store Event Handlers
 *
 * This file handles Wix store events. The function names must match Wix's
 * expected event handler names exactly.
 *
 * When a customer purchases something on your Wix site, this code
 * automatically decrements the corresponding inventory in Square.
 */

import wixData from "wix-data";
import { decrementSquareInventoryForOrder } from "./square-sync";
import { MAPPING_COLLECTION } from "./square-config";

/**
 * Triggered when a Wix store order is paid.
 * Decrements the corresponding Square inventory for each line item.
 *
 * Event handler name must be exactly: wixStores_onOrderPaid
 *
 * @param {Object} event - The order event object from Wix
 */
export async function wixStores_onOrderPaid(event) {
  try {
    const order = event;

    if (!order.lineItems || order.lineItems.length === 0) {
      return;
    }

    // Build an array of { productId, quantity } for each line item
    const lineItems = order.lineItems.map(item => ({
      productId: item.productId,
      quantity: item.quantity
    }));

    // Decrement Square inventory for each product sold
    const result = await decrementSquareInventoryForOrder(lineItems);

    if (result.errors.length > 0) {
      console.error("Square inventory decrement errors:", JSON.stringify(result.errors));
    }

    console.log(`Order ${order._id}: Adjusted ${result.adjusted} Square inventory items.`);
  } catch (err) {
    console.error("Error handling wixStores_onOrderPaid:", err);
  }
}

/**
 * Triggered when a Wix store order is refunded.
 * Increments the corresponding Square inventory back.
 *
 * Event handler name must be exactly: wixStores_onOrderRefunded
 *
 * @param {Object} event - The refund event object from Wix
 */
export async function wixStores_onOrderRefunded(event) {
  try {
    const order = event;

    if (!order.lineItems || order.lineItems.length === 0) {
      return;
    }

    // For refunds, we need to ADD inventory back to Square
    const { adjustSquareInventory } = await import("./square-api");

    for (const item of order.lineItems) {
      try {
        // Look up the Square variation ID
        const mapping = await wixData.query(MAPPING_COLLECTION)
          .eq("wixProductId", item.productId)
          .ne("squareVariationId", "")
          .find();

        if (mapping.items.length > 0) {
          const squareVariationId = mapping.items[0].squareVariationId;

          // Increment (positive quantity) to add stock back
          await adjustSquareInventory(
            squareVariationId,
            item.quantity,
            `Wix refund - restocked ${item.quantity}`
          );
        }
      } catch (err) {
        console.error(`Refund: Failed to restock Square inventory for ${item.productId}:`, err);
      }
    }

    console.log(`Refund processed for order ${order._id}: Square inventory restored.`);
  } catch (err) {
    console.error("Error handling wixStores_onOrderRefunded:", err);
  }
}

/**
 * (Optional) Triggered when Wix inventory is updated manually.
 * You can use this to push manual Wix inventory changes to Square.
 *
 * Event handler name must be exactly: wixStores_onInventoryItemUpdated
 *
 * Uncomment the function below to enable bidirectional manual inventory sync.
 * WARNING: Be careful with this — it can create sync loops if not handled properly.
 */

/*
export async function wixStores_onInventoryItemUpdated(event) {
  try {
    // Prevent sync loops: check if this update was triggered by our own sync
    const lastSync = await wixData.query(MAPPING_COLLECTION)
      .eq("wixProductId", event.productId)
      .find();

    if (lastSync.items.length > 0) {
      const mapping = lastSync.items[0];
      const timeSinceSync = Date.now() - new Date(mapping.lastSynced).getTime();

      // If last sync was within 10 seconds, this was probably our own update — skip
      if (timeSinceSync < 10000) {
        return;
      }

      // Push the new inventory count to Square
      const { adjustSquareInventory, getInventoryCount } = await import("./square-api");
      const currentSquareQty = await getInventoryCount(mapping.squareVariationId);
      const newWixQty = event.newValue; // The new inventory quantity in Wix
      const delta = newWixQty - currentSquareQty;

      if (delta !== 0) {
        await adjustSquareInventory(
          mapping.squareVariationId,
          delta,
          "Manual Wix inventory update"
        );
      }
    }
  } catch (err) {
    console.error("Error handling wixStores_onInventoryItemUpdated:", err);
  }
}
*/
