import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { filterAiItems, inferCategory, collectJiqizhixin, collectSources } from '../_data_sources.js';
import { generateFallbackReport } from '../_report_helpers.js';
import { loadHistory, loadLatestReport, loadReport, saveReport } from '../_fallback_storage.js';
import { loadHistoryFromMemory, loadLatestReportFromMemory, loadReportFromMemory, saveReportToMemory } from '../_memory_store.js';
import type { TrendReport, TrendSourceItem } from '../_pipeline_types.js';
import { calculateCategoryDistribution, injectCategoryDistributionVisualization, normalizeCoreCategory } from '../_category_chart.js';

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

  await runTest('Normalizing categories into AI Agent, LLM, Multimodal, and Infra', () => {
    assert.equal(normalizeCoreCategory('AI Agent'), 'AI Agent');
    assert.equal(normalizeCoreCategory('AutoGPT agent framework'), 'AI Agent');
    assert.equal(normalizeCoreCategory('智能体开发实践'), 'AI Agent');
    assert.equal(normalizeCoreCategory('MCP server tools'), 'AI Agent');

    assert.equal(normalizeCoreCategory('LLM'), 'LLM');
    assert.equal(normalizeCoreCategory('Large Language Model updates'), 'LLM');
    assert.equal(normalizeCoreCategory('大语言模型测评'), 'LLM');

    assert.equal(normalizeCoreCategory('Multimodal'), 'Multimodal');
    assert.equal(normalizeCoreCategory('Vision audio video generator'), 'Multimodal');
    assert.equal(normalizeCoreCategory('多模态落地应用'), 'Multimodal');

    assert.equal(normalizeCoreCategory('AI Infra'), 'Infra');
    assert.equal(normalizeCoreCategory('Infra'), 'Infra');
    assert.equal(normalizeCoreCategory('RAG vector database serving'), 'Infra');
    assert.equal(normalizeCoreCategory('GPU inference latency'), 'Infra');

    assert.equal(normalizeCoreCategory('Open Source Model'), 'Other');
    assert.equal(normalizeCoreCategory('Random news'), 'Other');
    assert.equal(normalizeCoreCategory(undefined), 'Other');
  });

  await runTest('Calculating pure statistical category distribution and cycle-over-cycle share change', () => {
    const currentItems: TrendSourceItem[] = [
      { id: '1', title: 'Agent 1', url: 'https://example.com/1', category: 'AI Agent' },
      { id: '2', title: 'Agent 2', url: 'https://example.com/2', category: 'AI Agent' },
      { id: '3', title: 'Agent 3', url: 'https://example.com/3', category: 'AI Agent' },
      { id: '4', title: 'Agent 4', url: 'https://example.com/4', category: 'AI Agent' }, // 4/10 = 40.0%
      { id: '5', title: 'LLM 1', url: 'https://example.com/5', category: 'LLM' },
      { id: '6', title: 'LLM 2', url: 'https://example.com/6', category: 'LLM' },
      { id: '7', title: 'LLM 3', url: 'https://example.com/7', category: 'LLM' }, // 3/10 = 30.0%
      { id: '8', title: 'Vision 1', url: 'https://example.com/8', category: 'Multimodal' },
      { id: '9', title: 'Vision 2', url: 'https://example.com/9', category: 'Multimodal' }, // 2/10 = 20.0%
      { id: '10', title: 'RAG 1', url: 'https://example.com/10', category: 'AI Infra' }, // 1/10 = 10.0%
    ];

    const historyItems: TrendSourceItem[] = [
      { id: 'h1', title: 'Agent h1', url: 'https://example.com/h1', category: 'AI Agent' },
      { id: 'h2', title: 'Agent h2', url: 'https://example.com/h2', category: 'AI Agent' }, // 2/8 = 25.0%
      { id: 'h3', title: 'LLM h1', url: 'https://example.com/h3', category: 'LLM' },
      { id: 'h4', title: 'LLM h2', url: 'https://example.com/h4', category: 'LLM' },
      { id: 'h5', title: 'LLM h3', url: 'https://example.com/h5', category: 'LLM' },
      { id: 'h6', title: 'LLM h4', url: 'https://example.com/h6', category: 'LLM' }, // 4/8 = 50.0%
      { id: 'h7', title: 'Vision h1', url: 'https://example.com/h7', category: 'Multimodal' }, // 1/8 = 12.5%
      { id: 'h8', title: 'Infra h1', url: 'https://example.com/h8', category: 'AI Infra' }, // 1/8 = 12.5%
    ];

    const stats = calculateCategoryDistribution(currentItems, historyItems);
    assert.equal(stats.totalCurrent, 10);
    assert.equal(stats.totalPrevious, 8);

    const agent = stats.categories.find(c => c.name === 'AI Agent');
    const llm = stats.categories.find(c => c.name === 'LLM');
    const multi = stats.categories.find(c => c.name === 'Multimodal');
    const infra = stats.categories.find(c => c.name === 'Infra');

    assert.equal(agent?.count, 4);
    assert.equal(agent?.share, 40.0);
    assert.equal(agent?.previousShare, 25.0);
    assert.equal(agent?.delta, 15.0); // 40.0 - 25.0 = +15.0%

    assert.equal(llm?.count, 3);
    assert.equal(llm?.share, 30.0);
    assert.equal(llm?.previousShare, 50.0);
    assert.equal(llm?.delta, -20.0); // 30.0 - 50.0 = -20.0%

    assert.equal(multi?.count, 2);
    assert.equal(multi?.share, 20.0);
    assert.equal(multi?.previousShare, 12.5);
    assert.equal(multi?.delta, 7.5); // 20.0 - 12.5 = +7.5%

    assert.equal(infra?.count, 1);
    assert.equal(infra?.share, 10.0);
    assert.equal(infra?.previousShare, 12.5);
    assert.equal(infra?.delta, -2.5); // 10.0 - 12.5 = -2.5%
  });

  await runTest('Injecting Category Distribution strictly between Today\'s Highlights and Trending Dynamics', () => {
    const originalMarkdown = [
      '# AI Trend Daily Report',
      '',
      '## Today\'s Highlights',
      'Agents and Multimodal surged this cycle with multiple breakout tools.',
      '',
      '## Trending Dynamics',
      '',
      '### AI Agent',
      '- [Claude Computer Use](https://example.com/1) — OS Agent breakthroughs',
      '',
      '### LLM',
      '- [DeepSeek V3](https://example.com/2) — Open weights frontier model',
    ].join('\n');

    const currentItems: TrendSourceItem[] = [
      { id: '1', title: 'Agent', url: 'https://example.com/1', category: 'AI Agent' },
      { id: '2', title: 'LLM', url: 'https://example.com/2', category: 'LLM' },
    ];

    const injected = injectCategoryDistributionVisualization(originalMarkdown, currentItems, []);

    // Verify presence of category distribution section
    assert.ok(injected.includes('## Category Distribution'));
    assert.ok(injected.includes('```chart:category-donut'));
    assert.ok(injected.includes('| Category | Items | Current Share | Share Shift vs. Prior Period |'));
    assert.ok(injected.includes('— (Initial Period)'));

    // Verify ordering: Highlights -> Category Distribution -> Trending Dynamics
    const highlightsIndex = injected.indexOf('## Today\'s Highlights');
    const categoryChartIndex = injected.indexOf('## Category Distribution');
    const trendingDynamicsIndex = injected.indexOf('## Trending Dynamics');

    assert.ok(highlightsIndex !== -1, 'Today\'s Highlights must exist');
    assert.ok(categoryChartIndex !== -1, 'Category Distribution must exist');
    assert.ok(trendingDynamicsIndex !== -1, 'Trending Dynamics must exist');

    assert.ok(
      highlightsIndex < categoryChartIndex && categoryChartIndex < trendingDynamicsIndex,
      'Category Distribution must be placed strictly between Today\'s Highlights and Trending Dynamics',
    );

    // Verify pure English section is also injected into Chinese report between 每日综述 and 热点摘要
    const cnMarkdown = [
      '# AI 趋势日报',
      '',
      '## 每日综述',
      '大模型智能体与多模态在生产场景取得重大突破。',
      '',
      '## 热点摘要',
      '',
      '### AI Agent',
      '- [智能体平台](https://example.com/1) — 摘要',
    ].join('\n');

    const cnInjected = injectCategoryDistributionVisualization(cnMarkdown, currentItems, [
      { id: 'h1', title: 'Prior Agent', url: 'https://example.com/h1', category: 'AI Agent' },
      { id: 'h2', title: 'Prior LLM', url: 'https://example.com/h2', category: 'LLM' },
    ]);
    const cnSummaryIndex = cnInjected.indexOf('## 每日综述');
    const cnChartIndex = cnInjected.indexOf('## Category Distribution');
    const cnDynamicsIndex = cnInjected.indexOf('## 热点摘要');

    assert.ok(cnSummaryIndex !== -1);
    assert.ok(cnChartIndex !== -1);
    assert.ok(cnDynamicsIndex !== -1);
    assert.ok(cnSummaryIndex < cnChartIndex && cnChartIndex < cnDynamicsIndex);
    assert.ok(cnInjected.includes('vs. prior (was '));

    // Verify idempotency (repeated call replaces in place, does not duplicate)
    const doubleInjected = injectCategoryDistributionVisualization(injected, currentItems, []);
    const countMatches = (doubleInjected.match(/## Category Distribution/g) || []).length;
    assert.equal(countMatches, 1, 'Should not produce duplicate Category Distribution sections');
  });

  await runTest('Parsing Jiqizhixin (机器之心) Parse.bot API response format', async () => {
    const originalFetch = globalThis.fetch;
    try {
      const mockResponse = {
        status: 'success',
        data: {
          success: true,
          articles: [
            {
              id: 'art-001',
              slug: '2026-06-10-13',
              title: '阿里搞了个免费报志愿Agent，40万AI考生提前把坑踩完了',
              author: '机器之心',
              source: '机器之心',
              content: '编辑｜杨文、泽南 Agent 这个词在高校志愿填报场景落地实践...',
              tagList: ['阿里巴巴', '高考志愿填报 Agent', '千问App'],
              category: 'industry',
              publishedAt: '2026/06/10 21:03',
              coverImageUrl: 'https://image.jiqizhixin.com/uploads/article/cover.jpg',
            },
            {
              id: 'art-002',
              slug: '2026-06-11-01',
              title: 'DeepSeek-V3 全新架构大语言模型技术全景分析',
              author: '机器之心',
              source: '机器之心',
              content: '深度解析 DeepSeek 开源大模型与混合专家架构创新...',
              publishedAt: '2026-06-11T10:00:00.000Z',
            },
          ],
          totalCount: 29942,
        },
      };

      let requestedHeaders: Record<string, string> = {};
      let requestedUrl = '';

      globalThis.fetch = async (input: any, init?: any) => {
        requestedUrl = String(input);
        requestedHeaders = init?.headers || {};
        return {
          ok: true,
          status: 200,
          json: async () => mockResponse,
        } as any;
      };

      const items = await collectJiqizhixin(10, 'test-parse-key');
      assert.equal(items.length, 2);
      assert.equal(requestedHeaders['X-API-Key'], 'test-parse-key');
      assert.ok(requestedUrl.includes('get_article_list'));

      const first = items[0];
      assert.equal(first.id, 'jiqizhixin_2026-06-10-13');
      assert.equal(first.source, '机器之心');
      assert.equal(first.title, '阿里搞了个免费报志愿Agent，40万AI考生提前把坑踩完了');
      assert.equal(first.url, 'https://www.jiqizhixin.com/articles/2026-06-10-13');
      assert.ok(first.publishedAt && first.publishedAt.startsWith('2026-06-10'));
      assert.ok(first.summary && first.summary.includes('Agent 这个词'));

      const second = items[1];
      assert.equal(second.id, 'jiqizhixin_2026-06-11-01');
      assert.equal(second.source, '机器之心');
      assert.equal(second.url, 'https://www.jiqizhixin.com/articles/2026-06-11-01');
      assert.equal(second.publishedAt, '2026-06-11T10:00:00.000Z');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runTest('Graceful handling of missing PARSE_API_KEY and 401 unauthorized errors', async () => {
    // 1. Missing API key returns empty array without throwing
    const itemsNoKey = await collectJiqizhixin(10, '');
    assert.deepEqual(itemsNoKey, []);

    // 2. 401 Unauthorized returns empty array gracefully
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Missing X-API-Key header', status_code: 401 }),
      } as any);

      const items401 = await collectJiqizhixin(10, 'invalid-key');
      assert.deepEqual(items401, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runTest('Accurate category inference for Chinese AI news from Jiqizhixin', () => {
    const testCases: Array<{ title: string; summary: string; expected: string }> = [
      {
        title: '阿里搞了个免费报志愿Agent，40万AI考生提前把坑踩完了',
        summary: '面向志愿填报场景的智能助手实践',
        expected: 'AI Agent',
      },
      {
        title: 'DeepSeek 新一代开源架构技术全景深度评测',
        summary: '在数学与代码基准上的评测结果',
        expected: 'LLM',
      },
      {
        title: '机器之心评测：新一代多模态 video 生成模型实战',
        summary: '视觉与音频统一生成架构深度解析',
        expected: 'Multimodal',
      },
      {
        title: '边缘端低延迟 inference 推理加速引擎新突破',
        summary: '面向大规模高并发系统的系统优化',
        expected: 'AI Infra',
      },
      {
        title: '某跨国AI创业公司获得千万美元种子轮融资',
        summary: '行业发展最新商业动向汇总',
        expected: 'AI Industry',
      },
    ];

    for (const { title, summary, expected } of testCases) {
      const item: TrendSourceItem = {
        id: 'test_zh',
        title,
        url: 'https://www.jiqizhixin.com/articles/test',
        summary,
      };
      assert.equal(inferCategory(item), expected, `Failed inferring category for title: "${title}"`);
    }
  });

  await runTest('Dynamic quota redistribution across 4 data sources when one source is empty', async () => {
    const originalFetch = globalThis.fetch;
    try {
      // Mock HN returning 10 items, DevTo returning 10 items, Jiqizhixin returning 0 items
      globalThis.fetch = async (input: any) => {
        const url = String(input);
        if (url.includes('topstories')) {
          return { ok: true, json: async () => [1, 2, 3, 4, 5] } as any;
        }
        if (url.includes('firebaseio.com/v0/item')) {
          const id = url.match(/item\/(\d+)/)?.[1] || '1';
          return {
            ok: true,
            json: async () => ({
              type: 'story',
              title: `OpenAI LLM breakthrough update ${id}`,
              url: `https://news.ycombinator.com/item?id=${id}`,
              time: 1780000000,
              score: 100,
            }),
          } as any;
        }
        if (url.includes('dev.to/api/articles')) {
          return {
            ok: true,
            json: async () => [
              { id: 'dev1', title: 'Building LLM agents with TypeScript', url: 'https://dev.to/1' },
              { id: 'dev2', title: 'State of modern AI models in 2026', url: 'https://dev.to/2' },
              { id: 'dev3', title: 'How to deploy AI models on edge', url: 'https://dev.to/3' },
              { id: 'dev4', title: 'Evaluating multi-agent collaboration with MCP', url: 'https://dev.to/4' },
              { id: 'dev5', title: 'Fine-tuning open source LLMs', url: 'https://dev.to/5' },
            ],
          } as any;
        }
        if (url.includes('parse.bot')) {
          // Jiqizhixin empty (e.g. key expired or empty response)
          return { ok: true, json: async () => ({ status: 'success', data: { success: true, articles: [] } }) } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      // Request limit = 8 with 4 sources
      const items = await collectSources(['hackernews', 'devto', 'jiqizhixin'], 8, null, { PARSE_API_KEY: 'test' });
      // Total collected should reach 8 through redistribution even with jiqizhixin empty
      assert.equal(items.length, 8);
      const sourcesPresent = new Set(items.map(i => i.source));
      assert.ok(sourcesPresent.has('Hacker News'));
      assert.ok(sourcesPresent.has('Dev.to'));
    } finally {
      globalThis.fetch = originalFetch;
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

