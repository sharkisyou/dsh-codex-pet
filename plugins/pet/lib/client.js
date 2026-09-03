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
      const base = typeof window !== 'undefined' && window.location && window.location.origin
        ? window.location.origin
        : ''
      const res = await globalThis.fetch(`${base}${RPC_PREFIX}/${method}`, {
        method: method === 'status' ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: method === 'status' ? undefined : JSON.stringify(body || {}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
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

    const inject = ['slots', 'remote', 'sessions']

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

      function navigateTo(ctx, sessionId) {
        if (typeof sessionId !== 'string' || sessionId === '') return
        let sessions
        try {
          sessions = ctx.get('sessions')
        } catch {
          sessions = ctx.sessions
        }
        if (sessions && typeof sessions.open === 'function') {
          try {
            sessions.open(sessionId)
          } catch {
            // 导航失败静默；不影响托盘功能
          }
        }
      }

      function openSessionIdOf(payload) {
        return payload && (payload.sessionId ?? payload.id)
      }

      // 托盘项点击 → 桥接插件发 session/open → 宿主转发为 remote event →
      // 这里切换到对应会话。服务不可用时静默降级。
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => {
          if (!ctx.remote || typeof ctx.remote.$on !== 'function') return () => {}
          const off = ctx.remote.$on('session/open', (payload) => {
            navigateTo(ctx, openSessionIdOf(payload))
          })
          return () => { if (typeof off === 'function') off() }
        }, 'dsh-pet: session/open navigation')
      }

      // B2（不依赖 DSH 官方 allowlist）：宿主把托盘点击的“打开会话”意图存为
      // 待办，客户端常驻轮询 /pet/bridge/pending-open（GET 即取即清）取回并导航。
      // 与上面的 remote.$on 事件通道并存：allowlist 在时事件即时到达；
      // 不在（DSH 升级抹掉补丁）时由本轮询兜底，DSH 升级后无需再改官方代码。
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => {
          if (typeof globalThis.fetch !== 'function') return () => {}
          let stopped = false
          let timer = null
          const pollPending = async () => {
            if (stopped) return
            let payload = null
            try {
              const base = typeof window !== 'undefined' && window.location && window.location.origin
                ? window.location.origin
                : ''
              const res = await globalThis.fetch(`${base}${RPC_PREFIX}/pending-open`, {
                method: 'GET',
                headers: { 'content-type': 'application/json' },
                cache: 'no-store',
              })
              if (!res.ok) return
              payload = await res.json()
            } catch {
              // 网络/服务暂不可用；下一轮重试
            }
            if (!payload || !payload.ok || !Array.isArray(payload.opens)) return
            for (const entry of payload.opens) {
              navigateTo(ctx, openSessionIdOf(entry))
            }
          }
          pollPending()
          timer = setInterval(pollPending, POLL_MS)
          return () => { stopped = true; if (timer !== null) clearInterval(timer) }
        }, 'dsh-pet: session/open pending poll')
      }

      // 上报 GUI 当前会话 → 宿主据此把"非当前会话"的完成态显示到托盘；
      // 当我切到某个会话时宿主会清除它的"已完成"待办（视为已查看）。
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => {
          let sessions
          try {
            sessions = ctx.get('sessions')
          } catch {
            sessions = ctx.sessions
          }
          if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== 'function') return () => {}
          let lastReported = undefined
          const report = (current) => {
            if (current === lastReported) return
            lastReported = current
            const base = typeof window !== 'undefined' && window.location && window.location.origin
              ? window.location.origin
              : ''
            globalThis.fetch(`${base}${RPC_PREFIX}/current`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({ sessionId: current || null }),
            }).catch(() => { lastReported = undefined })
          }
          const read = () => {
            try {
              const snap = sessions.list.getSnapshot()
              const current = snap && typeof snap.current === 'string' && snap.current !== ''
                ? snap.current
                : null
              report(current)
            } catch {
              // ignore
            }
          }
          read()
          let unsubscribe = null
          if (typeof sessions.list.subscribe === 'function') {
            try {
              unsubscribe = sessions.list.subscribe(() => read())
            } catch {
              unsubscribe = null
            }
          }
          return () => { if (typeof unsubscribe === 'function') unsubscribe() }
        }, 'dsh-pet: current session reporting')
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
