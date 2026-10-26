import { expect, mock, test } from 'claude-code/testing'
import { systemTimeZone, timeZonesDiffer } from '../hooks/ip_utils.js'

const INFO_A = {
  ip: '203.0.113.10',
  city: 'Shanghai',
  region: 'Shanghai',
  country: 'CN',
  timezone: 'Asia/Shanghai',
  asn: 'AS64500',
  asn_name: 'Example Backbone',
  domain_name: 'edge-a.example.test',
  source: 'test-a',
}
const INFO_B = {
  ip: '203.0.113.11',
  city: 'Los Angeles',
  region: 'CA',
  country: 'US',
  timezone: 'America/Los_Angeles',
  asn: 'AS64501',
  asn_name: 'Example Transit',
  domain_name: 'edge-b.example.test',
  source: 'test-b',
}

function snapshot(info: any, changed = false, previous: any = null) {
  return {
    info,
    fetched_at: 1000,
    from_cache: false,
    is_stale: false,
    error: '',
    changed,
    previous,
    history: [...(previous ? [previous] : []), ...(info ? [info] : [])],
    timezone: info?.timezone || 'unknown',
    local_time: 'unknown',
    config: { quiet_start: 0, quiet_end: 6, cache_ttl: 300, timeout: 5 },
  }
}

function store(on: any, initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial))
  on('store.get', async ($: any, e: any) => ({ value: values.get(e.key) }))
  on('store.set', async ($: any, e: any) => {
    values.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  return values
}

function ipProcess(on: any, snapshots: any[]) {
  const calls: string[][] = []
  on('process.run', async ($: any, e: any) => {
    calls.push(e.argv)
    const value = snapshots[Math.min(calls.length - 1, snapshots.length - 1)]
    return { value: { exitCode: 0, stdout: JSON.stringify(value), stderr: '' } }
  })
  return calls
}

function answers(on: any, initial = '继续') {
  const state = { answer: initial, questions: [] as string[] }
  on('tool.call', async ($: any, e: any) => {
    const question = e.questions[0].question
    state.questions.push(question)
    return { result: { answers: { [question]: state.answer } } }
  })
  return state
}

function sentPrompts(on: any) {
  const sent: string[] = []
  on('prompt.submit', async ($: any, e: any) => {
    sent.push(e.text)
    return { text: e.text }
  })
  return sent
}

function noUi(on: any) {
  on('ui.status', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
}

const shows = (tree: unknown, text: string) => JSON.stringify(tree).includes(text)

function byKey(node: any, key: string): any {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = byKey(child, key)
      if (match) return match
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (node.key === key || node.props?.key === key) return node
  return byKey(node.children ?? node.props?.children ?? [], key)
}

const propsOf = (node: any) => node?.props || node
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('session startup records an IP change and asks through the native question UI', {
  options: { translation_enabled: false, quiet_enabled: false },
}, async ($, on) => {
  const clock = mock.clock(on)
  store(on)
  ipProcess(on, [snapshot(INFO_B, true, INFO_A)])
  noUi(on)
  const ask = answers(on)
  const registered: string[] = []
  on('command.register', async ($: any, e: any) => {
    registered.push(e.name)
    return { value: undefined }
  })
  on('session.start', async () => ({ cwd: '/work' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(1)

  expect(registered).toContain('cc-four-o-three')
  expect(ask.questions.join('\n')).toContain('203.0.113.10 → 203.0.113.11')
})

test('declining an IP change is not forgotten by the next cache refresh', {
  options: { translation_enabled: false, quiet_enabled: false },
}, async ($, on) => {
  store(on)
  ipProcess(on, [
    snapshot(INFO_B, true, INFO_A),
    snapshot(INFO_B),
    snapshot(INFO_B),
    snapshot(INFO_B),
  ])
  noUi(on)
  const ask = answers(on, '取消')
  const sent = sentPrompts(on)

  const first = await $.prompt.submit({ text: 'hello' } as any)
  const second = await $.prompt.submit({ text: 'hello' } as any)
  expect(first.drop).toBeDefined()
  expect(second.drop).toBeDefined()
  expect(sent).toEqual([])

  ask.answer = '继续'
  await $.prompt.submit({ text: 'hello' } as any)
  await $.prompt.submit({ text: 'hello again' } as any)
  expect(sent).toEqual(['hello', 'hello again'])
  expect(ask.questions.length).toBe(3)
})

test('quiet confirmation includes 00:00, excludes 06:00 and can cancel the original prompt', {
  options: { translation_enabled: false, quiet_enabled: true, quiet_start: 0, quiet_end: 6 },
}, async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2025, 11, 31, 16, 0, 0) })
  store(on)
  ipProcess(on, [snapshot(INFO_A)])
  noUi(on)
  const ask = answers(on)
  const sent = sentPrompts(on)

  await $.prompt.submit({ text: 'midnight' } as any)
  expect(ask.questions.length).toBe(1)
  await clock.set(Date.UTC(2026, 0, 1, 22, 0, 0))
  await $.prompt.submit({ text: 'morning' } as any)
  expect(ask.questions.length).toBe(1)
  expect(sent).toEqual(['midnight', 'morning'])

  ask.answer = '取消'
  await clock.set(Date.UTC(2025, 11, 31, 17, 0, 0))
  const cancelled = await $.prompt.submit({ text: 'late night' } as any)
  expect(cancelled.drop).toBeDefined()
  expect(sent.length).toBe(2)
})

test('Chinese input is rewritten with the independent model and the message row stays bilingual', {
  options: {
    translation_enabled: true,
    translation_provider: 'claude',
    translation_model: 'translator-test',
    target_language: 'auto',
    quiet_enabled: false,
  },
}, async ($, on) => {
  store(on)
  ipProcess(on, [snapshot(INFO_B)])
  noUi(on)
  const sent = sentPrompts(on)
  const modelCalls: any[] = []
  on('model.complete', async ($: any, e: any) => {
    modelCalls.push(e)
    return { value: { isAnswered: true, text: 'Write a function', usage } }
  })
  on('ui.render', { component: 'UserMessage' }, async ($: any, e: any) => {
    return $.ui.resolve(e).Text({ children: e.props.text })
  })

  const result = await $.prompt.submit({ text: '写一个函数' } as any)
  expect(result.text).toBe('Write a function')
  expect(sent).toEqual(['Write a function'])
  expect(modelCalls[0].model).toBe('translator-test')
  expect(modelCalls[0].prompt).toBe('写一个函数')

  const drawn = await $.ui.render({ component: 'UserMessage', surface: 'terminal', props: { text: 'Write a function' } } as any)
  expect(shows(drawn, '写一个函数')).toBe(true)
  expect(shows(drawn, '→ Write a function')).toBe(true)
})

test('a failed input translation drops the prompt instead of silently sending Chinese', {
  options: { translation_enabled: true, translation_provider: 'claude', quiet_enabled: false },
}, async ($, on) => {
  store(on)
  ipProcess(on, [snapshot(INFO_B)])
  noUi(on)
  const sent = sentPrompts(on)
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'offline' } }))

  const result = await $.prompt.submit({ text: '写一个函数' } as any)
  expect(result.drop).toContain('原 Prompt 未发送')
  expect(sent).toEqual([])
})

test('an unknown IP-derived target language is explicit and does not call the model', {
  options: { translation_enabled: true, translation_provider: 'claude', target_language: 'auto', quiet_enabled: false },
}, async ($, on) => {
  store(on)
  ipProcess(on, [snapshot(null)])
  noUi(on)
  const sent = sentPrompts(on)
  let modelCalls = 0
  on('model.complete', async () => {
    modelCalls += 1
    return { value: { isAnswered: true, text: 'unexpected', usage } }
  })

  const result = await $.prompt.submit({ text: '你好' } as any)
  expect(result.drop).toContain('目标语言为 unknown')
  expect(modelCalls).toBe(0)
  expect(sent).toEqual([])
})

test('an assistant reply gets a Chinese Markdown translation with code preserved', {
  options: { translation_enabled: true, translation_provider: 'claude', quiet_enabled: false },
}, async ($, on) => {
  const clock = mock.clock(on)
  const kept = store(on)
  noUi(on)
  const modelCalls: any[] = []
  on('model.complete', async ($: any, e: any) => {
    modelCalls.push(e)
    return { value: { isAnswered: true, text: '这是说明：\n⟦0⟧', usage } }
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($: any, e: any) => {
    return $.ui.resolve(e).Text({ children: e.props.text })
  })
  const source = 'Explain this:\n```js\nconst x = 1;\n```'
  const draw = () => $.ui.render({ component: 'AssistantMessage', surface: 'terminal', props: { text: source, isFirstOfReply: true } } as any)

  expect(shows(await draw(), '中文翻译中')).toBe(true)
  await clock.advance(1)
  const translated = await draw()
  expect(shows(translated, '这是说明')).toBe(true)
  expect(shows(translated, 'const x = 1;')).toBe(true)
  expect(shows(translated, '⟦0⟧')).toBe(false)
  expect(modelCalls.length).toBe(1)
  expect(JSON.stringify(kept.get('translation-cache-v1'))).toContain('const x = 1;')
})

test('a failed reply translation keeps the original and reports the failure', {
  options: { translation_enabled: true, translation_provider: 'claude', quiet_enabled: false },
}, async ($, on) => {
  const clock = mock.clock(on)
  store(on)
  const logged: string[] = []
  on('ui.log', async ($: any, e: any) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'offline' } }))
  on('ui.render', { component: 'AssistantMessage' }, async ($: any, e: any) => {
    return $.ui.resolve(e).Text({ children: e.props.text })
  })
  const draw = () => $.ui.render({ component: 'AssistantMessage', surface: 'terminal', props: { text: 'Hello', isFirstOfReply: true } } as any)

  await draw()
  await clock.advance(1)
  const drawn = await draw()
  expect(shows(drawn, 'Hello')).toBe(true)
  expect(shows(drawn, '中文翻译失败，已保留原文')).toBe(true)
  expect(logged.join('\n')).toContain('回复翻译失败')
})

test('OpenAI-compatible translation uses the configured endpoint, model and protected key', {
  options: {
    translation_enabled: true,
    translation_provider: 'openai-compatible',
    translation_model: 'local-translator',
    translation_base_url: 'http://127.0.0.1:8080/v1',
    translation_api_key: 'secret-key',
    target_language: 'Japanese',
    quiet_enabled: false,
  },
}, async ($, on) => {
  const kept = store(on)
  ipProcess(on, [snapshot(INFO_B)])
  noUi(on)
  const sent = sentPrompts(on)
  const requests: any[] = []
  on('http.fetch', async ($: any, e: any) => {
    requests.push(e)
    return {
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({ choices: [{ message: { content: 'こんにちは' } }] }),
      },
    }
  })

  const result = await $.prompt.submit({ text: '你好' } as any)
  expect(result.text).toBe('こんにちは')
  expect(sent).toEqual(['こんにちは'])
  expect(requests[0].url).toBe('http://127.0.0.1:8080/v1/chat/completions')
  const body = JSON.parse(requests[0].init.body)
  expect(body.model).toBe('local-translator')
  expect(body.messages[1].content).toBe('你好')
  expect(requests[0].init.headers.Authorization).toBe('Bearer secret-key')
  expect(JSON.stringify([...kept.values()])).not.toContain('secret-key')
})

test('the band shows unknown instead of falling back to the system timezone', {
  options: { translation_enabled: false, quiet_enabled: true },
}, async ($, on) => {
  mock.clock(on)
  store(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => $.ui.resolve(e).Box({}))

  const drawn = await $.ui.render({
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isWorking: false },
  } as any)
  expect(shows(drawn, 'IP unknown')).toBe(true)
  expect(shows(drawn, 'ASN / 域名 unknown')).toBe(true)
  expect(shows(drawn, '时区 unknown')).toBe(true)
  expect(shows(drawn, '时间 unknown')).toBe(true)
  expect(shows(drawn, '深夜提醒 unknown')).toBe(true)
  expect(shows(drawn, '本机时区')).toBe(true)
  expect(shows(drawn, '时区提醒：')).toBe(false)
})

test('IP and host timezone differences are visible without blocking prompts', {
  options: { translation_enabled: false, quiet_enabled: false },
}, async ($, on) => {
  mock.clock(on)
  store(on)
  noUi(on)
  const localTimezone = systemTimeZone()
  const targetTimezone = localTimezone === 'Asia/Shanghai' ? 'America/Los_Angeles' : 'Asia/Shanghai'
  const mismatch = timeZonesDiffer(targetTimezone, localTimezone)
  ipProcess(on, [snapshot({ ...INFO_A, timezone: targetTimezone })])
  const sent = sentPrompts(on)
  on('command.register', async () => ({ value: undefined }))
  on('session.start', async () => ({ cwd: '/work' }))
  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => $.ui.resolve(e).Box({}))
  on('ui.render', { component: 'Pane' }, async ($: any, e: any) => $.ui.resolve(e).Box({}))

  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const band = await $.ui.render({
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isWorking: false },
  } as any)
  const pane = await $.ui.render({
    component: 'Pane',
    surface: 'terminal',
    requestId: 'cc-four-o-three',
    props: { title: 'CC Four-O-Three', isFocused: true },
  } as any)
  const notice = `时区提醒：IP ${targetTimezone} 与本机 ${localTimezone} 不一致`
  expect(shows(band, notice)).toBe(mismatch)
  expect(shows(pane, notice)).toBe(mismatch)
  expect(shows(band, `本机时区 ${localTimezone || 'unknown'}`)).toBe(!mismatch)
  expect(shows(pane, `本机时区 ${localTimezone || 'unknown'}`)).toBe(!mismatch)

  if (mismatch) {
    expect(propsOf(byKey(band, 'cc-four-o-three-band')).borderColor).toBe('yellow')
    expect(propsOf(byKey(pane, 'local-timezone')).color).toBe('yellow')
  }

  await $.prompt.submit({ text: 'hello' } as any)
  expect(sent).toEqual(['hello'])
})

test('terminal band and settings pane use status colors and colored section headings', {
  options: { translation_enabled: false, quiet_enabled: false },
}, async ($, on) => {
  mock.clock(on)
  store(on)
  noUi(on)
  const localTimezone = systemTimeZone()
  ipProcess(on, [snapshot({ ...INFO_A, timezone: localTimezone || 'Asia/Shanghai' })])
  on('command.register', async () => ({ value: undefined }))
  on('session.start', async () => ({ cwd: '/work' }))
  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => $.ui.resolve(e).Box({}))
  on('ui.render', { component: 'Pane' }, async ($: any, e: any) => $.ui.resolve(e).Box({}))

  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const band = await $.ui.render({
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isWorking: false },
  } as any)
  const pane = await $.ui.render({
    component: 'Pane',
    surface: 'terminal',
    requestId: 'cc-four-o-three',
    props: { title: 'CC Four-O-Three', isFocused: true },
  } as any)

  expect(propsOf(byKey(band, 'cc-four-o-three-band')).borderColor).toBe('cyan')
  expect(propsOf(byKey(band, 'ip')).color).toBe('cyan')
  expect(shows(band, 'ASN / 域名 AS64500 Example Backbone')).toBe(true)
  expect(propsOf(byKey(band, 'network')).color).toBe('cyan')
  expect(propsOf(byKey(band, 'features')).color).toBe('blue')
  expect(propsOf(byKey(band, 'local-timezone')).color).toBe(localTimezone ? 'green' : undefined)
  expect(propsOf(byKey(pane, 'title')).color).toBe('cyan')
  expect(propsOf(byKey(pane, 'current')).color).toBe('green')
  expect(shows(pane, 'ASN AS64500 Example Backbone · 域名 edge-a.example.test')).toBe(true)
  expect(propsOf(byKey(pane, 'network')).color).toBe('green')
  expect(propsOf(byKey(pane, 'translation-heading')).color).toBe('magenta')
  expect(propsOf(byKey(pane, 'guard-heading')).color).toBe('magenta')
  expect(propsOf(byKey(pane, 'history-title')).color).toBe('cyan')
})

test('the native settings pane persists translation, language and quiet-hour changes', {
  options: { translation_enabled: true, translation_model: 'haiku', quiet_enabled: true },
}, async ($, on) => {
  mock.clock(on)
  const kept = store(on)
  on('ui.render', { component: 'Pane' }, async ($: any, e: any) => $.ui.resolve(e).Box({}))
  const draw = () => $.ui.render({
    component: 'Pane',
    surface: 'terminal',
    requestId: 'cc-four-o-three',
    props: { title: 'CC Four-O-Three', isFocused: true },
  } as any)

  expect(shows(await draw(), '目标语言')).toBe(true)
  await ($.ui as any).select({ plugin: 'cc-four-o-three', key: 'quiet-enabled', value: 'off' })
  await ($.ui as any).input({ plugin: 'cc-four-o-three', key: 'target-language', text: 'Japanese' })
  await ($.ui as any).input({ plugin: 'cc-four-o-three', key: 'translation-model', text: 'new-model' })

  const saved = kept.get('settings') as any
  expect(saved.quiet_enabled).toBe(false)
  expect(saved.target_language).toBe('Japanese')
  expect(saved.translation_model).toBe('new-model')
})
