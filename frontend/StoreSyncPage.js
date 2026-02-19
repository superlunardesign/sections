/**
 * Store Sync Page — Frontend Code
 *
 * Paste this into your Wix Studio page code for the Store Sync admin page.
 *
 * Required page elements:
 *   #syncButton      — Button to start the full sync
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
  syncSingleProductComplete
} from "backend/square-sync";

let logLines = [];
let isSyncing = false;

/** Safely get a page element — returns null if it doesn't exist. */
function safeEl(selector) {
  try {
    const el = $w(selector);
    if (el.type) return el;
  } catch (e) { /* element not on page */ }
  return null;
}

$w.onReady(function () {
  const statusText = safeEl("#statusText");
  const progressBar = safeEl("#progressBar1");
  const syncBtn = safeEl("#syncButton");
  const singleBtn = safeEl("#singleSyncBtn");
  const skuInput = safeEl("#productIdInput");

  if (statusText) statusText.text = "Ready. Press Sync to start.";
  if (progressBar) progressBar.value = 0;

  function disableAll() {
    if (syncBtn) syncBtn.disable();
    if (singleBtn) singleBtn.disable();
  }

  function enableAll() {
    if (syncBtn) syncBtn.enable();
    if (singleBtn) singleBtn.enable();
  }

  // ── Full Sync button ────────────────────────────────────────────────────
  if (syncBtn) {
    syncBtn.onClick(async () => {
      if (isSyncing) return;
      isSyncing = true;
      logLines = [];
      disableAll();
      setProgress(0);

      try {
        await runFullSync();
      } catch (err) {
        log(`FATAL ERROR: ${err.message}`);
      }

      isSyncing = false;
      enableAll();
    });
  }

  // ── Single Product Sync button ──────────────────────────────────────────
  if (singleBtn && skuInput) {
    singleBtn.onClick(async () => {
      if (isSyncing) return;

      const inputVal = skuInput.value;
      if (!inputVal || inputVal.trim().length === 0) {
        if (statusText) statusText.text = "Enter a product SKU first.";
        return;
      }

      isSyncing = true;
      logLines = [];
      disableAll();
      setProgress(0);

      try {
        await runSingleSync(inputVal.trim());
      } catch (err) {
        log(`FATAL ERROR: ${err.message}`);
      }

      isSyncing = false;
      enableAll();
      setProgress(100);
    });
  }
});

// ─── Logging helper ──────────────────────────────────────────────────────────

function log(message) {
  logLines.push(message);
  if (logLines.length > 200) {
    logLines = logLines.slice(-200);
  }
  try {
    $w("#statusText").text = logLines.join("\n");
  } catch (e) {
    console.log("log:", message);
  }
}

function setProgress(value) {
  try { $w("#progressBar1").value = value; } catch (e) { /* element missing */ }
}

// ─── Single Product Sync ─────────────────────────────────────────────────────

async function runSingleSync(sku) {
  log("=== SINGLE PRODUCT SYNC ===");
  log("");

  setProgress(10);

  const result = await syncSingleProductComplete(sku);

  setProgress(90);

  // Display all log lines from the backend
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

    setProgress(Math.round(((i + 1) / total) * 33));
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

    setProgress(33 + Math.round(((i + 1) / invTotal) * 33));
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
  const imgSkipped = imageData.skippedUnchanged || 0;
  log(`Found ${imgTotal} products needing images${imgSkipped > 0 ? ` (${imgSkipped} unchanged — skipped)` : ""}.`);

  let imgSuccess = 0, imgErrors = 0;

  for (let i = 0; i < imageData.items.length; i++) {
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

  setProgress(100);
}
