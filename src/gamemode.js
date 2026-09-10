/*
 * Minecraft's four game modes.
 *
 * A mode is not a switch, it is a set of permissions, and the permissions are
 * the interesting part -- so this file is a table plus the code that makes the
 * table visible. Nothing here decides WHO may change mode; that is
 * authority.js, which imports the table below and grants or refuses. This
 * module only applies a mode that has already been granted.
 *
 * ADVENTURE IS THE DEFAULT, and that is a content decision rather than a
 * gameplay one. This world exists to show a resume as things you walk up to.
 * A visitor who can mine is a visitor who can quietly delete the point of the
 * site, and they will, because a Minecraft world with a pickaxe in it is an
 * invitation. Adventure keeps the walking, the looking and the falling, and
 * takes away only the vandalism.
 *
 * Vanilla's numeric ids are recorded because they are world data -- the day a
 * mode is persisted or sent over a socket, it goes as 0-3, not as a string.
 */

export const DEFAULT_GAMEMODE = 'adventure'

/*
 * `caps` is the whole contract between a mode and the rest of the codebase.
 * Every gate reads one of these fields; nothing anywhere tests the mode name
 * directly, so adding a fifth mode is a row here rather than a grep.
 */
export const GAMEMODES = {
  survival: {
    id: 0,
    label: 'Survival Mode',
    caps: {
      mayBuild: true, mayBreak: true, instantBreak: false, infiniteResources: false,
      damage: true, hunger: true,
      mayFly: false, startsFlying: false, noClip: false,
      visible: true, hud: 'full',
    },
  },
  creative: {
    id: 1,
    label: 'Creative Mode',
    caps: {
      mayBuild: true, mayBreak: true, instantBreak: true, infiniteResources: true,
      damage: false, hunger: false,
      mayFly: true, startsFlying: false, noClip: false,
      // Vanilla drops hearts, hunger and the XP bar in creative: they are all
      // stuck at full, and a full row of hearts that can never move is noise.
      visible: true, hud: 'hotbar-only',
    },
  },
  adventure: {
    id: 2,
    label: 'Adventure Mode',
    caps: {
      mayBuild: false, mayBreak: false, instantBreak: false, infiniteResources: false,
      damage: true, hunger: true,
      mayFly: false, startsFlying: false, noClip: false,
      visible: true, hud: 'full',
    },
  },
  spectator: {
    id: 3,
    label: 'Spectator Mode',
    caps: {
      mayBuild: false, mayBreak: false, instantBreak: false, infiniteResources: false,
      damage: false, hunger: false,
      mayFly: true, startsFlying: true, noClip: true,
      visible: false, hud: 'none',
    },
  },
}

/** Every mode name, for /gamemode's error message and for tab-completion later. */
export const GAMEMODE_NAMES = Object.keys(GAMEMODES)

/*
 * The visible consequences of a mode: what flies, what collides, what is
 * drawn. Split from the table so the table stays readable as data.
 *
 * `flight` comes from physics.js because flight is movement, and movement
 * constants and their calibration notes all live together there. No `noa`
 * argument, unlike every other install* in this codebase: everything a mode
 * changes is reached through one of the three systems above, and taking the
 * engine anyway would invite this file to start poking at it directly.
 */
export function installGamemode({ flight, perspective, held }) {
  let caps = GAMEMODES[DEFAULT_GAMEMODE].caps

  /*
   * Babylon's `isVisible` rather than `setEnabled`, and this is the subtle
   * bit: perspective.js and heldItem.js both drive `setEnabled` on these
   * meshes every time you press F5 or change hotbar slot. Writing setEnabled
   * here would be overwritten within the tick. `isVisible` is a separate
   * channel neither of them touches, so a spectator stays invisible through
   * every perspective change without either module knowing this file exists.
   */
  const meshesOf = (node) =>
    node ? [node, ...(node.getChildMeshes?.() ?? [])].filter(m => 'isVisible' in m) : []

  const bodyMeshes = meshesOf(perspective?.model?.root)
  const handMeshes = [...meshesOf(held?.mesh), ...meshesOf(held?.arm)]

  const el = (id) => document.getElementById(id)
  const HUD_PARTS = {
    status: el('status'),   // hearts + hunger
    xp: el('xp-row'),
    hotbar: el('hotbar'),
    heldName: el('held-name'),
    crosshair: el('crosshair'),
  }

  const showHud = (which) => {
    const survivalBars = which === 'full'
    const anything = which !== 'none'
    HUD_PARTS.status.style.display = survivalBars ? '' : 'none'
    HUD_PARTS.xp.style.display = survivalBars ? '' : 'none'
    HUD_PARTS.hotbar.style.display = anything ? '' : 'none'
    HUD_PARTS.heldName.style.display = anything ? '' : 'none'
    // Vanilla keeps the crosshair in creative -- you still aim at blocks --
    // and drops it in spectator, where there is nothing to aim at.
    HUD_PARTS.crosshair.style.display = anything ? '' : 'none'
  }

  const apply = (mode) => {
    caps = GAMEMODES[mode].caps
    flight.setAbilities(caps)
    for (const m of bodyMeshes) m.isVisible = caps.visible
    for (const m of handMeshes) m.isVisible = caps.visible
    showHud(caps.hud)
  }

  /*
   * F5 rebuilds nothing, but it does re-enable the player model, and a
   * spectator who presses it would otherwise pop into view for as long as
   * they stayed in third person. Re-applying visibility after perspective.js
   * has had its turn is cheaper than fighting it per tick -- this listener is
   * registered later, so it runs later.
   */
  document.addEventListener('keydown', (e) => {
    if (e.code === 'F5') for (const m of bodyMeshes) m.isVisible = caps.visible
  })

  apply(DEFAULT_GAMEMODE)

  return { apply, get caps() { return caps } }
}
