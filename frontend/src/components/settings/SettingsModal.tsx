import { useEffect, useRef, useState } from "react";

const BASE_URL = "http://localhost:8000";

type ApiKeys = {
  openai: string;
  anthropic: string;
  gemini: string;
  perplexity: string;
  midjourney: string;
  runway: string;
};

const PROVIDER_LABELS: Record<keyof ApiKeys, string> = {
  openai:     "OpenAI",
  anthropic:  "Anthropic (Claude)",
  gemini:     "Google Gemini",
  perplexity: "Perplexity",
  midjourney: "Midjourney",
  runway:     "Runway",
};

const PROVIDER_LINKS: Record<keyof ApiKeys, string> = {
  openai:     "https://platform.openai.com/api-keys",
  anthropic:  "https://console.anthropic.com/settings/keys",
  gemini:     "https://aistudio.google.com/app/apikey",
  perplexity: "https://www.perplexity.ai/settings/api",
  midjourney: "https://www.midjourney.com/account",
  runway:     "https://app.runwayml.com/settings",
};

type Tab = "api" | "interface" | "instruction" | "data";

type Props = {
  open: boolean;
  onClose: () => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  globalInstruction: string;
  onGlobalInstructionChange: (value: string) => void;
};

export default function SettingsModal({ open, onClose, fontSize, onFontSizeChange, globalInstruction, onGlobalInstructionChange }: Props) {
  const [tab, setTab] = useState<Tab>("api");
  const [keys, setKeys] = useState<ApiKeys>({ openai: "", anthropic: "", gemini: "", perplexity: "", midjourney: "", runway: "" });
  const [editKeys, setEditKeys] = useState<ApiKeys>({ openai: "", anthropic: "", gemini: "", perplexity: "", midjourney: "", runway: "" });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [resetting, setResetting] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`${BASE_URL}/api/settings/keys`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.keys) {
          setKeys(data.keys);
          setEditKeys(data.keys);
        }
      })
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  async function handleSaveKeys() {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${BASE_URL}/api/settings/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editKeys),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveMsg("저장됐습니다.");
        setKeys({ ...editKeys });
      } else {
        setSaveMsg("저장 실패: " + (data.error ?? "알 수 없는 오류"));
      }
    } catch {
      setSaveMsg("서버 연결 오류");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  }

  async function handleReset(target: string, label: string) {
    if (!window.confirm(`${label}을 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    setResetting(target);
    setResetMsg("");
    try {
      const res = await fetch(`${BASE_URL}/api/settings/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();
      setResetMsg(data.ok ? `${label} 초기화 완료` : `초기화 실패: ${data.error ?? ""}`);
    } catch {
      setResetMsg("서버 연결 오류");
    } finally {
      setResetting(null);
      setTimeout(() => setResetMsg(""), 4000);
    }
  }

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer",
    fontSize: 13, fontWeight: 600,
    background: tab === t ? "var(--accent)" : "transparent",
    color: tab === t ? "var(--accent-inverse)" : "var(--text-sub)",
    transition: "background 0.15s, color 0.15s",
  });

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)",
    background: "var(--bg-main)", color: "var(--text-main)", fontSize: 13,
    fontFamily: "monospace", outline: "none", boxSizing: "border-box",
  };

  const btnStyle: React.CSSProperties = {
    padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer",
    fontSize: 13, fontWeight: 600, background: "var(--accent)", color: "var(--accent-inverse)",
  };

  const dangerBtnStyle: React.CSSProperties = {
    padding: "7px 16px", borderRadius: 8, border: "1px solid var(--danger-border)",
    cursor: "pointer", fontSize: 13, fontWeight: 600,
    background: "var(--danger-bg)", color: "var(--danger-text)",
  };

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(20,18,10,0.45)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{
        width: 560, maxHeight: "80vh", borderRadius: 16,
        background: "var(--bg-main)", border: "1px solid var(--border)",
        boxShadow: "var(--shadow-soft)", display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 16px", borderBottom: "1px solid var(--border-soft)" }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>설정</span>
          <button type="button" onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", color: "var(--text-sub)" }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* 탭 */}
        <div style={{ display: "flex", gap: 4, padding: "12px 24px", borderBottom: "1px solid var(--border-soft)" }}>
          <button type="button" style={tabStyle("api")} onClick={() => setTab("api")}>API 키</button>
          <button type="button" style={tabStyle("interface")} onClick={() => setTab("interface")}>인터페이스</button>
          <button type="button" style={tabStyle("instruction")} onClick={() => setTab("instruction")}>지침</button>
          <button type="button" style={tabStyle("data")} onClick={() => setTab("data")}>데이터 관리</button>
        </div>

        {/* 본문 */}
        <div style={{ overflowY: "auto", flex: 1, padding: "20px 24px 24px" }}>

          {/* API 키 탭 */}
          {tab === "api" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-sub)", lineHeight: 1.6 }}>
                API 키는 서버의 <code style={{ fontSize: 12, background: "var(--bg-soft)", padding: "1px 5px", borderRadius: 4 }}>server/.env</code> 파일에 저장됩니다. 마스킹된 값은 변경되지 않습니다.
              </p>
              {(Object.keys(PROVIDER_LABELS) as (keyof ApiKeys)[]).map(provider => (
                <div key={provider}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)" }}>{PROVIDER_LABELS[provider]}</label>
                    <a href={PROVIDER_LINKS[provider]} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>키 발급 →</a>
                  </div>
                  <input
                    type="password"
                    style={inputStyle}
                    placeholder={keys[provider] || "입력하지 않으면 기존 값 유지"}
                    value={editKeys[provider]}
                    onChange={e => setEditKeys(prev => ({ ...prev, [provider]: e.target.value }))}
                  />
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                <button type="button" style={btnStyle} onClick={handleSaveKeys} disabled={saving}>
                  {saving ? "저장 중..." : "저장"}
                </button>
                {saveMsg && <span style={{ fontSize: 13, color: saveMsg.includes("실패") || saveMsg.includes("오류") ? "var(--danger-text)" : "var(--accent)" }}>{saveMsg}</span>}
              </div>
            </div>
          )}

          {/* 인터페이스 탭 */}
          {tab === "interface" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)", marginBottom: 12 }}>메시지 폰트 크기</div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ fontSize: 12, color: "var(--text-soft)", width: 24 }}>작게</span>
                  <input
                    type="range" min={13} max={20} step={1}
                    value={fontSize}
                    onChange={e => onFontSizeChange(Number(e.target.value))}
                    style={{ flex: 1, accentColor: "var(--accent)" }}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-soft)", width: 24 }}>크게</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-main)", minWidth: 36, textAlign: "right" }}>{fontSize}px</span>
                </div>
                <div style={{ marginTop: 16, padding: "14px 18px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-soft)" }}>
                  <p style={{ margin: 0, fontSize: fontSize, lineHeight: 1.82, color: "var(--text-main)" }}>
                    안녕하세요. 이것은 폰트 크기 미리보기 텍스트입니다. CORVUS X에서 AI 답변이 이 크기로 표시됩니다.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 지침 탭 */}
          {tab === "instruction" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", marginBottom: 6 }}>전체 지침</div>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-sub)", lineHeight: 1.6 }}>
                  모든 대화에 적용됩니다. AI가 항상 따라야 할 규칙, 말투, 형식 등을 입력하세요.
                </p>
                <textarea
                  style={{ width: "100%", minHeight: 140, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-main)", color: "var(--text-main)", fontSize: 13, lineHeight: 1.7, resize: "vertical", outline: "none", boxSizing: "border-box" as const, fontFamily: "inherit" }}
                  placeholder={"예시:\n- 항상 한국어로 답변하세요.\n- 답변은 간결하게 핵심만 작성하세요.\n- 코드는 반드시 주석을 포함하세요."}
                  value={globalInstruction}
                  onChange={e => onGlobalInstructionChange(e.target.value)}
                />
                <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-soft)" }}>변경사항은 자동 저장됩니다.</p>
              </div>
            </div>
          )}

          {/* 데이터 관리 탭 */}
          {tab === "data" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-sub)", lineHeight: 1.6 }}>
                초기화 작업은 되돌릴 수 없습니다. 신중하게 진행하세요.
              </p>
              {[
                { target: "thread-memory", label: "대화 메모리", desc: "모든 스레드 대화 내용과 요약을 삭제합니다." },
                { target: "project-memory", label: "프로젝트 메모리", desc: "프로젝트별 학습 데이터와 소스 자산을 삭제합니다." },
                { target: "scoreboard", label: "스코어보드", desc: "AI 성능 점수와 사용량 통계를 초기화합니다." },
                { target: "all", label: "전체 초기화", desc: "위 모든 데이터를 한번에 삭제합니다." },
              ].map(({ target, label, desc }) => (
                <div key={target} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "14px 16px", borderRadius: 10, border: "1px solid var(--border)", background: target === "all" ? "var(--danger-bg)" : "transparent" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: target === "all" ? "var(--danger-text)" : "var(--text-main)", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "var(--text-soft)" }}>{desc}</div>
                  </div>
                  <button
                    type="button"
                    style={{ ...dangerBtnStyle, whiteSpace: "nowrap" }}
                    onClick={() => handleReset(target, label)}
                    disabled={resetting !== null}
                  >
                    {resetting === target ? "초기화 중..." : "초기화"}
                  </button>
                </div>
              ))}
              {resetMsg && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: resetMsg.includes("완료") ? "var(--surface-active)" : "var(--danger-bg)", color: resetMsg.includes("완료") ? "var(--accent)" : "var(--danger-text)", fontSize: 13, fontWeight: 600 }}>
                  {resetMsg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
