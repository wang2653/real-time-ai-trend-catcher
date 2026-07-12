/**
 * GET /ai-trends/history — Cloud Function
 * Returns the list of historical reports.
 */

import { jsonResponse } from '../../_cf_http_helpers';
import { loadHistory } from '../../_cf_local_storage';

export async function onRequestGet(context: any): Promise<Response> {
  const history = await loadHistory();
  if (history.length) return jsonResponse({ history });
  return jsonResponse({ history: [] });
}
