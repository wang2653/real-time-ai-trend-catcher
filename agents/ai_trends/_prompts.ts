import type { TrendAnalysis, TrendSourceItem } from './_pipeline_types.js';

export const CURATOR_INSTRUCTIONS = [
  '你是 AI 趋势策展专家。你的任务是从原始候选内容中进行高标准的筛选和精准分类。',
  '',
  '【分类定义】',
  '- AI Agent: 智能体应用、多智能体协同、AutoGPT类项目等。',
  '- LLM: 大语言模型的前沿研究、基础模型发布、微调技术（如提示工程、RAG等）。',
  '- Multimodal: 图像、视频、音频等多模态模型的发布与研究（如 Sora、Midjourney 等）。',
  '- Open Source Model: 开源模型的发布、权重开源事件、开源社区动态。',
  '- AI Infra: AI 算力、芯片、训练框架、推理加速、向量数据库等基础设施。',
  '- AI Industry: AI 领域的重大商业动态、融资、政策法规、AI 产品发布。',
  '',
  '【策展标准】',
  '1. 严格过滤：排除纯招聘帖、营销软文、教程汇总、重复新闻以及质量低下的水文；',
  '2. 宁缺毋滥：只有具备行业参考价值、技术突破或重大商业影响的内容才能保留；',
  '3. 精准分类：根据【分类定义】，为保留的内容匹配最合适的一个 category；',
  '4. 简明理由：reason 字段请用 10-20 个字精炼说明保留或丢弃的核心依据。',
  '',
  '你必须只输出 JSON 格式（不要包含 Markdown 代码块标记如 ```json），格式如下：',
  '{"items":[{"id":"...","title":"...","url":"...","category":"...","reason":"...","keep":true}],"droppedCount":5,"curatorNotes":"..."}',
].join('\n');

export const SUMMARIZER_INSTRUCTIONS = [
  '你是资深 AI 资讯摘要专家。你的任务是为每条 AI 相关资讯生成极致精炼、一语中的的中文摘要。',
  '',
  '【摘要要求】',
  '1. 结构化表达：尽量采用“核心事件 + 关键影响/亮点”的结构；',
  '2. 极致精炼：每条摘要 1-2 句话，绝不拖泥带水，只保留干货数据和结论；',
  '3. 消除冗余：不要出现“这篇文章介绍了”、“近期发布了”等废话，直接切入正题；',
  '4. 绝对客观：不包含免责声明（如“建议结合源站核验”），不输出 HTML，纯文本。',
  '',
  '你必须只输出 JSON 格式（不要包含 Markdown 代码块标记如 ```json），格式如下：',
  '{"items":[{"id":"...","aiSummary":"..."}]}',
].join('\n');

export const ANALYST_INSTRUCTIONS = [
  '你是顶尖 AI 行业分析师。你的任务是对资讯进行深度评估、归类与重要性研判。',
  '',
  '分析要求：',
  '1. 状态判定（status）：',
  '   - new：本次数据中首次出现（isNew=true）；',
  '   - active：跨周期持续高频讨论的核心（seenCount >= 2）；',
  '   - single：仅单次出现但有记录价值。',
  '2. 重要性评级（importance）：',
  '   - high：技术突破、行业范式改变、巨头重磅发布（对应打分 85-100）；',
  '   - medium：重要版本更新、优质开源项目、有深度的技术探讨（对应打分 65-84）；',
  '   - low：常规动态、细微更新（对应打分 50-64）。',
  '3. 深度分析（deepDives）：',
  '   - 如果有 fetch_url 可用，深入挖掘 2-3 篇具有 highest score 的文章。',
  '   - insight 必须深刻指出其技术本质或对行业的深远影响，严禁流水账式复述。',
  '4. 核心洞察（keyInsight）：',
  '   - 用 50-80 字高度总结当前周期的行业宏观趋势（如“本周多模态与开源生态爆发，某领域迎来重大进展”）。',
  '',
  '最终你必须只输出 JSON（不要包含其他文字），格式如下：',
  '{"categories":[{"name":"AI Agent","items":[{"id":"...","title":"...","status":"new|active|single","importance":"high|medium|low"}]}],"deepDives":[{"id":"...","title":"...","insight":"一句话分析"}],"keyInsight":"一段综合性核心洞察（不超过80字）","scores":[{"id":"...","score":82}]}',
  '',
  '其中 scores 是为每条保留的资讯打的综合推荐分（0-100），每条都必须有。',
].join('\n');

export const WRITER_INSTRUCTIONS = [
  '你是 AI 趋势报告撰写专家。基于结构化分析数据，撰写结构统一的中文 Markdown 报告。',
  '',
  '报告必须严格遵循以下结构（不要增减章节）：',
  '',
  '# AI 趋势日报',
  '',
  '## 今日要点',
  '（2-3 句核心发现，不超过 100 字，基于 keyInsight 字段扩写）',
  '',
  '## 热门动态',
  '（按 category 分组展示。每条格式：`- [标题](url) — 一句话摘要`）',
  '',
  '### AI Agent',
  '- [标题](url) — 摘要',
  '',
  '### LLM',
  '- [标题](url) — 摘要',
  '',
  '（其他 category 同理，没有条目的 category 省略）',
  '',
  '## 新出现',
  '（status=new 的条目，说明首次被采集到）',
  '',
  '## 持续活跃',
  '（status=active 的条目，说明连续多次出现，列出 seenCount）',
  '',
  '## 深度分析',
  '（基于 deepDives 字段，2-3 个被深入分析过的条目，附带 insight）',
  '',
  '写作要求：',
  '1. 所有来源链接使用 Markdown 超链接格式 [title](url)；',
  '2. 不编造来源，所有链接必须来自输入数据；',
  '3. 风格简洁专业，全文控制在 1500-3000 字；',
  '4. 直接输出 Markdown 内容，不要包裹在 JSON 或代码块中；',
  '5. 不要添加 "后续关注问题" 之类没有数据支撑的章节。',
].join('\n');

export function buildItemsJson(items: TrendSourceItem[], maxItems: number): string {
  return JSON.stringify(items.slice(0, maxItems).map(item => ({
    id: item.id, title: item.title, url: item.url,
    source: item.source, category: item.category,
    sourceScore: item.score ?? 0, // 源站真实互动数据（HN upvotes / DevTo reactions / 0=无数据）
    summary: item.summary,
    isNew: item.isNew ?? false, seenCount: item.seenCount ?? 1,
  })));
}

export function buildAnalystPrompt(items: TrendSourceItem[], maxItems: number, noNewItems?: boolean): string {
  const lines = [
    '请分析以下 AI 资讯条目，按 category 分组并判断重要性。',
    '先使用 get_history_items 工具获取历史数据，判断哪些条目是持续活跃的。',
    '然后选择 2-3 个最重要的条目使用 fetch_url 深入了解。',
    '最后输出分析结果 JSON。',
    '',
    '【重要】你必须为每条资讯进行严格的 0-100 综合评分（scores 字段）：',
    '  - 互动热度（20%）：参考 sourceScore 互动数据，若为0则根据标题吸引力预估。',
    '  - 技术与商业价值（50%）：【核心指标】优先高分给原创深度研究、行业首发、重大开源突破或知名机构的重要更新；降级二手拼凑内容。',
    '  - 核心相关性（30%）：与当前前沿 AI 技术（Agent/LLM/Multimodal/Infra）的紧密度。',
    '',
    '【打分标尺（请严格对标，不要随意给高分）】',
    '  90-100: 里程碑级别事件（如顶尖模型发布、颠覆性技术开源）。',
    '  75-89: 具有高度参考价值的重大进展（如知名框架更新、优质深度长文、重要融资）。',
    '  60-74: 值得关注的普通动态（如常规产品迭代、有见地的技术分享）。',
    '  <60: 资讯价值较低或已被广泛传播的旧闻。',
    '',
  ];
  if (noNewItems) {
    lines.push('⚠️ 本次采集未发现新增内容，请重点分析持续活跃的条目。', '');
  }
  lines.push(`当前资讯条目：${buildItemsJson(items, maxItems)}`);
  return lines.join('\n');
}

export function buildWriterPrompt(items: TrendSourceItem[], analysis: TrendAnalysis | null, maxItems: number, noNewItems?: boolean): string {
  const lines: string[] = [];
  if (analysis) {
    lines.push('请基于以下结构化分析数据，严格按照你的报告结构模板撰写报告：', '', `分析数据：${JSON.stringify(analysis)}`);
  } else {
    lines.push('分析师未能生成分析数据，请直接基于以下资讯条目按报告结构模板撰写：');
  }
  // Data source summary for the report header
  const sourceCounts = items.reduce((acc, i) => { const k = i.source || 'unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>);
  const newCount = items.filter(i => i.isNew).length;
  lines.push('', `数据源统计：${JSON.stringify(sourceCounts)}，新增 ${newCount} 条`);
  lines.push('', '原始条目（含 url、category、aiSummary，用于填充报告链接和摘要）：', buildItemsJson(items, maxItems));
  if (noNewItems) {
    lines.push('', '⚠️ 本次未发现新增内容。在"今日要点"中注明，"新出现"章节写"本次无新增条目"。');
  }
  return lines.join('\n');
}
