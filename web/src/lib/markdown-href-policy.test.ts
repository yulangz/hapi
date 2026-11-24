import { describe, expect, it } from 'vitest'
import {
    classifyNoSchemeHref,
    expandTildePath,
    isKnownSpaHref,
    splitHrefMeta,
} from '@/lib/markdown-href-policy'

describe('splitHrefMeta', () => {
    it('strips #fragment for file targets', () => {
        expect(splitHrefMeta('docs/foo.md#section')).toEqual({
            path: 'docs/foo.md',
            suffix: '#section',
        })
    })

    it('strips query before fragment when both present', () => {
        expect(splitHrefMeta('docs/foo.md?x=1#y')).toEqual({
            path: 'docs/foo.md',
            suffix: '?x=1#y',
        })
    })
})

describe('isKnownSpaHref', () => {
    it.each([
        '/settings',
        '/settings/general',
        '/sessions',
        '/sessions/abc-def',
        '/sessions/abc/file',
        '/sessions/abc/files',
        '/sessions/abc/terminal',
        '/browse',
        '/share',
        '#section',
        '?q=1',
        '/',
    ])('treats %s as SPA', (href) => {
        expect(isKnownSpaHref(href)).toBe(true)
    })

    it.each([
        '/home/user/proj/docs/a.md',
        '~/proj/docs/a.md',
        'docs/foo.md',
        './foo',
        '../escape.md',
        '//example.com/path',
        '/settings/typo',
        '/browse/extra',
        '/sessions/id/unknown',
        '/share/extra',
    ])('does not treat %s as SPA', (href) => {
        expect(isKnownSpaHref(href)).toBe(false)
    })

    it('strips Vite BASE_URL prefix before SPA allowlist checks', () => {
        expect(isKnownSpaHref('/hamlet/settings', { baseUrl: '/hamlet/' })).toBe(true)
        expect(isKnownSpaHref('/hamlet/sessions/abc/file', { baseUrl: '/hamlet/' })).toBe(true)
        expect(isKnownSpaHref('/hamlet/settings/typo', { baseUrl: '/hamlet/' })).toBe(false)
    })
})

describe('expandTildePath', () => {
    it('expands ~/ against /home/<user> workspace', () => {
        expect(expandTildePath('~/coding/hamlet/docs/a.md', '/home/ada/coding/hamlet')).toBe(
            '/home/ada/coding/hamlet/docs/a.md'
        )
    })

    it('expands ~/ against /root workspaces', () => {
        expect(expandTildePath('~/hamlet/docs/a.md', '/root/hamlet')).toBe('/root/hamlet/docs/a.md')
    })

    it('returns null without workspace metadata', () => {
        expect(expandTildePath('~/docs/a.md', null)).toBeNull()
    })
})

describe('classifyNoSchemeHref — fail-closed (#1452)', () => {
    const workspace = '/home/ada/coding/hamlet'

    it('keeps allowlisted relative file targets as file preview', () => {
        expect(classifyNoSchemeHref('docs/foo.md')).toEqual({
            action: 'file',
            path: 'docs/foo.md',
        })
    })

    it('opens ./prefixed allowlisted files in preview', () => {
        expect(classifyNoSchemeHref('./diagram.mmd')).toEqual({
            action: 'file',
            path: './diagram.mmd',
        })
    })

    it('strips #fragment and still opens allowlisted relative files', () => {
        expect(classifyNoSchemeHref('docs/foo.md#section')).toEqual({
            action: 'file',
            path: 'docs/foo.md',
        })
    })

    it('routes in-workspace absolute paths to file preview', () => {
        expect(classifyNoSchemeHref('/home/ada/coding/hamlet/docs/a.md', { workspacePath: workspace })).toEqual({
            action: 'file',
            path: '/home/ada/coding/hamlet/docs/a.md',
        })
    })

    it('expands in-workspace ~/ paths to absolute file preview targets', () => {
        expect(classifyNoSchemeHref('~/coding/hamlet/docs/a.md', { workspacePath: workspace })).toEqual({
            action: 'file',
            path: '/home/ada/coding/hamlet/docs/a.md',
        })
    })

    it('expands ~/ for root-owned workspaces', () => {
        expect(
            classifyNoSchemeHref('~/hamlet/docs/a.md', { workspacePath: '/root/hamlet' })
        ).toEqual({
            action: 'file',
            path: '/root/hamlet/docs/a.md',
        })
    })

    it('decodes percent-encoded spaces before workspace containment', () => {
        const workspace = '/home/ada/My Project'
        expect(
            classifyNoSchemeHref('/home/ada/My%20Project/docs/a.md', {
                workspacePath: workspace,
            })
        ).toEqual({
            action: 'file',
            path: '/home/ada/My Project/docs/a.md',
        })
        expect(
            classifyNoSchemeHref('~/My%20Project/docs/a.md', {
                workspacePath: workspace,
            })
        ).toEqual({
            action: 'file',
            path: '/home/ada/My Project/docs/a.md',
        })
    })

    it('renders absolute paths outside the workspace as inert', () => {
        expect(classifyNoSchemeHref('/etc/passwd.sh', { workspacePath: workspace })).toEqual({
            action: 'inert',
        })
    })

    it('does not treat Windows absolute paths as repo-relative (containment required)', () => {
        expect(classifyNoSchemeHref('D:\\outside\\secret.ts')).toEqual({ action: 'inert' })
        expect(classifyNoSchemeHref('D:/outside/secret.ts#L1')).toEqual({ action: 'inert' })
    })

    it('routes in-workspace Windows absolute paths to file preview', () => {
        const winWorkspace = 'C:\\Users\\ada\\coding\\hamlet'
        expect(
            classifyNoSchemeHref('C:\\Users\\ada\\coding\\hamlet\\docs\\a.md', {
                workspacePath: winWorkspace,
            })
        ).toEqual({
            action: 'file',
            path: 'C:\\Users\\ada\\coding\\hamlet\\docs\\a.md',
        })
    })

    it('compares Windows workspace containment case-insensitively', () => {
        expect(
            classifyNoSchemeHref('c:\\users\\ada\\coding\\hamlet\\docs\\a.md', {
                workspacePath: 'C:\\Users\\Ada\\coding\\hamlet',
            })
        ).toEqual({
            action: 'file',
            path: 'c:\\users\\ada\\coding\\hamlet\\docs\\a.md',
        })
    })

    it('renders absolute paths without workspace metadata as inert (fail closed)', () => {
        expect(classifyNoSchemeHref('/home/ada/coding/hamlet/docs/a.md')).toEqual({ action: 'inert' })
    })

    it('rejects tilde paths that lexically escape the workspace via ..', () => {
        expect(classifyNoSchemeHref('~/coding/hamlet/../secret.ts', { workspacePath: workspace })).toEqual({
            action: 'inert',
        })
    })

    it('treats nonexistent SPA children as inert, not navigate', () => {
        expect(classifyNoSchemeHref('/settings/typo')).toEqual({ action: 'inert' })
        expect(classifyNoSchemeHref('/browse/extra')).toEqual({ action: 'inert' })
        expect(classifyNoSchemeHref('/sessions/id/unknown')).toEqual({ action: 'inert' })
    })

    it('renders unresolvable ~/ without workspace as inert (never SPA)', () => {
        expect(classifyNoSchemeHref('~/coding/hamlet/docs/a.md')).toEqual({ action: 'inert' })
    })

    it('renders no-extension path-like hrefs as inert', () => {
        expect(classifyNoSchemeHref('docs/foo')).toEqual({ action: 'inert' })
        expect(classifyNoSchemeHref('README')).toEqual({ action: 'inert' })
        expect(classifyNoSchemeHref('./relative-route')).toEqual({ action: 'inert' })
    })

    it('renders parent-relative escape attempts as inert', () => {
        expect(classifyNoSchemeHref('../escape.md')).toEqual({ action: 'inert' })
    })

    it('keeps real app routes navigable', () => {
        expect(classifyNoSchemeHref('/settings')).toEqual({ action: 'navigate' })
        expect(classifyNoSchemeHref('/settings/general')).toEqual({ action: 'navigate' })
        expect(classifyNoSchemeHref('#section')).toEqual({ action: 'navigate' })
        expect(classifyNoSchemeHref('?q=1')).toEqual({ action: 'navigate' })
    })

    it('keeps protocol-relative URLs navigable', () => {
        expect(classifyNoSchemeHref('//example.com/path')).toEqual({ action: 'navigate' })
    })

    it('never classifies /home/... absolute file hrefs as SPA navigate', () => {
        const decision = classifyNoSchemeHref('/home/ada/coding/hamlet/docs/a.md', {
            workspacePath: workspace,
        })
        expect(decision.action).not.toBe('navigate')
        expect(decision).toEqual({
            action: 'file',
            path: '/home/ada/coding/hamlet/docs/a.md',
        })
    })
})
