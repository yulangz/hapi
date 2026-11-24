import { isObject } from '@hamlet/protocol'
import { CodeBlock } from '@/components/CodeBlock'
import { codexPatchFiles } from '@/components/ToolCard/codexPatch'
import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import { resolveDisplayPath } from '@/utils/path'

export function CodexPatchView(props: ToolViewProps) {
    const input = props.block.tool.input
    const files = codexPatchFiles(input)
    const patch = isObject(input) && typeof input.patch === 'string' ? input.patch : undefined

    return (
        <div className="flex min-w-0 flex-col gap-3">
            {files.map((file, index) => (
                <section key={index} className="min-w-0 space-y-1">
                    <div className="break-all font-mono text-sm text-[var(--app-fg)]">
                        {resolveDisplayPath(file.path, props.metadata)}
                        {file.to && <> → {resolveDisplayPath(file.to, props.metadata)}</>}
                    </div>
                    {file.body && <CodeBlock code={file.body} language={file.kind === 'add' || file.kind === 'delete' ? undefined : 'diff'} title={file.kind} />}
                </section>
            ))}
            {patch && (!files.length || files.some(file => file.body === undefined)) && <CodeBlock code={patch} language="diff" />}
        </div>
    )
}
