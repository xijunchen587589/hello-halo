/**
 * InjectionAnnotation - Permanent annotation for mid-turn injected messages.
 *
 * Displayed at the bottom of an assistant message bubble when the user sent
 * supplementary messages during that response's generation. The injected
 * messages are persisted with `source: 'injection'` and filtered out of the
 * main message list — this component is their only visual representation.
 *
 * Styled consistently with QueuedMessagesPanel (streaming-time equivalent).
 */

import { useTranslation } from '../../i18n'
import type { Message } from '../../types'

interface InjectionAnnotationProps {
  messages: Message[]
}

export function InjectionAnnotation({ messages }: InjectionAnnotationProps) {
  const { t } = useTranslation()

  if (messages.length === 0) return null

  return (
    <div className="mt-1.5 rounded-lg border border-border/20 bg-muted/10 px-3 py-1.5">
      <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-muted-foreground/50 select-none uppercase tracking-wide">
        <span>{t('Appended')}</span>
      </div>
      <div className="space-y-0.5">
        {messages.map((msg) => (
          <div key={msg.id} className="flex items-start gap-1.5 text-xs text-muted-foreground/60">
            <span className="mt-px shrink-0 select-none">↳</span>
            <span className="break-words min-w-0">{msg.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
