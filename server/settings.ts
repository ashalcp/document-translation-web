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
  azureDocIntelEndpoint: process.env.AZURE_DOC_INTEL_ENDPOINT || '',
  azureDocIntelKey: process.env.AZURE_DOC_INTEL_KEY || '',
  azureTranslatorKey: process.env.AZURE_TRANSLATOR_KEY || '',
  azureTranslatorRegion: process.env.AZURE_TRANSLATOR_REGION || 'eastus'
}

export function getSettings(): Settings {
  // Always merge env vars so Azure App Service settings take priority
  const envSettings: Settings = {
    azureDocIntelEndpoint: process.env.AZURE_DOC_INTEL_ENDPOINT || '',
    azureDocIntelKey: process.env.AZURE_DOC_INTEL_KEY || '',
    azureTranslatorKey: process.env.AZURE_TRANSLATOR_KEY || '',
    azureTranslatorRegion: process.env.AZURE_TRANSLATOR_REGION || 'eastus'
  }
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const fileSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
      // env vars take priority over file settings
      return {
        ...DEFAULTS,
        ...fileSettings,
        ...(envSettings.azureDocIntelKey ? envSettings : {})
      }
    }
  } catch {}
  return { ...DEFAULTS, ...envSettings }
}

export function saveSettings(patch: Partial<Settings>): void {
  const dir = path.dirname(SETTINGS_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const current = getSettings()
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ ...current, ...patch }, null, 2))
}
