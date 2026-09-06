import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { filterAiItems, inferCategory } from '../_data_sources.js';
import { generateFallbackReport } from '../_report_helpers.js';
import { loadHistory, loadLatestReport, loadReport, saveReport } from '../_fallback_storage.js';
import { loadHistoryFromMemory, loadLatestReportFromMemory, loadReportFromMemory, saveReportToMemory } from '../_memory_store.js';
import type { TrendReport, TrendSourceItem } from '../_pipeline_types.js';

class FakeMemory {
  messages: Array<{ content: string; metadata: Record<string, unknown>; createdAt: number }> = [];

  async appendMessage(input: { content: string; metadata?: Record<string, unknown> }) {
    this.messages.push({
      content: input.content,
      metadata: input.metadata || {},
      createdAt: this.messages.length + 1,
    });
    return `msg_${this.messages.length}`;
  }

  async getMessages(input: { limit?: number; order?: 'asc' | 'desc' }) {
    const items = [...this.messages];
    if (input.order === 'desc') items.reverse();
    return items.slice(0, input.limit || 20);
  }
}

async function runTest(name: string, fn: () => void | Promise<void>) {
  console.log(`\n⏳ Running: ${name}`);
  const start = performance.now();
  await fn();
  const end = performance.now();
  console.log(`✅ Passed: (${(end - start).toFixed(2)}ms)`);
}

async function run() {
  await runTest('Validating OpenAI client configuration parameters', async () => {
    const { buildOpenAIClientOptions } = await import('../_agent_pipeline.js');
    const clientOptions = buildOpenAIClientOptions({
      AI_GATEWAY_API_KEY: 'test-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.example.com/v1',
    });
    assert.equal(clientOptions.apiKey, 'test-key');
    assert.equal(clientOptions.baseURL, 'https://gateway.example.com/v1');
  });

  await runTest('Filtering AI-related articles and rejecting substring false positives', () => {
    const candidates: TrendSourceItem[] = [
      // Valid AI articles
      { id: 'ai_1', title: 'OpenAI launches new AI agents SDK', url: 'https://example.com/ai' },
      { id: 'ai_2', title: 'Building a RAG pipeline with MCP server', url: 'https://example.com/rag' },
      { id: 'ai_3', title: 'State of modern LLMs in 2026', url: 'https://example.com/llm' },
      { id: 'ai_4', title: '全新大模型智能体落地实践', url: 'https://example.com/cn-agent' },
      { id: 'ai_5', title: '体验最新的AI应用与工具', url: 'https://example.com/cn-ai-app' },
      { id: 'ai_6', title: 'Why Cursor is an AI-powered editor', url: 'https://cursor.com/editor' },

      // False-positive noise words containing "ai" substring
      { id: 'noise_email', title: 'How to configure your email server', url: 'https://example.com/email' },
      { id: 'noise_domain', title: 'Choosing the best domain name for your business', url: 'https://example.com/domain' },
      { id: 'noise_chain', title: 'Supply chain management strategies in manufacturing', url: 'https://example.com/chain' },
      { id: 'noise_maintain', title: 'How to maintain your open-source projects', url: 'https://example.com/maintain' },
      { id: 'noise_wait', title: 'Why you should never wait to refactor technical debt', url: 'https://example.com/wait' },
      { id: 'noise_claim', title: 'Insurance claim processing automation guide', url: 'https://example.com/claim' },
      { id: 'noise_straight', title: 'Getting straight to the point in tech presentations', url: 'https://example.com/straight' },
      { id: 'noise_bread', title: 'Best sourdough bread recipes', url: 'https://example.com/bread' },
      { id: 'noise_container', title: 'Container networking deep dive with Linux namespaces', url: 'https://example.com/container' },
    ];

    const filtered = filterAiItems(candidates);
    const matchedIds = filtered.map((item: TrendSourceItem) => item.id);

    // Only AI articles should pass
    assert.deepEqual(matchedIds, ['ai_1', 'ai_2', 'ai_3', 'ai_4', 'ai_5', 'ai_6']);
  });

  await runTest('Preventing false category inference on substring matches', () => {
    // 'dragon' contains 'rag', but must not be classified as 'AI Infra'
    const nonInfraItem: TrendSourceItem = {
      id: 'dragon_1',
      title: 'Dragon warrior quest updates',
      url: 'https://example.com/dragon',
    };
    assert.equal(inferCategory(nonInfraItem), 'AI Industry');

    // Genuine RAG should be classified as 'AI Infra'
    const ragItem: TrendSourceItem = {
      id: 'rag_1',
      title: 'High throughput RAG retrieval architectures',
      url: 'https://example.com/rag',
    };
    assert.equal(inferCategory(ragItem), 'AI Infra');

    // Genuine MCP / Agent item
    const agentItem: TrendSourceItem = {
      id: 'agent_1',
      title: 'LangGraph multi-agent orchestration with MCP tools',
      url: 'https://example.com/agent',
    };
    assert.equal(inferCategory(agentItem), 'AI Agent');
  });

  await runTest('Sanitizing HTML text and generating fallback summaries', async () => {
    const rawHtml = '<a href="https:&#x2F;&#x2F;github.com&#x2F;TanStack&#x2F;router&#x2F;issues&#x2F;7383" rel="nofollow">https:&#x2F;&#x2F;github.com&#x2F;TanStack&#x2F;router&#x2F;issues&#x2F;7383</a>';
    const { cleanText, buildFallbackAiSummary } = await import('../_data_sources.js');
    const cleaned = cleanText(rawHtml);
    const fallbackSummary = buildFallbackAiSummary({
      id: 'html_1',
      title: 'TanStack Router issue discussion',
      url: 'https://example.com',
      summary: rawHtml,
      category: 'AI Infra',
    });
    assert.ok(!cleaned.includes('<a'));
    assert.ok(!cleaned.includes('&#x2F;'));
    assert.ok(!fallbackSummary.includes('<a'));
    assert.ok(!fallbackSummary.includes('建议结合源站内容继续核验'));
  });

  let report: any;
  await runTest('Generating a structured fallback trend report', () => {
    report = generateFallbackReport([
      {
        id: 'hn_1',
        source: 'Hacker News',
        title: 'LangGraph adds better agent orchestration',
        url: 'https://example.com/langgraph',
        category: 'AI Agent',
        score: 123,
      },
    ], 'run_test');
    assert.equal(report.runId, 'run_test');
    assert.equal(report.status, 'success');
    assert.match(report.reportMarkdown, /AI Agent/);
    assert.match(report.reportMarkdown, /https:\/\/example\.com\/langgraph/);
    assert.equal(report.trends.length, 1);
  });

  await runTest('Persisting and retrieving reports from memory storage', async () => {
    const fakeContext = { store: new FakeMemory() };
    await saveReportToMemory(fakeContext, report);
    const memoryLatest = await loadLatestReportFromMemory(fakeContext);
    const memoryHistory = await loadHistoryFromMemory(fakeContext);
    const memoryDetail = await loadReportFromMemory(fakeContext, 'run_test');
    assert.equal(memoryLatest?.runId, 'run_test');
    assert.equal(memoryLatest?.storage, 'memory');
    assert.equal(memoryHistory[0]?.runId, 'run_test');
    assert.equal(memoryHistory[0]?.storage, 'memory');
    assert.equal((memoryDetail as TrendReport | null)?.reportMarkdown, report.reportMarkdown);
    assert.equal((memoryDetail as TrendReport | null)?.storage, 'memory');
  });

  await runTest('Merging new trending items with historical data', async () => {
    const { mergeItemLibrary } = await import('../_item_library.js');
    const mergeResult = mergeItemLibrary([
      {
        id: 'old_1',
        title: 'OpenAI agents launch',
        url: 'https://example.com/post?utm_source=x',
        score: 3,
        firstSeenAt: '2026-05-07T00:00:00Z',
        lastSeenAt: '2026-05-07T00:00:00Z',
        seenCount: 1,
        fingerprint: 'https://example.com/post',
      },
    ], [
      { id: 'new_same', title: 'OpenAI agents launch', url: 'https://example.com/post/', score: 9 },
      { id: 'new_2', title: 'Claude Platform on AWS', url: 'https://example.com/claude', score: 4 },
      { id: 'bad', title: 'Bad URL', url: 'javascript:alert(1)', score: 1 },
    ], '2026-05-08T00:00:00Z');
    assert.equal(mergeResult.newItemCount, 2);
    assert.equal(mergeResult.reusedItemCount, 1);
    assert.equal(mergeResult.reusedItems[0].seenCount, 2);
    assert.equal(mergeResult.reusedItems[0].score, 9);
    assert.equal(mergeResult.newItems[1].url, '');
    assert.deepEqual(mergeResult.reportItems.slice(0, 2).map(item => item.isNew), [true, true]);
  });

  await runTest('Persisting and retrieving reports from the file system', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-trends-node-'));
    try {
      report.newItemCount = 2;
      report.reusedItemCount = 1;
      report.itemIds = ['hn_1'];
      await saveReport(report, dir);
      assert.equal((await loadLatestReport(dir))?.runId, 'run_test');
      assert.equal((await loadReport('run_test', dir))?.reportMarkdown, report.reportMarkdown);
      assert.equal((await loadHistory(dir))[0]?.runId, 'run_test');
      assert.equal((await loadHistory(dir))[0]?.newItemCount, 2);
      assert.equal((await loadHistory(dir))[0]?.reusedItemCount, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

run()
  .then(() => {
    console.log("✅ All tests passed!");
  })
  .catch(error => {
    console.error("❌:", error);
    process.exit(1);
  });

