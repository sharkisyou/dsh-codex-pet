import { protocolSchema, type PetEvent } from './generated/protocol.js'

type SchemaNode = Record<string, any>

export interface PetEventEnvelope {
  /** Source tool, e.g. "dsh", "codex", or "claude". Open string, not an enum. */
  agent: string
  /** Session id as scoped by the source tool. */
  sessionId: string
  /** Optional event discriminator; the full event set is documented in schema/events.schema.json. */
  type?: string
  [key: string]: unknown
}

export type PetEventValidationResult =
  | { ok: true; valid: true; value: PetEvent }
  | { ok: false; valid: false; value: undefined; errors: string[] }

function resolveRef(ref: string): SchemaNode {
  const parts = ref.replace(/^#\//, '').split('/')
  let node: unknown = protocolSchema
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) {
      throw new Error(`Cannot resolve JSON Schema $ref: ${ref}`)
    }
    node = (node as Record<string, unknown>)[part]
  }
  return node as SchemaNode
}

function checkType(schema: SchemaNode, value: unknown, path: string, errors: string[]): boolean {
  const expected = schema.type
  if (expected === undefined) return true
  const list = Array.isArray(expected) ? expected : [expected]

  const checkOne = (type: string): boolean => {
    switch (type) {
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value)
      case 'array':
        return Array.isArray(value)
      case 'string':
        return typeof value === 'string'
      case 'number':
        return typeof value === 'number' && Number.isFinite(value)
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value)
      case 'boolean':
        return typeof value === 'boolean'
      case 'null':
        return value === null
      default:
        return true
    }
  }

  if (!list.some(checkOne)) {
    errors.push(`${path}: expected ${list.join(' or ')}, got ${value === null ? 'null' : typeof value}`)
    return false
  }

  if (typeof value === 'string' && typeof schema.minLength === 'number' && value.length < schema.minLength) {
    errors.push(`${path}: string is shorter than minLength ${schema.minLength}`)
    return false
  }
  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) {
    errors.push(`${path}: number is smaller than minimum ${schema.minimum}`)
    return false
  }
  return true
}

function validateNode(schema: SchemaNode, value: unknown, path = '$', errors: string[] = []): boolean {
  if (schema.$ref !== undefined) {
    return validateNode(resolveRef(schema.$ref), value, path, errors)
  }

  let ok = true
  ok = checkType(schema, value, path, errors) && ok

  if (schema.const !== undefined) {
    if (value !== schema.const) {
      errors.push(`${path}: expected ${JSON.stringify(schema.const)}`)
      ok = false
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: value ${JSON.stringify(value)} is not one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`)
    ok = false
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const validCount = schema.oneOf.filter((alt: SchemaNode) => validateNode(alt, value, path, [])).length
    if (validCount !== 1) {
      errors.push(`${path}: expected exactly one matching event variant, matched ${validCount}`)
      ok = false
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      const subOk = validateNode(sub, value, path, errors)
      ok = subOk && ok
    }
  }

  if (schema.type === 'object' || schema.properties) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return ok
    }
    const record = value as Record<string, unknown>
    const properties: Record<string, SchemaNode> = schema.properties ?? {}
    for (const key of Object.keys(record)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        const childOk = validateNode(properties[key], record[key], `${path}.${key}`, errors)
        ok = childOk && ok
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: additional property is not allowed`)
        ok = false
      }
    }
    const required: string[] = schema.required ?? []
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        errors.push(`${path}.${key}: required property is missing`)
        ok = false
      }
    }
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) return ok
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: array has fewer than minItems ${schema.minItems}`)
      ok = false
    }
    if (schema.uniqueItems === true) {
      const seen = new Set<string>()
      for (const item of value) {
        const key = JSON.stringify(item)
        if (seen.has(key)) {
          errors.push(`${path}: array items must be unique`)
          ok = false
          break
        }
        seen.add(key)
      }
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        const childOk = validateNode(schema.items as SchemaNode, item, `${path}[${index}]`, errors)
        ok = childOk && ok
      })
    }
  }

  return ok
}

export function validatePetEvent(value: unknown): PetEventValidationResult {
  const errors: string[] = []
  const ok = validateNode(protocolSchema as SchemaNode, value)
  if (ok) {
    return { ok: true, valid: true, value: value as PetEvent }
  }
  return { ok: false, valid: false, value: undefined, errors }
}

export function isPetEvent(value: unknown): value is PetEvent {
  return validatePetEvent(value).ok
}

export function isValidPetEvent(value: unknown): boolean {
  return validatePetEvent(value).ok
}

export function assertPetEvent(value: unknown): asserts value is PetEvent {
  const result = validatePetEvent(value)
  if (!result.ok) {
    throw new TypeError(`Invalid desktop pet wire protocol event:\n- ${result.errors.join('\n- ')}`)
  }
}

export function parsePetEvent(value: unknown): PetEvent {
  assertPetEvent(value)
  return value
}

export function isPetEventEnvelope(value: unknown): value is PetEventEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.agent === 'string' && typeof record.sessionId === 'string'
}
