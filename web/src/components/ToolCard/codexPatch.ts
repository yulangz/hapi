import { isObject } from '@hamlet/protocol'

type FileChange = { path: string; to?: string; kind?: string; body?: string }

export function codexPatchFiles(input: unknown): FileChange[] {
    if (!isObject(input) || !isObject(input.changes)) return []
    const changes = input.changes
    const entries: [string, unknown][] = Array.isArray(changes)
        ? changes.flatMap((item): [string, unknown][] => isObject(item) && typeof item.path === 'string' ? [[item.path, item]] : [])
        : Object.entries(changes)

    return entries.map(([path, value]) => {
        if (!isObject(value)) return { path }
        const kind = isObject(value.kind) ? value.kind.type : value.kind ?? value.type
        const move = isObject(value.kind) ? value.kind.move_path ?? value.kind.movePath : value.move_path ?? value.movePath
        const body = value.diff ?? value.unified_diff ?? value.content
        return { path, kind: typeof kind === 'string' ? kind : undefined, to: typeof move === 'string' ? move : undefined,
            body: typeof body === 'string' ? body : undefined }
    })
}
