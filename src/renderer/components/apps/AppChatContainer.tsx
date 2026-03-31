/**
 * AppChatContainer
 *
 * Orchestration container for the Chat tab of an automation App.
 * Manages the layout between the native Halo chat (AppChatView) and
 * IM session conversations (ImChatView), with a collapsible right-side
 * session panel (ImSessionPanel).
 *
 * Layout:
 * - Default: Full-width AppChatView (unchanged from before)
 * - Panel open: Left = conversation area, Right = session list panel
 * - IM session selected: Left shows ImChatView (read-only), no input area
 *
 * Responsive:
 * - Desktop (≥640px): Side-by-side split
 * - Mobile (<640px): Panel as full-screen overlay
 */

import { useEffect, useState, useCallback } from 'react'
import { PanelRight } from 'lucide-react'
import { useAppsPageStore } from '../../stores/apps-page.store'
import { useChatStore } from '../../stores/chat.store'
import { useTranslation } from '../../i18n'
import { AppChatView } from './AppChatView'
import { ImChatView } from './ImChatView'
import { ImSessionPanel } from './ImSessionPanel'
import type { ImSessionRecord } from '../../../shared/types/im-channel'

interface AppChatContainerProps {
  appId: string
  spaceId: string
}

export function AppChatContainer({ appId, spaceId }: AppChatContainerProps) {
  const { t } = useTranslation()
  const {
    imPanelOpen,
    selectedImSession,
    toggleImPanel,
    selectImSession,
  } = useAppsPageStore()

  // Reset IM session selection when switching apps
  useEffect(() => {
    selectImSession(null)
  }, [appId, selectImSession])

  // Check if any IM session is actively generating (for badge indicator)
  const hasActiveImSession = useImActiveIndicator(appId)

  // ── Clear key for ImChatView reload ──
  // Incremented when ImSessionPanel clears the currently viewed session,
  // triggering ImChatView to re-fetch messages (which will now be empty).
  const [imChatClearKey, setImChatClearKey] = useState(0)

  const handleSessionCleared = useCallback((clearedSession: ImSessionRecord) => {
    // If the cleared session is the one currently being viewed, trigger reload
    if (
      selectedImSession &&
      selectedImSession.channel === clearedSession.channel &&
      selectedImSession.chatId === clearedSession.chatId
    ) {
      setImChatClearKey(prev => prev + 1)
    }
  }, [selectedImSession])

  return (
    <div className="flex h-full">
      {/* Main conversation area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Toggle button bar */}
        <div className="flex items-center justify-end px-2 py-1 flex-shrink-0">
          <button
            onClick={toggleImPanel}
            className="relative p-1.5 rounded hover:bg-secondary transition-colors"
            title={t('Conversations')}
          >
            <PanelRight className="w-4 h-4 text-muted-foreground" />
            {/* Active badge when panel is closed and IM sessions are active */}
            {!imPanelOpen && hasActiveImSession && (
              <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-primary animate-pulse" />
            )}
          </button>
        </div>

        {/* Conversation content */}
        <div className="flex-1 overflow-hidden">
          {selectedImSession ? (
            <ImChatView
              appId={appId}
              spaceId={spaceId}
              session={selectedImSession}
              clearKey={imChatClearKey}
            />
          ) : (
            <AppChatView appId={appId} spaceId={spaceId} />
          )}
        </div>
      </div>

      {/* Right panel — session list */}
      {imPanelOpen && (
        <div className="
          fixed inset-0 z-50 bg-background
          sm:relative sm:inset-auto sm:z-auto sm:w-64 sm:border-l sm:border-border
        ">
          <ImSessionPanel
            appId={appId}
            spaceId={spaceId}
            onSessionCleared={handleSessionCleared}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Hook to check if any IM session for this app is actively generating.
 * Uses store sessions (shared with ImSessionPanel) and a proper Zustand
 * selector on chat.store sessions map so it re-renders reactively when
 * isGenerating changes — no polling needed for this check.
 */
function useImActiveIndicator(appId: string): boolean {
  const imSessions = useAppsPageStore(s => s.imSessions)

  // Build the set of conversationIds to watch
  const convIds = imSessions.map(
    s => `app-chat:${appId}:${s.channel}:${s.chatType}:${s.chatId}`
  )

  // Subscribe reactively to the sessions map in chat store.
  // The selector returns true if ANY of the convIds is generating.
  return useChatStore(state => {
    for (const id of convIds) {
      const session = state.sessions.get(id)
      if (session?.isGenerating) return true
    }
    return false
  })
}
