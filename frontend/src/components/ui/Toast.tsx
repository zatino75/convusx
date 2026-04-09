import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { t } from "../../i18n";

// ── 타입 ──

export type ToastType = "info" | "success" | "warning" | "error";

type ToastItem = {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
};

type ConfirmOptions = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

// ── 전역 이벤트 기반 API (Context 불필요 — 어디서든 호출 가능) ──

type ToastHandler = (message: string, type: ToastType, duration: number) => void;
type ConfirmHandler = (options: ConfirmOptions) => Promise<boolean>;

let _toastHandler: ToastHandler | null = null;
let _confirmHandler: ConfirmHandler | null = null;

export function showToast(message: string, type: ToastType = "info", duration = 3500): void {
  if (_toastHandler) _toastHandler(message, type, duration);
}

export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  if (_confirmHandler) return _confirmHandler(options);
  return Promise.resolve(false);
}

// ── Provider (App 루트에 1개만 마운트) ──

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const toast = useCallback((message: string, type: ToastType = "info", duration = 3500) => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(item => item.id !== id));
  }, []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      setConfirmState({ options, resolve });
    });
  }, []);

  const handleConfirm = useCallback((value: boolean) => {
    confirmState?.resolve(value);
    setConfirmState(null);
  }, [confirmState]);

  // 전역 핸들러 등록
  useEffect(() => {
    _toastHandler = toast;
    _confirmHandler = confirm;
    return () => {
      _toastHandler = null;
      _confirmHandler = null;
    };
  }, [toast, confirm]);

  return (
    <>
      {children}

      {/* Toast 렌더링 */}
      {toasts.length > 0 && (
        <div className="toast-container" role="status" aria-live="polite">
          {toasts.map(item => (
            <ToastBubble key={item.id} item={item} onDismiss={removeToast} />
          ))}
        </div>
      )}

      {/* Confirm 모달 */}
      {confirmState && (
        <div
          className="toast-confirm-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-label={confirmState.options.message}
          onMouseDown={e => { if (e.target === e.currentTarget) handleConfirm(false); }}
          onKeyDown={e => { if (e.key === "Escape") handleConfirm(false); }}
        >
          <div className="toast-confirm-dialog" onMouseDown={e => e.stopPropagation()}>
            <p className="toast-confirm-message">{confirmState.options.message}</p>
            <div className="toast-confirm-actions">
              <button
                type="button"
                className="toast-confirm-btn toast-confirm-btn--cancel"
                onClick={() => handleConfirm(false)}
                style={{ minHeight: 44, minWidth: 44 }}
              >
                {confirmState.options.cancelLabel ?? t("common.cancel")}
              </button>
              <button
                type="button"
                className={
                  "toast-confirm-btn toast-confirm-btn--ok" +
                  (confirmState.options.danger ? " toast-confirm-btn--danger" : "")
                }
                onClick={() => handleConfirm(true)}
                autoFocus
                style={{ minHeight: 44, minWidth: 44 }}
              >
                {confirmState.options.confirmLabel ?? t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── 개별 토스트 아이템 ──

function ToastBubble({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(item.id), 280);
    }, item.duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [item.id, item.duration, onDismiss]);

  const icon = TOAST_ICONS[item.type];

  return (
    <div
      className={`toast-bubble toast-bubble--${item.type}${exiting ? " toast-bubble--exit" : ""}`}
      onClick={() => {
        setExiting(true);
        setTimeout(() => onDismiss(item.id), 280);
      }}
    >
      <span className="toast-bubble__icon">{icon}</span>
      <span className="toast-bubble__text">{item.message}</span>
    </div>
  );
}

const TOAST_ICONS: Record<ToastType, string> = {
  info: "ℹ️",
  success: "✓",
  warning: "⚠",
  error: "✗",
};
