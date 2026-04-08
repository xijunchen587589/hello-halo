/**
 * Post-install script
 *
 * Runs after `npm install` to set up the development environment:
 * 1. patch-package  — apply SDK patches
 * 2. SDK cli dedup  — symlink agent-sdk/cli.js → claude-code/cli.js (save ~13MB)
 * 3. electron-builder install-app-deps
 * 4. electron-rebuild for better-sqlite3
 */

import { execSync } from 'child_process'
import { unlinkSync, symlinkSync, lstatSync } from 'fs'

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })

// 1. Apply patches to @anthropic-ai/claude-agent-sdk
run('patch-package')

// 2. Deduplicate CLI binary: agent-sdk ships its own cli.js (~13MB) identical
//    to claude-code/cli.js. Replace with a symlink to save disk & ensure we
//    always run the claude-code version (which is the canonical CLI package).
const sdkCli = 'node_modules/@anthropic-ai/claude-agent-sdk/cli.js'
const target = '../claude-code/cli.js' // relative from agent-sdk dir
try {
  const stat = lstatSync(sdkCli)
  if (stat.isSymbolicLink() || stat.isFile()) unlinkSync(sdkCli)
} catch { /* file doesn't exist yet, that's fine */ }
symlinkSync(target, sdkCli)
console.log(`  ✔ ${sdkCli} → ${target}`)

// 3. Rebuild native modules for Electron
run('electron-builder install-app-deps')
run('electron-rebuild -f -w better-sqlite3')
