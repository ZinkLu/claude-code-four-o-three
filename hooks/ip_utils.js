export function unknownSnapshot(error = '') {
  return {
    info: null,
    fetched_at: 0,
    from_cache: false,
    is_stale: false,
    error,
    changed: false,
    previous: null,
    history: [],
    timezone: 'unknown',
    local_time: 'unknown',
  }
}

export function regionOf(info) {
  return [info?.city, info?.region, info?.country].filter(Boolean).join(', ') || 'unknown'
}

function textOf(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).trim()
}

export function asnOf(info) {
  const rawAsn = textOf(info?.asn)
  const asn = /^\d+$/.test(rawAsn) ? `AS${rawAsn}` : rawAsn
  return [asn, textOf(info?.asn_name)].filter(Boolean).join(' ') || 'unknown'
}

export function domainOf(info) {
  return textOf(info?.domain_name) || 'unknown'
}

export function networkOf(info) {
  const asn = asnOf(info)
  return asn === 'unknown' ? domainOf(info) : asn
}

function normalizedTimeZone(timezone) {
  if (typeof timezone !== 'string' || !timezone.trim()) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone.trim() }).resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export function systemTimeZone() {
  try {
    return normalizedTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return null
  }
}

export function timeZonesDiffer(targetTimezone, localTimezone) {
  const target = normalizedTimeZone(targetTimezone)
  const local = normalizedTimeZone(localTimezone)
  return Boolean(target && local && target !== local)
}

export function localTime(info, nowMs) {
  const timezone = info?.timezone
  if (!timezone) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(nowMs))
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return {
      text: `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`,
      hour: Number(values.hour),
      minute: Number(values.minute),
    }
  } catch {
    return null
  }
}

export function inQuietPeriod(hour, start, end) {
  if (start === end) return false
  if (start < end) return start <= hour && hour < end
  return hour >= start || hour < end
}

export function quietEnabled(settings, info) {
  return settings.quiet_enabled && settings.quiet_start !== settings.quiet_end && Boolean(localTime(info, 0))
}
