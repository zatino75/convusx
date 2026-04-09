import { useState } from "react";
import type { ReactNode } from "react";
import { copyText } from "../../utils/helpers";
import { t } from "../../i18n";

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function inlineMarkdown(input: string) {
  const linkPlaceholders: string[] = [];
  const withLinks = input.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (_, text, url) => {
    const idx = linkPlaceholders.length;
    linkPlaceholders.push('<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color:#c96442;text-decoration:underline;word-break:break-all;">' + escapeHtml(text) + '</a>');
    return "\x00LINK" + idx + "\x00";
  });
  let result = escapeHtml(withLinks)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*|\w)\*([^*\n]+)\*(?!\*|\w)/g, "<em>$1</em>")
    .replace(/==(.+?)==/g, '<mark style="background:#fff176;padding:0 2px;border-radius:2px;">$1</mark>')
    .replace(/!!(.+?)!!/g, '<span style="color:#ef4444;font-weight:700;">$1</span>')
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.07);padding:1px 5px;border-radius:4px;font-size:0.9em;">$1</code>');
  linkPlaceholders.forEach((link, idx) => {
    result = result.replace("\x00LINK" + idx + "\x00", link);
  });
  return result;
}

function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isDividerCell(cell: string) {
  return /^:?-{3,}:?$/.test(cell.trim());
}

function isTableDivider(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every(isDividerCell);
}

function isPotentialTable(lines: string[], startIndex: number) {
  if (startIndex + 1 >= lines.length) return false;

  const header = lines[startIndex]?.trim() ?? "";
  const divider = lines[startIndex + 1]?.trim() ?? "";

  if (!header.includes("|")) return false;
  if (!divider.includes("|")) return false;
  if (!isTableDivider(divider)) return false;

  const headerCells = splitTableRow(header);
  const dividerCells = splitTableRow(divider);

  return headerCells.length >= 2 && headerCells.length === dividerCells.length;
}

function alignFromDivider(cell: string): "left" | "center" | "right" {
  const trimmed = cell.trim();
  const starts = trimmed.startsWith(":");
  const ends = trimmed.endsWith(":");

  if (starts && ends) return "center";
  if (ends) return "right";
  return "left";
}


const COPY_SVG = <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M5 15V7a2 2 0 0 1 2-2h8" /></svg>;
const CHECK_SVG = <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#10a37f" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>;

// ── 차트 컴포넌트 (SVG 기반, 외부 라이브러리 없음) ──────────────────────────
type ChartData = {
  type: "bar" | "line" | "pie"
  labels: string[]
  values: number[]
  title?: string
  colors?: string[]
}

const DEFAULT_COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899","#84cc16"]

function parseChartData(raw: string): ChartData | null {
  try {
    const lines = raw.trim().split("\n").map(l => l.trim()).filter(Boolean)
    let type: ChartData["type"] = "bar"
    let title = ""
    const labels: string[] = []
    const values: number[] = []

    for (const line of lines) {
      if (line.startsWith("type:")) { type = line.replace("type:", "").trim() as ChartData["type"]; continue }
      if (line.startsWith("title:")) { title = line.replace("title:", "").trim(); continue }
      const m = line.match(/^(.+?)\s*[:|]\s*(-?[\d.]+)$/)
      if (m) { labels.push(m[1].trim()); values.push(parseFloat(m[2])) }
    }
    if (!labels.length || !values.length) return null
    return { type, labels, values, title }
  } catch { return null }
}

function BarChart({ data }: { data: ChartData }) {
  const W = 480, H = 220, PAD = { top: 36, right: 16, bottom: 48, left: 48 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom
  const max = Math.max(...data.values, 0) * 1.15 || 1
  const barW = Math.max(12, Math.min(48, chartW / data.labels.length - 8))
  const step = chartW / data.labels.length

  return (
    <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", maxWidth: W, display: "block" }}>
      {data.title && <text x={W/2} y={20} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--text-main)">{data.title}</text>}
      {[0,0.25,0.5,0.75,1].map((r, i) => {
        const y = PAD.top + chartH * (1 - r)
        const val = Math.round(max * r * 10) / 10
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e5e7eb" strokeWidth={1} />
            <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{val}</text>
          </g>
        )
      })}
      {data.labels.map((label, i) => {
        const barH = (data.values[i] / max) * chartH
        const x = PAD.left + i * step + (step - barW) / 2
        const y = PAD.top + chartH - barH
        const color = DEFAULT_COLORS[i % DEFAULT_COLORS.length]
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill={color} rx={3} opacity={0.85} />
            <text x={x + barW/2} y={y - 4} textAnchor="middle" fontSize={10} fill={color} fontWeight={600}>
              {data.values[i]}
            </text>
            <text x={x + barW/2} y={PAD.top + chartH + 14} textAnchor="middle" fontSize={10} fill="#6b7280">
              {label.length > 8 ? label.slice(0, 7) + "…" : label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function LineChart({ data }: { data: ChartData }) {
  const W = 480, H = 220, PAD = { top: 36, right: 16, bottom: 48, left: 48 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom
  const max = Math.max(...data.values, 0) * 1.15 || 1
  const step = chartW / Math.max(data.labels.length - 1, 1)

  const points = data.values.map((v, i) => ({
    x: PAD.left + i * step,
    y: PAD.top + chartH - (v / max) * chartH
  }))
  const pathD = points.map((p, i) => (i === 0 ? "M" : "L") + p.x + " " + p.y).join(" ")

  return (
    <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", maxWidth: W, display: "block" }}>
      {data.title && <text x={W/2} y={20} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--text-main)">{data.title}</text>}
      {[0,0.25,0.5,0.75,1].map((r, i) => {
        const y = PAD.top + chartH * (1 - r)
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e5e7eb" strokeWidth={1} />
            <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{Math.round(max * r * 10) / 10}</text>
          </g>
        )
      })}
      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4} fill="#3b82f6" />
          <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={10} fill="#3b82f6" fontWeight={600}>{data.values[i]}</text>
          <text x={p.x} y={PAD.top + chartH + 14} textAnchor="middle" fontSize={10} fill="#6b7280">
            {data.labels[i].length > 6 ? data.labels[i].slice(0, 5) + "…" : data.labels[i]}
          </text>
        </g>
      ))}
    </svg>
  )
}

function PieChart({ data }: { data: ChartData }) {
  const W = 320, H = 220, CX = 100, CY = 110, R = 90
  const total = data.values.reduce((a, b) => a + b, 0) || 1
  let angle = -Math.PI / 2
  const slices = data.values.map((v, i) => {
    const sweep = (v / total) * Math.PI * 2
    const start = angle
    angle += sweep
    return { start, sweep, color: DEFAULT_COLORS[i % DEFAULT_COLORS.length], label: data.labels[i], value: v }
  })

  return (
    <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", maxWidth: W, display: "block" }}>
      {data.title && <text x={W/2} y={16} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--text-main)">{data.title}</text>}
      {slices.map((s, i) => {
        const x1 = CX + R * Math.cos(s.start)
        const y1 = CY + R * Math.sin(s.start)
        const x2 = CX + R * Math.cos(s.start + s.sweep)
        const y2 = CY + R * Math.sin(s.start + s.sweep)
        const large = s.sweep > Math.PI ? 1 : 0
        const mx = CX + (R * 0.65) * Math.cos(s.start + s.sweep / 2)
        const my = CY + (R * 0.65) * Math.sin(s.start + s.sweep / 2)
        const pct = Math.round((s.value / total) * 100)
        return (
          <g key={i}>
            <path d={"M " + CX + " " + CY + " L " + x1 + " " + y1 + " A " + R + " " + R + " 0 " + large + " 1 " + x2 + " " + y2 + " Z"}
              fill={s.color} opacity={0.85} />
            {pct > 5 && <text x={mx} y={my} textAnchor="middle" fontSize={10} fill="white" fontWeight={700}>{pct}%</text>}
          </g>
        )
      })}
      <g>{slices.map((s, i) => (
        <g key={i}>
          <rect x={CX + R + 16} y={28 + i * 18} width={10} height={10} fill={s.color} rx={2} />
          <text x={CX + R + 30} y={37 + i * 18} fontSize={11} fill="var(--text-main)">
            {s.label.length > 10 ? s.label.slice(0, 9) + "…" : s.label} ({s.value})
          </text>
        </g>
      ))}</g>
    </svg>
  )
}

function ChartBlock({ raw }: { raw: string }) {
  const data = parseChartData(raw)
  if (!data) return (
    <div style={{ padding: 12, background: "#fef2f2", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>
      {t("message.chartParseError")}
    </div>
  )
  return (
    <div style={{ padding: "12px 16px", background: "var(--surface-1, #fafafa)", borderRadius: 10, border: "1px solid var(--border, #e5e7eb)", margin: "8px 0", overflowX: "auto" }}>
      {data.type === "bar" && <BarChart data={data} />}
      {data.type === "line" && <LineChart data={data} />}
      {data.type === "pie" && <PieChart data={data} />}
    </div>
  )
}

// ── 코드 하이라이팅 (외부 라이브러리 없음) ──────────────────────────────────
function highlightCode(code: string, lang: string): string {
  const escaped = escapeHtml(code)
  const l = (lang || "").toLowerCase()

  if (["js", "javascript", "ts", "typescript", "jsx", "tsx"].includes(l)) {
    return escaped
      .replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|default|from|async|await|new|this|typeof|instanceof|null|undefined|true|false|void|type|interface|extends|implements|enum)\b/g,
        '<span style="color:#9333ea;font-weight:600;">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
        '<span style="color:#16a34a;">$1</span>')
      .replace(/(\/\/.*$)/gm, '<span style="color:#9ca3af;font-style:italic;">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span style="color:#dc2626;">$1</span>')
  }

  if (["py", "python"].includes(l)) {
    return escaped
      .replace(/\b(def|class|import|from|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|pass|break|continue|with|as|try|except|finally|raise|lambda|yield|async|await)\b/g,
        '<span style="color:#9333ea;font-weight:600;">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
        '<span style="color:#16a34a;">$1</span>')
      .replace(/(#.*$)/gm, '<span style="color:#9ca3af;font-style:italic;">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span style="color:#dc2626;">$1</span>')
  }

  if (["css", "scss"].includes(l)) {
    return escaped
      .replace(/([.#][\w-]+)/g, '<span style="color:#0ea5e9;">$1</span>')
      .replace(/(:\w[\w-]*)/g, '<span style="color:#9333ea;">$1</span>')
      .replace(/([\w-]+)(?=\s*:)/g, '<span style="color:#d97706;">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|#[0-9a-fA-F]{3,8}|\d+(?:px|em|rem|%|vh|vw)?)/g,
        '<span style="color:#16a34a;">$1</span>')
  }

  if (["json"].includes(l)) {
    return escaped
      .replace(/"([^"]+)"(?=\s*:)/g, '<span style="color:#0ea5e9;">"$1"</span>')
      .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span style="color:#16a34a;">$1</span>')
      .replace(/:\s*(\d+(?:\.\d+)?)/g, ': <span style="color:#dc2626;">$1</span>')
      .replace(/:\s*(true|false|null)/g, ': <span style="color:#9333ea;">$1</span>')
  }

  return escaped
}
function CopyButton({
  text,
  label = t("button.copy")
}: {
  text: string;
  label?: string;
}) {
  const [tick, setTick] = useState(0);
  const isCopied = tick > 0;

  function handleCopy() {
    navigator.clipboard.writeText(text).catch(() => {});
    setTick(t => t + 1);
    setTimeout(() => setTick(0), 1800);
  }

  return (
    <button
      type="button"
      className="assistant-inline-copy__button"
      onClick={handleCopy}
      title={isCopied ? t("button.copyDone") : label}
      style={{ flex: "0 0 auto" }}
    >
      {isCopied ? CHECK_SVG : COPY_SVG}
    </button>
  );
}

function StickyBlockToolbar({
  title,
  copyTextValue,
  copyLabel
}: {
  title: string;
  copyTextValue: string;
  copyLabel: string;
}) {
  return (
    <div
      className="message-block-toolbar"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        height: 42,
        padding: "0 10px 0 14px",
        margin: 0,
        borderBottom: "1px solid var(--code-border)",
        background: "var(--code-bg, rgba(248, 243, 224, 0.95))"
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--text-sub)",
          fontSize: 12,
          fontWeight: 700,
          textTransform: "lowercase",
          lineHeight: 1
        }}
      >
        {title}
      </span>

      <CopyButton text={copyTextValue} label={copyLabel} />
    </div>
  );
}

function TableBlock({
  rawTable,
  headerCells,
  aligns,
  bodyLines
}: {
  rawTable: string;
  headerCells: string[];
  aligns: Array<"left" | "center" | "right">;
  bodyLines: string[];
}) {
  return (
    <div
      className="md-table-wrap"
      style={{
        position: "relative",
        overflow: "hidden"
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          height: 36,
          padding: "0 10px 0 14px",
          margin: 0,
          borderBottom: "1px solid rgba(210, 195, 140, 0.35)",
          background: "rgba(242, 234, 195, 0.50)"
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(140, 120, 60, 0.7)", textTransform: "lowercase" as const }}>table</span>
        <CopyButton text={rawTable} label={t("button.copyTable")} />
      </div>

      <div
        className="md-table-scroll"
        style={{
          overflowX: "auto",
          overflowY: "visible",
          marginTop: 0,
          paddingTop: 0
        }}
      >
        <table
          className="md-table"
          style={{
            marginTop: 0
          }}
        >
          <thead>
            <tr>
              {headerCells.map((cell, index) => (
                <th
                  key={`th_cell_${index}`}
                  style={{ textAlign: aligns[index] }}
                  dangerouslySetInnerHTML={{ __html: inlineMarkdown(cell) }}
                />
              ))}
            </tr>
          </thead>

          <tbody>
            {bodyLines.map((line, rowIndex) => {
              const rowCells = splitTableRow(line);

              return (
                <tr key={`tr_${rowIndex}`}>
                  {rowCells.map((cell, cellIndex) => (
                    <td
                      key={`td_${rowIndex}_${cellIndex}`}
                      style={{ textAlign: aligns[cellIndex] }}
                      dangerouslySetInnerHTML={{ __html: inlineMarkdown(cell) }}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function downloadCode(code: string, language: string) {
  const extMap: Record<string, string> = {
    javascript: "js", typescript: "ts", jsx: "jsx", tsx: "tsx",
    python: "py", java: "java", go: "go", rust: "rs", c: "c", cpp: "cpp",
    html: "html", css: "css", scss: "scss", json: "json", yaml: "yml",
    sql: "sql", bash: "sh", shell: "sh", markdown: "md", xml: "xml",
    ruby: "rb", php: "php", swift: "swift", kotlin: "kt", dart: "dart"
  };
  const ext = extMap[language.toLowerCase()] ?? (language.toLowerCase() || "txt");
  const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `code.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

function CodeBlock({
  language,
  code,
  onOpen
}: {
  language: string;
  code: string;
  onOpen?: () => void;
}) {
  return (
    <div
      className="code-block"
      style={{
        position: "relative",
        overflow: "hidden"
      }}
    >
      <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "space-between", height: 42, padding: "0 10px 0 14px", borderBottom: "1px solid var(--border, #e5e2d9)", background: "var(--bg-soft, rgba(228, 226, 218, 0.50))" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub, #78716c)", textTransform: "lowercase" }}>{language || "code"}</span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {onOpen ? (
            <button type="button" onClick={onOpen} title="패널에서 열기"
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-sub, #78716c)", border: "1px solid var(--border, #e5e2d9)", borderRadius: 5, padding: "2px 8px", background: "transparent", cursor: "pointer" }}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
              열기
            </button>
          ) : null}
          <button type="button" onClick={() => downloadCode(code, language)} title="파일 다운로드"
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-sub, #78716c)", border: "1px solid var(--border, #e5e2d9)", borderRadius: 5, padding: "2px 8px", background: "transparent", cursor: "pointer" }}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
          </button>
          <CopyButton text={code} label="코드 복사" />
        </div>
      </div>

      <pre
        className="code-block__pre"
        style={{
          overflowX: "auto",
          overflowY: "visible",
          marginTop: 0,
          paddingTop: 0
        }}
      >
        <code
          style={{
            display: "block",
            padding: "12px 14px",
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
            fontSize: 13,
            lineHeight: 1.7
          }}
          dangerouslySetInnerHTML={{ __html: highlightCode(code, language) }}
        />
      </pre>
    </div>
  );
}

export default function renderMessageContent(content: string, options?: { onRelatedQuestion?: (q: string) => void; onOpenArtifact?: (title: string, code: string, language: string) => void }): ReactNode {
  const normalized = content.replace(/\r\n/g, "\n");
  const codeFencePattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let keyIndex = 0;

  function pushTable(lines: string[], startIndex: number) {
    const headerCells = splitTableRow(lines[startIndex]);
    const dividerCells = splitTableRow(lines[startIndex + 1]);
    const aligns = dividerCells.map(alignFromDivider);

    const bodyLines: string[] = [];
    let cursor = startIndex + 2;

    while (cursor < lines.length) {
      const line = lines[cursor].trim();
      if (!line || !line.includes("|")) break;

      const rowCells = splitTableRow(line);
      if (rowCells.length !== headerCells.length) break;

      bodyLines.push(lines[cursor]);
      cursor += 1;
    }

    const rawTable = lines.slice(startIndex, cursor).join("\n");

    nodes.push(
      <TableBlock
        key={`table_${keyIndex++}`}
        rawTable={rawTable}
        headerCells={headerCells}
        aligns={aligns}
        bodyLines={bodyLines}
      />
    );

    return cursor - 1;
  }

  function pushCitationsBlock(block: string) {
    const lines = block.split("\n").filter(l => l.trim())
    nodes.push(
      <div key={`citations_${keyIndex++}`} style={{
        marginTop: 6,
        padding: "6px 10px",
        background: "rgba(0,0,0,0.03)",
        borderRadius: 6,
        borderLeft: "2px solid var(--border, #e5e7eb)"
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-sub, #888)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4, display: "block" }}>출처</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
          {lines.map((line, i) => {
            const m = line.match(/^\[\d+\]\s+\[(.+?)\]\((.+?)\)$/)
            if (!m) return null
            return (
              <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: "var(--text-sub, #888)", textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}
                onMouseOver={e => (e.currentTarget.style.color = "#c96442")}
                onMouseOut={e => (e.currentTarget.style.color = "var(--text-sub, #888)")}
              >
                {m[1]}
              </a>
            )
          })}
        </div>
      </div>
    )
  }

  function pushTextBlock(textBlock: string) {
    // :::citations 블록 감지
    const citationBlockPattern = /:::citations\n([\s\S]*?)\n:::/g
    let lastCitIdx = 0
    let citMatch: RegExpExecArray | null = null
    const citParts: { type: "text" | "citations"; content: string }[] = []

    while ((citMatch = citationBlockPattern.exec(textBlock)) !== null) {
      if (citMatch.index > lastCitIdx) {
        citParts.push({ type: "text", content: textBlock.slice(lastCitIdx, citMatch.index) })
      }
      citParts.push({ type: "citations", content: citMatch[1] })
      lastCitIdx = citMatch.index + citMatch[0].length
    }
    if (lastCitIdx < textBlock.length) {
      citParts.push({ type: "text", content: textBlock.slice(lastCitIdx) })
    }

    if (citParts.some(p => p.type === "citations")) {
      citParts.forEach(part => {
        if (part.type === "citations") {
          pushCitationsBlock(part.content)
        } else if (part.content.trim()) {
          pushTextBlockInner(part.content)
        }
      })
      return
    }

    pushTextBlockInner(textBlock)
  }

  function pushTextBlockInner(textBlock: string) {
    const sections = textBlock
      .split(/\n{2,}/)
      .map((item) => item.trimEnd())
      .filter((item) => item.trim());

    sections.forEach((section) => {
      // 콜아웃 박스 — > [!NOTE], > [!WARNING], > [!TIP], > [!INFO], > [!CAUTION]
      const calloutMatch = section.match(/^>\s*\[!(NOTE|WARNING|TIP|INFO|CAUTION|SUCCESS|ERROR)\]\s*\n?([\s\S]*)/i);
      if (calloutMatch) {
        const calloutType = calloutMatch[1].toUpperCase();
        const calloutBody = calloutMatch[2].replace(/^>\s?/gm, "").trim();
        const calloutStyles: Record<string, { bg: string; border: string; icon: string; color: string }> = {
          NOTE:    { bg: "#eff6ff", border: "#3b82f6", icon: "ℹ️", color: "#1d4ed8" },
          INFO:    { bg: "#eff6ff", border: "#3b82f6", icon: "ℹ️", color: "#1d4ed8" },
          TIP:     { bg: "#f0fdf4", border: "#22c55e", icon: "💡", color: "#15803d" },
          SUCCESS: { bg: "#f0fdf4", border: "#22c55e", icon: "✅", color: "#15803d" },
          WARNING: { bg: "#fffbeb", border: "#f59e0b", icon: "⚠️", color: "#b45309" },
          CAUTION: { bg: "#fff7ed", border: "#f97316", icon: "🔥", color: "#c2410c" },
          ERROR:   { bg: "#fef2f2", border: "#ef4444", icon: "❌", color: "#b91c1c" },
        };
        const cs = calloutStyles[calloutType] ?? calloutStyles.NOTE;
        nodes.push(
          <div key={"callout_" + keyIndex++} style={{
            background: cs.bg, borderLeft: "4px solid " + cs.border,
            borderRadius: "0 8px 8px 0", padding: "10px 14px", margin: "8px 0"
          }}>
            <div style={{ fontWeight: 700, color: cs.color, fontSize: 12, marginBottom: 4 }}>
              {cs.icon} {calloutType}
            </div>
            <div style={{ fontSize: 14, color: "var(--text-main)", lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: inlineMarkdown(calloutBody) }} />
          </div>
        );
        return;
      }

      // 일반 인용구 >
      if (section.split("\n").every(l => l.trim().startsWith(">"))) {
        const quoteBody = section.replace(/^>\s?/gm, "").trim();
        nodes.push(
          <blockquote key={"bq_" + keyIndex++} style={{
            borderLeft: "3px solid var(--border, #e5e7eb)", margin: "6px 0",
            padding: "6px 12px", color: "var(--text-sub)", fontStyle: "italic"
          }} dangerouslySetInnerHTML={{ __html: inlineMarkdown(quoteBody) }} />
        );
        return;
      }

      const lines = section.split("\n");
      const isBullet = lines.every((line) => /^[-*]\s+/.test(line.trim()));
      const isOrdered = lines.every((line) => /^\d+\.\s+/.test(line.trim()));

      if (isBullet) {
        nodes.push(
          <ul key={`ul_${keyIndex++}`} className="md-list">
            {lines.map((line, index) => (
              <li
                key={`li_${keyIndex++}_${index}`}
                dangerouslySetInnerHTML={{ __html: inlineMarkdown(line.replace(/^[-*]\s+/, "")) }}
              />
            ))}
          </ul>
        );
        return;
      }

      if (isOrdered) {
        nodes.push(
          <ol key={`ol_${keyIndex++}`} className="md-list md-list--ordered">
            {lines.map((line, index) => (
              <li
                key={`oli_${keyIndex++}_${index}`}
                dangerouslySetInnerHTML={{ __html: inlineMarkdown(line.replace(/^\d+\.\s+/, "")) }}
              />
            ))}
          </ol>
        );
        return;
      }

      for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index];
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        if (isPotentialTable(lines, index)) {
          index = pushTable(lines, index);
          continue;
        }

        if (/^####\s+/.test(trimmed)) {
          nodes.push(
            <h4
              key={"h4_" + keyIndex++}
              style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", margin: "10px 0 4px", lineHeight: 1.4 }}
              dangerouslySetInnerHTML={{ __html: inlineMarkdown(trimmed.replace(/^####\s+/, "")) }}
            />
          );
          continue;
        }

        if (/^###\s+/.test(trimmed)) {
          nodes.push(
            <h3
              key={"h3_" + keyIndex++}
              className="md-h3"
              dangerouslySetInnerHTML={{ __html: inlineMarkdown(trimmed.replace(/^###\s+/, "")) }}
            />
          );
          continue;
        }

        if (/^##\s+/.test(trimmed)) {
          nodes.push(
            <h2
              key={`h2_${keyIndex++}`}
              className="md-h2"
              dangerouslySetInnerHTML={{ __html: inlineMarkdown(trimmed.replace(/^##\s+/, "")) }}
            />
          );
          continue;
        }

        if (/^#\s+/.test(trimmed)) {
          nodes.push(
            <h1
              key={`h1_${keyIndex++}`}
              className="md-h1"
              dangerouslySetInnerHTML={{ __html: inlineMarkdown(trimmed.replace(/^#\s+/, "")) }}
            />
          );
          continue;
        }

        nodes.push(
          <p
            key={`p_${keyIndex++}`}
            className="md-p"
            dangerouslySetInnerHTML={{ __html: inlineMarkdown(trimmed) }}
          />
        );
      }
    });
  }

  while ((match = codeFencePattern.exec(normalized)) !== null) {
    const before = normalized.slice(lastIndex, match.index);
    if (before.trim()) {
      pushTextBlock(before);
    }

    const language = (match[1] ?? "").trim();
    const code = match[2] ?? "";

    if (language === "chart") {
      nodes.push(<ChartBlock key={"chart_" + keyIndex++} raw={code} />);
    } else {
      nodes.push(
        <CodeBlock
          key={"code_" + keyIndex++}
          language={language}
          code={code}
          onOpen={options?.onOpenArtifact ? () => options!.onOpenArtifact!(language ? language + " 코드" : "코드", code, language) : undefined}
        />
      );
    }

    lastIndex = match.index + match[0].length;
  }

  const after = normalized.slice(lastIndex);
  if (after.trim()) {
    pushTextBlock(after);
  }

  if (!nodes.length) {
    return <p className="md-p">{content}</p>;
  }

  return <div className="message-rich">{nodes}</div>;
}
