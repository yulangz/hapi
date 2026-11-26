import { useTranslation } from '@/lib/use-translation'

export function MainAgentBadge() {
    const { t } = useTranslation()
    return (
        <span className="shrink-0 rounded-full bg-[var(--app-chat-user-chip-bg)] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[var(--app-chat-user-chip-fg)]">
            {t('session.mainAgent')}
        </span>
    )
}
