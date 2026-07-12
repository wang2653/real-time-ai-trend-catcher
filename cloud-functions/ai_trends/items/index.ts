/**
 * GET /ai-trends/items — Cloud Function
 * Returns the contents of the local items.json library.
 */

import { jsonResponse } from '../../_cf_http_helpers';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultBaseDir } from '../../_cf_local_storage';

export async function onRequestGet(context: any): Promise<Response> {
  try {
    const base = defaultBaseDir();
    const itemsJson = await readFile(join(base, 'items.json'), 'utf8').catch(() => '[]');
    const items = JSON.parse(itemsJson);
    return jsonResponse(items);
  } catch (error: any) {
    return jsonResponse({ error: error.message }, 500);
  }
}
