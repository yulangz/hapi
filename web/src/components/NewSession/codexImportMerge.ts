export function resolveCodexImportRedirectSessionId(
    merged: ReadonlyArray<{ canonicalSessionId?: string | null }>,
    importedHamletSessionIds: readonly string[]
): string | null {
    return merged.find((group) => Boolean(group.canonicalSessionId))?.canonicalSessionId
        ?? importedHamletSessionIds[0]
        ?? null
}

export function clearBatchImportedCodexSelection(
    selectedSessionId: string | null,
    importedSessionIds: string[]
): string | null {
    return selectedSessionId && importedSessionIds.includes(selectedSessionId) ? null : selectedSessionId
}
