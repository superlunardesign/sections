/**
 * Scheduled Sync Jobs
 *
 * These functions are triggered by the schedule defined in jobs.config.
 * They run automatically in the background on Wix's servers.
 */

import { syncSquareToWix, syncAllInventoryCounts } from "./square-sync";

/**
 * Runs every 30 minutes (configurable in jobs.config).
 * Syncs only inventory counts from Square to Wix (lightweight operation).
 */
export async function scheduledInventorySync() {
  console.log("Scheduled inventory sync starting...");

  try {
    const results = await syncAllInventoryCounts();
    console.log(`Inventory sync complete: ${results.inventorySynced} items synced.`);

    if (results.errors && results.errors.length > 0) {
      console.error("Inventory sync errors:", JSON.stringify(results.errors));
    }
  } catch (err) {
    console.error("Scheduled inventory sync failed:", err);
  }
}

/**
 * Runs daily at 3 AM (configurable in jobs.config).
 * Full sync: creates new products, updates existing ones, and syncs inventory.
 */
export async function scheduledFullSync() {
  console.log("Scheduled full sync starting...");

  try {
    const results = await syncSquareToWix();
    console.log(
      `Full sync complete: ${results.created} created, ` +
      `${results.updated} updated, ${results.inventorySynced} inventory synced.`
    );

    if (results.errors && results.errors.length > 0) {
      console.error("Full sync errors:", JSON.stringify(results.errors));
    }
  } catch (err) {
    console.error("Scheduled full sync failed:", err);
  }
}
