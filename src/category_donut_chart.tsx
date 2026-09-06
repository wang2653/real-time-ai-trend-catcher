import { useState, useMemo } from 'react';
import styles from './trends_dashboard.module.css';

export interface CategoryMetric {
  name: string;
  count: number;
  share: number;
  previousCount: number;
  previousShare: number;
  delta: number;
}

export interface CategoryDistributionData {
  totalCurrent: number;
  totalPrevious: number;
  categories: CategoryMetric[];
}

const CATEGORY_COLORS: Record<string, { primary: string; secondary: string; glow: string; bg: string }> = {
  'AI Agent': {
    primary: '#8b5cf6',
    secondary: '#6366f1',
    glow: 'rgba(139, 92, 246, 0.4)',
    bg: 'rgba(139, 92, 246, 0.12)',
  },
  LLM: {
    primary: '#06b6d4',
    secondary: '#0284c7',
    glow: 'rgba(6, 182, 212, 0.4)',
    bg: 'rgba(6, 182, 212, 0.12)',
  },
  Multimodal: {
    primary: '#10b981',
    secondary: '#059669',
    glow: 'rgba(16, 185, 129, 0.4)',
    bg: 'rgba(16, 185, 129, 0.12)',
  },
  Infra: {
    primary: '#f59e0b',
    secondary: '#d97706',
    glow: 'rgba(245, 158, 11, 0.4)',
    bg: 'rgba(245, 158, 11, 0.12)',
  },
  Other: {
    primary: '#64748b',
    secondary: '#475569',
    glow: 'rgba(100, 116, 139, 0.3)',
    bg: 'rgba(100, 116, 139, 0.12)',
  },
};

function getColors(category: string) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS['Other'];
}

function describeArc(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startAngle: number,
  endAngle: number,
): string {
  if (endAngle - startAngle >= 2 * Math.PI - 0.001) {
    const midAngle = startAngle + Math.PI;
    return `${describeArc(cx, cy, rInner, rOuter, startAngle, midAngle)} ${describeArc(cx, cy, rInner, rOuter, midAngle, endAngle)}`;
  }

  const x1 = cx + rOuter * Math.cos(startAngle);
  const y1 = cy + rOuter * Math.sin(startAngle);
  const x2 = cx + rOuter * Math.cos(endAngle);
  const y2 = cy + rOuter * Math.sin(endAngle);

  const x3 = cx + rInner * Math.cos(endAngle);
  const y3 = cy + rInner * Math.sin(endAngle);
  const x4 = cx + rInner * Math.cos(startAngle);
  const y4 = cy + rInner * Math.sin(startAngle);

  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

export default function CategoryDonutChart({ data }: { data: CategoryDistributionData }) {
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);

  const { totalCurrent, totalPrevious, categories } = data;
  const hasHistory = totalPrevious > 0;

  // Compute SVG sectors
  const sectors = useMemo(() => {
    const valid = categories.filter(c => c.count > 0);
    const countTotal = valid.reduce((acc, c) => acc + c.count, 0);
    if (!countTotal) return [];

    let currentAngle = -Math.PI / 2;
    const gap = valid.length > 1 ? 0.03 : 0;

    return valid.map(cat => {
      const fraction = cat.count / countTotal;
      const angleSpan = fraction * 2 * Math.PI;
      const start = currentAngle + (gap / 2);
      const end = currentAngle + angleSpan - (gap / 2);
      currentAngle += angleSpan;

      return {
        category: cat.name,
        start,
        end,
        fraction,
        ...cat,
      };
    });
  }, [categories]);

  const activeCategoryData = categories.find(c => c.name === hoveredCategory);
  const activeColors = hoveredCategory ? getColors(hoveredCategory) : null;

  return (
    <div className={styles.donutCard}>
      <div className={styles.donutHeader}>
        <div>
          <span className={styles.donutEyebrow}>STATISTICAL BREAKDOWN</span>
          <h4 className={styles.donutTitle}>Category Distribution & Share Shift</h4>
        </div>
        <div className={styles.donutBadge}>
          <span>Current: <strong>{totalCurrent}</strong> items</span>
          {hasHistory && <span className={styles.donutPrevBadge}>Prior: {totalPrevious} items</span>}
        </div>
      </div>

      <div className={styles.donutBody}>
        {/* Left: Interactive SVG Donut */}
        <div className={styles.donutChartWrapper}>
          <svg
            viewBox="0 0 240 240"
            className={styles.donutSvg}
            aria-label="Category Distribution Donut Chart"
          >
            <defs>
              {categories.map(c => {
                const colors = getColors(c.name);
                return (
                  <linearGradient key={`grad-${c.name}`} id={`donut-grad-${c.name}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={colors.primary} />
                    <stop offset="100%" stopColor={colors.secondary} />
                  </linearGradient>
                );
              })}
              <filter id="donutGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Background track circle */}
            <circle
              cx="120"
              cy="120"
              r="76"
              fill="none"
              stroke="rgba(148, 163, 184, 0.12)"
              strokeWidth="28"
            />

            {/* Interactive Arcs */}
            {sectors.map(sector => {
              const isHovered = hoveredCategory === sector.category;
              const rInner = isHovered ? 60 : 62;
              const rOuter = isHovered ? 94 : 90;
              const d = describeArc(120, 120, rInner, rOuter, sector.start, sector.end);

              return (
                <path
                  key={sector.category}
                  d={d}
                  fill={`url(#donut-grad-${sector.category})`}
                  filter={isHovered ? 'url(#donutGlow)' : undefined}
                  className={styles.donutSector}
                  onMouseEnter={() => setHoveredCategory(sector.category)}
                  onMouseLeave={() => setHoveredCategory(null)}
                />
              );
            })}

            {/* Donut Center Readout */}
            {hoveredCategory && activeCategoryData && activeColors ? (
              <g className={styles.donutCenterText}>
                <text x="120" y="106" textAnchor="middle" className={styles.centerValue} fill={activeColors.primary}>
                  {activeCategoryData.share.toFixed(1)}%
                </text>
                <text x="120" y="126" textAnchor="middle" className={styles.centerLabel}>
                  {activeCategoryData.name}
                </text>
                <text x="120" y="142" textAnchor="middle" className={styles.centerSub}>
                  {activeCategoryData.count} items · {hasHistory ? `${activeCategoryData.delta >= 0 ? '+' : ''}${activeCategoryData.delta.toFixed(1)}% vs. prior` : 'Initial Period'}
                </text>
              </g>
            ) : (
              <g className={styles.donutCenterText}>
                <text x="120" y="112" textAnchor="middle" className={styles.centerValueDefault}>
                  {totalCurrent}
                </text>
                <text x="120" y="132" textAnchor="middle" className={styles.centerLabel}>
                  Current Items
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* Right: Category Metric Cards Grid */}
        <div className={styles.donutCardsGrid}>
          {categories.map(cat => {
            const colors = getColors(cat.name);
            const isHovered = hoveredCategory === cat.name;

            const isPositive = cat.delta > 0;
            const isNegative = cat.delta < 0;

            return (
              <div
                key={cat.name}
                className={`${styles.categoryStatCard} ${isHovered ? styles.categoryStatCardActive : ''}`}
                onMouseEnter={() => setHoveredCategory(cat.name)}
                onMouseLeave={() => setHoveredCategory(null)}
              >
                <div className={styles.cardHeader}>
                  <div className={styles.cardIndicatorWrap}>
                    <span className={styles.cardIndicatorDot} style={{ background: colors.primary, boxShadow: `0 0 8px ${colors.glow}` }} />
                    <span className={styles.cardCategoryName}>{cat.name}</span>
                  </div>
                  {/* Share Shift Badge */}
                  {hasHistory ? (
                    <span
                      className={`${styles.deltaBadge} ${isPositive ? styles.deltaPositive : isNegative ? styles.deltaNegative : styles.deltaNeutral}`}
                      title={`Prior share: ${cat.previousShare.toFixed(1)}%`}
                    >
                      {isPositive ? `▲ +${cat.delta.toFixed(1)}% vs. prior` : isNegative ? `▼ ${cat.delta.toFixed(1)}% vs. prior` : '0.0% vs. prior'}
                    </span>
                  ) : (
                    <span className={`${styles.deltaBadge} ${styles.deltaNeutral}`}>
                      Initial Period
                    </span>
                  )}
                </div>

                <div className={styles.cardValueRow}>
                  <span className={styles.cardPercentage} style={{ color: colors.primary }}>
                    {cat.share.toFixed(1)}%
                  </span>
                  <span className={styles.cardCount}>
                    {cat.count} items
                  </span>
                </div>

                {/* Explicit Prior Comparison Context */}
                <div className={styles.cardShiftNote}>
                  {hasHistory
                    ? `Prior share: ${cat.previousShare.toFixed(1)}% (${cat.delta >= 0 ? '+' : ''}${cat.delta.toFixed(1)}% shift)`
                    : 'Baseline period recorded'}
                </div>

                {/* Progress bar */}
                <div className={styles.cardProgressTrack}>
                  <div
                    className={styles.cardProgressFill}
                    style={{
                      width: `${Math.min(100, Math.max(0, cat.share))}%`,
                      background: `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
