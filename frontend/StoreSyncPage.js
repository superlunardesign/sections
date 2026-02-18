/**
 * Store Sync Page — Frontend Code
 *
 * Paste this into your Wix Studio page code for the Store Sync admin page.
 *
 * Required page elements:
 *   #syncButton    — Button to start the full sync
 *   #statusLog     — Text element (or textBox) to display the running log
 *
 * Optional elements:
 *   #progressBar   — ProgressBar element to show overall progress
 *   #syncImages    — Checkbox or toggle: whether to sync images (default: on)
 */

import {
  getSquareItemIds,
  prepareSync,
  syncSingleItemById,
  getInventoryMappings,
  syncSingleInventoryItem,
  getImageSyncList,
  syncSingleProductImages
} from "backend/square-sync";

let logLines = [];
let isSyncing = false;

$w.onReady(function () {
  $w("#statusLog").text = "Ready. Press Sync to start.";

  $w("#syncButton").onClick(async () => {
    if (isSyncing) return;
    isSyncing = true;
    logLines = [];
    $w("#syncButton").disable();

    try {
      await runFullSync();
    } catch (err) {
      log(`FATAL ERROR: ${err.message}`);
    }

    isSyncing = false;
    $w("#syncButton").enable();
  });
});

// ─── Logging helper ──────────────────────────────────────────────────────────

function log(message) {
  logLines.push(message);
  // Keep last 200 lines to avoid UI slowdown
  if (logLines.length > 200) {
    logLines = logLines.slice(-200);
  }
  $w("#statusLog").text = logLines.join("\n");
}

// ─── Full Sync Flow ──────────────────────────────────────────────────────────

async function runFullSync() {
  const startTime = Date.now();

  log("=== STARTING SYNC ===");
  log("");

  // ── Phase 1: Fetch item list from Square ──────────────────────────────────
  log("Fetching items from Square...");
  const { itemIds, total } = await getSquareItemIds();
  log(`Found ${total} items in Square.`);
  log("");

  // ── Phase 2: Prepare categories/collections ───────────────────────────────
  log("Preparing categories & collections...");
  const collectionMap = await prepareSync();
  const collectionCount = Object.keys(collectionMap).length;
  log(`Categories ready (${collectionCount} collections mapped).`);
  log("");

  // ── Phase 3: Sync products one by one ─────────────────────────────────────
  log("=== SYNCING PRODUCTS ===");
  log("");

  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (let i = 0; i < itemIds.length; i++) {
    const num = `(${i + 1}/${total})`;

    try {
      const result = await syncSingleItemById(itemIds[i], collectionMap);

      switch (result.status) {
        case "created":
          log(`${num} + NEW: ${result.name} — ${result.details}`);
          created++;
          break;
        case "updated":
          log(`${num} ~ UPDATED: ${result.name} — ${result.details}`);
          updated++;
          break;
        case "skipped":
          log(`${num} . ${result.name} — no changes`);
          skipped++;
          break;
        case "error":
          log(`${num} ! ERROR: ${result.name} — ${result.details}`);
          errors++;
          break;
      }
    } catch (err) {
      log(`${num} ! ERROR: ${err.message}`);
      errors++;
    }

    // Update progress bar if available
    try {
      $w("#progressBar").value = Math.round(((i + 1) / total) * 33);
    } catch (e) { /* no progress bar */ }
  }

  log("");
  log(`=== PRODUCTS DONE === Created: ${created}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
  log("");

  // ── Phase 4: Sync inventory ───────────────────────────────────────────────
  log("=== SYNCING INVENTORY ===");
  log("");
  log("Fetching inventory mappings from Square...");

  const inventoryData = await getInventoryMappings();
  const invTotal = inventoryData.total;
  log(`Found ${invTotal} items to check inventory.`);

  if (inventoryData.error) {
    log(`! Error fetching inventory: ${inventoryData.error}`);
  }

  let invSynced = 0, invErrors = 0;

  for (let i = 0; i < inventoryData.items.length; i++) {
    const item = inventoryData.items[i];
    const num = `(${i + 1}/${invTotal})`;

    try {
      const result = await syncSingleInventoryItem(item);

      if (result.status === "synced") {
        log(`${num} ${result.name}: ${result.details}`);
        invSynced++;
      } else {
        log(`${num} ! ${result.name}: ${result.details}`);
        invErrors++;
      }
    } catch (err) {
      log(`${num} ! ${item.squareItemName}: ${err.message}`);
      invErrors++;
    }

    try {
      $w("#progressBar").value = 33 + Math.round(((i + 1) / invTotal) * 33);
    } catch (e) { /* no progress bar */ }
  }

  log("");
  log(`=== INVENTORY DONE === Synced: ${invSynced}, Errors: ${invErrors}`);
  log("");

  // ── Phase 5: Sync images ──────────────────────────────────────────────────
  log("=== SYNCING IMAGES ===");
  log("");
  log("Building image list from Square...");

  const imageData = await getImageSyncList();
  const imgTotal = imageData.total;
  log(`Found ${imgTotal} products with images.`);

  let imgSuccess = 0, imgErrors = 0;

  for (let i = 0; i < imageData.items.length; i++) {
    const item = imageData.items[i];
    const num = `(${i + 1}/${imgTotal})`;

    log(`${num} Importing images for: ${item.name}...`);

    try {
      const result = await syncSingleProductImages(
        item.wixProductId,
        item.imageUrls,
        item.name
      );

      if (result.success) {
        log(`  + Done (${result.imported} images)`);
        imgSuccess++;
      } else {
        log(`  ! Failed: ${result.error}`);
        imgErrors++;
      }
    } catch (err) {
      log(`  ! Failed: ${err.message}`);
      imgErrors++;
    }

    try {
      $w("#progressBar").value = 66 + Math.round(((i + 1) / imgTotal) * 34);
    } catch (e) { /* no progress bar */ }
  }

  log("");
  log(`=== IMAGES DONE === Success: ${imgSuccess}, Errors: ${imgErrors}`);
  log("");

  // ── Summary ───────────────────────────────────────────────────────────────
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  log("========================================");
  log("           SYNC COMPLETE");
  log("========================================");
  log(`Products  — New: ${created}, Updated: ${updated}, Unchanged: ${skipped}, Errors: ${errors}`);
  log(`Inventory — Synced: ${invSynced}, Errors: ${invErrors}`);
  log(`Images    — Imported: ${imgSuccess}, Errors: ${imgErrors}`);
  log(`Time      — ${mins}m ${secs}s`);
  log("========================================");

  try {
    $w("#progressBar").value = 100;
  } catch (e) { /* no progress bar */ }
}
