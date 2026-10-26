import { expect, test } from 'claude-code/testing'
import { normalizeBaseUrl, settingsFrom, storedSettings } from '../hooks/config.js'
import { asnOf, domainOf, inQuietPeriod, localTime, networkOf, systemTimeZone, timeZonesDiffer } from '../hooks/ip_utils.js'
import {
  needsReplyTranslation,
  openAiUrl,
  protectMarkdown,
  responseText,
  targetLanguage,
} from '../hooks/translation.js'

test('target language follows the IP country and accepts an explicit override', () => {
  const auto = settingsFrom({ target_language: 'auto' })
  expect(targetLanguage(auto, { country: 'US' })).toBe('English')
  expect(targetLanguage(auto, { country: 'JP' })).toBe('Japanese')
  expect(targetLanguage(auto, { country: 'BR' })).toBe('Portuguese')
  expect(targetLanguage(auto, { country: '' })).toBe('unknown')
  expect(targetLanguage(auto, null)).toBe('unknown')
  expect(targetLanguage(settingsFrom({ target_language: 'zh-Hant' }), { country: 'US' })).toBe('zh-Hant')
})

test('Markdown protection keeps code, inline code, URLs and link targets intact', () => {
  const original = '请解释 `const x = 1`：\n```python\nprint("你好")\n```\n阅读[文档](https://example.com/a?x=1)。'
  const { masked, restore } = protectMarkdown(original)
  expect(masked.includes('const x')).toBe(false)
  expect(masked.includes('print')).toBe(false)
  expect(masked.includes('https://example.com')).toBe(false)
  const translated = masked.replace('请解释', 'Explain').replace('阅读', 'Read').replace('文档', 'the documentation')
  const restored = restore(translated)
  expect(restored).toContain('Explain')
  expect(restored).toContain('`const x = 1`')
  expect(restored).toContain('print("你好")')
  expect(restored).toContain('(https://example.com/a?x=1)')
})

test('a missing or duplicated Markdown placeholder is rejected', () => {
  const { masked, restore } = protectMarkdown('解释 `x`')
  expect(masked).toBe('解释 ⟦0⟧')
  expect(() => restore('Explain')).toThrow()
  expect(() => restore('Explain ⟦0⟧ ⟦0⟧')).toThrow()
})

test('reply language checks ignore code and accept Chinese without another language', () => {
  expect(needsReplyTranslation('Hello, Claude.')).toBe(true)
  expect(needsReplyTranslation('你好，Claude。')).toBe(true)
  expect(needsReplyTranslation('你好，世界。')).toBe(false)
  expect(needsReplyTranslation('```python\nprint("hello")\n```')).toBe(false)
  expect(needsReplyTranslation('こんにちは')).toBe(true)
})

test('quiet hours include midnight, exclude 06:00 and support overnight ranges', () => {
  expect(inQuietPeriod(0, 0, 6)).toBe(true)
  expect(inQuietPeriod(5, 0, 6)).toBe(true)
  expect(inQuietPeriod(6, 0, 6)).toBe(false)
  expect(inQuietPeriod(23, 22, 6)).toBe(true)
  expect(inQuietPeriod(2, 22, 6)).toBe(true)
  expect(inQuietPeriod(12, 22, 6)).toBe(false)
  expect(inQuietPeriod(3, 6, 6)).toBe(false)
})

test('local time uses the IP timezone and rejects unknown timezones', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)
  expect(localTime({ timezone: 'Asia/Shanghai' }, now)?.text).toBe('2026-01-01 08:00:00')
  expect(localTime({ timezone: 'Invalid/Zone' }, now)).toBe(null)
  expect(localTime(null, now)).toBe(null)
})

test('network info formats ASN and falls back to domain or unknown', () => {
  const info = { asn: 'AS64500', asn_name: 'Example Backbone', domain_name: 'edge.example.test' }
  expect(asnOf(info)).toBe('AS64500 Example Backbone')
  expect(domainOf(info)).toBe('edge.example.test')
  expect(networkOf(info)).toBe('AS64500 Example Backbone')
  expect(networkOf({ domain_name: 'edge.example.test' })).toBe('edge.example.test')
  expect(networkOf({ asn: 64500 })).toBe('AS64500')
  expect(asnOf(null)).toBe('unknown')
  expect(domainOf({})).toBe('unknown')
  expect(networkOf(null)).toBe('unknown')
})

test('timezone mismatch checks normalize names and ignore unknown zones', () => {
  expect(timeZonesDiffer('Asia/Shanghai', 'asia/shanghai')).toBe(false)
  expect(timeZonesDiffer('Asia/Shanghai', 'Asia/Singapore')).toBe(true)
  expect(timeZonesDiffer('Asia/Shanghai', 'America/Los_Angeles')).toBe(true)
  expect(timeZonesDiffer('Asia/Shanghai', 'Invalid/Zone')).toBe(false)
  expect(timeZonesDiffer(null, 'Asia/Shanghai')).toBe(false)
  expect(timeZonesDiffer('Invalid/Zone', systemTimeZone())).toBe(false)
})

test('settings validation keeps secrets out of the persisted object', () => {
  const settings = settingsFrom({ translation_api_key: 'secret', quiet_start: 99, quiet_end: -1 })
  expect(settings.quiet_start).toBe(0)
  expect(settings.quiet_end).toBe(6)
  expect(Object.keys(storedSettings(settings))).not.toContain('translation_api_key')
  expect(JSON.stringify(storedSettings(settings))).not.toContain('secret')
})

test('OpenAI-compatible endpoints require HTTPS except on the local machine', () => {
  expect(openAiUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions')
  expect(normalizeBaseUrl('http://127.0.0.1:8080/v1/')).toBe('http://127.0.0.1:8080/v1')
  expect(() => normalizeBaseUrl('http://example.com/v1')).toThrow()
  expect(() => normalizeBaseUrl('https://user:secret@example.com/v1')).toThrow()
})

test('OpenAI response parsing supports string and content-part responses', () => {
  expect(responseText({ choices: [{ message: { content: '译文' } }] })).toBe('译文')
  expect(responseText({ choices: [{ message: { content: [{ text: '译' }, { text: '文' }] } }] })).toBe('译文')
  expect(responseText({})).toBe('')
})
