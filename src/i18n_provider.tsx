import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Locale = 'zh' | 'en';

const translations = {
  zh: {
    // Header
    eyebrow: 'AI Daily News Monitor',
    title: 'AI 每日新闻汇总',
    subtitle: '自动化聚合全网前沿新闻，依托大模型生成多维度、可溯源的行业趋势研报。',
    scheduleHint: '系统定时任务：每日 09:00 (UTC+8) 执行',
    generate: '立即执行',
    generating: '任务执行中...',
    stop: '终止任务',

    // Stats bar
    lastGenerated: '最后更新时间',
    items: '项情报',
    topics: '个核心议题',
    source: '个数据源',

    // Pipeline
    stageFetch: '数据清洗与采集',
    stageFilter: '特征提取与降噪',
    stageAnalyze: '深度聚类与分析',
    stageWrite: '研报自动化合成',

    // Live phase hints
    phaseIdle: '系统就绪，等待执行指令...',
    phaseFetched: '多源数据接入完成，正在执行特征提取与降噪...',
    phaseCurated: '高价值情报过滤完毕，正在构建结构化摘要...',
    phaseSummarized: '摘要构建完成，正在启动多维度趋势分析...',
    phaseAnalyzed: '数据分析完成，正在进行最终研报排版合成...',
    phaseWriting: '研报正按标准自动化输出中...',
    phaseDone: '研报生成完毕，已自动归档',

    // Feed
    feedLabel: 'Intelligence Stream',
    feedTitle: '情报监控流',
    refresh: '刷新',
    newItems: '新增情报',
    recurring: '长期追踪',
    emptyFeed: '当前数据流为空',
    noNewBanner: '当前监控周期内未发现显著增量动态，以下为系统持续追踪的核心情报',
    sourceLabel: '数据来源',
    score: '重要性评级',

    // Sidebar
    reportsLabel: 'Research Archives',
    reportsTitle: '行业研报归档',
    reportCount: '份存档',
    latest: '最新发布',
    viewReport: '查阅完整研报',
    noSummary: '摘要缺失',
    noHistory: '知识库暂无归档记录',
    noHistoryHint: '研报将自动存储于此',
    deleteReport: '移除当前研报记录',
    confirmDelete: '是否确认永久移除该研报记录？此操作不可逆',

    // Trigger badge
    triggerSchedule: '系统调度',
    triggerManual: '人工触发',

    // Status
    statusEmpty: '待等待执行',
    statusRunning: '任务运行中',
    statusSuccess: '执行成功',
    statusFailed: '执行异常',

    // Time
    noTime: '无时间戳记录',
    unknownTime: '时间戳异常',

    // Mini typing card
    writingReport: '研报排版合成中',
    chars: '字',
    expandClick: '展开',

    // Drawer
    liveWriting: 'Live Synthesis',
    fullReport: 'Comprehensive Report',
    writingTitle: '正在进行研报自动化排版...',
    reportTitle: '行业态势分析研报',

    // Onboarding
    onboardingTitle: '初始化企业级 AI 态势感知监控系统',
    onboardingDesc: '全链路接入全球主流技术信息源，依托底层 Agent 协同架构，执行“数据采集 → 降噪过滤 → 智能摘要 → 深度分析”标准自动化流水线，输出高置信度、可溯源的专业行业研报。',
    onboardingFeature1: '全网采集',
    onboardingFeature2: '智能聚类',
    onboardingFeature3: '长期追踪',
    onboardingCta: '初始化首个任务',
    onboardingGenerating: '环境初始化与任务执行中...',

    // Drawer extras
    liveTag: '实时流式输出',
    drawerLoading: '正在从知识库检索研报...',
    reportItems: '项情报节点',
    reportNew: '项新增数据',
    noMoreHistory: '暂无更多历史数据',
    close: '关闭',

    // Live phase tags
    phaseTagFetched: '数据已采集',
    phaseTagCurated: '数据已清洗',
    phaseTagSummarized: '特征已提取',
    otherCategory: '未分类长尾数据',
    unknownTimeLabel: '时间戳缺失',
    fallbackSummary: '动态',
  },
  en: {
    // Header
    eyebrow: 'Enterprise AI Intelligence',
    title: 'AI Daily News Monitor',
    subtitle: 'Crawl, filter, and aggregate news from AI industry automatically into traceable trend reports.',
    scheduleHint: 'Scheduled Task: Daily at UTC+10',
    generate: 'Execute',
    generating: 'Processing...',
    stop: 'Terminate',

    // Stats bar
    lastGenerated: 'Last Updated',
    items: 'items',
    topics: 'key topics',
    source: 'sources',

    // Pipeline
    stageFetch: 'Data Aggregation',
    stageFilter: 'Curation & Filtering',
    stageAnalyze: 'Deep Analysis',
    stageWrite: 'Report Synthesis',

    // Live phase hints
    phaseIdle: 'System ready, awaiting execution command...',
    phaseFetched: 'Data ingestion complete. Executing noise reduction and extraction...',
    phaseCurated: 'High-value intelligence curated. Constructing structured summaries...',
    phaseSummarized: 'Summarization complete. Initiating multi-dimensional trend analysis...',
    phaseAnalyzed: 'Analysis modeling complete. Synthesizing final research report...',
    phaseWriting: 'Outputting report to standard template. Delivery imminent...',
    phaseDone: 'Report synthesis complete and archived.',

    // Feed
    feedLabel: 'News Feed',
    feedTitle: 'Intelligence Stream',
    refresh: 'Refresh',
    newItems: 'New Items',
    recurring: 'Tracked Targets',
    emptyFeed: 'Data stream is empty',
    noNewBanner: 'No incremental updates detected in current cycle. Below is long-term topics.',
    sourceLabel: 'Source',
    score: 'Relevance Score',

    // Sidebar
    reportsLabel: 'Research Archives',
    reportsTitle: 'Report Repository',
    reportCount: ' archived',
    latest: 'Latest Release',
    viewReport: 'View Full Research',
    noSummary: 'No summary',
    noHistory: 'No archived records',
    noHistoryHint: 'Reports will store here',
    deleteReport: 'Remove Record',
    confirmDelete: 'Confirm irreversible removal?',

    // Trigger badge
    triggerSchedule: 'Scheduled Job',
    triggerManual: 'Manual Trigger',

    // Status
    statusEmpty: 'Pending',
    statusRunning: 'Executing',
    statusSuccess: 'Completed',
    statusFailed: 'Failed',

    // Time
    noTime: 'No Timestamp',
    unknownTime: 'Invalid Timestamp',

    // Mini typing card
    writingReport: 'Synthesizing report',
    chars: 'chars',
    expandClick: 'expand',

    // Drawer
    liveWriting: 'Live Synthesis',
    fullReport: 'Full Report',
    writingTitle: 'Writing report...',
    reportTitle: 'Trend Report',

    // Onboarding
    onboardingTitle: 'Initialize First Report',
    onboardingDesc: 'Connect to global mainstream tech sources. Utilizing an underlying Agent, execute a standard automated pipeline (Aggregation → Filtering → Summarization → Analysis) to deliver high-confidence, traceable reports.',
    onboardingFeature1: 'Multi-source',
    onboardingFeature2: 'Semantic Clustering & Noise Reduction',
    onboardingFeature3: 'Continuous Tracking',
    onboardingCta: 'Initialize first task',
    onboardingGenerating: 'Generating...',

    // Drawer extras
    liveTag: 'Streaming Output',
    drawerLoading: 'Retrieving report...',
    reportItems: 'items',
    reportNew: 'new',
    noMoreHistory: 'End of record',
    close: 'Close',

    // Live phase tags
    phaseTagFetched: 'Fetched',
    phaseTagCurated: 'Curated',
    phaseTagSummarized: 'Summarized',
    otherCategory: 'Uncategorized',
    unknownTimeLabel: 'Missing Timestamp',
    fallbackSummary: 'update',
  },
} as const;

export type TranslationKey = keyof typeof translations['zh'];

const I18nContext = createContext<{
  locale: Locale;
  t: (key: TranslationKey) => string;
  toggleLocale: () => void;
}>({
  locale: 'en',
  t: (key) => translations.en[key] ?? key,
  toggleLocale: () => { },
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ai-trends-locale');
      if (saved === 'en' || saved === 'zh') return saved;
    }
    return 'en';
  });

  const toggleLocale = useCallback(() => {
    setLocale(prev => {
      const next = prev === 'zh' ? 'en' : 'zh';
      localStorage.setItem('ai-trends-locale', next);
      return next;
    });
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    return translations[locale][key] ?? key;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, t, toggleLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
