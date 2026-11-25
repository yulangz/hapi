import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getToolPresentation } from '../knownTools'
import { CodexPatchView } from './CodexPatchView'
import type { ToolViewProps } from './_all'

vi.mock('@/components/CodeBlock', () => ({ CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre> }))

function show(input: unknown) {
    const block = { tool: { input } } as ToolViewProps['block']
    render(<CodexPatchView block={block} metadata={null} surface="dialog" />)
    return getToolPresentation({ toolName: 'CodexPatch', input, result: null, childrenCount: 0, description: null, metadata: null })
}

describe('Codex file changes', () => {
    it('shows native files and complete per-file patches, including a rename and an added file', () => {
        const diff = '@@ -1 +1 @@\n-old\n+new'
        const result = show({ changes: [
            { path: 'docs/task-tracker.md', kind: { type: 'update', movePath: 'docs/tasks.md' }, diff },
            { path: 'docs/new.md', kind: { type: 'add' }, diff: 'new file contents' },
        ] })
        expect(result.subtitle).toBe('task-tracker.md (+1)')
        expect(screen.getByText('docs/task-tracker.md → docs/tasks.md')).toBeTruthy()
        expect(screen.getByText(/@@ -1/).textContent).toBe(diff)
        expect(screen.getByText('new file contents')).toBeTruthy()
    })
    it('displays the original patch once for legacy path-keyed metadata', () => {
        const result = show({ changes: { 'a.md': { kind: 'update' }, 'b.md': { kind: 'add' } }, patch: '*** Begin Patch' })
        expect(result.subtitle).toBe('a.md (+1)')
        expect(screen.getAllByText('*** Begin Patch')).toHaveLength(1)
    })
})
