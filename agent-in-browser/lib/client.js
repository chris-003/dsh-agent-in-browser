// @chris/agent-in-browser client half (browser). Registers a config card into
// the 设置 → 插件 → 插件配置 surface (`settings.plugin.item` keyed by the
// namespace the host serves), reading/writing {port, token, host,
// commandTimeoutMs} through the settings scope. Plain ESM, no JSX/TS.
import React from 'react'

export const name = 'agent-in-browser'
export const inject = ['slots', 'settingsScope']

const NS = 'agent-in-browser'

const FIELDS = [
  { key: 'port', label: '监听端口', type: 'number' },
  { key: 'token', label: '令牌（token）', type: 'text' },
  { key: 'host', label: '监听地址', type: 'text' },
  { key: 'commandTimeoutMs', label: '命令超时（ms）', type: 'number' },
]

function ConfigCard({ scope }) {
  const [snap, setSnap] = React.useState(scope.getSnapshot())
  const [drafts, setDrafts] = React.useState({})
  React.useEffect(() => scope.subscribe(() => setSnap(scope.getSnapshot())), [scope])

  const value = snap.value || {}
  const draft = (key) => (key in drafts ? drafts[key] : String(value[key] ?? ''))
  const setDraft = (key, text) => setDrafts((d) => ({ ...d, [key]: text }))
  const writable = snap.writable

  const save = async () => {
    await scope.set('port', Number(draft('port')) || 38745)
    await scope.set('token', String(draft('token') || 'agent-in-browser'))
    await scope.set('host', String(draft('host') || '127.0.0.1'))
    await scope.set('commandTimeoutMs', Number(draft('commandTimeoutMs')) || 30000)
    setDrafts({})
  }
  const reset = async () => {
    for (const f of FIELDS) await scope.unset(f.key).catch(() => {})
    setDrafts({})
  }

  const field = (f) =>
    React.createElement(
      'label',
      { key: f.key, style: { display: 'block', margin: '10px 0' } },
      React.createElement('div', { style: { fontSize: 13, marginBottom: 4, color: '#555' } }, f.label),
      React.createElement('input', {
        type: f.type,
        value: draft(f.key),
        onChange: (e) => setDraft(f.key, e.target.value),
        style: { display: 'block', width: '100%', boxSizing: 'border-box', padding: 6, borderRadius: 6, border: '1px solid #ccc' },
      }),
    )

  if (snap.status !== 'ready') {
    return React.createElement('div', null,
      React.createElement('div', { style: { fontWeight: 600, marginBottom: 6 } }, 'agent-in-browser'),
      React.createElement('div', { style: { color: '#888', fontSize: 13 } }, '配置未就绪…'),
    )
  }

  return React.createElement('div', null,
    React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, 'agent-in-browser'),
    React.createElement('div', { style: { color: '#888', fontSize: 12, marginBottom: 10 } },
      'WebSocket 服务端地址与令牌；改动保存在 DSH 设置中，重启/刷新后生效。'),
    ...FIELDS.map(field),
    React.createElement('div', { style: { marginTop: 12 } },
      React.createElement('button', { onClick: save, disabled: !writable, style: { padding: '6px 14px', marginRight: 8 } }, '保存'),
      React.createElement('button', { onClick: reset, disabled: !writable, style: { padding: '6px 14px' } }, '重置'),
    ),
  )
}

export function apply(ctx) {
  const scope = ctx.settingsScope.bind({ namespace: NS })
  ctx.effect(() => ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      { name: 'settings.plugin.item', key: NS },
      () => React.createElement(ConfigCard, { scope }),
    ),
  ), 'agent-in-browser.config-card')
}
