/**
 * Square API Configuration
 *
 * Store your Square Access Token and Location ID in Wix Secrets Manager:
 *   - Secret name: "square_access_token"
 *   - Secret name: "square_location_id"
 *
 * To get these values:
 *   1. Go to https://developer.squareup.com/apps
 *   2. Create or select your application
 *   3. Copy the Access Token (use Sandbox for testing, Production for live)
 *   4. Get your Location ID from the Locations tab or API
 */

import { getSecret } from "wix-secrets-backend";

// Square API base URLs
const SQUARE_BASE_URL = "https://connect.squareup.com/v2";
const SQUARE_SANDBOX_URL = "https://connect.squareupsandbox.com/v2";

// Set to true during development/testing, false for production
const USE_SANDBOX = false;

/**
 * Returns the correct Square API base URL
 */
export function getBaseUrl() {
  return USE_SANDBOX ? SQUARE_SANDBOX_URL : SQUARE_BASE_URL;
}

/**
 * Retrieves the Square Access Token from Wix Secrets Manager
 */
export async function getAccessToken() {
  return getSecret("square_access_token");
}

/**
 * Retrieves the Square Location ID from Wix Secrets Manager
 */
export async function getLocationId() {
  return getSecret("square_location_id");
}

/**
 * (Optional) Retrieves the Square Webhook Signature Key for verifying webhooks.
 * Store as secret name: "square_webhook_signature_key"
 */
export async function getWebhookSignatureKey() {
  return getSecret("square_webhook_signature_key");
}

/**
 * Builds standard headers for Square API requests
 */
export async function getHeaders() {
  const token = await getAccessToken();
  return {
    "Square-Version": "2024-11-20",
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

/**
 * The name of the Wix Data collection used to map Square items to Wix products.
 * You must create this collection manually in Wix (see SETUP-GUIDE.md).
 */
export const MAPPING_COLLECTION = "SquareWixMapping";

/**
 * Square category IDs you want to sync.
 * Leave empty [] to sync ALL items, or specify category IDs to filter.
 *
 * Find your category IDs by calling the Square Catalog API:
 *   GET /v2/catalog/list?types=CATEGORY
 *
 * Example: ["ABCDEF123456", "GHIJKL789012"]
 */
export const SYNC_CATEGORY_IDS = [];
