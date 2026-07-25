// $lib/components/panels/settingsPanel.svelte.ts

class SettingsPanelStore {
  searchQuery = $state("");

  clearSearch() {
    this.searchQuery = "";
  }
}

const KEY = Symbol.for('unigen.renderer.settingsPanelStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const settingsPanelStore: SettingsPanelStore = ((globalThis as any)[KEY] ??= new SettingsPanelStore());