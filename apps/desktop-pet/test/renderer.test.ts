import assert from 'node:assert/strict'
import test from 'node:test'

import {
  animationNameForState,
  bubbleText,
  nextClickSkill,
} from '../src/renderer'

test('maps display states to pet animation rows', () => {
  assert.equal(animationNameForState('idle'), 'idle')
  assert.equal(animationNameForState('running'), 'running')
  assert.equal(animationNameForState('working'), 'running')
  assert.equal(animationNameForState('waiting'), 'waiting')
  assert.equal(animationNameForState('blocked'), 'failed')
  assert.equal(animationNameForState('failed'), 'failed')
  assert.equal(animationNameForState('ready'), 'review')
})

test('cycles click skills in package order', () => {
  assert.equal(nextClickSkill(null, ['amaterasu', 'kirin']), 'amaterasu')
  assert.equal(nextClickSkill('amaterasu', ['amaterasu', 'kirin']), 'kirin')
  assert.equal(nextClickSkill('kirin', ['amaterasu', 'kirin']), 'amaterasu')
  assert.equal(nextClickSkill(null, []), null)
})

test('renders human-readable bubbles', () => {
  assert.equal(bubbleText('idle'), '空闲')
  assert.equal(bubbleText('thinking'), '思考中')
  assert.equal(bubbleText('waitingApproval'), '等待批准')
  assert.equal(bubbleText('executingTool', { name: 'bash' }), '执行工具: bash')
  assert.equal(bubbleText('executingTool', { name: 'bash' }, 'en'), 'Running tool: bash')
})
