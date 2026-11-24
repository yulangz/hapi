import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MACHINE_DISPLAY_NAME_MAX_LENGTH } from '@hamlet/protocol'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { getHubAccessToken } from '@/hooks/useAuthSource'
import { downloadBlobFile } from '@/lib/sessionExport/download'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useMachines } from '@/hooks/queries/useMachines'
import { getMachineTitle } from '@/hooks/useMachineLabels'
import { queryKeys } from '@/lib/query-keys'
import { SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'

function MachineRow(props: { api: ApiClient | null; machine: Machine }) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const [error, setError] = useState<string | null>(null)
    const savingRef = useRef(false)

    const label = getMachineTitle(props.machine)
    const host = props.machine.metadata?.host
    const platform = props.machine.metadata?.platform
    const subtitle = [host, platform].filter(Boolean).join(' · ')

    const renameMutation = useMutation({
        mutationFn: async (displayName: string) => {
            if (!props.api) {
                throw new Error('API unavailable')
            }
            await props.api.renameMachine(props.machine.id, displayName)
        },
        onSuccess: () => {
            setEditing(false)
            setError(null)
            void queryClient.invalidateQueries({ queryKey: queryKeys.machines })
        },
        onError: () => setError(t('settings.machines.error')),
    })

    function startEditing() {
        setDraft(props.machine.metadata?.displayName ?? '')
        setError(null)
        setEditing(true)
    }

    function save() {
        // Disabling the focused input on submit forces a blur, so `save` is
        // reached twice for a single Enter. A ref (not `isPending`, which is a
        // render-timing-dependent closure value) keeps that to one request.
        if (savingRef.current) {
            return
        }
        const next = draft.trim()
        if (next === (props.machine.metadata?.displayName ?? '')) {
            setEditing(false)
            return
        }
        savingRef.current = true
        renameMutation.mutate(next, {
            onSettled: () => {
                savingRef.current = false
            },
        })
    }

    return (
        <div className="px-3 py-3">
            <div className="flex min-h-9 items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                    {editing ? (
                        <input
                            autoFocus
                            value={draft}
                            maxLength={MACHINE_DISPLAY_NAME_MAX_LENGTH}
                            disabled={renameMutation.isPending}
                            placeholder={host ?? t('settings.machines.namePlaceholder')}
                            aria-label={t('settings.machines.rename', { name: label })}
                            onChange={(event) => setDraft(event.target.value)}
                            onBlur={save}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    save()
                                } else if (event.key === 'Escape') {
                                    event.preventDefault()
                                    setEditing(false)
                                    setError(null)
                                }
                            }}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)] disabled:opacity-60"
                        />
                    ) : (
                        <button
                            type="button"
                            onClick={startEditing}
                            aria-label={t('settings.machines.rename', { name: label })}
                            className="block w-full truncate text-left text-sm font-medium text-[var(--app-fg)] hover:text-[var(--app-link)]"
                        >
                            {label}
                        </button>
                    )}
                    {subtitle ? (
                        <div className="mt-0.5 truncate text-xs leading-snug text-[var(--app-hint)]">{subtitle}</div>
                    ) : null}
                </div>
            </div>
            {error ? <div role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</div> : null}
        </div>
    )
}

function RunnerInstall() {
    const { api, baseUrl, token } = useAppContext()
    const [failedDownload, setFailedDownload] = useState(false)
    const { t } = useTranslation()
    const { copy, copied } = useCopyToClipboard()
    const tokenCopy = useCopyToClipboard()
    const accessToken = getHubAccessToken(baseUrl)
    const { data } = useQuery({
        queryKey: ['runner-install', baseUrl],
        queryFn: () => api.getRunnerInstall(),
    })
    const current = new URL(baseUrl || window.location.origin)
    const configured = data?.hubUrl ? new URL(data.hubUrl) : current
    const isLocal = (url: URL) => ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    const hub = !isLocal(configured) ? configured : current
    const lan = hub.protocol === 'http:' && !isLocal(hub)
    const path = current.origin + '/runner/'
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
    const setup = [
        'set -eo pipefail',
        'IFS= read -rs -p "Hub token: " CLI_API_TOKEN </dev/tty',
        'echo >&2',
        'export CLI_API_TOKEN',
        'printf "Authorization: Bearer %s\\n" "$CLI_API_TOKEN" | curl -fsS -H @- "$1/runner/install.py" | python3 - --hub "$1"' + (lan ? ' --allow-http' : ''),
    ].join('; ')
    const command = 'bash -c ' + quote(setup) + ' _ ' + quote(hub.origin)
    async function download(event: React.MouseEvent<HTMLAnchorElement>) {
        event.preventDefault()
        const { href, download: filename } = event.currentTarget
        setFailedDownload(false)
        try {
            const response = await fetch(href, { headers: { Authorization: 'Bearer ' + token }, redirect: 'error' })
            if (!response.ok) throw new Error(String(response.status))
            downloadBlobFile(filename, await response.blob())
        } catch {
            setFailedDownload(true)
        }
    }
    return (
        <SettingsSection title={t('settings.machines.install')} description={t('settings.machines.installHint')}>
            <div className="space-y-3 px-3 py-3">
                {(lan || isLocal(hub)) && <p className="text-sm text-[var(--app-hint)]">{t(lan ? 'settings.machines.lan' : 'settings.machines.httpsNeeded')}</p>}
                    <code className="block select-all break-all rounded bg-[var(--app-subtle-bg)] p-2 text-xs">{command}</code>
                    <button type="button" className="text-sm text-[var(--app-link)]" onClick={() => void copy(command)}>
                        {t(copied ? 'settings.machines.copied' : 'settings.machines.copyInstall')}
                    </button>
                {failedDownload && <p role="alert" className="text-sm text-red-600">{t('settings.machines.downloadError')}</p>}
                {accessToken && <button type="button" className="block text-sm text-[var(--app-link)]" onClick={() => void tokenCopy.copy(accessToken)}>
                    {t(tokenCopy.copied ? 'settings.machines.copied' : 'settings.machines.copyToken')}
                </button>}
                <a className="block text-sm text-[var(--app-link)]" href={path + 'install.py'} download="install.py" onClick={download}>{t('settings.machines.script')}</a>
            </div>
            <div className="grid grid-cols-2 gap-2 px-3 py-3 text-sm text-[var(--app-link)]">
                {(['darwin', 'linux'] as const).flatMap(os => (['arm64', 'x64'] as const).map(arch =>
                    <a key={os + arch} href={path + 'hamlet-runner-' + os + '-' + arch + '.gz'} download={'hamlet-runner-' + os + '-' + arch + '.gz'} onClick={download}>
                        {os === 'darwin' ? 'macOS' : 'Linux'} · {arch === 'arm64' ? 'ARM64' : 'x64'}
                    </a>
                ))}
            </div>
        </SettingsSection>
    )
}

export default function SettingsMachinesPage() {
    const { t } = useTranslation()
    const { api } = useAppContext()
    const { machines } = useMachines(api, true)

    return (
        <SettingsPageContent description={t('settings.machines.description')}>
            <RunnerInstall />
            <SettingsSection title={t('settings.machines.section')}>
                {machines.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-[var(--app-hint)]">{t('settings.machines.empty')}</div>
                ) : (
                    machines.map((machine) => (
                        <MachineRow key={machine.id} api={api} machine={machine} />
                    ))
                )}
            </SettingsSection>
        </SettingsPageContent>
    )
}
