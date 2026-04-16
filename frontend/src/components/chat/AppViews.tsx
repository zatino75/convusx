/**
 * Lazy-loaded view re-exports (C6 — Code Splitting)
 *
 * 큰 뷰 컴포넌트들을 React.lazy로 분리하여 초기 번들 크기 절감.
 * 각 뷰는 named export이므로 lazy wrapper에서 default로 변환.
 */
import { lazy } from "react";

export const SearchView = lazy(() =>
  import("./SearchView").then(m => ({ default: m.SearchView }))
);

export const DashboardView = lazy(() =>
  import("./DashboardView").then(m => ({ default: m.DashboardView }))
);

export const BenchmarkView = lazy(() =>
  import("./BenchmarkView").then(m => ({ default: m.BenchmarkView }))
);

export const ImageGalleryView = lazy(() =>
  import("./ImageGalleryView").then(m => ({ default: m.ImageGalleryView }))
);

export const SalesView = lazy(() =>
  import("./SalesView").then(m => ({ default: m.SalesView }))
);

export const WorkforceView = lazy(() =>
  import("./WorkforceView").then(m => ({ default: m.WorkforceView }))
);

export const StoreOpsView = lazy(() =>
  import("./StoreOpsView").then(m => ({ default: m.StoreOpsView }))
);

export const PosView = lazy(() =>
  import("./PosView").then(m => ({ default: m.PosView }))
);
