import { slotLabel } from '@shared/editMode'
import { itemLabel, type PalaceRoom } from '@shared/palace'
import type { InventoryReason } from '@shared/placements'

const REASON: Record<InventoryReason, string> = {
  hidden: 'Hidden by you',
  replaced: 'Replaced by an upgrade',
  no_free_slot: 'Its spot is taken',
  needs_host: 'Needs what it stands on',
  invalid_slot: 'Its spot no longer exists'
}

const chip = 'rounded-full border border-brass/50 px-2.5 py-0.5 text-xs hover:bg-raised disabled:opacity-50'

/**
 * The room editor: what stands in the room and what waits in its inventory.
 * Choose an item, then a spot (here or on the outlined floor); hide, re-skin
 * or reset it. The main process checks every change again.
 */
export function InventoryDrawer({
  room,
  roomIds,
  selected,
  onSelect,
  onPlace,
  onVariant,
  onHide,
  onReset,
  onDone
}: {
  room: PalaceRoom
  roomIds: readonly string[]
  selected: string | null
  onSelect: (instance: string | null) => void
  onPlace: (instance: string, slot: string) => void
  onVariant: (instance: string, variant: string | null) => void
  onHide: (instance: string, hidden: boolean) => void
  onReset: (instance: string) => void
  onDone: () => void
}) {
  const targets = selected ? (room.editor.targets[selected] ?? []) : []
  const name = (item: string): string => itemLabel(item, roomIds)

  const row = (instance: string, item: string, where: string, userPlaced: boolean, hidden: boolean) => {
    const variants = room.editor.variants[item] ?? []
    const isSelected = selected === instance
    const movable = (room.editor.targets[instance] ?? []).length > 0
    return (
      <li key={instance} className={`flex flex-col gap-1.5 rounded-md px-3 py-2 ${isSelected ? 'bg-raised ring-1 ring-gold' : 'bg-ink-soft'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{name(item)}</span>
          <span className="text-xs text-muted">{where}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={chip} disabled={!movable} onClick={() => onSelect(isSelected ? null : instance)} aria-pressed={isSelected}>
            {isSelected ? 'Cancel' : movable ? 'Move' : 'No free spot'}
          </button>
          <button type="button" className={chip} onClick={() => onHide(instance, !hidden)}>
            {hidden ? 'Show' : 'Hide'}
          </button>
          {variants.length > 0 && (
            <label className="flex items-center gap-1 text-xs">
              <span className="sr-only">Look of {name(item)}</span>
              <select
                className="rounded border border-brass/50 bg-walnut px-1 py-0.5"
                defaultValue=""
                onChange={(event) => onVariant(instance, event.target.value || null)}
              >
                <option value="">Default look</option>
                {variants.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
          {userPlaced && (
            <button type="button" className={chip} onClick={() => onReset(instance)}>
              Reset
            </button>
          )}
        </div>
        {isSelected && (
          <div className="flex flex-wrap gap-1.5" aria-label={`Spots for ${name(item)}`}>
            {targets.map((slot) => (
              <button key={slot} type="button" className={`${chip} border-gold text-gold`} onClick={() => onPlace(instance, slot)}>
                {slotLabel(slot)}
              </button>
            ))}
          </div>
        )}
      </li>
    )
  }

  return (
    <section aria-label={`Arrange the ${room.name}`} className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Arrange the room</h3>
        <button type="button" onClick={onDone} className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-ink">
          Done
        </button>
      </header>
      <p className="text-xs text-muted">
        Choose Move, then a spot below or an outlined spot in the room. What you place stays where you put it; new things land in a free spot.
      </p>
      <ul className="flex flex-col gap-1.5" aria-label="In the room">
        {room.placed.map((p) => row(p.instance, p.item, slotLabel(p.slot), p.userPlaced, false))}
      </ul>
      {room.inventory.length > 0 && (
        <>
          <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">Inventory</h4>
          <ul className="flex flex-col gap-1.5" aria-label="Inventory">
            {room.inventory.map((i) => row(i.instance, i.item, REASON[i.reason], true, i.reason === 'hidden'))}
          </ul>
        </>
      )}
    </section>
  )
}
