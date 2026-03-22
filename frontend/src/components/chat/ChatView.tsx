import type { RefObject } from "react";
import type { Message, ProviderDraft, Thread } from "../../App";

type Props = {
  activeThread?: Thread;
  isSending: boolean;
  lastError: string | null;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
};

function providerLabel(provider: string | null | undefined) {
  const normalized = String(provider ?? "").trim().toLowerCase();
  if (!normalized) return "-";
  if (normalized === "openai") return "OpenAI";
  if (normalized === "claude") return "Claude";
  if (normalized === "gemini") return "Gemini";
  if (normalized === "perplexity") return "Perplexity";
  return normalized;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

function formatLatencyMs(value: number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return "-";
  if (number < 1000) return `${Math.round(number)}ms`;
  return `${(number / 1000).toFixed(1)}s`;
}

function formatUsd(value: number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return "$0";
  if (number < 0.01) return `$${number.toFixed(4)}`;
  return `$${number.toFixed(2)}`;
}

function formatScore(value: number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return "-";
  return number.toFixed(2);
}

function TimelineNode({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#1f1f1f] px-3 py-2">
      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-[#8e8ea0]">{label}</div>
      <div className={["truncate text-xs text-white", accent ?? ""].join(" ")}>{value}</div>
    </div>
  );
}

function MetaChip({
  text,
  accent
}: {
  text: string;
  accent?: string;
}) {
  return (
    <span
      className={[
        "inline-flex rounded-full border px-2.5 py-1 text-[11px]",
        accent ? accent : "border-white/10 bg-white/[0.04] text-[#d7d7d7]"
      ].join(" ")}
    >
      {text}
    </span>
  );
}

function ProviderDraftPanel({
  drafts,
  winnerProvider,
  loserProviders,
  hiddenFailedProviders,
  primaryRecovered,
  recoveryFromModel,
  recoveryToModel
}: {
  drafts: ProviderDraft[];
  winnerProvider: string | null | undefined;
  loserProviders: string[];
  hiddenFailedProviders: string[];
  primaryRecovered?: boolean;
  recoveryFromModel?: string | null;
  recoveryToModel?: string | null;
}) {
  if (!Array.isArray(drafts) || drafts.length === 0) return null;

  const visibleDrafts = drafts.filter(
    (draft) => !hiddenFailedProviders.includes(draft.provider)
  );

  if (visibleDrafts.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[#8e8ea0]">Live providers</div>

      {visibleDrafts.map((draft) => {
        const isWinner = draft.provider === winnerProvider;
        const isLoser = loserProviders.includes(draft.provider);

        return (
          <div
            key={draft.provider}
            className={[
              "rounded-2xl border px-3 py-3",
              isWinner
                ? "border-emerald-500/30 bg-emerald-500/10"
                : isLoser
                  ? "border-white/10 bg-[#141414] opacity-80"
                  : "border-white/10 bg-[#181818]"
            ].join(" ")}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-white">{providerLabel(draft.provider)}</div>
              <div className="flex items-center gap-2 text-[10px]">
                {isWinner ? <span className="text-emerald-300">winner</span> : null}
                {isLoser ? <span className="text-[#8e8ea0]">loser</span> : null}
                {!isWinner && !isLoser ? <span className="text-[#8e8ea0]">streaming</span> : null}
              </div>
            </div>

            {isWinner && primaryRecovered ? (
              <div className="mb-2 text-[10px] text-amber-300">
                recovered ({recoveryFromModel ?? "-"} → {recoveryToModel ?? "-"})
              </div>
            ) : null}

            <div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-[#d7d7d7]">
              {draft.content || "..."}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RequestMetaInline({ meta }: { meta: any }) {
  const primary = meta?.selectedProviders?.[0] ?? null;
  const verifier = meta?.verifierProviders?.[0] ?? null;
  const selectedModels = Array.isArray(meta?.selectedModels) ? meta.selectedModels : [];
  const winner = meta?.displayWinner?.provider ?? meta?.winnerProvider ?? primary ?? null;
  const providerDrafts = Array.isArray(meta?.providerDrafts) ? meta.providerDrafts : [];
  const loserProviders = Array.isArray(meta?.displayLosers) ? meta.displayLosers : [];
  const hiddenFailedProviders = Array.isArray(meta?.hiddenFailedProviders) ? meta.hiddenFailedProviders : [];

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-2xl border border-white/10 bg-[#181818] p-3">
        <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[#8e8ea0]">Orchestration timeline</div>

        <div className="flex items-center gap-2">
          <TimelineNode label="Primary" value={providerLabel(primary)} />
          <div className="text-xs text-[#5f5f66]">→</div>
          <TimelineNode label="Verifier" value={providerLabel(verifier)} />
          <div className="text-xs text-[#5f5f66]">→</div>
          <TimelineNode label="Winner" value={providerLabel(winner)} accent="text-emerald-300" />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <MetaChip text={`Latency ${formatLatencyMs(meta?.requestLatencyMs ?? meta?.latency)}`} />
          <MetaChip text={`Cost ${formatUsd(meta?.requestCostUsd ?? meta?.cost)}`} />
          <MetaChip text={`Confidence ${formatScore(meta?.judgeConfidence ?? meta?.confidence)}`} accent="border-emerald-500/20 bg-emerald-500/10 text-emerald-300" />
          <MetaChip
            text={meta?.fallbackUsed ?? meta?.fallback ? "Fallback 사용" : "Primary 유지"}
            accent={meta?.fallbackUsed ?? meta?.fallback ? "border-amber-500/20 bg-amber-500/10 text-amber-300" : undefined}
          />
          {meta?.primaryRecovered ? (
            <MetaChip
              text={`Recovered ${meta?.recoveryFromModel ?? "-"} → ${meta?.recoveryToModel ?? "-"}`}
              accent="border-amber-500/20 bg-amber-500/10 text-amber-300"
            />
          ) : null}
          {meta?.banditScore != null ? (
            <MetaChip
              text={`Bandit ${Number(meta.banditScore).toFixed(2)}`}
              accent="border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
            />
          ) : null}
        </div>
      </div>

      {selectedModels.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedModels.map((row: any, index: number) => (
            <div
              key={`${row?.provider ?? "unknown"}_${row?.model ?? "unknown"}_${index}`}
              className="rounded-full border border-white/10 bg-[#1f1f1f] px-2.5 py-1 text-[11px] text-[#b4b4b4]"
            >
              {providerLabel(row?.provider)} · {row?.model ?? "-"}
            </div>
          ))}
        </div>
      ) : null}

      <ProviderDraftPanel
        drafts={providerDrafts}
        winnerProvider={winner}
        loserProviders={loserProviders}
        hiddenFailedProviders={hiddenFailedProviders}
        primaryRecovered={Boolean(meta?.primaryRecovered)}
        recoveryFromModel={meta?.recoveryFromModel ?? null}
        recoveryToModel={meta?.recoveryToModel ?? null}
      />
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const isError = message.status === "error";

  return (
    <div className={["flex w-full", isUser ? "justify-end" : "justify-start"].join(" ")}>
      <div
        className={[
          "max-w-[85%] rounded-3xl px-4 py-3 shadow-sm",
          isUser ? "bg-[#303030] text-white" : "bg-[#2a2a2a] text-[#ececec]",
          isError ? "border border-red-500/20" : ""
        ].join(" ")}
      >
        <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-[#8e8ea0]">
          {isUser ? "You" : "AI ORCHESTRA"}
        </div>

        <div className="whitespace-pre-wrap break-words text-[15px] leading-7">
          {message.content || (isPending ? "응답 생성 중..." : "")}
        </div>

        {isPending ? (
          <div className="mt-3 inline-flex items-center gap-2 text-[12px] text-[#b4b4b4]">
            <span className="h-2 w-2 rounded-full bg-[#8e8ea0] animate-pulse" />
            실시간 생성 중...
          </div>
        ) : null}

        {!isUser && message.requestMeta ? <RequestMetaInline meta={message.requestMeta} /> : null}

        <div className="mt-3 text-right text-[11px] text-[#8e8ea0]">{formatTime(message.createdAt)}</div>
      </div>
    </div>
  );
}

export default function ChatView({
  activeThread,
  isSending,
  lastError,
  draft,
  onDraftChange,
  onSend,
  textareaRef,
  scrollRef
}: Props) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {activeThread?.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {lastError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {lastError}
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-4 md:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-[28px] border border-white/10 bg-[#2f2f2f] p-3 shadow-2xl">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="AI ORCHESTRA에 메시지 보내기"
              className="max-h-56 min-h-[28px] w-full resize-y border-none bg-transparent px-2 py-2 text-[15px] leading-7 text-white outline-none placeholder:text-[#8e8ea0]"
            />

            <div className="mt-3 flex items-center justify-between px-1">
              <div className="text-xs text-[#8e8ea0]">Enter 전송 · Shift+Enter 줄바꿈</div>

              <button
                type="button"
                onClick={onSend}
                disabled={isSending || !draft.trim()}
                className="inline-flex h-10 items-center rounded-full bg-white px-4 text-sm font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSending ? "생성 중..." : "보내기"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
