/**
 * Square API Wrapper
 *
 * Handles all communication with Square's Catalog and Inventory APIs.
 * All functions run server-side only.
 */

import { fetch } from "wix-fetch";
import { getBaseUrl, getHeaders, getLocationId, SYNC_CATEGORY_IDS } from "./square-config";

// ─── CATALOG ────────────────────────────────────────────────────────────────

/**
 * List all catalog items from Square, with optional category filtering.
 * Handles pagination automatically.
 *
 * @returns {Promise<Array>} Array of Square CatalogObject items (type: ITEM)
 */
export async function listSquareCatalogItems() {
  const baseUrl = getBaseUrl();
  const headers = await getHeaders();
  let allItems = [];
  let cursor = null;

  do {
    let url = `${baseUrl}/catalog/list?types=ITEM`;
    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    const response = await fetch(url, { method: "GET", headers });
    const data = await response.json();

    if (data.objects) {
      allItems = allItems.concat(data.objects);
    }

    cursor = data.cursor || null;
  } while (cursor);

  // Filter by category if SYNC_CATEGORY_IDS is set
  if (SYNC_CATEGORY_IDS && SYNC_CATEGORY_IDS.length > 0) {
    allItems = allItems.filter(item => {
      const itemData = item.item_data;
      if (!itemData || !itemData.category_id) return false;
      return SYNC_CATEGORY_IDS.includes(itemData.category_id);
    });
  }

  return allItems;
}

/**
 * List all categories from Square catalog.
 *
 * @returns {Promise<Array>} Array of Square CatalogObject categories
 */
export async function listSquareCategories() {
  const baseUrl = getBaseUrl();
  const headers = await getHeaders();
  let allCategories = [];
  let cursor = null;

  do {
    let url = `${baseUrl}/catalog/list?types=CATEGORY`;
    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    const response = await fetch(url, { method: "GET", headers });
    const data = await response.json();

    if (data.objects) {
      allCategories = allCategories.concat(data.objects);
    }

    cursor = data.cursor || null;
  } while (cursor);

  return allCategories;
}

/**
 * Retrieve a single catalog object by ID.
 *
 * @param {string} objectId - The Square catalog object ID
 * @returns {Promise<Object>} The CatalogObject
 */
export async function getCatalogObject(objectId) {
  const baseUrl = getBaseUrl();
  const headers = await getHeaders();

  const response = await fetch(`${baseUrl}/catalog/object/${objectId}?include_related_objects=true`, {
    method: "GET",
    headers
  });

  return response.json();
}

/**
 * Batch retrieve multiple catalog objects.
 *
 * @param {Array<string>} objectIds - Array of Square catalog object IDs
 * @returns {Promise<Array>} Array of CatalogObjects
 */
export async function batchRetrieveCatalogObjects(objectIds) {
  const baseUrl = getBaseUrl();
  const headers = await getHeaders();

  const response = await fetch(`${baseUrl}/catalog/batch-retrieve`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      object_ids: objectIds,
      include_related_objects: true
    })
  });

  const data = await response.json();
  return data.objects || [];
}

/**
 * Search catalog items by category IDs.
 *
 * @param {Array<string>} categoryIds - Category IDs to filter by
 * @returns {Promise<Array>} Matching catalog items
 */
export async function searchCatalogByCategory(categoryIds) {
  const baseUrl = getBaseUrl();
  const headers = await getHeaders();
  let allItems = [];
  let cursor = null;

  do {
    const body = {
      object_types: ["ITEM"],
      query: {
        exact_query: {
          attribute_name: "category_id",
          attribute_values: categoryIds
        }
      },
      limit: 100
    };

    if (cursor) {
      body.cursor = cursor;
    }

    const response = await fetch(`${baseUrl}/catalog/search`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (data.objects) {
      allItems = allItems.concat(data.objects);
    }

    cursor = data.cursor || null;
  } while (cursor);

  return allItems;
}

// ─── INVENTORY ──────────────────────────────────────────────────────────────

/**
 * Get inventory counts for a list of catalog object IDs (variations).
 *
 * @param {Array<string>} catalogObjectIds - Square variation IDs
 * @returns {Promise<Array>} Array of inventory count objects
 */
export async function getInventoryCounts(catalogObjectIds) {
  const baseUrl = getBaseUrl();
  const headers = await getHeaders();
  const locationId = await getLocationId();
  let allCounts = [];
  let cursor = null;

  do {
    const body = {
      catalog_object_ids: catalogObjectIds,
      location_ids: [locationId],
      states: ["IN_STOCK"]
    };

    if (cursor) {
      body.cursor = cursor;
    }

    const response = await fetch(`${baseUrl}/inventory/counts/batch-retrieve`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (data.counts) {
      allCounts = allCounts.concat(data.counts);
    }

    cursor = data.cursor || null;
  } while (cursor);

  return allCounts;
}

/**
 * Get the inventory count for a single catalog object (variation).
 *
 * @param {string} catalogObjectId - Square variation ID
 * @returns {Promise<number>} The quantity in stock
 */
export async function getInventoryCount(catalogObjectId) {
  const counts = await getInventoryCounts([catalogObjectId]);
  if (counts.length > 0) {
    return parseFloat(counts[0].quantity) || 0;
  }
  return 0;
}

/**
 * Adjust inventory in Square (add or subtract stock).
 *
 * @param {string} catalogObjectId - The Square variation ID
 * @param {number} quantityChange - Positive to add, negative to subtract
 * @param {string} reason - Reason for the adjustment (e.g., "Sold on Wix")
 * @returns {Promise<Object>} The API response
 */
export async function adjustSquareInventory(catalogObjectId, quantityChange, reason = "Wix sync") {
  const baseUrl = getBaseUrl();
  const headers = await getHeaders();
  const locationId = await getLocationId();

  const idempotencyKey = `${catalogObjectId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const occurredAt = new Date().toISOString();

  const body = {
    idempotency_key: idempotencyKey,
    changes: [
      {
        type: "ADJUSTMENT",
        adjustment: {
          catalog_object_id: catalogObjectId,
          location_id: locationId,
          quantity: String(Math.abs(quantityChange)),
          from_state: quantityChange > 0 ? "NONE" : "IN_STOCK",
          to_state: quantityChange > 0 ? "IN_STOCK" : "SOLD",
          occurred_at: occurredAt,
          reference_id: reason
        }
      }
    ]
  };

  const response = await fetch(`${baseUrl}/inventory/changes/batch-create`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  return response.json();
}

// ─── ORDERS ─────────────────────────────────────────────────────────────────

/**
 * Retrieve a Square order by ID (for order sync verification).
 *
 * @param {string} orderId - The Square order ID
 * @returns {Promise<Object>} The order object
 */
export async function getSquareOrder(orderId) {
  const baseUrl = getBaseUrl();
  const headers = await getHeaders();

  const response = await fetch(`${baseUrl}/orders/${orderId}`, {
    method: "GET",
    headers
  });

  return response.json();
}
