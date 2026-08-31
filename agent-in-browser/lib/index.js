// @chris/agent-in-browser host plugin entry (Cordis contract).
//
// Serves an editable settings namespace (`agent-in-browser`) in the DSH web
// settings, so the plugin appears under 设置 → 插件 → 插件配置, and reads its
// effective config from that namespace (composition base merged with the user
// layer). Registration tools expose the browser_* commands over the WebSocket.
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { AgentInBrowserServer } from './host/server.js'
import { registerBrowserTools } from './host/tools.js'
import { DEFAULT_PORT, DEFAULT_TOKEN } from './protocol/types.js'

export const name = 'agent-in-browser'
export const inject = ['tools']

/** The settings namespace this plugin serves in the web settings surface. */
export const SETTINGS_NAMESPACE = settingsNamespace('agent-in-browser')

export const Config = z.object({
  port: z.number().step(1).min(1).max(65535).default(DEFAULT_PORT),
  token: z.string().min(3).default(DEFAULT_TOKEN),
  host: z.string().default('127.0.0.1'),
  commandTimeoutMs: z.number().step(1).min(100).default(30000),
})

export function apply(ctx, config = {}) {
  // `current()` yields the effective config: the composition entry merged with
  // whatever the user stored in the settings namespace (when the settings
  // service is mounted). Falls back to the composition config otherwise.
  //
  // When the settings service mounts, `installSettingsSection` calls `setSource`
  // and then `onChange`. We must not read `current()` synchronously at startup:
  // the settings-injection callback may run after the effect below, at which
  // point `current` would still be the composition fallback and the saved
  // user overrides (e.g. host) would be ignored. Instead `startServer()` reads
  // the latest source and (re)binds — so whether the inject callback is
  // synchronous or async, the running WebSocket server ends up on the
  // user-overridden values.
  let current = () => config
  let server = null
  let toolsRegistered = false

  const startServer = () => {
    const cfg = current()
    if (!server) {
      server = new AgentInBrowserServer({
        port: cfg.port ?? DEFAULT_PORT,
        token: cfg.token ?? DEFAULT_TOKEN,
        host: cfg.host ?? '127.0.0.1',
        commandTimeoutMs: cfg.commandTimeoutMs ?? 30000,
      })
      server.setCallbacks({
        onConnect: () => ctx.logger?.info?.('agent-in-browser: browser connected'),
        onDisconnect: () => ctx.logger?.info?.('agent-in-browser: browser disconnected'),
      })
    }
    // `applyConfig` rebinds only when a listener-facing value changed, so an
    // unchanged onChange (e.g. the settings-service mount/unmount cycle) does
    // not drop the browser connection.
    server.applyConfig({
      port: cfg.port ?? DEFAULT_PORT,
      token: cfg.token ?? DEFAULT_TOKEN,
      host: cfg.host ?? '127.0.0.1',
      commandTimeoutMs: cfg.commandTimeoutMs ?? 30000,
    })
    server.start()
    if (!toolsRegistered) {
      registerBrowserTools(ctx, server)
      toolsRegistered = true
    }
  }

  installSettingsSection(ctx, SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // Fires right after `setSource`, and again on every settings change — the
    // exact signal that `current()` now reflects the user layer. Reading here
    // (rather than synchronously at startup) is what makes saved overrides
    // actually bind. The library already guards this against unloading.
    onChange: () => startServer(),
  })

  ctx.effect(() => {
    // Fallback when the settings service never mounts: start with the
    // composition config so the plugin still works exactly as composed.
    startServer()
    return () => server?.stop()
  }, 'agent-in-browser.server')
}
