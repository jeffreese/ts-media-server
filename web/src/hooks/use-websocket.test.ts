import { describe, it, expect } from 'vitest'
import { parseMessage } from '~/hooks/use-websocket'

describe('parseMessage', () => {
  it('parses a full notification message', () => {
    const result = parseMessage('create,mediaItem,42,7')
    expect(result).toMatchObject({
      action: 'create',
      source: 'mediaItem',
      id: '42',
      userId: '7',
    })
    expect(result?.timestamp).toBeGreaterThan(0)
  })

  it('handles missing id and userId', () => {
    const result = parseMessage('update,setting,,')
    expect(result).toMatchObject({
      action: 'update',
      source: 'setting',
      id: '',
      userId: '',
    })
  })

  it('handles progress messages with encoded data', () => {
    const result = parseMessage('progress,fileIndex,indexing:42/100,')
    expect(result).toMatchObject({
      action: 'progress',
      source: 'fileIndex',
      id: 'indexing:42/100',
      userId: '',
    })
  })

  it('returns null for messages with fewer than 2 parts', () => {
    expect(parseMessage('single')).toBeNull()
    expect(parseMessage('')).toBeNull()
  })

  it('handles action and source only', () => {
    const result = parseMessage('delete,folder')
    expect(result).toMatchObject({
      action: 'delete',
      source: 'folder',
      id: '',
      userId: '',
    })
  })
})
