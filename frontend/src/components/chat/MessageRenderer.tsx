import type { ReactNode } from "react";

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function inlineMarkdown(input: string) {
  return escapeHtml(input)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
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

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
}

function CopyButton({
  text,
  label = "복사"
}: {
  text: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="assistant-inline-copy__button"
      onClick={() => void copyText(text)}
      aria-label={label}
      title={label}
      style={{
        flex: "0 0 auto"
      }}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="9" y="9" width="10" height="10" rx="2" />
        <path d="M5 15V7a2 2 0 0 1 2-2h8" />
      </svg>
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
        background: "#f4f6f8"
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
      <StickyBlockToolbar title="table" copyTextValue={rawTable} copyLabel="표 복사" />

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
      <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "space-between", height: 42, padding: "0 10px 0 14px", borderBottom: "1px solid var(--code-border)", background: "#f4f6f8" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", textTransform: "lowercase" }}>{language || "code"}</span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {onOpen ? (
            <button type="button" onClick={onOpen} title="패널에서 열기"
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-sub)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 8px", background: "transparent", cursor: "pointer" }}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
              열기
            </button>
          ) : null}
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
            padding: "12px 14px"
          }}
        >
          {code}
        </code>
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

  function pushTextBlock(textBlock: string) {
    const sections = textBlock
      .split(/\n{2,}/)
      .map((item) => item.trimEnd())
      .filter((item) => item.trim());

    sections.forEach((section) => {
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

        if (/^###\s+/.test(trimmed)) {
          nodes.push(
            <h3
              key={`h3_${keyIndex++}`}
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

    nodes.push(
      <CodeBlock
        key={`code_${keyIndex++}`}
        language={language}
        code={code}
        onOpen={options?.onOpenArtifact ? () => options!.onOpenArtifact!(language ? `${language} 코드` : "코드", code, language) : undefined}
      />
    );

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
