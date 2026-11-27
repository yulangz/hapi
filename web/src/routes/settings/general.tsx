import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { CompanionPairing } from '@/components/settings/CompanionPairing'
import { SettingsChoiceGroup, SettingsPageContent, SettingsRow, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsPrimitives'
import { getNamespace } from '@/lib/tokenNamespace'
import { queryKeys } from '@/lib/query-keys'

const locales: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
]

export default function SettingsGeneralPage() {
    const { t, locale, setLocale } = useTranslation()
    const { api, baseUrl, token, browserNotifications } = useAppContext()
    const [notificationPending, setNotificationPending] = useState(false)
    const [notificationFailed, setNotificationFailed] = useState(false)
    const queryClient = useQueryClient()
    const isOwner = getNamespace(token) === 'default'

    const hubSettingsQuery = useQuery({
        queryKey: queryKeys.hubSettings,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getHubSettings()
        },
        enabled: Boolean(api) && isOwner,
        staleTime: 30_000,
        retry: false,
    })

    const hubSettingsMutation = useMutation({
        mutationFn: async (patch: { sessionSummaryContract?: boolean; sessionSummaryInChat?: boolean }) => {
            if (!api) throw new Error('API unavailable')
            return await api.updateHubSettings(patch)
        },
        onSuccess: (data) => {
            queryClient.setQueryData(queryKeys.hubSettings, data)
        },
    })

    return (
        <SettingsPageContent description={t('settings.general.description')}>
            <SettingsSection title={t('settings.language.label')}>
                <SettingsChoiceGroup hideLabel label={t('settings.language.label')} value={locale} options={locales} onChange={setLocale} />
            </SettingsSection>
            {browserNotifications ? (
                <SettingsSection title={t('settings.general.browserNotifications')}>
                    <SettingsRow
                        label={t('settings.general.browserNotifications.mainAgent')}
                        description={browserNotifications.permission === 'denied'
                            ? t('settings.general.browserNotifications.denied')
                            : t('settings.general.browserNotifications.description')}
                        trailing={browserNotifications.isSubscribed ? (
                            <span className="text-sm text-[var(--app-badge-success-text)]">{t('settings.general.browserNotifications.enabled')}</span>
                        ) : browserNotifications.permission !== 'denied' ? (
                            <button
                                type="button"
                                disabled={notificationPending}
                                className="rounded-md bg-[var(--app-button)] px-3 py-1.5 text-sm text-[var(--app-button-text)] disabled:opacity-50"
                                onClick={async () => {
                                    setNotificationPending(true)
                                    try {
                                        setNotificationFailed(!await browserNotifications.enable())
                                    } catch {
                                        setNotificationFailed(true)
                                    } finally {
                                        setNotificationPending(false)
                                    }
                                }}
                            >
                                {notificationPending ? t('loading') : t('settings.general.browserNotifications.enable')}
                            </button>
                        ) : undefined}
                    />
                    {notificationFailed && !browserNotifications.isSubscribed && browserNotifications.permission !== 'denied' ? (
                        <p role="status" className="px-3 pb-3 text-xs text-[var(--app-hint)]">{t('settings.general.browserNotifications.failed')}</p>
                    ) : null}
                </SettingsSection>
            ) : null}
            {isOwner ? (
                <SettingsSection
                    title={t('settings.general.sessionSummary.title')}
                    description={t('settings.general.sessionSummary.description')}
                >
                    {hubSettingsQuery.data ? (
                        <>
                            <SettingsSwitch
                                label={t('settings.general.sessionSummaryContract')}
                                description={t('settings.general.sessionSummaryContract.desc')}
                                checked={hubSettingsQuery.data.sessionSummaryContract}
                                onChange={(checked) => {
                                    if (hubSettingsMutation.isPending) return
                                    hubSettingsMutation.mutate({ sessionSummaryContract: checked })
                                }}
                            />
                            <SettingsSwitch
                                label={t('settings.general.sessionSummaryInChat')}
                                description={t('settings.general.sessionSummaryInChat.desc')}
                                checked={hubSettingsQuery.data.sessionSummaryInChat}
                                onChange={(checked) => {
                                    if (hubSettingsMutation.isPending) return
                                    hubSettingsMutation.mutate({ sessionSummaryInChat: checked })
                                }}
                            />
                        </>
                    ) : null}
                </SettingsSection>
            ) : null}
            <SettingsSection title={t('settings.companion.title')}>
                <div className="px-3 py-3">
                    <CompanionPairing baseUrl={baseUrl} />
                </div>
            </SettingsSection>
        </SettingsPageContent>
    )
}
