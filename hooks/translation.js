const HAN = /\p{Script=Han}/u
const LETTER = /\p{L}/u
const FENCE = /^\s*(`{3,}|~{3,})/
const INLINE_PROTECTED = /`[^`\n]+`|\]\([^)\s]+\)|https?:\/\/[^\s)>\]]+/g
const PLACEHOLDER = /⟦\s*(\d+)\s*⟧/g

export function containsHan(text) {
  return HAN.test(text)
}

export function targetLanguage(settings, info) {
  const configured = settings.target_language.trim()
  if (configured.toLowerCase() !== 'auto') return configured
  const country = String(info?.country || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return 'unknown'
  try {
    const tag = new Intl.Locale(`und-${country === 'UK' ? 'GB' : country}`).maximize().language
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) || 'unknown'
  } catch {
    return 'unknown'
  }
}

export function needsPromptTranslation(text, target) {
  if (!containsHan(text)) return false
  return !/^(?:zh(?:-CN|-Hans)?|Chinese|简体中文)$/i.test(target.trim())
}

export function proseOf(text) {
  let inFence = false
  return text
    .split('\n')
    .filter((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence
        return false
      }
      return !inFence
    })
    .join('\n')
    .replace(/`[^`\n]+`|\]\([^)\s]+\)|https?:\/\/[^\s)>\]]+/g, ' ')
}

export function needsReplyTranslation(text) {
  const prose = proseOf(text)
  if (!LETTER.test(prose)) return false
  if (!containsHan(prose)) return true
  return LETTER.test(prose.replace(/\p{Script=Han}/gu, ''))
}

export function protectMarkdown(text) {
  const protectedParts = []
  const keep = (value) => {
    const index = protectedParts.push(value) - 1
    return `⟦${index}⟧`
  }
  const output = []
  let fence = null
  for (const line of text.split('\n')) {
    if (fence) {
      fence.push(line)
      if (FENCE.test(line)) {
        output.push(keep(fence.join('\n')))
        fence = null
      }
      continue
    }
    if (FENCE.test(line)) {
      fence = [line]
      continue
    }
    output.push(line.replace(INLINE_PROTECTED, (match) => keep(match)))
  }
  if (fence) output.push(keep(fence.join('\n')))
  const masked = output.join('\n')

  const restore = (translated) => {
    const tokens = [...translated.matchAll(PLACEHOLDER)]
    if (tokens.length !== protectedParts.length) throw new Error('翻译结果改变了代码保护标记')
    for (let index = 0; index < protectedParts.length; index += 1) {
      const count = tokens.filter((match) => Number(match[1]) === index).length
      if (count !== 1) throw new Error('翻译结果缺少或重复代码保护标记')
    }
    return translated.replace(PLACEHOLDER, (_match, index) => protectedParts[Number(index)])
  }
  return { masked, restore }
}

export function translationMaxTokens(text) {
  return Math.min(64000, Math.max(1024, Math.ceil(text.length * 2)))
}

export function openAiUrl(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

export function responseText(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('')
  }
  return ''
}
