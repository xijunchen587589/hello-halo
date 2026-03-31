/**
 * AppChatView
 *
 * Interactive chat view for automation Apps (digital humans).
 * Allows users to chat with an App's AI agent in real-time,
 * reusing the same streaming infrastructure as the main Agent chat.
 *
 * Architecture:
 * - Uses the virtual conversationId "app-chat:{appId}" for event routing
 * - The existing agent event listeners in App.tsx are GLOBAL — they dispatch
 *   to chat.store.ts sessions by conversationId. App chat events automatically
 *   flow to sessions.get("app-chat:{appId}") without any extra wiring.
 * - Persisted messages loaded from JSONL via app:chat-messages IPC
 * - Reuses atomic UI components from main chat (StreamingBubble, BrowserTaskCard,
 *   AskUserQuestionCard, ThoughtProcess, etc.) for feature parity.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Loader2, AlertCircle, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { useChatStore } from '../../stores/chat.store'
import { MessageItem } from '../chat/MessageItem'
import { CollapsedThoughtProcess } from '../chat/CollapsedThoughtProcess'
import { ThoughtProcess } from '../chat/ThoughtProcess'
import { StreamingBubble } from '../chat/StreamingBubble'
import { BrowserTaskCard, isBrowserTool } from '../tool/BrowserTaskCard'
import { AskUserQuestionCard } from '../chat/AskUserQuestionCard'
import { InterruptedBubble } from '../chat/InterruptedBubble'
import { CompactNotice } from '../chat/CompactNotice'
import { InputArea } from '../chat/InputArea'
import { useTranslation } from '../../i18n'
import type { Message, Thought, ImageAttachment } from '../../types'

interface AppChatViewProps {
  /** App ID */
  appId: string
  /** Space ID (for loading messages and sending chat) */
  spaceId: string
}

/**
 * Build the virtual conversationId for app chat.
 * Must match the backend's getAppChatConversationId().
 */
function getConversationId(appId: string): string {
  return `app-chat:${appId}`
}

type LoadState = 'loading' | 'loaded' | 'error' | 'empty'

export function AppChatView({ appId, spaceId }: AppChatViewProps) {
  const { t } = useTranslation()
  const conversationId = getConversationId(appId)

  // ── Persisted messages ──
  const [messages, setMessages] = useState<Message[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── Streaming state from chat store (uses virtual conversationId) ──
  const session = useChatStore(s => s.getSession(conversationId))
  const resetSession = useChatStore(s => s.resetSession)
  const answerQuestion = useChatStore(s => s.answerQuestion)
  const {
    isGenerating,
    streamingContent,
    isStreaming,
    thoughts,
    isThinking,
    pendingQuestion,
    error,
    errorType,
    compactInfo,
    textBlockVersion,
  } = session

  // ── Extract browser tool calls from streaming thoughts (same as MessageList) ──
  const streamingBrowserToolCalls = useMemo(() => {
    return thoughts
      .filter(t => t.type === 'tool_use' && t.toolName && isBrowserTool(t.toolName))
      .map(t => ({
        id: t.id,
        name: t.toolName!,
        // Determine status from merged toolResult (set by backend via agent:thought-delta)
        status: t.toolResult
          ? (t.toolResult.isError ? 'error' as const : 'success' as const)
          : 'running' as const,
        input: t.toolInput || {},
      }))
  }, [thoughts])

  // ── Load persisted chat messages on mount ──
  useEffect(() => {
    let cancelled = false

    async function loadMessages() {
      setLoadState('loading')
      setErrorMsg(null)
      try {
        const res = await api.appChatMessages(appId, spaceId)
        if (cancelled) return

        if (res.success && res.data) {
          const msgs = (res.data as Message[]) ?? []
          setMessages(msgs)
          setLoadState(msgs.length > 0 ? 'loaded' : 'empty')
        } else {
          setLoadState('empty')
        }
      } catch (err) {
        if (cancelled) return
        console.error('[AppChatView] Failed to load messages:', err)
        setErrorMsg(String(err))
        setLoadState('error')
      }
    }

    loadMessages()
    return () => { cancelled = true }
  }, [appId, spaceId])

  // ── Reload messages when generation completes ──
  // This ensures the persisted messages include the latest assistant response
  const prevIsGeneratingRef = useRef(isGenerating)
  useEffect(() => {
    if (prevIsGeneratingRef.current && !isGenerating) {
      // Generation just completed — reload messages from JSONL
      api.appChatMessages(appId, spaceId).then(res => {
        if (res.success && res.data) {
          const msgs = (res.data as Message[]) ?? []
          setMessages(msgs)
          setLoadState(msgs.length > 0 ? 'loaded' : 'empty')
        }
      }).catch(err => {
        console.error('[AppChatView] Failed to reload messages after completion:', err)
      })
    }
    prevIsGeneratingRef.current = isGenerating
  }, [isGenerating, appId, spaceId])

  // ── Auto-scroll to bottom when streaming ──
  useEffect(() => {
    if (isStreaming || isThinking) {
      const el = scrollRef.current
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      }
    }
  }, [streamingContent, thoughts.length, isStreaming, isThinking, pendingQuestion])

  // ── Clear chat (with confirmation) ──
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const handleClearChat = useCallback(async () => {
    try {
      const res = await api.appChatClear(appId, spaceId)
      if (res.success) {
        setMessages([])
        setLoadState('empty')
        // Reset session state to clear stale thoughts/streaming content
        resetSession(conversationId)
      }
    } catch (err) {
      console.error('[AppChatView] Clear chat error:', err)
    } finally {
      setShowClearConfirm(false)
    }
  }, [appId, spaceId, conversationId, resetSession])

  // ── Send message ──
  const handleSend = useCallback(async (content: string, images?: ImageAttachment[], thinkingEnabled?: boolean) => {
    // Reset session state before sending to clear any stale thoughts/content
    // from a previous conversation (mirrors normal chat's sendMessage behavior)
    resetSession(conversationId)

    try {
      // Map ImageAttachment[] to API format { type, media_type, data }
      const apiImages = images && images.length > 0
        ? images.map(img => ({ type: img.type, media_type: img.mediaType, data: img.data }))
        : undefined
      const res = await api.appChatSend({
        appId,
        spaceId,
        message: content,
        images: apiImages,
        thinkingEnabled,
      })
      if (!res.success) {
        console.error('[AppChatView] Send failed:', res.error)
      }
      // Optimistically add user message to local list
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, userMsg])
      setLoadState('loaded')

      // Scroll to bottom after sending
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
      })
    } catch (err) {
      console.error('[AppChatView] Send error:', err)
    }
  }, [appId, spaceId, conversationId, resetSession])

  // ── Stop generation ──
  const handleStop = useCallback(async () => {
    try {
      await api.appChatStop(appId)
    } catch (err) {
      console.error('[AppChatView] Stop error:', err)
    }
  }, [appId])

  // ── Answer question from AskUserQuestionCard ──
  const handleAnswerQuestion = useCallback((answers: Record<string, string>) => {
    answerQuestion(conversationId, answers)
  }, [conversationId, answerQuestion])

  // ── Loading state ──
  if (loadState === 'loading') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">{t('Loading chat...')}</span>
          </div>
        </div>
        <div className="shrink-0 p-4">
          <InputArea
            onSend={handleSend}
            onStop={handleStop}
            isGenerating={false}
            placeholder={t('Chat with this App...')}
            isCompact
          />
        </div>
      </div>
    )
  }

  // ── Error state (load error) ──
  if (loadState === 'error') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="flex flex-col items-center gap-2 text-muted-foreground max-w-sm text-center">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <p className="text-sm">{t('Failed to load chat')}</p>
            {errorMsg && <p className="text-xs text-muted-foreground/60">{errorMsg}</p>}
          </div>
        </div>
        <div className="shrink-0 p-4">
          <InputArea
            onSend={handleSend}
            onStop={handleStop}
            isGenerating={false}
            placeholder={t('Chat with this App...')}
            isCompact
          />
        </div>
      </div>
    )
  }

  // ── Active state: messages + streaming + input ──
  const hasStreamingContent = isGenerating && (streamingContent || thoughts.length > 0 || isThinking)

  return (
    <div className="flex flex-col h-full">
      {/* Message area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto py-6 px-4">
          {/* Empty state hint */}
          {loadState === 'empty' && !hasStreamingContent && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">{t('Send a message to start chatting with this App')}</p>
            </div>
          )}

          {/* Persisted messages */}
          {messages.map((message) => {
            const hasInlineThoughts = Array.isArray(message.thoughts) && message.thoughts.length > 0

            if (message.role === 'assistant' && hasInlineThoughts) {
              return (
                <div key={message.id} className="flex justify-start pb-4">
                  <div className="w-[85%]">
                    <CollapsedThoughtProcess
                      thoughts={message.thoughts as Thought[]}
                      defaultExpanded={false}
                    />
                    {/* Only render the message bubble if there is text content.
                        Assistant events with only tool_use/thinking blocks have empty content —
                        rendering MessageItem for those would produce empty visible bubbles. */}
                    {message.content && (
                      <MessageItem
                        message={message}
                        hideThoughts
                        isInContainer
                        hideBrowserViewButton
                      />
                    )}
                  </div>
                </div>
              )
            }

            return (
              <div key={message.id} className="pb-4">
                <MessageItem message={message} hideBrowserViewButton />
              </div>
            )
          })}

          {/* Live streaming content */}
          {hasStreamingContent && (
            <div className="flex justify-start pb-4 animate-fade-in">
              <div className="w-[85%]">
                {/* Real-time thought process */}
                {(thoughts.length > 0 || isThinking) && (
                  <ThoughtProcess thoughts={thoughts} isThinking={isThinking} />
                )}

                {/* Real-time browser task card */}
                {streamingBrowserToolCalls.length > 0 && (
                  <div className="mb-4">
                    <BrowserTaskCard
                      browserToolCalls={streamingBrowserToolCalls}
                      isActive={isThinking}
                      showViewButton={false}
                    />
                  </div>
                )}

                {/* Streaming text content with scroll animation */}
                <StreamingBubble
                  content={streamingContent}
                  isStreaming={isStreaming}
                  thoughts={thoughts}
                  textBlockVersion={textBlockVersion}
                />

                {/* AskUserQuestion card */}
                {pendingQuestion && (
                  <AskUserQuestionCard
                    pendingQuestion={pendingQuestion}
                    onAnswer={handleAnswerQuestion}
                  />
                )}
              </div>
            </div>
          )}

          {/* Interrupted error (special friendly UI) */}
          {!isGenerating && error && errorType === 'interrupted' && (
            <div className="pb-4">
              <InterruptedBubble error={error} />
            </div>
          )}

          {/* Generic error */}
          {!isGenerating && error && errorType !== 'interrupted' && (
            <div className="flex justify-start animate-fade-in pb-4">
              <div className="w-[85%]">
                <div className="rounded-2xl px-4 py-3 bg-destructive/10 border border-destructive/30">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">{t('Something went wrong')}</span>
                  </div>
                  <p className="mt-2 text-sm text-destructive/80">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Compact notice */}
          {compactInfo && (
            <div className="pb-4">
              <CompactNotice trigger={compactInfo.trigger} preTokens={compactInfo.preTokens} />
            </div>
          )}
        </div>
      </div>

      {/* Clear chat + Input area */}
      <div className="shrink-0 p-4">
        {messages.length > 0 && !isGenerating && (
          <div className="mb-2">
            {showClearConfirm ? (
              <div className="flex items-center justify-end gap-2">
                <span className="text-[11px] text-muted-foreground/80">{t('Clear all chat history?')}</span>
                <button
                  onClick={handleClearChat}
                  className="px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 rounded transition-colors"
                >
                  {t('Confirm')}
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary rounded transition-colors"
                >
                  {t('Cancel')}
                </button>
              </div>
            ) : (
              <div className="flex justify-end">
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors rounded"
                  title={t('Clear chat history')}
                >
                  <Trash2 className="w-3 h-3" />
                  {t('Clear chat')}
                </button>
              </div>
            )}
          </div>
        )}
        <InputArea
          onSend={handleSend}
          onStop={handleStop}
          isGenerating={isGenerating}
          placeholder={t('Chat with this App...')}
          isCompact
        />
      </div>
    </div>
  )
}
