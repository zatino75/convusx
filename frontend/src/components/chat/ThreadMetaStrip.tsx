import type { ProjectGroup, Thread } from "../../types/workspace";
import ExportMenu from "./ExportMenu";
import { t } from "../../i18n";

export default function ThreadMetaStrip({
  thread,
  project,
}: {
  thread: Thread;
  project: ProjectGroup | null;
}) {
  const chips: string[] = [];

  if (project?.meta?.memoryEnabled) chips.push("Project memory on");
  if (thread.meta?.pinned) chips.push(t("sidebar.pinned"));
  if (thread.meta?.sourceThreadIds?.length) chips.push(`Fusion ${thread.meta.sourceThreadIds.length}`);
  if (thread.meta?.labels?.length) chips.push(...thread.meta.labels.slice(0, 2));

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <div className="thread-meta-strip">
        {chips.length > 0
          ? chips.map((chip) => (
              <span key={chip} className="thread-badge">
                {chip}
              </span>
            ))
          : null}
      </div>
      <ExportMenu thread={thread} />
    </div>
  );
}
