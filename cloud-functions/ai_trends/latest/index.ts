/**
 * GET /ai-trends/latest — Cloud Function
 * Returns the latest generated report.
 */

import { jsonResponse } from '../../_cf_http_helpers';
import { loadLatestReport } from '../../_cf_local_storage';

export async function onRequestGet(context: any): Promise<Response> {
  const report = await loadLatestReport();
  if (report) return jsonResponse(report);
  return jsonResponse({
    status: 'empty',
    summary: '还没有生成过 AI 趋势报告。',
    reportMarkdown: '# AI 趋势日报\n\n还没有生成过报告，点击"手动生成"开始。',
    trends: [],
    items: [],
  });
}
