import { useEffect, useState } from 'react'

interface Settings {
  azureDocIntelEndpoint: string
  azureDocIntelKey: string
  azureTranslatorKey: string
  azureTranslatorRegion: string
}

interface Props { open: boolean; onClose: () => void }

export default function SettingsModal({ open, onClose }: Props) {
  const [form, setForm] = useState<Settings>({
    azureDocIntelEndpoint: '', azureDocIntelKey: '',
    azureTranslatorKey: '', azureTranslatorRegion: 'eastus'
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      fetch('/api/settings').then(r => r.json()).then(setForm).catch(() => {})
    }
  }, [open])

  const handleSave = async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-bold text-lg">⚙️ Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">✕</button>
        </div>

        <div className="space-y-4">
          {[
            { label: 'Azure Doc Intelligence Endpoint', key: 'azureDocIntelEndpoint', placeholder: 'https://....cognitiveservices.azure.com/' },
            { label: 'Azure Doc Intelligence Key', key: 'azureDocIntelKey', placeholder: 'API Key' },
            { label: 'Azure Translator Key', key: 'azureTranslatorKey', placeholder: 'API Key' },
            { label: 'Azure Translator Region', key: 'azureTranslatorRegion', placeholder: 'eastus' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="text-gray-400 text-xs mb-1 block">{label}</label>
              <input
                type="text"
                value={form[key as keyof Settings]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
          <button onClick={handleSave}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
            {saved ? '✓ Saved!' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
