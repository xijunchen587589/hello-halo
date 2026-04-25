/**
 * apps/manager -- Default App Seed
 *
 * Seeds a "Halo 助手" default automation app when the apps table is empty.
 * Runs as a Tier 3 idle task so it never blocks startup. Failures are
 * logged as warnings and do not affect any functionality.
 *
 * Idempotency: subsequent launches skip seeding because the apps table
 * is no longer empty. If the user deletes all apps, the seed runs again
 * on the next startup.
 */

import type { AppManagerService } from './types'
import type { AutomationSpec } from '../spec'

/** Space ID for the default temporary space */
const SEED_SPACE_ID = 'halo-temp'

/** Default app spec — no subscriptions (IM / manual-trigger only) */
const DEFAULT_APP_SPEC: AutomationSpec = {
  spec_version: '1',
  name: 'Halo 助手',
  version: '1.0',
  author: 'Halo',
  description: '默认数字人，可绑定 IM 机器人或手动对话',
  type: 'automation',
  system_prompt: [
    '你是 Halo 助手，一个有用的 AI 助手。',
    '准确、简洁地回答用户的问题。',
    '如果不确定，请诚实告知。',
  ].join('\n'),
  // No subscriptions — pure IM/manual mode
}

/**
 * Seed the default app if the apps table is empty.
 *
 * @param appManager - The initialized AppManagerService
 */
export async function seedDefaultAppIfNeeded(appManager: AppManagerService): Promise<void> {
  const allApps = appManager.listApps()
  if (allApps.length > 0) {
    return
  }

  console.log('[Seed] Apps table is empty — seeding default "Halo 助手" app')

  try {
    const appId = await appManager.install(SEED_SPACE_ID, DEFAULT_APP_SPEC)
    console.log(`[Seed] Default app installed: id=${appId}, space=${SEED_SPACE_ID}`)
  } catch (err) {
    console.warn('[Seed] Failed to seed default app (non-critical):', err)
  }
}
