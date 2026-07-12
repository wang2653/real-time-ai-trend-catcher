/**
 * GET /ai-trends/history — Cloud Function
 * Returns the list of historical reports.
 */

import { jsonResponse } from '../../_cf_http_helpers';
import { getStore, loadHistory } from '../../_cf_store_access';

export async function onRequestGet(context: any): Promise<Response> {
  const store = getStore(context);
  if (store) {
    const history = await loadHistory(store);
    if (history.length) return jsonResponse({ history });
  }
  return jsonResponse({ history: [] });
}
