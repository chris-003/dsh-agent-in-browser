// @chris-003/agent-in-browser client half (browser).
//
// Loaded by the web UI through window.__ModuleLoader__.load({ id, factory }),
// the factory's `require` resolving externals (React is provided by the shell).
// Renders a config card in 设置 → 插件 → 插件配置 that matches the native
// Agent 循环 style: collapsible card, per-field label + hint, "已覆盖" badge
// + "恢复默认" link, and a "放弃修改 / 保存" footer. Reads/writes the settings
// namespace the host serves.
window.__ModuleLoader__.load({
  id: '@chris-003/agent-in-browser',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    const NS = 'agent-in-browser'

    // Inject the card styles (mirrors the shipped plugin-card CSS, using the
    // same theme tokens so it matches the native cards).
    ;(() => {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-aib]')) return
      const css = [
        '.aib-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}',
        '.aib-card:hover{border-color:var(--dsw-alias-label-dimmed)}',
        '.aib-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
        '.aib-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
        '.aib-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
        '.aib-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}',
        '.aib-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
        '.aib-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
        '.aib-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;font-size:14px}',
        '.aib-chevronOpen{transform:rotate(180deg)}',
        '.aib-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}',
        '.aib-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}',
        '.aib-field+.aib-field{border-top:1px solid var(--dsw-alias-border-l2)}',
        '.aib-fieldHead{align-items:center;gap:8px;display:flex}',
        '.aib-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}',
        '.aib-badges{align-items:center;gap:8px;display:inline-flex}',
        '.aib-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}',
        '.aib-badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}',
        '.aib-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}',
        '.aib-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
        '.aib-reset:disabled{cursor:default}',
        '.aib-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}',
        '.aib-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
        '.aib-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
        '.aib-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
        '.aib-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}',
        '.aib-failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}',
        '.aib-discard,.aib-save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
        '.aib-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}',
        '.aib-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
        '.aib-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
        '.aib-discard:disabled,.aib-save:disabled{opacity:.4;cursor:default}',
      ].join('')
      const tag = document.createElement('style')
      tag.dataset.aib = 'agent-in-browser'
      tag.textContent = css
      document.head.appendChild(tag)
    })()

    const FIELDS = [
      { key: 'port', label: '监听端口', type: 'number', hint: 'DSH 侧 WebSocket 服务端监听端口（默认 38745）。' },
      { key: 'token', label: '令牌（token）', type: 'text', hint: '需与扩展「选项」里的令牌一致（默认 agent-in-browser）。' },
      { key: 'host', label: '监听地址', type: 'text', hint: '仅监听本机环回地址（默认 127.0.0.1）。' },
      { key: 'commandTimeoutMs', label: '命令超时（ms）', type: 'number', hint: '单条浏览器命令的等待上限（默认 30000）。' },
    ]

    function ConfigCard(props) {
      const scope = props.scope
      const [snap, setSnap] = React.useState(scope.getSnapshot())
      const [drafts, setDrafts] = React.useState({})
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => scope.subscribe(() => setSnap(scope.getSnapshot())), [scope])

      const value = snap.value || {}
      const user = snap.user || {}
      const isOverridden = (key) => Object.prototype.hasOwnProperty.call(user, key)
      const draft = (key) => (key in drafts ? drafts[key] : String(value[key] ?? ''))
      const setDraft = (key, text) => setDrafts((d) => ({ ...d, [key]: text }))
      const dirty = FIELDS.some((f) => String(value[f.key] ?? '') !== draft(f.key))

      const save = async () => {
        try {
          for (const f of FIELDS) {
            const raw = draft(f.key)
            if (f.type === 'number') await scope.set(f.key, Number(raw) || (f.key === 'port' ? 38745 : 30000))
            else await scope.set(f.key, String(raw || (f.key === 'token' ? 'agent-in-browser' : '127.0.0.1')))
          }
          setDrafts({})
        } catch {
          /* keep drafts so the user can correct */
        }
      }
      const discard = () => setDrafts({})
      const restoreDefault = async (key) => {
        await scope.unset(key).catch(() => {})
        setDrafts((d) => ({ ...d, [key]: String(value[key] ?? '') }))
      }

      const field = (f) =>
        React.createElement('div', { key: f.key, className: 'aib-field' },
          React.createElement('div', { className: 'aib-fieldHead' },
            React.createElement('span', { className: 'aib-label' }, f.label),
            React.createElement('span', { className: 'aib-badges' },
              isOverridden(f.key)
                ? React.createElement('span', { className: 'aib-badge' }, '已覆盖')
                : React.createElement('span', { className: 'aib-badgeMuted' }, '未覆盖'),
              React.createElement('button', { className: 'aib-reset', onClick: () => restoreDefault(f.key), disabled: !snap.writable }, '恢复默认'),
            ),
          ),
          React.createElement('input', {
            type: f.type,
            value: draft(f.key),
            disabled: !snap.writable,
            onChange: (e) => setDraft(f.key, e.target.value),
            className: 'aib-input',
          }),
          React.createElement('p', { className: 'aib-hint' }, f.hint),
        )

      if (snap.status !== 'ready') {
        return React.createElement('div', { className: 'aib-card' },
          React.createElement('div', { className: 'aib-header' },
            React.createElement('div', { className: 'aib-headText' },
              React.createElement('span', { className: 'aib-name' }, 'agent-in-browser'),
              React.createElement('span', { className: 'aib-description' }, 'WebSocket 服务端地址与令牌'),
            ),
          ),
        )
      }

      return React.createElement('div', { className: 'aib-card ' + (open ? 'aib-cardOpen' : '') },
        React.createElement('button', { className: 'aib-header', onClick: () => setOpen((o) => !o) },
          React.createElement('div', { className: 'aib-headText' },
            React.createElement('span', { className: 'aib-name' }, 'agent-in-browser'),
            React.createElement('span', { className: 'aib-description' }, 'WebSocket 服务端地址与令牌'),
          ),
          dirty ? React.createElement('span', { className: 'aib-badge' }, '未保存') : null,
          React.createElement('svg', { className: 'aib-chevron ' + (open ? 'aib-chevronOpen' : ''), width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true },
            React.createElement('path', { d: 'M3.5 5.5L7 9L10.5 5.5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ),
        ),
        open
          ? React.createElement('div', { className: 'aib-body' },
              ...FIELDS.map(field),
              React.createElement('div', { className: 'aib-footer' },
                React.createElement('p', { className: 'aib-failed' }, ''),
                React.createElement('button', { className: 'aib-discard', onClick: discard, disabled: !dirty || !snap.writable }, '放弃修改'),
                React.createElement('button', { className: 'aib-save', onClick: save, disabled: !snap.writable }, '保存'),
              ),
            )
          : null,
      )
    }

    const name = 'agent-in-browser'
    const inject = ['slots', 'settingsScope']

    function apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: NS })
      ctx.effect(() => ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register(
          { name: 'settings.plugin.item', key: NS },
          () => React.createElement(ConfigCard, { scope }),
        ),
      ), 'agent-in-browser.config-card')
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
