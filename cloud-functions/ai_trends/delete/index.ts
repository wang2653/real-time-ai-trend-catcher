/**
 * POST /ai-trends/delete — Cloud Function
 * Deletes a report by runId.
 */

import { jsonResponse, readJsonBody } from '../../_cf_http_helpers';
import { deleteReport } from '../../_cf_local_storage';

export async function onRequestPost(context: any): Promise<Response> {
  const body = await readJsonBody(context);
  const runId = (body.runId || body.run_id) as string | undefined;
  if (!runId) return jsonResponse({ error: 'runId is required' }, 400);

  const deleted = await deleteReport(runId);
  if (!deleted) return jsonResponse({ error: 'report not found or delete not supported' }, 404);
  return jsonResponse({ success: true, runId });
}
