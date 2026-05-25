/**
 * ShareCurrentAppDialog
 *
 * One-click "share this installed app" confirmation dialog.
 *
 * Used by the Share buttons on individual Digital Human / Skill detail pages
 * (AutomationHeader, SkillInfoCard). The user has already picked WHAT to share
 * — the dialog just confirms the action and reports the result.
 *
 * For the store-header "I have nothing picked yet" entry, use ShareToStoreDialog
 * instead (which has type tabs + source pickers + file/folder upload).
 */

import { useCallback, useState } from 'react'
import { X, Share2, Loader2, AlertCircle, CheckCircle2, Bot, BookOpen, Puzzle, Wrench } from 'lucide-react'
import { useAppsStore } from '../../stores/apps.store'
import { useTranslation } from '../../i18n'
import { api } from '../../api'
import type { AppType } from '../../../shared/apps/spec-types'

export interface ShareCurrentAppDialogProps {
  appId: string
  onClose: () => void
}

/** Pick a representative icon for the preview header by app type. */
function iconForType(type: AppType): typeof Bot {
  switch (type) {
    case 'automation': return Bot
    case 'skill':      return BookOpen
    case 'mcp':        return Wrench
    case 'extension':  return Puzzle
    default:           return Puzzle
  }
}

function typeLabel(type: AppType, t: (s: string) => string): string {
  switch (type) {
    case 'automation': return t('Digital Human')
    case 'skill':      return t('Skill')
    case 'mcp':        return t('MCP')
    case 'extension':  return t('Extension')
    default:           return type
  }
}

export function ShareCurrentAppDialog({ appId, onClose }: ShareCurrentAppDialogProps) {
  const { t } = useTranslation()
  const app = useAppsStore(s => s.apps.find(a => a.id === appId))

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleShare = useCallback(async () => {
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      const res = await api.storePublish(appId)
      if (!res.success) {
        setError(res.error ?? t('Share failed.'))
        return
      }
      const details = (res.data as { details?: string } | undefined)?.details
      setSuccess(details ?? t('Shared to store successfully.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Share failed.'))
    } finally {
      setSubmitting(false)
    }
  }, [appId, t])

  // App may have been uninstalled between mount and render — guard gracefully.
  if (!app) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        onMouseDown={onClose}
      >
        <div
          className="relative w-full max-w-md bg-background border border-border rounded-xl shadow-xl p-6"
          onMouseDown={e => e.stopPropagation()}
        >
          <p className="text-sm text-muted-foreground">
            {t('This app is no longer available.')}
          </p>
        </div>
      </div>
    )
  }

  const spec = app.spec
  const Icon = iconForType(spec.type)
  const label = typeLabel(spec.type, t)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={onClose}
    >
      <div
        className="relative w-full max-w-md bg-background border border-border rounded-xl shadow-xl flex flex-col"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Share2 className="w-4 h-4 text-primary flex-shrink-0" />
            <h2 className="text-sm font-semibold truncate">{t('Share to Store')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
            aria-label={t('Close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('You are about to share the following to the store:')}
          </p>

          <div className="flex items-start gap-3 p-3 bg-secondary/60 rounded-lg border border-border">
            <Icon className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{spec.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {label}
                {spec.version && <> · v{spec.version}</>}
                {spec.author && <> · {t('by')} {spec.author}</>}
              </p>
              {spec.description && (
                <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-3">
                  {spec.description}
                </p>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {t('Once published, other users will be able to find and install it from the store.')}
          </p>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap break-words">{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap break-words">{success}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-secondary transition-colors"
          >
            {success ? t('Done') : t('Cancel')}
          </button>
          {!success && (
            <button
              onClick={handleShare}
              disabled={submitting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Share2 className="w-3.5 h-3.5" />}
              {submitting ? t('Sharing...') : t('Share to Store')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
