import { useTranslation } from "../../lib/i18n";

export type DatePreset = 'all' | '7d' | '30d' | 'year' | 'custom';

interface FilterPanelProps {
  tierFilter: number | null;
  datePreset: DatePreset;
  dateFrom: string | null;
  dateTo: string | null;
  distinctTiers: number[];
  onTierChange: (v: number | null) => void;
  onDatePresetChange: (preset: DatePreset) => void;
  onDateRangeChange: (from: string | null, to: string | null) => void;
}

export function FilterPanel({
  tierFilter, datePreset, dateFrom, dateTo, distinctTiers,
  onTierChange, onDatePresetChange, onDateRangeChange,
}: FilterPanelProps) {
  const t = useTranslation();

  function handlePreset(preset: DatePreset) {
    onDatePresetChange(preset);
    if (preset === 'all') {
      onDateRangeChange(null, null);
    } else if (preset === 'custom') {
      // user will set dates via inputs
    } else {
      const localISO = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const now = new Date();
      let from: string;
      if (preset === '7d') {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        from = localISO(d);
      } else if (preset === '30d') {
        const d = new Date(now);
        d.setDate(d.getDate() - 30);
        from = localISO(d);
      } else {
        from = `${now.getFullYear()}-01-01`;
      }
      onDateRangeChange(from, null);
    }
  }

  const tierLabel = (cents: number) => cents === 0 ? t.filterPanel.free : `$${cents / 100}`;

  const chipClass = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs border transition-colors cursor-pointer ${
      active
        ? 'bg-primary/20 text-primary border-primary/40'
        : 'bg-background border-border hover:bg-muted/50'
    }`;

  const presetLabels: Record<DatePreset, string> = {
    all: t.filterPanel.presetAll, '7d': t.filterPanel.preset7d, '30d': t.filterPanel.preset30d,
    year: t.filterPanel.presetYear, custom: t.filterPanel.presetCustom,
  };

  return (
    <div className="bg-muted/20 border rounded-md p-3 space-y-3 text-sm">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{t.filterPanel.publishDate}</div>
        <div className="flex flex-wrap gap-1.5">
          {(['all', '7d', '30d', 'year', 'custom'] as DatePreset[]).map(p => (
            <button key={p} onClick={() => handlePreset(p)} className={chipClass(datePreset === p)}>
              {presetLabels[p]}
            </button>
          ))}
        </div>
        {datePreset === 'custom' && (
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1">
              <div className="text-[10px] text-muted-foreground mb-1">{t.filterPanel.from}</div>
              <input
                type="date"
                value={dateFrom ?? ''}
                onChange={e => onDateRangeChange(e.target.value || null, dateTo)}
                className="w-full h-7 text-xs px-2 border rounded bg-background"
              />
            </div>
            <span className="text-muted-foreground mt-4 text-xs">→</span>
            <div className="flex-1">
              <div className="text-[10px] text-muted-foreground mb-1">{t.filterPanel.to}</div>
              <input
                type="date"
                value={dateTo ?? ''}
                onChange={e => onDateRangeChange(dateFrom, e.target.value || null)}
                className="w-full h-7 text-xs px-2 border rounded bg-background"
              />
            </div>
          </div>
        )}
      </div>

      {distinctTiers.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{t.filterPanel.paidTier}</div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => onTierChange(null)} className={chipClass(tierFilter === null)}>
              {t.filterPanel.all}
            </button>
            {distinctTiers.map(cents => (
              <button key={cents} onClick={() => onTierChange(cents)} className={chipClass(tierFilter === cents)}>
                {tierLabel(cents)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
