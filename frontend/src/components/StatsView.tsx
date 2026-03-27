import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTheme, colors } from '../lib/theme';
import { fetchDashboardRecordStats, fetchPublicRecordStats } from '../lib/api';
import type { RecordStatsResponse } from '../lib/api';

interface StatsViewProps {
  isAuthor: boolean;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const DAY_LABEL_WIDTH = 24;
const DAY_LABEL_GAP = 8;
const MIN_GAP = 2;

const getHeatmapColor = (count: number, isDark: boolean): string => {
  if (count === 0) return isDark ? '#2d333b' : '#ebedf0';
  if (count === 1) return isDark ? '#0e4429' : '#b8e6c8';
  if (count <= 3) return isDark ? '#006d32' : '#6dd698';
  return isDark ? '#26a641' : '#31d266';
};

const buildHeatmapGrid = (heatmap: { date: string; count: number }[]) => {
  const countMap = new Map(heatmap.map((d) => [d.date, d.count]));

  const today = new Date();
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() + 1);
  start.setDate(start.getDate() - start.getDay());

  const weeks: { date: string; count: number; dow: number }[][] = [];
  let currentWeek: { date: string; count: number; dow: number }[] = [];
  const cursor = new Date(start);

  while (cursor <= today) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const dow = cursor.getDay();
    currentWeek.push({ date: dateStr, count: countMap.get(dateStr) ?? 0, dow });
    if (dow === 6) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  const monthLabels: { index: number; label: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < weeks.length; i++) {
    for (const cell of weeks[i]) {
      const ym = cell.date.slice(0, 7);
      if (!seen.has(ym) && cell.date.endsWith('-01')) {
        const monthIdx = parseInt(cell.date.slice(5, 7), 10) - 1;
        monthLabels.push({ index: i, label: MONTH_NAMES[monthIdx] });
        seen.add(ym);
      }
    }
  }

  return { weeks, monthLabels };
};

export const StatsView = ({ isAuthor }: StatsViewProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(10);
  const [cellGap, setCellGap] = useState(3);

  const { data, isLoading } = useQuery<RecordStatsResponse>({
    queryKey: isAuthor ? ['dashboard-record-stats'] : ['public-record-stats'],
    queryFn: () => (isAuthor ? fetchDashboardRecordStats() : fetchPublicRecordStats()),
  });

  const weekCount = data ? buildHeatmapGrid(data.heatmap).weeks.length : 53;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const paddingX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const available = el.clientWidth - paddingX - DAY_LABEL_WIDTH - DAY_LABEL_GAP;
      const perCol = available / weekCount;
      const gap = Math.max(MIN_GAP, Math.floor(perCol * 0.2));
      const size = Math.floor(perCol - gap);
      setCellSize(Math.max(4, size));
      setCellGap(gap);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weekCount]);

  if (isLoading || !data) {
    return <div style={{ color: c.textMuted, fontSize: 14, padding: '20px 0' }}>Loading...</div>;
  }

  const { weeks, monthLabels } = buildHeatmapGrid(data.heatmap);
  const gridWidth = weeks.length * (cellSize + cellGap);

  const statItems = [
    { value: data.totalMemos.toLocaleString(), label: '笔记' },
    { value: data.totalWords.toLocaleString(), label: '字数' },
    { value: data.maxDailyMemos.toLocaleString(), label: '单日最多条数' },
    { value: data.maxDailyWords.toLocaleString(), label: '单日最多字数' },
    { value: data.activeDays.toLocaleString(), label: '坚持记录天数' },
  ];

  const storageItems = [
    { value: data.imageCount.toLocaleString(), label: '图片数量' },
    { value: formatBytes(data.totalStorageBytes), label: '存储占用' },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px', color: c.textPrimary }}>记录统计</h2>

      <div style={{ ...styles.statsCard, background: c.cardBg, borderColor: c.border }}>
        <div style={styles.statsGrid}>
          {statItems.map((item) => (
            <div key={item.label}>
              <div style={{ fontSize: 28, fontWeight: 800, color: c.textPrimary }}>{item.value}</div>
              <div style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {isAuthor && (
        <div style={{ ...styles.statsCard, background: c.cardBg, borderColor: c.border }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: c.textPrimary, marginBottom: 12 }}>图片存储</div>
          <div style={styles.statsGrid}>
            {storageItems.map((item) => (
              <div key={item.label}>
                <div style={{ fontSize: 28, fontWeight: 800, color: c.textPrimary }}>{item.value}</div>
                <div style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={containerRef} style={{ ...styles.heatmapCard, background: c.cardBg, borderColor: c.border }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: c.textPrimary, marginBottom: 16 }}>
          最近一年记录 {data.yearMemos} 条笔记
        </div>

        <div style={{ display: 'flex', gap: DAY_LABEL_GAP }}>
          {/* Grid area */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: cellGap }}>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: cellGap }}>
                  {Array.from({ length: 7 }, (_, dow) => {
                    const cell = week.find((item) => item.dow === dow);
                    if (!cell) return <div key={dow} style={{ width: cellSize, height: cellSize }} />;
                    return (
                      <div
                        key={dow}
                        title={`${cell.date}: ${cell.count} 条`}
                        style={{
                          width: cellSize,
                          height: cellSize,
                          borderRadius: 2,
                          background: getHeatmapColor(cell.count, isDark),
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Month labels */}
            <div style={{ position: 'relative', height: 20, marginTop: 6, width: gridWidth }}>
              {monthLabels.map((ml) => (
                <span
                  key={ml.label + ml.index}
                  style={{
                    position: 'absolute',
                    left: ml.index * (cellSize + cellGap),
                    fontSize: 11,
                    color: c.textMuted,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ml.label}
                </span>
              ))}
            </div>
          </div>

          {/* Day labels on right */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: cellGap, width: DAY_LABEL_WIDTH, flexShrink: 0 }}>
            {DAY_LABELS.map((label, i) => (
              <div
                key={label}
                style={{
                  height: cellSize,
                  fontSize: 11,
                  color: c.textMuted,
                  lineHeight: `${cellSize}px`,
                  visibility: i % 2 === 0 ? 'visible' : 'hidden',
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  statsCard: {
    borderRadius: 12,
    border: '1px solid #f0f0f0',
    padding: '20px 24px',
    marginBottom: 16,
    boxSizing: 'border-box',
  },
  statsGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 24,
    justifyContent: 'space-between',
  },
  heatmapCard: {
    borderRadius: 12,
    border: '1px solid #f0f0f0',
    padding: '20px 24px',
    boxSizing: 'border-box',
  },
};
