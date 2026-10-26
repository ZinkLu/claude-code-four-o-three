export const DEFAULT_SETTINGS = Object.freeze({
  translation_enabled: true,
  translation_provider: 'claude',
  translation_model: 'haiku',
  translation_base_url: 'https://api.openai.com/v1',
  translation_api_key: '',
  target_language: 'auto',
  ip_change_confirmation: true,
  quiet_enabled: true,
  quiet_start: 0,
  quiet_end: 6,
})

export function settingsFrom(options = {}, stored = {}) {
  const merged = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (options[key] !== undefined) merged[key] = options[key]
    if (stored && stored[key] !== undefined) merged[key] = stored[key]
  }
  for (const key of ['translation_enabled', 'ip_change_confirmation', 'quiet_enabled']) {
    if (typeof merged[key] !== 'boolean') merged[key] = DEFAULT_SETTINGS[key]
  }
  if (!['claude', 'openai-compatible'].includes(merged.translation_provider)) {
    merged.translation_provider = DEFAULT_SETTINGS.translation_provider
  }
  for (const key of ['translation_model', 'translation_base_url', 'target_language']) {
    if (typeof merged[key] !== 'string' || !merged[key].trim()) merged[key] = DEFAULT_SETTINGS[key]
    merged[key] = merged[key].trim()
  }
  if (typeof merged.translation_api_key !== 'string') merged.translation_api_key = ''
  for (const key of ['quiet_start', 'quiet_end']) {
    const value = merged[key]
    if (!Number.isInteger(value) || value < 0 || value > 24) merged[key] = DEFAULT_SETTINGS[key]
  }
  return merged
}

export function storedSettings(settings) {
  const { translation_api_key: _secret, ...stored } = settings
  return stored
}

export function normalizeBaseUrl(value) {
  const url = new URL(value.trim())
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password) {
    throw new Error('翻译端点必须使用 HTTPS；仅本机端点可使用 HTTP，且 URL 不能包含凭据')
  }
  return url.href.replace(/\/+$/, '')
}

export function translationSignature(settings) {
  return [settings.translation_provider, settings.translation_model, settings.translation_base_url, 'zh-CN'].join('|')
}
