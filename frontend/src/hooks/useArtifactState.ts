import { useCallback, useState } from "react"

export type ArtifactItem = {
  id: string
  kind: string
  title?: string
  payload?: any
}

export function useArtifactState(initialArtifacts: ArtifactItem[] = []) {
  const [artifactList, setArtifactList] = useState<ArtifactItem[]>(initialArtifacts)
  const [activeArtifact, setActiveArtifact] = useState<ArtifactItem | null>(null)

  const openArtifact = useCallback((artifact: ArtifactItem) => {
    setActiveArtifact(artifact)
    setArtifactList((prev) => {
      const exists = prev.some((item) => item.id === artifact.id)
      return exists ? prev.map((item) => (item.id === artifact.id ? artifact : item)) : [...prev, artifact]
    })
  }, [])

  const revealArtifact = useCallback((id: string) => {
    setActiveArtifact((prev) => prev ?? artifactList.find((item) => item.id === id) ?? null)
  }, [artifactList])

  const closeArtifact = useCallback(() => {
    setActiveArtifact(null)
  }, [])

  return {
    artifactList,
    activeArtifact,
    setArtifactList,
    openArtifact,
    revealArtifact,
    closeArtifact,
  }
}
