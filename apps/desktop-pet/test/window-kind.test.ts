import assert from 'node:assert/strict'
import test from 'node:test'

import { detectWindowKind } from '../src/window-kind'

test('detects the settings window from query string', () => {
  assert.equal(detectWindowKind('?window=settings'), 'settings')
  assert.equal(detectWindowKind('?foo=1&window=settings&bar=2'), 'settings')
})

test('defaults to the pet window', () => {
  assert.equal(detectWindowKind(''), 'pet')
  assert.equal(detectWindowKind('?window=pet'), 'pet')
  assert.equal(detectWindowKind('?other=1'), 'pet')
})
