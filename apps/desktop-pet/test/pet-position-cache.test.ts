/**
 * 宠物窗位置本地兜底缓存的纯函数测试：
 *  - 读：缺失/损坏/非有限数 → null（坏档不能让宠物跳去诡异位置）；
 *  - 写：取整落盘、storage 抛错时静默；
 *  - 冲突：本地优先于服务端；容差内视为一致（不必回推）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PET_WINDOW_POS_KEY,
  POSITION_TOLERANCE_PX,
  positionsDiffer,
  preferredRestorePosition,
  readLocalWindowPos,
  writeLocalWindowPos,
  type StorageLike,
} from '../src/pet-position-cache'

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
}

test('读写往返：位置取整后落盘并能读回', () => {
  const storage = fakeStorage()
  writeLocalWindowPos(storage, { x: 1404.4, y: 386.6 })
  assert.equal(storage.data[PET_WINDOW_POS_KEY], '{"x":1404,"y":387}')
  assert.deepEqual(readLocalWindowPos(storage), { x: 1404, y: 387 })
})

test('缺失 / 损坏 / 非有限数一律返回 null', () => {
  assert.equal(readLocalWindowPos(fakeStorage()), null)
  assert.equal(readLocalWindowPos(fakeStorage({ [PET_WINDOW_POS_KEY]: 'not json' })), null)
  assert.equal(readLocalWindowPos(fakeStorage({ [PET_WINDOW_POS_KEY]: '"1404,387"' })), null)
  assert.equal(readLocalWindowPos(fakeStorage({ [PET_WINDOW_POS_KEY]: '{"x":1404}' })), null)
  assert.equal(readLocalWindowPos(fakeStorage({ [PET_WINDOW_POS_KEY]: '{"x":null,"y":387}' })), null)
  assert.equal(readLocalWindowPos(fakeStorage({ [PET_WINDOW_POS_KEY]: '{"x":1e9999,"y":387}' })), null)
  assert.equal(readLocalWindowPos(fakeStorage({ [PET_WINDOW_POS_KEY]: '{"x":"1404","y":387}' })), null)
})

test('storage 不可用（隐私模式 / 抛错）时读写都退化为 no-op', () => {
  const storage = throwingStorage()
  assert.equal(readLocalWindowPos(storage), null)
  assert.doesNotThrow(() => writeLocalWindowPos(storage, { x: 1, y: 2 }))
  assert.equal(readLocalWindowPos(null), null)
  assert.doesNotThrow(() => writeLocalWindowPos(null, { x: 1, y: 2 }))
})

test('启动恢复位置：本地优先，没有本地值才用服务端', () => {
  assert.deepEqual(preferredRestorePosition({ x: 10, y: 20 }, { x: 99, y: 99 }), { x: 10, y: 20 })
  assert.deepEqual(preferredRestorePosition(null, { x: 99, y: 99 }), { x: 99, y: 99 })
  assert.equal(preferredRestorePosition(null, null), null)
})

test('位置差异判定：容差内一致，只有一侧有值算不同', () => {
  assert.equal(positionsDiffer({ x: 10, y: 20 }, { x: 10, y: 20 }), false)
  assert.equal(positionsDiffer({ x: 10, y: 20 }, { x: 11, y: 20 }), false) // 容差 1px
  assert.equal(positionsDiffer({ x: 10, y: 20 }, { x: 12, y: 20 }), true)
  assert.equal(positionsDiffer({ x: 10, y: 20 }, null), true)
  assert.equal(positionsDiffer(null, null), false)
  assert.equal(positionsDiffer({ x: 10, y: 20 }, { x: 14, y: 20 }, 4), false)
  assert.equal(POSITION_TOLERANCE_PX, 1)
})
