/**
 * GET /ai-trends/latest — Cloud Function
 * Returns the latest generated report.
 */

import { jsonResponse } from '../../_cf_http_helpers';
import { getStore, loadLatestReport } from '../../_cf_store_access';

export async function onRequestGet(context: any): Promise<Response> {
  const store = getStore(context);
  if (store) {
    const report = await loadLatestReport(store);
    if (report) return jsonResponse(report);
  }
  return jsonResponse({
    status: 'empty',
    summary: 'No incremental updates detected',
    reportMarkdown: 'Data stream is empty',
    trends: [],
    items: [],
  });
}
