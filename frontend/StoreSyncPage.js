/**
 * Store Sync Page — Frontend Code
 *
 * Paste this into your Wix Studio page code for the Store Sync admin page.
 *
 * Required page elements:
 *   #syncButton      — Button to start the full sync
 *   #stopSyncBtn     — Button to stop a running sync
 *   #statusText      — Text element to display the running log
 *   #progressBar1    — ProgressBar element to show overall progress
 *
 * Single product sync elements (optional — page works without them):
 *   #productIdInput  — Text input for product SKU
 *   #singleSyncBtn   — Button to sync a single product
 */

import {
  getSquareItemIds,
  prepareSync,
  syncSingleItemById,
  getInventoryMappings,
  syncSingleInventoryItem,
  getImageSyncList,
  syncSingleProductImages,
  syncSingleProductComplete,
  cleanupDeletedProducts
} from "backend/square-sync";

let logLines = [];
let isSyncing = false;
let stopRequested = false;
let errorList = []; // Collects { name, details } for error summary

// ─── Logging + progress helpers ─────────────────────────────────────────────

function log(message) {
  logLines.push(message);
  if (logLines.length > 200) {
    logLines = logLines.slice(-200);
  }
  $w("#statusText").text = logLines.join("\n");
}

function setProgress(value) {
  $w("#progressBar1").value = value;
}

// ─── Page setup ─────────────────────────────────────────────────────────────

$w.onReady(function () {
  $w("#statusText").text = "Ready. Press Sync to start.";
  $w("#progressBar1").value = 0;

  // Hide stop button initially
  try { $w("#stopSyncBtn").hide(); } catch (e) { /* not on page yet */ }

  // ── Full Sync button ────────────────────────────────────────────────────
  $w("#syncButton").onClick(async () => {
    if (isSyncing) return;
    isSyncing = true;
    stopRequested = false;
    errorList = [];
    logLines = [];
    $w("#syncButton").disable();
    try { $w("#singleSyncBtn").disable(); } catch (e) {}
    try { $w("#stopSyncBtn").show(); } catch (e) {}

    $w("#statusText").text = "Starting sync...";

    try {
      $w("#progressBar1").value = 0;
    } catch (e) {}

    try {
      await runFullSync();
    } catch (err) {
      log(`FATAL ERROR: ${err.message}`);
    }

    isSyncing = false;
    stopRequested = false;
    $w("#syncButton").enable();
    try { $w("#singleSyncBtn").enable(); } catch (e) {}
    try { $w("#stopSyncBtn").hide(); } catch (e) {}
  });

  // ── Stop Sync button ───────────────────────────────────────────────────
  try {
    $w("#stopSyncBtn").onClick(() => {
      stopRequested = true;
      log("");
      log("STOP REQUESTED — finishing current item...");
    });
  } catch (e) {
    // #stopSyncBtn not on page — that's fine
  }

  // ── Single Product Sync button ─────────────────────────────────────────
  try {
    $w("#singleSyncBtn").onClick(async () => {
      if (isSyncing) return;

      const inputVal = $w("#productIdInput").value;
      if (!inputVal || inputVal.trim().length === 0) {
        $w("#statusText").text = "Enter a product SKU first.";
        return;
      }

      isSyncing = true;
      logLines = [];
      errorList = [];
      $w("#syncButton").disable();
      $w("#singleSyncBtn").disable();
      setProgress(0);

      try {
        await runSingleSync(inputVal.trim());
      } catch (err) {
        log(`FATAL ERROR: ${err.message}`);
      }

      isSyncing = false;
      $w("#syncButton").enable();
      $w("#singleSyncBtn").enable();
      setProgress(100);
    });
  } catch (e) {
    // #singleSyncBtn or #productIdInput not on page — that's fine
  }
});

// ─── Single Product Sync ─────────────────────────────────────────────────────

async function runSingleSync(sku) {
  log("=== SINGLE PRODUCT SYNC ===");
  log("");

  setProgress(10);

  const result = await syncSingleProductComplete(sku);

  setProgress(90);

  for (const line of result.log) {
    log(line);
  }

  setProgress(100);
}

// ─── Full Sync Flow ──────────────────────────────────────────────────────────

async function runFullSync() {
  const startTime = Date.now();

  log("=== STARTING FULL SYNC ===");
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
    if (stopRequested) { log("Sync stopped by user."); break; }

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
          errorList.push({ name: result.name, details: result.details });
          errors++;
          break;
      }
    } catch (err) {
      log(`${num} ! ERROR: ${err.message}`);
      errorList.push({ name: itemIds[i], details: err.message });
      errors++;
    }

    setProgress(Math.round(((i + 1) / total) * 33));
  }

  log("");
  log(`=== PRODUCTS DONE === Created: ${created}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
  log("");

  if (stopRequested) { logSummary(startTime, created, updated, skipped, errors, 0, 0, 0, 0); return; }

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
    if (stopRequested) { log("Sync stopped by user."); break; }

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

    setProgress(33 + Math.round(((i + 1) / invTotal) * 33));
  }

  log("");
  log(`=== INVENTORY DONE === Synced: ${invSynced}, Errors: ${invErrors}`);
  log("");

  if (stopRequested) { logSummary(startTime, created, updated, skipped, errors, invSynced, invErrors, 0, 0); return; }

  // ── Phase 5: Sync images ──────────────────────────────────────────────────
  log("=== SYNCING IMAGES ===");
  log("");
  log("Building image list from Square...");

  const imageData = await getImageSyncList();
  const imgTotal = imageData.total;
  const imgSkipped = imageData.skippedUnchanged || 0;
  log(`Found ${imgTotal} products needing images${imgSkipped > 0 ? ` (${imgSkipped} unchanged — skipped)` : ""}.`);

  let imgSuccess = 0, imgErrors = 0;

  for (let i = 0; i < imageData.items.length; i++) {
    if (stopRequested) { log("Sync stopped by user."); break; }

    const item = imageData.items[i];
    const num = `(${i + 1}/${imgTotal})`;

    log(`${num} Importing images for: ${item.name}...`);

    try {
      const result = await syncSingleProductImages(
        item.wixProductId,
        item.imageUrls,
        item.name,
        item.mappingId,
        item.squareImageIds
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

    setProgress(66 + Math.round(((i + 1) / imgTotal) * 34));
  }

  log("");
  log(`=== IMAGES DONE === Success: ${imgSuccess}, Errors: ${imgErrors}`);
  log("");

  if (stopRequested) { logSummary(startTime, created, updated, skipped, errors, invSynced, invErrors, imgSuccess, imgErrors, 0); return; }

  // ── Phase 6: Cleanup deleted products ───────────────────────────────────
  log("Checking for products deleted from Square...");
  let deletedCount = 0;

  try {
    const cleanup = await cleanupDeletedProducts();
    deletedCount = cleanup.deleted.length;

    if (deletedCount > 0) {
      for (const d of cleanup.deleted) {
        log(`  - Removed: ${d.name}`);
      }
      log(`Cleaned up ${deletedCount} deleted product(s).`);
    } else {
      log("No deleted products found.");
    }

    if (cleanup.errors.length > 0) {
      for (const e of cleanup.errors) {
        log(`  ! ${e}`);
      }
    }
  } catch (err) {
    log(`! Cleanup error: ${err.message}`);
  }

  log("");

  logSummary(startTime, created, updated, skipped, errors, invSynced, invErrors, imgSuccess, imgErrors, deletedCount);
}

function logSummary(startTime, created, updated, skipped, errors, invSynced, invErrors, imgSuccess, imgErrors, deletedCount = 0) {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  log("========================================");
  log(stopRequested ? "         SYNC STOPPED" : "           SYNC COMPLETE");
  log("========================================");
  log(`Products  — New: ${created}, Updated: ${updated}, Unchanged: ${skipped}, Errors: ${errors}`);
  log(`Inventory — Synced: ${invSynced}, Errors: ${invErrors}`);
  log(`Images    — Imported: ${imgSuccess}, Errors: ${imgErrors}`);
  if (deletedCount > 0) log(`Cleanup   — Deleted: ${deletedCount}`);
  log(`Time      — ${mins}m ${secs}s`);

  // ── Error summary: list every failed product ──────────────────────────
  if (errorList.length > 0) {
    log("");
    log("========================================");
    log("         FAILED PRODUCTS");
    log("========================================");
    for (const e of errorList) {
      log(`  ! ${e.name}: ${e.details}`);
    }
  }

  log("========================================");
  setProgress(100);
}
