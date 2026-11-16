import { describe, expect, it } from 'vitest'
import { computeRoomState } from '../src/shared/engine'
import { progressMarks } from '../src/shared/progress'
import { catalog, chatsOn, run } from './helpers'

const stateWith = (roomId: string, days: number) =>
  computeRoomState(roomId, chatsOn(roomId, run('2026-11-30', days)), catalog, '2026-12-04')

describe('progressMarks', () => {
  it('returns the new marks for a room whose best streak rose', () => {
    expect(progressMarks([stateWith('coding', 5)], { coding: { bestStreak: 3, goalCount: 0 } })).toEqual([
      { roomId: 'coding', bestStreak: 5, goalCount: 0 }
    ])
  })

  it('returns nothing for a room at or below its marks', () => {
    expect(progressMarks([stateWith('coding', 5)], { coding: { bestStreak: 5, goalCount: 0 } })).toEqual([])
    expect(progressMarks([stateWith('coding', 2)], { coding: { bestStreak: 9, goalCount: 1 } })).toEqual([])
  })

  it('records a room with no marks yet only once it has earned something', () => {
    expect(progressMarks([stateWith('coding', 0)], {})).toEqual([])
    expect(progressMarks([stateWith('coding', 2)], {})).toEqual([{ roomId: 'coding', bestStreak: 2, goalCount: 0 }])
  })

  it('never lowers a mark that is already higher', () => {
    expect(progressMarks([stateWith('coding', 5)], { coding: { bestStreak: 2, goalCount: 4 } })).toEqual([
      { roomId: 'coding', bestStreak: 5, goalCount: 4 }
    ])
  })
})
