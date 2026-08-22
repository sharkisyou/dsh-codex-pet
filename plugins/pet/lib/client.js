window.__ModuleLoader__.load({
  id: '@yshark/dsh-codex-pet',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const RPC_PREFIX = '/pet/bridge'
    const POLL_MS = 1000

    const PET_CSS = `
.dsh-pet-settings { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; }
.dsh-pet-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dsh-pet-settings-label { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary, inherit); }
.dsh-pet-settings-status { font-size: 12px; color: var(--dsw-alias-label-tertiary, #888); }
.dsh-pet-settings-btn {
  background: var(--dsw-alias-bg-module-platform, rgba(128,128,128,.08));
  color: var(--dsw-alias-label-primary, #1f1f1f);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.15));
  border-radius: 8px; padding: 5px 12px; font-size: 12px; font-weight: 500; cursor: pointer;
}
.dsh-pet-settings-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
.dsh-pet-settings-btn:disabled { opacity: .45; cursor: not-allowed; }
.dsh-pet-settings-error { font-size: 12px; color: var(--dsw-alias-state-error-primary, #f66); }
`

    function statusText(status) {
      if (!status || typeof status !== 'object') return '状态未知'
      if (!status.enabled) return '已停用'
      if (status.connected) return '已连接'
      if (status.connecting) return '连接中…'
      return '未连接'
    }

    async function rpc(method, body) {
      const res = await fetch(`${RPC_PREFIX}/${method}`, {
        method: method === 'status' ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: method === 'status' ? undefined : JSON.stringify(body || {}),
      })
      return res.json()
    }

    function PetSettingsPanel() {
      const [status, setStatus] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      async function refresh() {
        try {
          const result = await rpc('status')
          if (result && result.ok) setStatus(result)
          else setError(result && result.error ? result.error : '读取状态失败')
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }

      React.useEffect(() => {
        refresh()
        const timer = setInterval(refresh, POLL_MS)
        return () => clearInterval(timer)
      }, [])

      async function toggleEnabled() {
        setBusy(true)
        setError(null)
        try {
          const next = !(status && status.enabled)
          const result = await rpc('enabled', { enabled: next })
          if (result && result.ok) setStatus(result)
          else setError(result && result.error ? result.error : '切换失败')
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      async function openDesktopPet() {
        setBusy(true)
        setError(null)
        try {
          const result = await rpc('open')
          if (result && result.ok && result.hint) setError(result.hint)
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      return React.createElement(
        'div',
        { className: 'dsh-pet-settings' },
        React.createElement(
          'label',
          { className: 'dsh-pet-settings-row' },
          React.createElement('input', {
            type: 'checkbox',
            checked: Boolean(status && status.enabled),
            onChange: toggleEnabled,
            disabled: busy,
          }),
          React.createElement('span', { className: 'dsh-pet-settings-label' }, '启用开关（桌宠桥接）'),
        ),
        React.createElement(
          'div',
          { className: 'dsh-pet-settings-row' },
          React.createElement('span', { className: 'dsh-pet-settings-label' }, '连接状态'),
          React.createElement('span', { className: 'dsh-pet-settings-status' }, statusText(status)),
          React.createElement('button', {
            className: 'dsh-pet-settings-btn',
            onClick: openDesktopPet,
            disabled: busy,
          }, '打开桌宠'),
        ),
        error ? React.createElement('div', { className: 'dsh-pet-settings-error' }, error) : null,
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => {
          if (typeof document === 'undefined') return
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-pet-settings'
          tag.textContent = PET_CSS
          document.head.append(tag)
          return () => tag.remove()
        }, 'dsh-pet: settings styles')
      }

      if (ctx && ctx.slots && typeof ctx.slots.inject === 'function') {
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          {
            name: 'settings.section',
            id: 'pet',
            order: 30,
            label: () => '桌宠',
          },
          () => React.createElement(PetSettingsPanel),
        ))
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
