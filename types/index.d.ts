export type ShowSwitchWarning = boolean

declare module 'claude-code' {
  interface PluginState {
    'model-router': { showSwitchWarning: ShowSwitchWarning }
  }
}
