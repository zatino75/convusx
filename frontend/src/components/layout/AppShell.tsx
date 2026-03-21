import type { ReactNode } from "react";

type Props = {
  sidebar: ReactNode;
  topbar: ReactNode;
  statusBar: ReactNode;
  main: ReactNode;
  rightPanel?: ReactNode;
};

export default function AppShell({ sidebar, topbar, statusBar, main, rightPanel }: Props) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-[#212121] text-[#ececec]">
      <div className="flex h-full w-full">
        {sidebar}

        <main className="flex min-w-0 flex-1 flex-col bg-[#212121]">
          {topbar}
          {statusBar}

          <div className="flex min-h-0 flex-1">
            <section className="flex min-w-0 flex-1 flex-col">{main}</section>
            {rightPanel}
          </div>
        </main>
      </div>
    </div>
  );
}
