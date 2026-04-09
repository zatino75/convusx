import { useMemo } from "react";
import { getVisibleMessages } from "../appMessageUtils";
import type { Message } from "../types/workspace";

export function useMessageVersions(workspace: any) {
  const messageVersionMap = useMemo(() => {
    const thread = workspace.activeThread;
    if (!thread) return {};

    const versions = thread.messageVersions ?? {};
    const activeVersionIndex = thread.activeVersionIndex ?? {};
    const result: Record<string, { current: number; total: number }> = {};

    for (const [groupId, messages] of Object.entries(versions)) {
      if (!Array.isArray(messages) || messages.length <= 1) continue;

      const visibleUserMessage = thread.messages.find(
        (item: Message) => item.role === "user" && !item.isHidden && item.versionGroupId === groupId
      );

      if (!visibleUserMessage) continue;

      result[visibleUserMessage.id] = {
        current: (activeVersionIndex[groupId] ?? 0) + 1,
        total: (messages as Message[]).filter((item) => item.role === "user").length || messages.length
      };
    }

    return result;
  }, [workspace.activeThread]);

  function handleSelectMessageVersion(messageId: string, direction: "prev" | "next") {
    const thread = workspace.activeThread;
    if (!thread) return;

    const baseMessage = thread.messages.find((item: Message) => item.id === messageId);
    const groupId = baseMessage?.versionGroupId;
    if (!groupId) return;

    const versions = thread.messageVersions?.[groupId] ?? [];
    const userVersions = (versions as Message[])
      .filter((item) => item.role === "user")
      .sort((a, b) => (a.versionIndex ?? 0) - (b.versionIndex ?? 0));

    if (userVersions.length <= 1) return;

    const currentVersionValue = thread.activeVersionIndex?.[groupId] ?? 0;
    const currentVersionPosition = userVersions.findIndex(
      (item) => (item.versionIndex ?? 0) === currentVersionValue
    );

    const safeCurrentPosition = currentVersionPosition >= 0 ? currentVersionPosition : 0;
    const nextPosition =
      direction === "prev"
        ? Math.max(0, safeCurrentPosition - 1)
        : Math.min(userVersions.length - 1, safeCurrentPosition + 1);

    if (nextPosition === safeCurrentPosition) return;

    const nextUserVersion = userVersions[nextPosition];
    const nextVersionValue = nextUserVersion.versionIndex ?? 0;

    const nextAssistantVersion =
      (versions as Message[]).find(
        (item) => item.role === "assistant" && (item.versionIndex ?? 0) === nextVersionValue
      ) ?? null;

    workspace.updateThreadById(thread.id, (currentThread: any) => {
      const visibleMessages = getVisibleMessages(currentThread);
      const currentUserIndex = visibleMessages.findIndex((item: Message) => item.id === messageId);
      if (currentUserIndex < 0) return currentThread;

      const existingAssistant =
        currentUserIndex + 1 < visibleMessages.length && visibleMessages[currentUserIndex + 1]?.role === "assistant"
          ? visibleMessages[currentUserIndex + 1]
          : null;

      const before = visibleMessages.slice(0, currentUserIndex);
      const after = existingAssistant
        ? visibleMessages.slice(currentUserIndex + 2)
        : visibleMessages.slice(currentUserIndex + 1);

      const replacementMessages: Message[] = [
        {
          ...nextUserVersion,
          isHidden: false
        }
      ];

      if (nextAssistantVersion) {
        replacementMessages.push({
          ...nextAssistantVersion,
          isHidden: false
        });
      }

      return {
        ...currentThread,
        messages: [...before, ...replacementMessages, ...after],
        activeVersionIndex: {
          ...(currentThread.activeVersionIndex ?? {}),
          [groupId]: nextVersionValue
        }
      };
    });
  }

  return { messageVersionMap, handleSelectMessageVersion };
}
