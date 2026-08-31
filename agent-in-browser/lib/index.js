// @chris/agent-in-browser host plugin entry (Cordis contract).
import { AgentInBrowserServer } from './host/server.js'
import { registerBrowserTools } from './host/tools.js'
import { DEFAULT_PORT, DEFAULT_TOKEN } from './protocol/types.js'

export const name = 'agent-in-browser'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const server = new AgentInBrowserServer({
    port: config.port ?? DEFAULT_PORT,
    token: config.token ?? DEFAULT_TOKEN,
    host: config.host ?? '127.0.0.1',
    commandTimeoutMs: config.commandTimeoutMs ?? 30000,
  })

  const log = (...a) => ctx.logger?.info?.(...a)
  server.setCallbacks({
    onConnect: () => log('agent-in-browser: browser connected'),
    onDisconnect: () => log('agent-in-browser: browser disconnected'),
  })

  ctx.effect(() => {
    server.start()
    return () => server.stop()
  }, 'agent-in-browser.server')

  registerBrowserTools(ctx, server)
}
