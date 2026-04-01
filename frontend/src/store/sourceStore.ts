export type SourceAsset = {
  id: string;
  projectId: string;
  type: "file" | "image" | "link" | "note" | "thread_summary";
  title?: string;
  content?: string;
  url?: string;
  status: "draft" | "confirmed";
  createdAt: number;
  updatedAt: number;
};

type SourceState = {
  assets: SourceAsset[];
};

const state: SourceState = {
  assets: []
};

const API_BASE = "http://localhost:8000";

function normalizeText(value: string): string {
  return String(value ?? "").trim();
}

function sortAssets(list: SourceAsset[]): SourceAsset[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "confirmed" ? -1 : 1;
    }

    return Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0);
  });
}

function normalizeAsset(asset: Partial<SourceAsset>): SourceAsset {
  return {
    id: normalizeText(String(asset?.id ?? crypto.randomUUID())),
    projectId: normalizeText(String(asset?.projectId ?? "")),
    type: (asset?.type ?? "note") as SourceAsset["type"],
    title: normalizeText(String(asset?.title ?? "")) || undefined,
    content: normalizeText(String(asset?.content ?? "")) || undefined,
    url: normalizeText(String(asset?.url ?? "")) || undefined,
    status: (asset?.status ?? "draft") as SourceAsset["status"],
    createdAt: Number(asset?.createdAt ?? Date.now()),
    updatedAt: Number(asset?.updatedAt ?? Date.now())
  };
}

function upsertLocalAsset(asset: SourceAsset) {
  const index = state.assets.findIndex((item) => item.id === asset.id);

  if (index === -1) {
    state.assets.push(asset);
    return;
  }

  state.assets[index] = asset;
}

function replaceProjectAssets(projectId: string, nextAssets: SourceAsset[]) {
  state.assets = state.assets.filter((asset) => asset.projectId !== projectId);
  state.assets.push(...nextAssets);
}

export function addAsset(asset: SourceAsset) {
  upsertLocalAsset(normalizeAsset(asset));
}

export function updateAsset(id: string, patch: Partial<SourceAsset>) {
  const index = state.assets.findIndex((a) => a.id === id);
  if (index === -1) return;

  state.assets[index] = normalizeAsset({
    ...state.assets[index],
    ...patch,
    updatedAt: Date.now()
  });
}

export function removeAsset(id: string) {
  state.assets = state.assets.filter((a) => a.id !== id);
}

export function getAssetsByProject(projectId: string): SourceAsset[] {
  return sortAssets(
    state.assets.filter((a) => a.projectId === projectId)
  );
}

export function getConfirmedAssets(projectId: string): SourceAsset[] {
  return getAssetsByProject(projectId).filter((a) => a.status === "confirmed");
}

export async function fetchProjectAssets(projectId: string): Promise<SourceAsset[]> {
  const safeProjectId = normalizeText(projectId);
  if (!safeProjectId) return [];

  const url = new URL("/api/project-sources", API_BASE);
  url.searchParams.set("projectId", safeProjectId);

  const response = await fetch(url.toString(), {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error("failed_to_fetch_project_sources");
  }

  const payload = await response.json();
  const assets = Array.isArray(payload?.data) ? payload.data : [];
  const normalizedAssets = assets
    .map((asset: any) =>
      normalizeAsset({
        id: asset?.id,
        projectId: safeProjectId,
        type: asset?.type,
        title: asset?.title,
        content: asset?.content,
        url: asset?.url,
        status: asset?.status,
        createdAt: asset?.created_at ?? asset?.createdAt,
        updatedAt: asset?.updated_at ?? asset?.updatedAt
      })
    )
    .filter((asset: SourceAsset) => asset.projectId.length > 0);

  replaceProjectAssets(safeProjectId, normalizedAssets);
  return getAssetsByProject(safeProjectId);
}

export async function persistAsset(projectId: string, asset: SourceAsset): Promise<void> {
  const safeProjectId = normalizeText(projectId);
  if (!safeProjectId) {
    throw new Error("invalid_project_id");
  }

  const normalized = normalizeAsset({
    ...asset,
    projectId: safeProjectId
  });

  const response = await fetch(`${API_BASE}/api/project-sources`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      projectId: safeProjectId,
      asset: {
        id: normalized.id,
        type: normalized.type,
        title: normalized.title,
        content: normalized.content,
        url: normalized.url,
        status: normalized.status,
        created_at: normalized.createdAt,
        updated_at: normalized.updatedAt
      }
    })
  });

  if (!response.ok) {
    throw new Error("failed_to_persist_project_source");
  }

  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(String(payload?.error ?? "failed_to_persist_project_source"));
  }

  upsertLocalAsset(normalized);
}

export async function deleteAssetFromServer(projectId: string, assetId: string): Promise<void> {
  const url = new URL(`/api/project-sources/${assetId}`, API_BASE);
  url.searchParams.set("projectId", projectId);
  await fetch(url.toString(), { method: "DELETE" }).catch(() => {});
}

export async function patchAssetOnServer(projectId: string, assetId: string, patch: Partial<SourceAsset>): Promise<void> {
  await fetch(`${API_BASE}/api/project-sources/${assetId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, ...patch })
  }).catch(() => {});
}

export async function refreshProjectAssets(projectId: string): Promise<SourceAsset[]> {
  return fetchProjectAssets(projectId);
}
