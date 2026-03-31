/**
 * ImSessionItem
 *
 * Renders a single IM session entry in the session panel list.
 * Shows session name, channel badge, chat type icon, last message preview,
 * relative time, and an active indicator when the session is generating.
 *
 * Supports an optional onClear callback to trigger session clearing
 * from a hover-revealed clear button.
 */

import { Trash2, User, Users } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chat.store'
import type { ImSessionRecord } from '../../../shared/types/im-channel'

interface ImSessionItemProps {
  session: ImSessionRecord
  isSelected: boolean
  onClick: () => void
  /** Called when the user clicks the clear button on this session */
  onClear?: (session: ImSessionRecord) => void
}

/** Channel identifier → display label */
const CHANNEL_LABELS: Record<string, string> = {
  'wecom-bot': 'WeCom',
  'feishu-bot': 'Feishu',
  'dingtalk-bot': 'DingTalk',
}

/** Format relative time from epoch ms */
function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function ImSessionItem({ session, isSelected, onClick, onClear }: ImSessionItemProps) {
  const { t } = useTranslation()

  // Build conversationId to check streaming state
  const conversationId = `app-chat:${session.appId}:${session.channel}:${session.chatType}:${session.chatId}`
  const isGenerating = useChatStore(s => s.getSession(conversationId).isGenerating)

  const displayName = session.customName || session.displayName || session.chatId
  const channelLabel = CHANNEL_LABELS[session.channel] ?? session.channel
  const chatTypeLabel = session.chatType === 'group' ? t('Group') : t('Direct')
  const ChatTypeIcon = session.chatType === 'group' ? Users : User

  return (
    <button
      onClick={onClick}
      className={`group w-full text-left px-3 py-2.5 transition-colors ${
        isSelected
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Active indicator */}
        {isGenerating && (
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          {/* Name */}
          <div className="text-sm font-medium truncate">{displayName}</div>

          {/* Channel + type */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <ChatTypeIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <span className="text-[11px] text-muted-foreground truncate">
              {channelLabel} · {chatTypeLabel}
            </span>
          </div>

          {/* Last message preview */}
          {session.lastMessage && (
            <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
              {session.lastSender ? `${session.lastSender}: ` : ''}{session.lastMessage}
            </p>
          )}
        </div>

        {/* Time + Clear button */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0 self-start mt-0.5">
          <span className="text-[10px] text-muted-foreground/50">
            {formatRelativeTime(session.lastActiveAt)}
          </span>
          {onClear && !isGenerating && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClear(session)
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-secondary transition-all"
              title={t('Clear session')}
            >
              <Trash2 className="w-3 h-3 text-muted-foreground/60 hover:text-destructive" />
            </button>
          )}
        </div>
      </div>
    </button>
  )
}
