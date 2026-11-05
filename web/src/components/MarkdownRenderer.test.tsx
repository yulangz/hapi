import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { MarkdownRenderer } from './MarkdownRenderer'

describe('MarkdownRenderer', () => {
    it('keeps the path and copy control visible for a labeled absolute file link', () => {
        const path = '/storage/openpsi/users/wanghaitao.wht/project/rsi/BCPlus/runs/20261105-35b-to-8b-middle-resumable/trajectories/630/transcript.json'
        render(<I18nProvider><MarkdownRenderer standalone content={`[完整交互 transcript.json](${path})`} /></I18nProvider>)
        expect(screen.getByText(path)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /copy path/i })).toBeInTheDocument()
    })
    afterEach(() => {
        cleanup()
    })

    it('renders fenced code blocks with the shared syntax highlighter shell in standalone mode', () => {
        render(
            <I18nProvider>
                <MarkdownRenderer standalone content={'```ts\nexport const ok = true\n```'} />
            </I18nProvider>
        )

        expect(document.querySelector('.aui-md-codeblock')).toBeTruthy()
    })

    it('renders inline code without the fenced-code shell in standalone mode', () => {
        render(
            <I18nProvider>
                <MarkdownRenderer standalone content={'Use `npm test` here.'} />
            </I18nProvider>
        )

        expect(document.querySelector('.aui-md-codeblock')).toBeFalsy()
        expect(document.querySelector('.aui-md-code')).toBeTruthy()
    })

    it('renders TeX bracket math in standalone mode', () => {
        const { container } = render(
            <I18nProvider>
                <MarkdownRenderer standalone content={String.raw`\[
E = mc^2
\]`} />
            </I18nProvider>
        )

        expect(container.querySelector('.katex-display')).toBeTruthy()
        expect(container.querySelector('.katex')).toBeTruthy()
        expect(container.textContent).not.toContain('\\[')
    })

    it('renders TeX bracket math through the assistant-ui path', () => {
        const { container } = render(
            <I18nProvider>
                <MarkdownRenderer content={String.raw`Result: \(x^2\)`} />
            </I18nProvider>
        )

        expect(container.querySelector('.katex')).toBeTruthy()
        expect(container.querySelector('.katex-display')).toBeFalsy()
    })
})
