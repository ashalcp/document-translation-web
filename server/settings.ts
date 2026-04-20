import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

interface Settings {
  azureDocIntelEndpoint: string
  azureDocIntelKey: string
  azureTranslatorKey: string
  azureTranslatorRegion: string
}

const SETTINGS_PATH = path.join(os.homedir(), '.document-translation-web', 'settings.json')

const DEFAULTS: Settings = {
  azureDocIntelEndpoint: '',
  azureDocIntelKey: '',
  azureTranslatorKey: '',
  azureTranslatorRegion: 'eastus'
}

export function getSettings(): Settings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) }
    }
  } catch {}
  return { ...DEFAULTS }
}

export function saveSettings(patch: Partial<Settings>): void {
  const dir = path.dirname(SETTINGS_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const current = getSettings()
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ ...current, ...patch }, null, 2))
}
