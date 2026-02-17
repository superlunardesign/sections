/**
 * Scheduled Sync Jobs
 *
 * These functions are triggered by the schedule defined in jobs.config.
 * They run automatically in the background on Wix's servers.
 */

import { listSquareItemIds } from "./square-api";
import { syncBatch, getInventoryMappings, syncInventoryBatch } from "./square-sync";

/**
 * Runs every 30 minutes (configurable in jobs.config).
 * Syncs only inventory counts from Square to Wix.
 * Processes in batches to avoid timeout.
 */
export async function scheduledInventorySync() {
  console.log("Scheduled inventory sync starting...");

  try {
    const { items } = await getInventoryMappings();
    let totalSynced = 0;

    const batchSize = 20;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const results = await syncInventoryBatch(batch);
      totalSynced += results.synced;
    }

    console.log(`Inventory sync complete: ${totalSynced} items synced.`);
  } catch (err) {
    console.error("Scheduled inventory sync failed:", err);
  }
}

/**
 * Runs every 30 minutes offset by 15 min (configurable in jobs.config).
 * Full sync: creates new products, updates existing ones, and syncs inventory.
 * Processes in batches to stay under Wix's timeout.
 */
export async function scheduledFullSync() {
  console.log("Scheduled full sync starting...");

  try {
    const itemIds = await listSquareItemIds();
    let totalCreated = 0, totalUpdated = 0, totalErrors = 0;

    const batchSize = 10;
    for (let i = 0; i < itemIds.length; i += batchSize) {
      const batch = itemIds.slice(i, i + batchSize);
      const results = await syncBatch(batch);
      totalCreated += results.created.length;
      totalUpdated += results.updated.length;
      totalErrors += results.errors.length;
    }

    // Then sync inventory in batches
    const { items } = await getInventoryMappings();
    let totalSynced = 0;

    const invBatchSize = 20;
    for (let i = 0; i < items.length; i += invBatchSize) {
      const batch = items.slice(i, i + invBatchSize);
      const invResults = await syncInventoryBatch(batch);
      totalSynced += invResults.synced;
    }

    console.log(
      `Full sync complete: ${totalCreated} created, ` +
      `${totalUpdated} updated, ${totalSynced} inventory synced, ` +
      `${totalErrors} errors.`
    );
  } catch (err) {
    console.error("Scheduled full sync failed:", err);
  }
}
