type Props = {
  onNewThread: () => void;
  onRefreshOps: () => void;
  onToggleOps: () => void;
  showOps: boolean;
};

function ActionButton({
  children,
  onClick,
  subtle
}: {
  children: React.ReactNode;
  onClick: () => void;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-lg border px-3 py-2 text-xs transition",
        subtle
          ? "border-white/10 bg-transparent text-[#d7d7d7] hover:bg-white/5"
          : "border-white/10 bg-[#2a2a2a] text-white hover:bg-[#323232]"
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export default function Topbar({ onNewThread, onRefreshOps, onToggleOps, showOps }: Props) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-white/10 bg-[#212121] px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onNewThread}
          className="inline-flex h-9 items-center rounded-lg border border-white/10 px-3 text-sm text-white md:hidden"
        >
          새 채팅
        </button>

        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">AI ORCHESTRA</div>
          <div className="truncate text-xs text-[#8e8ea0]">
            Planner · Router · Judge · Multi-AI Workspace
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300 lg:inline-flex">
          backend 8000
        </span>

        <ActionButton onClick={onRefreshOps} subtle>
          상태 갱신
        </ActionButton>

        <ActionButton onClick={onToggleOps} subtle>
          {showOps ? "패널 숨김" : "패널 표시"}
        </ActionButton>
      </div>
    </header>
  );
}
