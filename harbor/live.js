// Cross-module flags. Walk / tour / orbit and the exhibit HUD share one district.
export const live = {
  showHud: false,
  walkMode: false,
  tourMode: false,
  // Filled once the owning function exists (hoisted tick, post renderFrame).
  tick: null,
  renderFrame: null,
  // Street-atlas callback, installed when quay prop wear is ready.
  onStreetPropWear: null,
};
