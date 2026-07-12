import fs from 'node:fs/promises';
import path from 'node:path';

// disable TLS validation to bypass self-signed / untrusted SSL certificate errors
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let BASE_URL = process.argv[2] || 'https://real-time-ai-trend-catcher.edgeone.dev';
if (BASE_URL.endsWith('/')) {
  BASE_URL = BASE_URL.slice(0, -1);
}
const DATA_DIR = path.join(process.cwd(), 'data', 'ai_trends');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function run() {
  console.log(`Syncing data from ${BASE_URL} to ${DATA_DIR}...`);
  await ensureDir(DATA_DIR);
  await ensureDir(path.join(DATA_DIR, 'reports'));

  // download latest.json
  try {
    const latest = await fetchJson(`${BASE_URL}/ai_trends/latest`);
    await fs.writeFile(path.join(DATA_DIR, 'latest.json'), JSON.stringify(latest, null, 2));
    console.log('✓ Synced latest.json');
  } catch (err) {
    console.warn('✗ Failed to sync latest.json:', err.message);
  }

  // download history.json
  let historyList = [];
  try {
    const historyData = await fetchJson(`${BASE_URL}/ai_trends/history`);
    historyList = historyData.history || [];
    await fs.writeFile(path.join(DATA_DIR, 'history.json'), JSON.stringify(historyList, null, 2));
    console.log('✓ Synced history.json');
  } catch (err) {
    console.warn('✗ Failed to sync history.json:', err.message);
  }

  // download items.json (original data items)
  try {
    const items = await fetchJson(`${BASE_URL}/ai_trends/items`);
    await fs.writeFile(path.join(DATA_DIR, 'items.json'), JSON.stringify(items, null, 2));
    console.log('✓ Synced items.json');
  } catch (err) {
    console.warn('✗ Failed to sync items.json:', err.message);
  }

  // download individual historical reports
  for (const entry of historyList) {
    if (!entry.runId) continue;
    try {
      const report = await fetchJson(`${BASE_URL}/ai_trends/detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: entry.runId }),
      });
      await fs.writeFile(
        path.join(DATA_DIR, 'reports', `${entry.runId}.json`),
        JSON.stringify(report, null, 2)
      );
      console.log(`✓ Synced report ${entry.runId}.json`);
    } catch (err) {
      console.warn(`✗ Failed to sync report ${entry.runId}:`, err.message);
    }
  }

  console.log('Sync complete!');
}

run().catch(console.error);
