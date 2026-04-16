import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api/url";
import { t } from "../../i18n";
import { showConfirm } from "../ui/Toast";
import { validateField } from "../../utils/validation";
import type { FieldRule } from "../../utils/validation";
import {
  setDomainProfile as agentSetDomainProfile,
  setRegulationUpdateInterval as agentSetRegulationInterval,
  initAgentSettings,
} from "../../store/agentStore";
import type { DomainProfile } from "../../types/agent";

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

type Tab = "api" | "interface" | "instruction" | "connector" | "data" | "domain";

type Instruction = {
  id: string;
  title: string;
  content: string;
  active: boolean;
  createdAt: string;
};

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

  // Key validation state
  const [keyStatus, setKeyStatus] = useState<Record<string, "idle" | "checking" | "valid" | "invalid">>({});
  // Inline form validation errors
  const [keyErrors, setKeyErrors] = useState<Record<string, string | null>>({});

  /** API 키 인라인 검증 */
  function handleKeyInputValidation(provider: string, value: string) {
    if (!value.trim()) {
      // 빈 값은 기존 키 유지 의미이므로 에러 제거
      setKeyErrors(prev => ({ ...prev, [provider]: null }));
      return;
    }
    const rule: FieldRule = { field: provider, minLength: 10, maxLength: 256 };
    const error = validateField(value, rule);
    setKeyErrors(prev => ({ ...prev, [provider]: error }));
  }

  async function handleValidateKey(provider: string) {
    setKeyStatus(prev => ({ ...prev, [provider]: "checking" }));
    try {
      const res = await apiFetch("/api/settings/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      setKeyStatus(prev => ({ ...prev, [provider]: data.ok && data.valid ? "valid" : "invalid" }));
    } catch {
      setKeyStatus(prev => ({ ...prev, [provider]: "invalid" }));
    }
  }

  function keyStatusIcon(provider: string): string {
    const s = keyStatus[provider];
    if (s === "checking") return "⏳";
    if (s === "valid") return "✅";
    if (s === "invalid") return "❌";
    return "";
  }

  // Interface settings (fonts, line-height)
  const [fontFamily, setFontFamily] = useState(() => {
    try { return localStorage.getItem("corvus-x.font-family") ?? "Pretendard"; } catch { return "Pretendard"; }
  });
  const [codeFont, setCodeFont] = useState(() => {
    try { return localStorage.getItem("corvus-x.code-font") ?? "Fira Code"; } catch { return "Fira Code"; }
  });
  const [lineHeight, setLineHeight] = useState(() => {
    try { return parseFloat(localStorage.getItem("corvus-x.line-height") ?? "1.7"); } catch { return 1.7; }
  });

  // Instructions management
  const [instructions, setInstructions] = useState<Instruction[]>(() => {
    try {
      const stored = localStorage.getItem("corvus-x.instructions");
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [editingInstruction, setEditingInstruction] = useState<Instruction | null>(null);
  const [showInstructionForm, setShowInstructionForm] = useState(false);

  // Active providers
  const [activeProviders, setActiveProviders] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("corvus-x.active-providers");
      return stored ? JSON.parse(stored) : ["openai", "anthropic", "gemini", "perplexity"];
    } catch { return ["openai", "anthropic", "gemini", "perplexity"]; }
  });

  // Connector expand state
  const [connectorExpanded, setConnectorExpanded] = useState(false);

  // Domain profile
  const [domainProfile, setDomainProfile] = useState<string>(() => {
    try { return localStorage.getItem("corvus-x.domain-profile") ?? "general"; } catch { return "general"; }
  });

  // Regulation watcher interval
  const [regulationInterval, setRegulationInterval] = useState<string>(() => {
    try { return localStorage.getItem("corvus-x.regulation-interval") ?? "daily"; } catch { return "daily"; }
  });

  // Regulation watcher status (from server)
  const [regulationStatus, setRegulationStatus] = useState<{
    running: boolean;
    cached_sources: number;
    total_sources: number;
    ok_count: number;
    last_fetch_at: number | null;
    last_change_at: number | null;
  } | null>(null);
  const [regulationRefreshing, setRegulationRefreshing] = useState(false);

  // 최초 오픈 시 agentStore 초기화 (localStorage → agentStore 동기)
  useEffect(() => { if (open) initAgentSettings(); }, [open]);

  function saveDomainProfile(profile: string) {
    setDomainProfile(profile);
    try { localStorage.setItem("corvus-x.domain-profile", profile); } catch {}
    // agentStore 동기화
    agentSetDomainProfile(profile as DomainProfile);
  }

  const INTERVAL_TO_MINUTES: Record<string, number> = {
    daily: 1440,
    weekly: 10080,
    manual: 0,
  };

  function saveRegulationInterval(interval: string) {
    setRegulationInterval(interval);
    try { localStorage.setItem("corvus-x.regulation-interval", interval); } catch {}
    // agentStore 동기화
    agentSetRegulationInterval(INTERVAL_TO_MINUTES[interval] ?? 1440);
  }

  async function fetchRegulationStatus() {
    try {
      const r = await apiFetch("/api/regulation/status");
      if (r.ok) {
        const d = await r.json();
        setRegulationStatus(d);
      }
    } catch { /* ignore */ }
  }

  async function handleRegulationRefresh() {
    setRegulationRefreshing(true);
    try {
      await apiFetch("/api/regulation/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      await fetchRegulationStatus();
    } catch { /* ignore */ }
    finally { setRegulationRefreshing(false); }
  }

  // domain 탭 진입 시 법규 상태 조회
  useEffect(() => {
    if (open && tab === "domain") { void fetchRegulationStatus(); }
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    apiFetch("/api/settings/keys")
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.keys) {
          setKeys(data.keys);
          setEditKeys(data.keys);
        }
      })
      .catch(() => {});

    // Apply CSS variables for fonts and line-height
    applyInterfaceSettings();
  }, [open]);

  useEffect(() => {
    applyInterfaceSettings();
  }, [fontFamily, codeFont, lineHeight]);

  function applyInterfaceSettings() {
    const root = document.documentElement;
    root.style.setProperty("--msg-font-family", fontFamily);
    root.style.setProperty("--code-font-family", codeFont);
    root.style.setProperty("--msg-line-height", String(lineHeight));
  }

  function saveFontSettings() {
    try {
      localStorage.setItem("corvus-x.font-family", fontFamily);
      localStorage.setItem("corvus-x.code-font", codeFont);
      localStorage.setItem("corvus-x.line-height", String(lineHeight));
    } catch {}
  }

  function saveInstructions() {
    try {
      localStorage.setItem("corvus-x.instructions", JSON.stringify(instructions));
    } catch {}
    // Sync global instruction
    syncGlobalInstruction();
  }

  function syncGlobalInstruction() {
    const activeInstructions = instructions.filter(i => i.active).map(i => i.content);
    const concatenated = activeInstructions.join("\n\n");
    onGlobalInstructionChange(concatenated);
  }

  function createOrUpdateInstruction(title: string, content: string) {
    if (editingInstruction) {
      // Update
      const updated = instructions.map(i =>
        i.id === editingInstruction.id
          ? { ...i, title, content }
          : i
      );
      setInstructions(updated);
      saveInstructions();
    } else {
      // Create new
      const newInstruction: Instruction = {
        id: `instr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        content,
        active: true,
        createdAt: new Date().toISOString(),
      };
      const updated = [newInstruction, ...instructions];
      setInstructions(updated);
      saveInstructions();
    }
    setEditingInstruction(null);
    setShowInstructionForm(false);
  }

  function deleteInstruction(id: string) {
    const updated = instructions.filter(i => i.id !== id);
    setInstructions(updated);
    saveInstructions();
  }

  function toggleInstructionActive(id: string) {
    const updated = instructions.map(i =>
      i.id === id ? { ...i, active: !i.active } : i
    );
    setInstructions(updated);
    saveInstructions();
  }

  function saveActiveProviders() {
    try {
      localStorage.setItem("corvus-x.active-providers", JSON.stringify(activeProviders));
    } catch {}
  }

  function toggleProvider(provider: string) {
    const updated = activeProviders.includes(provider)
      ? activeProviders.filter(p => p !== provider)
      : [...activeProviders, provider];
    setActiveProviders(updated);
    saveActiveProviders();
  }

  if (!open) return null;

  async function handleSaveKeys() {
    // 저장 전 전체 키 유효성 검사
    const newErrors: Record<string, string | null> = {};
    let hasError = false;
    for (const provider of Object.keys(editKeys) as (keyof ApiKeys)[]) {
      const value = editKeys[provider];
      if (!value.trim()) continue; // 빈 값은 기존 키 유지
      const rule: FieldRule = { field: provider, minLength: 10, maxLength: 256 };
      const error = validateField(value, rule);
      newErrors[provider] = error;
      if (error) hasError = true;
    }
    setKeyErrors(prev => ({ ...prev, ...newErrors }));
    if (hasError) {
      setSaveMsg(t("settings.saveFailed") + " 입력값을 확인해주세요.");
      return;
    }

    setSaving(true);
    setSaveMsg("");
    try {
      const res = await apiFetch("/api/settings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editKeys),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveMsg(t("settings.saved"));
        setKeys({ ...editKeys });
      } else {
        setSaveMsg(t("settings.saveFailed") + (data.error ?? t("settings.unknownError")));
      }
    } catch {
      setSaveMsg(t("settings.serverError"));
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  }

  async function handleReset(target: string, label: string) {
    const confirmed = await showConfirm({
      message: t("settings.resetConfirmMsg").replace("{label}", label),
      danger: true,
    });
    if (!confirmed) return;
    setResetting(target);
    setResetMsg("");
    try {
      const res = await apiFetch("/api/settings/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Confirm-Reset": "true" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();
      if (data.ok) {
        setResetMsg(t("settings.resetComplete").replace("{label}", label));
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setResetMsg(t("settings.resetFailed") + (data.error ?? ""));
      }
    } catch {
      setResetMsg(t("settings.serverError"));
    } finally {
      setResetting(null);
    }
  }

  const tabStyle = (t_tab: Tab): React.CSSProperties => ({
    padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer",
    fontSize: 13, fontWeight: 600,
    background: tab === t_tab ? "var(--accent)" : "transparent",
    color: tab === t_tab ? "var(--accent-inverse)" : "var(--text-sub)",
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
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>{t("settings.title")}</span>
          <button type="button" onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", color: "var(--text-sub)" }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* 탭 */}
        <div style={{ display: "flex", gap: 4, padding: "12px 24px", borderBottom: "1px solid var(--border-soft)", overflowX: "auto" }}>
          <button type="button" style={tabStyle("api")} onClick={() => setTab("api")}>{t("settings.apiKeys")}</button>
          <button type="button" style={tabStyle("interface")} onClick={() => setTab("interface")}>{t("settings.interface")}</button>
          <button type="button" style={tabStyle("instruction")} onClick={() => setTab("instruction")}>{t("settings.instruction")}</button>
          <button type="button" style={tabStyle("connector")} onClick={() => setTab("connector")}>{t("settings.connector")}</button>
          <button type="button" style={tabStyle("data")} onClick={() => setTab("data")}>{t("settings.dataManagement")}</button>
          <button type="button" style={tabStyle("domain")} onClick={() => setTab("domain")}>도메인</button>
        </div>

        {/* 본문 */}
        <div style={{ overflowY: "auto", flex: 1, padding: "20px 24px 24px" }}>

          {/* API 키 탭 */}
          {tab === "api" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-sub)", lineHeight: 1.6 }}>
                {t("settings.apiKeyInfo")}
              </p>

              {/* 주요 AI 제공자 */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t("settings.majorProviders")}</div>
                {(["openai", "anthropic", "gemini", "perplexity"] as (keyof ApiKeys)[]).map(provider => (
                  <div key={provider} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)" }}>
                        {PROVIDER_LABELS[provider]} {keyStatusIcon(provider) && <span style={{ marginLeft: 4 }}>{keyStatusIcon(provider)}</span>}
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {keys[provider] && (
                          <button type="button" onClick={() => handleValidateKey(provider)} disabled={keyStatus[provider] === "checking"}
                            style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "transparent", color: "var(--text-sub)", cursor: "pointer", whiteSpace: "nowrap" }}>
                            {keyStatus[provider] === "checking" ? t("settings.validating") : t("settings.validateKey")}
                          </button>
                        )}
                        <a href={PROVIDER_LINKS[provider]} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>{t("settings.getKey")}</a>
                      </div>
                    </div>
                    <input
                      type="password"
                      style={{ ...inputStyle, ...(keyErrors[provider] ? { borderColor: "var(--danger-text)" } : {}) }}
                      placeholder={keys[provider] || t("settings.keepExisting")}
                      value={editKeys[provider]}
                      onChange={e => {
                        setEditKeys(prev => ({ ...prev, [provider]: e.target.value }));
                        handleKeyInputValidation(provider, e.target.value);
                      }}
                    />
                    {keyErrors[provider] && (
                      <div style={{ fontSize: 11, color: "var(--danger-text)", marginTop: 4 }}>{keyErrors[provider]}</div>
                    )}
                  </div>
                ))}
              </div>

              {/* 기타 제공자 (콜랩스) */}
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.5px", userSelect: "none" }}>{t("settings.otherProviders")}</summary>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
                  {(["midjourney", "runway"] as (keyof ApiKeys)[]).map(provider => (
                    <div key={provider}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)" }}>{PROVIDER_LABELS[provider]}</label>
                        <a href={PROVIDER_LINKS[provider]} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>{t("settings.getKey")}</a>
                      </div>
                      <input
                        type="password"
                        style={inputStyle}
                        placeholder={keys[provider] || t("settings.keepExisting")}
                        value={editKeys[provider]}
                        onChange={e => setEditKeys(prev => ({ ...prev, [provider]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </details>

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                <button type="button" style={btnStyle} onClick={handleSaveKeys} disabled={saving}>
                  {saving ? t("settings.saving") : t("settings.save")}
                </button>
                {saveMsg && <span style={{ fontSize: 13, color: saveMsg.includes(t("settings.saveFailed").slice(0, 4)) || saveMsg.includes(t("settings.serverError").slice(0, 4)) ? "var(--danger-text)" : "var(--accent)" }}>{saveMsg}</span>}
              </div>
            </div>
          )}

          {/* 인터페이스 탭 */}
          {tab === "interface" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* 글꼴 선택 */}
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)", display: "block", marginBottom: 8 }}>{t("settings.fontFamily")}</label>
                <select
                  value={fontFamily}
                  onChange={e => { setFontFamily(e.target.value); saveFontSettings(); }}
                  style={{ ...inputStyle, appearance: "none", paddingRight: 32 }}
                >
                  <option value="Pretendard">Pretendard</option>
                  <option value="Noto Sans KR">Noto Sans KR</option>
                  <option value="IBM Plex Sans KR">IBM Plex Sans KR</option>
                  <option value="system-ui">{t("settings.systemDefault")}</option>
                </select>
              </div>

              {/* 코드 글꼴 */}
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)", display: "block", marginBottom: 8 }}>{t("settings.codeFont")}</label>
                <select
                  value={codeFont}
                  onChange={e => { setCodeFont(e.target.value); saveFontSettings(); }}
                  style={{ ...inputStyle, appearance: "none", paddingRight: 32 }}
                >
                  <option value="Fira Code">Fira Code</option>
                  <option value="JetBrains Mono">JetBrains Mono</option>
                  <option value="Consolas">Consolas</option>
                  <option value="monospace">{t("settings.systemDefault")}</option>
                </select>
              </div>

              {/* 메시지 폰트 크기 */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)", marginBottom: 12 }}>{t("settings.messageFontSize")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ fontSize: 12, color: "var(--text-soft)", width: 24 }}>{t("settings.small")}</span>
                  <input
                    type="range" min={13} max={20} step={1}
                    value={fontSize}
                    onChange={e => onFontSizeChange(Number(e.target.value))}
                    style={{ flex: 1, accentColor: "var(--accent)" }}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-soft)", width: 24 }}>{t("settings.large")}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-main)", minWidth: 36, textAlign: "right" }}>{fontSize}px</span>
                </div>
              </div>

              {/* 줄간격 */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)", marginBottom: 12 }}>{t("settings.lineHeight")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ fontSize: 12, color: "var(--text-soft)", minWidth: 32 }}>{t("settings.tight")}</span>
                  <input
                    type="range" min={1.4} max={2.0} step={0.1}
                    value={lineHeight}
                    onChange={e => { setLineHeight(Number(e.target.value)); saveFontSettings(); }}
                    style={{ flex: 1, accentColor: "var(--accent)" }}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-soft)", minWidth: 32 }}>{t("settings.loose")}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-main)", minWidth: 40, textAlign: "right" }}>{lineHeight.toFixed(1)}</span>
                </div>
              </div>

              {/* 미리보기 */}
              <div style={{ marginTop: 8, padding: "14px 18px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-soft)" }}>
                <p style={{ margin: 0, fontSize: fontSize, lineHeight: lineHeight, color: "var(--text-main)", fontFamily: fontFamily }}>
                  {t("settings.previewText")}
                </p>
              </div>
            </div>
          )}

          {/* 지침 탭 */}
          {tab === "instruction" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* 헤더 및 통계 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>{t("settings.manageInstructions")}</div>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--text-sub)" }}>{t("settings.activeCount").replace("{active}", String(instructions.filter(i => i.active).length)).replace("{total}", String(instructions.length))}</p>
                </div>
                <button
                  type="button"
                  style={{ ...btnStyle, fontSize: 12 }}
                  onClick={() => { setEditingInstruction(null); setShowInstructionForm(true); }}
                >
                  {t("settings.addInstruction")}
                </button>
              </div>

              {/* 지침 입력 폼 */}
              {showInstructionForm && (
                <div style={{ padding: 16, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-soft)" }}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main)", display: "block", marginBottom: 6 }}>{t("settings.titleLabel")}</label>
                    <input
                      type="text"
                      style={inputStyle}
                      placeholder={t("settings.instructionTitle")}
                      defaultValue={editingInstruction?.title ?? ""}
                      id="instruction-title-input"
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main)", display: "block", marginBottom: 6 }}>{t("settings.contentLabel")}</label>
                    <textarea
                      style={{ width: "100%", minHeight: 100, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-main)", color: "var(--text-main)", fontSize: 13, lineHeight: 1.6, resize: "vertical", outline: "none", boxSizing: "border-box" as const, fontFamily: "monospace" }}
                      placeholder={t("settings.instructionMarkdown")}
                      defaultValue={editingInstruction?.content ?? ""}
                      id="instruction-content-input"
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      style={btnStyle}
                      onClick={() => {
                        const title = (document.getElementById("instruction-title-input") as HTMLInputElement)?.value.trim();
                        const content = (document.getElementById("instruction-content-input") as HTMLTextAreaElement)?.value.trim();
                        if (title && content) {
                          createOrUpdateInstruction(title, content);
                        }
                      }}
                    >
                      {editingInstruction ? t("settings.edit") : t("settings.add")}
                    </button>
                    <button
                      type="button"
                      style={{ ...btnStyle, background: "transparent", color: "var(--text-sub)", border: "1px solid var(--border)" }}
                      onClick={() => { setEditingInstruction(null); setShowInstructionForm(false); }}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}

              {/* 지침 목록 */}
              {instructions.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-soft)", fontStyle: "italic" }}>{t("settings.noInstructions")}</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {instructions.map(instr => (
                    <div
                      key={instr.id}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: instr.active ? "var(--surface-active)" : "transparent",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={instr.active}
                        onChange={() => toggleInstructionActive(instr.id)}
                        style={{ marginTop: 3, cursor: "pointer", accentColor: "var(--accent)" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main)" }}>{instr.title}</div>
                        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-soft)", lineHeight: 1.5 }}>
                          {instr.content.split("\n")[0].substring(0, 60)}
                          {instr.content.split("\n")[0].length > 60 ? "..." : ""}
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 11, color: "var(--accent)" }}
                          onClick={() => { setEditingInstruction(instr); setShowInstructionForm(true); }}
                        >
                          {t("settings.edit")}
                        </button>
                        <button
                          type="button"
                          style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--danger-border)", background: "transparent", cursor: "pointer", fontSize: 11, color: "var(--danger-text)" }}
                          onClick={() => deleteInstruction(instr.id)}
                        >
                          {t("settings.delete")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 커넥터 탭 */}
          {tab === "connector" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-sub)" }}>
                {t("settings.connectorDesc")}
              </p>

              {/* AI 제공자 섹션 */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t("settings.aiProviders")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {["openai", "anthropic", "gemini", "perplexity"].map(provider => (
                    <div
                      key={provider}
                      style={{
                        padding: 14,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--bg-soft)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main)" }}>
                          {PROVIDER_LABELS[provider as keyof ApiKeys]}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: keys[provider as keyof ApiKeys] ? "var(--surface-active)" : "var(--border)",
                            color: keys[provider as keyof ApiKeys] ? "var(--accent)" : "var(--text-soft)",
                          }}
                        >
                          {keys[provider as keyof ApiKeys] ? t("settings.connected") : t("settings.disconnected")}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={activeProviders.includes(provider)}
                          onChange={() => toggleProvider(provider)}
                          disabled={!keys[provider as keyof ApiKeys]}
                          style={{ cursor: keys[provider as keyof ApiKeys] ? "pointer" : "not-allowed", accentColor: "var(--accent)" }}
                        />
                        <label style={{ fontSize: 11, color: "var(--text-sub)", flex: 1 }}>{t("settings.enableOrchestration")}</label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 외부 서비스 섹션 */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t("settings.externalServices")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {["GitHub", "Notion", "Figma"].map(service => (
                    <div
                      key={service}
                      style={{
                        padding: 14,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--bg-soft)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        opacity: 0.6,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main)" }}>{service}</div>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: "var(--border)",
                            color: "var(--text-soft)",
                          }}
                        >
                          {t("settings.comingSoon")}
                        </div>
                      </div>
                      <p style={{ margin: 0, fontSize: 11, color: "var(--text-soft)", fontStyle: "italic" }}>
                        {t("settings.comingSoonDesc")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Agent 설정 섹션 */}
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.5px", userSelect: "none" }}>{t("settings.agentSettings")}</summary>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { key: "dialogue", label: t("task.dialogue") },
                    { key: "reasoning", label: t("task.reasoning") },
                    { key: "research", label: t("task.research") },
                    { key: "code", label: t("task.code") },
                    { key: "writing", label: t("task.writing") },
                  ].map(({ key, label: taskLabel }) => (
                    <div
                      key={key}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--bg-soft)",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-main)", marginBottom: 8 }}>{taskLabel}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11, color: "var(--text-soft)" }}>
                        <div>
                          <span style={{ fontWeight: 500 }}>{t("settings.primary")}</span> OpenAI
                        </div>
                        <div>
                          <span style={{ fontWeight: 500 }}>{t("settings.verifier")}</span> Anthropic
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          {/* 데이터 관리 탭 */}
          {tab === "data" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-sub)", lineHeight: 1.6 }}>
                {t("settings.dataWarning")}
              </p>
              {[
                { target: "thread-memory", label: t("settings.chatMemory"), desc: t("settings.chatMemoryDesc") },
                { target: "project-memory", label: t("settings.projectMemory"), desc: t("settings.projectMemoryDesc") },
                { target: "scoreboard", label: t("settings.scoreboard"), desc: t("settings.scoreboardDesc") },
                { target: "all", label: t("settings.resetAll"), desc: t("settings.resetAllDesc") },
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
                    {resetting === target ? t("settings.resetting") : t("settings.reset")}
                  </button>
                </div>
              ))}
              {resetMsg && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: resetMsg.includes(t("settings.resetComplete").slice(0, 4)) ? "var(--surface-active)" : "var(--danger-bg)", color: resetMsg.includes(t("settings.resetComplete").slice(0, 4)) ? "var(--accent)" : "var(--danger-text)", fontSize: 13, fontWeight: 600 }}>
                  {resetMsg}
                </div>
              )}
            </div>
          )}

          {/* 도메인 탭 */}
          {tab === "domain" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* 도메인 프로파일 */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>도메인 프로파일</div>
                <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--text-sub)", lineHeight: 1.6 }}>
                  선택한 도메인의 특화 도구가 에이전트 루프에서 우선 활성화됩니다.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { key: "food", label: "식품", desc: "식품 시장·법규·레시피·유통 분석", icon: "🍱" },
                    { key: "ecig", label: "액상전자담배", desc: "전자담배 시장·규제·브랜드·유통", icon: "💨" },
                    { key: "cosmetic", label: "화장품", desc: "화장품 시장·성분·제조·규정", icon: "✨" },
                    { key: "general", label: "범용", desc: "시장·비즈니스·금융 분석 (기본)", icon: "🌐" },
                  ].map(({ key, label, desc, icon }) => (
                    <div
                      key={key}
                      onClick={() => saveDomainProfile(key)}
                      style={{
                        padding: "14px 16px",
                        borderRadius: 10,
                        border: `2px solid ${domainProfile === key ? "var(--accent)" : "var(--border)"}`,
                        background: domainProfile === key ? "var(--surface-active)" : "var(--bg-soft)",
                        cursor: "pointer",
                        transition: "border-color 0.15s, background 0.15s",
                      }}
                    >
                      <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: domainProfile === key ? "var(--accent)" : "var(--text-main)", marginBottom: 3 }}>{label}</div>
                      <div style={{ fontSize: 11, color: "var(--text-soft)", lineHeight: 1.5 }}>{desc}</div>
                      {domainProfile === key && (
                        <div style={{ marginTop: 8, fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.5px" }}>● 활성</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 자동 법규 갱신 주기 */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>자동 법규 갱신 주기</div>
                <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--text-sub)", lineHeight: 1.6 }}>
                  식품·전자담배·화장품·일반 법규를 자동으로 조회하는 주기를 설정합니다.
                  서버 환경변수 <code style={{ fontSize: 11, background: "var(--bg-soft)", padding: "1px 4px", borderRadius: 4 }}>CORVUS_ENABLE_REGULATION_WATCHER=1</code>이 설정된 경우에만 작동합니다.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { key: "daily", label: "매일 1회", desc: "자정 기준 일 1회 자동 갱신 (권장)" },
                    { key: "weekly", label: "매주 1회", desc: "월요일 자정 기준 주 1회 갱신" },
                    { key: "manual", label: "수동", desc: "자동 갱신 비활성 — 직접 갱신 요청 시에만 실행" },
                  ].map(({ key, label, desc }) => (
                    <label
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "12px 14px",
                        borderRadius: 8,
                        border: `1px solid ${regulationInterval === key ? "var(--accent)" : "var(--border)"}`,
                        background: regulationInterval === key ? "var(--surface-active)" : "transparent",
                        cursor: "pointer",
                        transition: "border-color 0.15s, background 0.15s",
                      }}
                    >
                      <input
                        type="radio"
                        name="regulation-interval"
                        value={key}
                        checked={regulationInterval === key}
                        onChange={() => saveRegulationInterval(key)}
                        style={{ marginTop: 2, accentColor: "var(--accent)" }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)", marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 11, color: "var(--text-soft)" }}>{desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* 법규 캐시 현황 */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>법규 캐시 현황</div>
                  <button
                    type="button"
                    disabled={regulationRefreshing}
                    onClick={handleRegulationRefresh}
                    style={{
                      padding: "5px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "var(--bg-soft)",
                      color: "var(--text-main)",
                      cursor: regulationRefreshing ? "not-allowed" : "pointer",
                      opacity: regulationRefreshing ? 0.6 : 1,
                    }}
                  >
                    {regulationRefreshing ? "갱신 중…" : "⟳ 지금 갱신"}
                  </button>
                </div>
                <div style={{
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--bg-soft)",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px 20px",
                  fontSize: 12,
                }}>
                  {regulationStatus ? (
                    <>
                      <div>
                        <div style={{ color: "var(--text-soft)", marginBottom: 2 }}>워처 상태</div>
                        <div style={{ fontWeight: 700, color: regulationStatus.running ? "#1a9e4b" : "#888" }}>
                          {regulationStatus.running ? "● 실행 중" : "○ 비활성"}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "var(--text-soft)", marginBottom: 2 }}>캐시된 소스</div>
                        <div style={{ fontWeight: 700, color: "var(--text-main)" }}>
                          {regulationStatus.ok_count} / {regulationStatus.total_sources}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "var(--text-soft)", marginBottom: 2 }}>마지막 조회</div>
                        <div style={{ fontWeight: 600, color: "var(--text-main)" }}>
                          {regulationStatus.last_fetch_at
                            ? new Date(regulationStatus.last_fetch_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                            : "없음"}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "var(--text-soft)", marginBottom: 2 }}>마지막 변경 감지</div>
                        <div style={{ fontWeight: 600, color: "var(--text-main)" }}>
                          {regulationStatus.last_change_at
                            ? new Date(regulationStatus.last_change_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                            : "없음"}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div style={{ gridColumn: "1 / -1", color: "var(--text-soft)", fontSize: 12 }}>
                      법규 상태를 불러오는 중…
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 24px", display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-soft)",
              color: "var(--text-main)",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}