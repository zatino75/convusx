import type { CSSProperties, ReactNode } from "react";

type OpsPanelProps = {
  title?: ReactNode;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
};

type OpsKpiCardProps = {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  className?: string;
};

type OpsTabButtonProps = {
  active: boolean;
  label: ReactNode;
  onClick: () => void;
};

type OpsMiniStatProps = {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
};

type OpsMeterRowProps = {
  label: ReactNode;
  valueText: ReactNode;
  ratio: number;
  color?: string;
  className?: string;
};

export function OpsPanel({ title, right, className = "", children }: OpsPanelProps) {
  return (
    <section className={`ops-panel ${className}`.trim()}>
      {title || right ? (
        <header className="ops-panel__head">
          {title ? <strong className="ops-panel__title">{title}</strong> : <span />}
          {right ? <span className="ops-panel__right">{right}</span> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function OpsKpiCard({ label, value, sub, accent, className = "" }: OpsKpiCardProps) {
  const style = accent ? ({ "--accent": accent } as CSSProperties) : undefined;
  return (
    <article className={`ops-kpi-card ${className}`.trim()} style={style}>
      <span className="ops-kpi-card__label">{label}</span>
      <strong className="ops-kpi-card__value">{value}</strong>
      {sub ? <b className="ops-kpi-card__sub">{sub}</b> : null}
    </article>
  );
}

export function OpsTabButton({ active, label, onClick }: OpsTabButtonProps) {
  return (
    <button
      type="button"
      className={`ops-tab-btn${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function OpsMiniStat({ label, value, sub, className = "" }: OpsMiniStatProps) {
  return (
    <article className={`ops-mini-stat ${className}`.trim()}>
      <span className="ops-mini-stat__label">{label}</span>
      <strong className="ops-mini-stat__value">{value}</strong>
      {sub ? <b className="ops-mini-stat__sub">{sub}</b> : null}
    </article>
  );
}

export function OpsMeterRow({ label, valueText, ratio, color, className = "" }: OpsMeterRowProps) {
  const normalized = Number.isFinite(ratio) ? Math.max(0, Math.min(100, ratio)) : 0;
  const style = color ? ({ "--meter-color": color } as CSSProperties) : undefined;

  return (
    <div className={`ops-meter-row ${className}`.trim()} style={style}>
      <div className="ops-meter-row__head">
        <span>{label}</span>
        <strong>{valueText}</strong>
      </div>
      <div className="ops-meter-row__bar">
        <i style={{ width: `${normalized}%` }} />
      </div>
    </div>
  );
}
