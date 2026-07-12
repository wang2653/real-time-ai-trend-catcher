/**
 * POST /ai-trends/delete — Cloud Function
 * Deletes a report by runId.
 */

import { jsonResponse, readJsonBody } from '../../_cf_http_helpers';
import { getStore, deleteReport } from '../../_cf_store_access';

export async function onRequestPost(context: any): Promise<Response> {
  const body = await readJsonBody(context);
  const runId = (body.runId || body.run_id) as string | undefined;
  if (!runId) return jsonResponse({ error: 'runId is required' }, 400);

  const store = getStore(context);
  if (!store) return jsonResponse({ error: 'store not available' }, 500);

  const deleted = await deleteReport(store, runId);
  if (!deleted) return jsonResponse({ error: 'report not found or delete not supported' }, 404);
  return jsonResponse({ success: true, runId });
}
