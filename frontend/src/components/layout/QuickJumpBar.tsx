import { t } from "../../i18n";
import type { ReactNode } from "react";
import {
  DashboardIcon,
  SalesIcon,
  WorkforceIcon,
  StoreOpsIcon,
  PosIcon,
  SearchIcon
} from "./SidebarIcons";

type ViewKey = "dashboard" | "sales" | "workforce" | "storeops" | "pos" | "search";

type Props = {
  active: ViewKey | "chat";
  onOpenChat: () => void;
  onOpenDashboard: () => void;
  onOpenSales: () => void;
  onOpenWorkforce: () => void;
  onOpenStoreOps: () => void;
  onOpenPos: () => void;
  onOpenSearch: () => void;
};

export default function QuickJumpBar({
  active,
  onOpenChat,
  onOpenDashboard,
  onOpenSales,
  onOpenWorkforce,
  onOpenStoreOps,
  onOpenPos,
  onOpenSearch
}: Props) {
  const items: Array<{ key: ViewKey | "chat"; label: string; icon: ReactNode; onClick: () => void }> = [
    {
      key: "chat",
      label: t("nav.newThread"),
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
        </svg>
      ),
      onClick: onOpenChat
    },
    { key: "dashboard", label: t("nav.dashboard"), icon: <DashboardIcon />, onClick: onOpenDashboard },
    { key: "sales", label: t("nav.sales"), icon: <SalesIcon />, onClick: onOpenSales },
    { key: "workforce", label: t("nav.workforce"), icon: <WorkforceIcon />, onClick: onOpenWorkforce },
    { key: "storeops", label: t("nav.storeops"), icon: <StoreOpsIcon />, onClick: onOpenStoreOps },
    { key: "pos", label: t("nav.pos"), icon: <PosIcon />, onClick: onOpenPos },
    { key: "search", label: t("nav.search"), icon: <SearchIcon />, onClick: onOpenSearch }
  ];

  return (
    <nav className="quick-jump" aria-label="빠른 전환">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={"quick-jump__btn" + (active === item.key ? " is-active" : "")}
          onClick={item.onClick}
          title={item.label}
        >
          <span className="quick-jump__icon">{item.icon}</span>
          <b>{item.label}</b>
        </button>
      ))}
    </nav>
  );
}
