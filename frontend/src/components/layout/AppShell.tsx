import type { ReactNode } from "react";

type Props = {
  sidebar: ReactNode;
  topbar: ReactNode;
  main: ReactNode;
  artifact?: ReactNode;
};

export default function AppShell({ sidebar, topbar, main, artifact }: Props) {
  return (
    <div className={"app-shell" + (artifact ? " app-shell--with-artifact" : "")}>
      <aside className="app-shell__sidebar">{sidebar}</aside>

      <main className="app-shell__main">
        <div className="app-shell__topbar">{topbar}</div>
        <div className="app-shell__body">
          <section className="app-shell__content">{main}</section>
          {artifact ? (
            <aside className="app-shell__artifact">{artifact}</aside>
          ) : null}
        </div>
      </main>
    </div>
  );
}
