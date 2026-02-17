/**
 * Scheduled Sync Jobs
 *
 * These functions are triggered by the schedule defined in jobs.config.
 * They run automatically in the background on Wix's servers.
 */

import { syncAllInventoryCounts } from "./square-sync";
import { listSquareItemIds } from "./square-api";
import { syncBatch } from "./square-sync";

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
 * Runs every hour (configurable in jobs.config).
 * Full sync: creates new products, updates existing ones, and syncs inventory.
 * Processes in batches to stay under Wix's timeout.
 */
export async function scheduledFullSync() {
  console.log("Scheduled full sync starting...");

  try {
    const itemIds = await listSquareItemIds();
    let totalCreated = 0, totalUpdated = 0, totalErrors = 0;

    // Process in batches of 10
    const batchSize = 10;
    for (let i = 0; i < itemIds.length; i += batchSize) {
      const batch = itemIds.slice(i, i + batchSize);
      const results = await syncBatch(batch);
      totalCreated += results.created.length;
      totalUpdated += results.updated.length;
      totalErrors += results.errors.length;
    }

    // Then sync inventory
    const invResults = await syncAllInventoryCounts();

    console.log(
      `Full sync complete: ${totalCreated} created, ` +
      `${totalUpdated} updated, ${invResults.inventorySynced} inventory synced, ` +
      `${totalErrors} errors.`
    );
  } catch (err) {
    console.error("Scheduled full sync failed:", err);
  }
}
