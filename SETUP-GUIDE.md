# Square <-> Wix Studio Inventory Sync — Setup Guide

This guide walks you through connecting your Square inventory to your Wix Studio site so that:

- Square products appear as Wix Store products
- Inventory stays in sync in both directions
- Purchases on Wix automatically decrement Square stock
- Square POS sales automatically update Wix stock
- A scheduled job keeps everything in sync as a safety net

---

## Architecture Overview

```
┌──────────────┐                          ┌──────────────┐
│   SQUARE     │  ── webhooks ──────────> │   WIX STUDIO │
│   POS &      │                          │   STORE      │
│   INVENTORY  │  <── API calls ────────  │   (Velo)     │
└──────────────┘                          └──────────────┘
       │                                         │
       │  inventory.count.updated webhook        │  wixStores_onOrderPaid event
       │  ───────────────────────────────>       │  ─── calls Square API ──────>
       │                                         │
       └─────── Scheduled sync (every 30 min) ──┘
```

**Data flow:**
1. **Square -> Wix (real-time):** Square sends webhooks when inventory changes. Wix receives them and updates stock.
2. **Wix -> Square (real-time):** When a Wix order is paid, the event handler calls Square's API to decrement stock.
3. **Square -> Wix (scheduled):** Every 30 minutes, a scheduled job reconciles inventory counts. A daily full sync also updates product names/prices.

---

## Step 1: Square Developer Setup

### 1a. Create a Square Application

1. Go to [Square Developer Dashboard](https://developer.squareup.com/apps)
2. Click **"+" (New Application)**
3. Name it (e.g., "Wix Store Sync")
4. Open the application

### 1b. Get Your Credentials

1. In the application dashboard, go to **Credentials**
2. Copy your **Access Token**:
   - Use **Sandbox Access Token** for testing
   - Use **Production Access Token** for your live store
3. Go to **Locations** in your Square Dashboard and note your **Location ID**
   - Or call `GET /v2/locations` to get it programmatically

### 1c. Set Up Webhooks

1. In the Square Developer Dashboard, go to **Webhooks**
2. Click **Add Endpoint**
3. Set the URL to: `https://www.YOUR-SITE.com/_functions/square_webhook`
   - Replace `YOUR-SITE.com` with your actual Wix site domain
4. Subscribe to these events:
   - `inventory.count.updated`
   - `catalog.version.updated`
5. Save the endpoint
6. Copy the **Signature Key** (for webhook verification)

### 1d. Find Your Category IDs (Optional)

If you only want to sync specific categories, you need their Square IDs.

Using a tool like Postman or curl:
```
GET https://connect.squareup.com/v2/catalog/list?types=CATEGORY
Authorization: Bearer YOUR_ACCESS_TOKEN
```

Note down the `id` of each category you want to sync.

---

## Step 2: Wix Studio Setup

### 2a. Enable Wix Stores

Make sure your Wix Studio site has **Wix Stores** installed:
1. In the Wix Studio Editor, go to **Add Apps** (or **App Market**)
2. Search for **Wix Stores** and add it if not already installed
3. Set up your payment methods in **Settings > Payments**

### 2b. Store Secrets in Wix Secrets Manager

1. In the Wix Studio Editor, go to the **Velo sidebar** (code panel)
2. Click **Developer Tools > Secrets Manager** (or find it in Dashboard > Settings)
3. Add these secrets:

| Secret Name                   | Value                                    |
| ----------------------------- | ---------------------------------------- |
| `square_access_token`         | Your Square Access Token                 |
| `square_location_id`          | Your Square Location ID                  |
| `square_webhook_signature_key`| Your Square Webhook Signature Key        |

### 2c. Create the Mapping Database Collection

1. In the Wix Studio Editor, go to **CMS** (or Database)
2. Click **"+ Create Collection"**
3. Name it exactly: `SquareWixMapping`
4. Set permissions to **Admin only** (read & write)
5. Add these fields:

| Field Name          | Field Key           | Type      |
| ------------------- | ------------------- | --------- |
| Square Catalog ID   | `squareCatalogId`   | Text      |
| Square Variation ID | `squareVariationId` | Text      |
| Wix Product ID      | `wixProductId`      | Text      |
| Wix Variant ID      | `wixVariantId`      | Text      |
| Square Category ID  | `squareCategoryId`  | Text      |
| Square Item Name    | `squareItemName`    | Text      |
| Last Synced         | `lastSynced`        | Date/Time |

### 2d. Add the Backend Code Files

In the Wix Studio Editor, expand the **backend** section in the Velo sidebar. Create or copy these files:

```
backend/
├── square-config.js          ← Configuration & secrets
├── square-api.js             ← Square API wrapper
├── square-sync.jsw           ← Sync logic (web module — callable from frontend)
├── http-functions.js         ← Webhook receiver
├── events.js                 ← Wix store event handlers
├── jobs.config               ← Scheduled job definitions
└── square-scheduled-sync.js  ← Scheduled sync functions
```

**To add files in Wix Studio:**
1. Click the **{ }** (Velo) icon in the left sidebar
2. Under **Backend**, right-click and choose **New .js file** (or .jsw)
3. Copy the contents of each file from this repo's `backend/` folder

---

## Step 3: Configure Category Filtering (Optional)

If you only want to sync specific Square categories (not your entire catalog):

1. Open `backend/square-config.js`
2. Find the `SYNC_CATEGORY_IDS` array
3. Add your category IDs:

```js
export const SYNC_CATEGORY_IDS = [
  "YOUR_CATEGORY_ID_1",
  "YOUR_CATEGORY_ID_2"
];
```

Leave the array empty `[]` to sync everything.

---

## Step 4: Run Your First Sync

### Option A: From a Dashboard Page (Recommended)

Create a simple admin page to trigger syncs:

1. In Wix Studio, create a new page (e.g., "Admin Sync Dashboard")
2. Add a **Button** element and a **Text** element
3. In the page code, add:

```js
import { syncSquareToWix, getAllMappings } from "backend/square-sync";

$w.onReady(function () {
  $w("#syncButton").onClick(async () => {
    $w("#statusText").text = "Syncing... please wait.";

    try {
      const results = await syncSquareToWix();
      $w("#statusText").text =
        `Done! Created: ${results.created}, Updated: ${results.updated}, ` +
        `Inventory synced: ${results.inventorySynced}. ` +
        `Errors: ${results.errors.length}`;

      if (results.errors.length > 0) {
        console.error("Sync errors:", results.errors);
      }
    } catch (err) {
      $w("#statusText").text = "Sync failed: " + err.message;
    }
  });
});
```

4. Set the page to **Members Only** or **Password Protected** so only admins can access it

### Option B: From the Browser Console (Quick Test)

In your published site, open the browser developer console and run:
```js
// This won't work directly — use Option A instead
```

---

## Step 5: Verify Everything Works

### Test Square -> Wix (Webhook)

1. Make an inventory change in your Square POS (sell an item or adjust stock)
2. Check your Wix Store — the product inventory should update within seconds
3. Check the `SquareWixMapping` collection — `lastSynced` should be updated

### Test Wix -> Square (Order)

1. Make a test purchase on your Wix site
2. Check your Square Dashboard — the inventory should decrement
3. If using sandbox, use Square's test payment methods

### Test Scheduled Sync

1. The inventory sync runs every 30 minutes automatically
2. The full product sync runs daily at 3 AM
3. Check your site logs (Velo > Logs) for sync results

---

## File Reference

| File | Purpose |
|------|---------|
| `square-config.js` | API URLs, secret retrieval, sync category filter |
| `square-api.js` | All Square API calls (catalog, inventory, orders) |
| `square-sync.jsw` | Core sync logic — callable from frontend as a web module |
| `http-functions.js` | Receives Square webhooks at `/_functions/square_webhook` |
| `events.js` | Wix `onOrderPaid` / `onOrderRefunded` — pushes to Square |
| `jobs.config` | Cron schedule: 30-min inventory sync + daily full sync |
| `square-scheduled-sync.js` | Functions invoked by the scheduled jobs |

---

## Troubleshooting

### Products not syncing
- Check that your `square_access_token` secret is correct
- Check Velo Logs for errors (`Developer Tools > Logs`)
- If using category filtering, verify the category IDs are correct

### Inventory not updating from Square webhooks
- Verify the webhook URL is correct: `https://www.YOUR-SITE.com/_functions/square_webhook`
- Test the endpoint: visit `https://www.YOUR-SITE.com/_functions/square_webhook` in a browser — you should see `{"status":"active",...}`
- Check Square Developer Dashboard > Webhooks for delivery failures

### Inventory not updating after Wix purchase
- Make sure the product has a mapping in the `SquareWixMapping` collection
- Check that `squareVariationId` is populated (not empty)
- Check Velo Logs for errors from `events.js`

### Sync loop / double-counting
- The `events.js` file has an optional `onInventoryItemUpdated` handler that's **commented out by default** to prevent loops
- Only uncomment it if you need bidirectional manual inventory edits (with the 10-second cooldown)

---

## Customization

### Sync images from Square
Square stores images separately. To sync product images:
1. After creating a product, call `getCatalogObject()` with `include_related_objects=true`
2. Extract image URLs from the related objects
3. Call `wixStoresBackend.addProductMedia()` with the URLs

### Sync product variants/options
The current implementation maps each Square item to one Wix product. To sync variants:
1. When creating a Wix product, use `addProductOptions()` and `createProductVariants()`
2. Map each Square variation to a Wix variant in the `SquareWixMapping` collection
3. Update the inventory sync to use variant-specific `incrementInventory` / `decrementInventory`

### Change sync frequency
Edit `backend/jobs.config` and adjust the `cronExpression` values:
- `*/15 * * * *` = every 15 minutes
- `*/30 * * * *` = every 30 minutes (default)
- `0 * * * *` = every hour
- `0 3 * * *` = daily at 3 AM (default for full sync)
