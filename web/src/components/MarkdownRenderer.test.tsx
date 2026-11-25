import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { MarkdownRenderer } from './MarkdownRenderer'

describe('MarkdownRenderer', () => {
    it('keeps extensionless directory citations and copy controls inline', () => {
        const first = '/storage/openpsi/users/wanghaitao.wht/project/rsi/BCPlus/runs/20261105-eval-25'
        const second = `${first}-50/`
        render(<I18nProvider><MarkdownRenderer standalone content={`- [25% 评测目录](${first})\n- [50% 评测目录](${second})`} /></I18nProvider>)
        expect(screen.queryByText(first)).not.toBeInTheDocument()
        expect(screen.queryByText(second)).not.toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: /copy path/i })).toHaveLength(2)
        expect(screen.getByRole('button', { name: '25% 评测目录' })).toBeInTheDocument()
    })
    it.each([true, false])('renders labeled file citations inline (standalone: %s)', (standalone) => {
        const patch = '/storage/project/sglang_gdn_decode_padding.py'
        const server = '/storage/project/sglang_server.py'
        const content = `- 见[补丁实现](${patch})，继续检查。\n- 见[AReaL 启动入口](${server})。`
        render(<I18nProvider><MarkdownRenderer standalone={standalone} content={content} /></I18nProvider>)

        const [first, second] = screen.getAllByRole('listitem')
        expect(first.textContent).toBe('见补丁实现，继续检查。')
        expect(second.textContent).toBe('见AReaL 启动入口。')
        for (const [item, label] of [[first, '补丁实现'], [second, 'AReaL 启动入口']] as const) {
            const citation = within(item).getByRole('button', { name: label })
            expect(citation).toHaveClass('underline')
            expect(citation.nextElementSibling).toBe(within(item).getByRole('button', { name: /copy path/i }))
        }
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
