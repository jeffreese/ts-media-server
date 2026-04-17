import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTriageKeyboard } from '~/hooks/use-triage-keyboard'

function fireKey(key: string, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true })
  Object.defineProperty(event, 'target', { value: target })
  document.dispatchEvent(event)
}

describe('useTriageKeyboard', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes with no focus', () => {
    const { result } = renderHook(() => useTriageKeyboard(5))
    expect(result.current.focusedIndex).toBe(-1)
  })

  it('moves focus down with ArrowDown', () => {
    const { result } = renderHook(() => useTriageKeyboard(5))

    act(() => fireKey('ArrowDown'))
    expect(result.current.focusedIndex).toBe(0)

    act(() => fireKey('ArrowDown'))
    expect(result.current.focusedIndex).toBe(1)
  })

  it('moves focus down with j', () => {
    const { result } = renderHook(() => useTriageKeyboard(5))

    act(() => fireKey('j'))
    expect(result.current.focusedIndex).toBe(0)
  })

  it('moves focus up with ArrowUp', () => {
    const { result } = renderHook(() => useTriageKeyboard(5))

    act(() => fireKey('ArrowDown'))
    act(() => fireKey('ArrowDown'))
    act(() => fireKey('ArrowDown'))
    expect(result.current.focusedIndex).toBe(2)

    act(() => fireKey('ArrowUp'))
    expect(result.current.focusedIndex).toBe(1)
  })

  it('moves focus up with k', () => {
    const { result } = renderHook(() => useTriageKeyboard(5))

    act(() => fireKey('ArrowDown'))
    act(() => fireKey('ArrowDown'))
    act(() => fireKey('k'))
    expect(result.current.focusedIndex).toBe(0)
  })

  it('clamps at boundaries', () => {
    const { result } = renderHook(() => useTriageKeyboard(2))

    // ArrowUp from unfocused is a no-op
    act(() => fireKey('ArrowUp'))
    expect(result.current.focusedIndex).toBe(-1)

    // ArrowDown enters focus at 0
    act(() => fireKey('ArrowDown'))
    expect(result.current.focusedIndex).toBe(0)

    act(() => fireKey('ArrowDown'))
    act(() => fireKey('ArrowDown'))
    act(() => fireKey('ArrowDown'))
    expect(result.current.focusedIndex).toBe(1)
  })

  it('clears focus on Escape', () => {
    const { result } = renderHook(() => useTriageKeyboard(5))

    act(() => fireKey('ArrowDown'))
    act(() => fireKey('ArrowDown'))
    expect(result.current.focusedIndex).toBe(1)

    act(() => fireKey('Escape'))
    expect(result.current.focusedIndex).toBe(-1)
  })

  it('calls selectAll on a', () => {
    const selectAll = vi.fn()
    const { result } = renderHook(() => useTriageKeyboard(3))
    const el = document.createElement('div')

    act(() => {
      result.current.registerCard(0, el, {
        selectAll,
        quickAssign: vi.fn(),
        openNaming: vi.fn(),
        openLinking: vi.fn(),
        hasCandidate: false,
      })
    })

    act(() => fireKey('ArrowDown'))
    act(() => fireKey('a'))
    expect(selectAll).toHaveBeenCalledOnce()
  })

  it('calls quickAssign on Enter when candidate exists', () => {
    const quickAssign = vi.fn()
    const { result } = renderHook(() => useTriageKeyboard(3))
    const el = document.createElement('div')

    act(() => {
      result.current.registerCard(0, el, {
        selectAll: vi.fn(),
        quickAssign,
        openNaming: vi.fn(),
        openLinking: vi.fn(),
        hasCandidate: true,
      })
    })

    act(() => fireKey('ArrowDown'))
    act(() => fireKey('Enter'))
    expect(quickAssign).toHaveBeenCalledOnce()
  })

  it('does not call quickAssign on Enter when no candidate', () => {
    const quickAssign = vi.fn()
    const { result } = renderHook(() => useTriageKeyboard(3))
    const el = document.createElement('div')

    act(() => {
      result.current.registerCard(0, el, {
        selectAll: vi.fn(),
        quickAssign,
        openNaming: vi.fn(),
        openLinking: vi.fn(),
        hasCandidate: false,
      })
    })

    act(() => fireKey('ArrowDown'))
    act(() => fireKey('Enter'))
    expect(quickAssign).not.toHaveBeenCalled()
  })

  it('calls openNaming on n', () => {
    const openNaming = vi.fn()
    const { result } = renderHook(() => useTriageKeyboard(3))
    const el = document.createElement('div')

    act(() => {
      result.current.registerCard(0, el, {
        selectAll: vi.fn(),
        quickAssign: vi.fn(),
        openNaming,
        openLinking: vi.fn(),
        hasCandidate: false,
      })
    })

    act(() => fireKey('ArrowDown'))
    act(() => fireKey('n'))
    expect(openNaming).toHaveBeenCalledOnce()
  })

  it('calls openLinking on l', () => {
    const openLinking = vi.fn()
    const { result } = renderHook(() => useTriageKeyboard(3))
    const el = document.createElement('div')

    act(() => {
      result.current.registerCard(0, el, {
        selectAll: vi.fn(),
        quickAssign: vi.fn(),
        openNaming: vi.fn(),
        openLinking,
        hasCandidate: false,
      })
    })

    act(() => fireKey('ArrowDown'))
    act(() => fireKey('l'))
    expect(openLinking).toHaveBeenCalledOnce()
  })

  it('ignores keystrokes when an input is focused', () => {
    const selectAll = vi.fn()
    const { result } = renderHook(() => useTriageKeyboard(3))
    const el = document.createElement('div')
    const input = document.createElement('input')

    act(() => {
      result.current.registerCard(0, el, {
        selectAll,
        quickAssign: vi.fn(),
        openNaming: vi.fn(),
        openLinking: vi.fn(),
        hasCandidate: false,
      })
    })

    act(() => fireKey('ArrowDown'))
    act(() => fireKey('a', input))
    expect(selectAll).not.toHaveBeenCalled()
  })

  it('does nothing when cluster count is 0', () => {
    const { result } = renderHook(() => useTriageKeyboard(0))

    act(() => fireKey('ArrowDown'))
    expect(result.current.focusedIndex).toBe(-1)
  })

  it('adjusts focus when cluster count shrinks', () => {
    const { result, rerender } = renderHook(
      ({ count }) => useTriageKeyboard(count),
      { initialProps: { count: 5 } },
    )

    act(() => {
      result.current.setFocusedIndex(4)
    })
    expect(result.current.focusedIndex).toBe(4)

    rerender({ count: 3 })
    expect(result.current.focusedIndex).toBe(2)
  })

  it('handles uppercase letter shortcuts (Caps Lock)', () => {
    const selectAll = vi.fn()
    const openNaming = vi.fn()
    const openLinking = vi.fn()
    const { result } = renderHook(() => useTriageKeyboard(3))
    const el = document.createElement('div')

    act(() => {
      result.current.registerCard(0, el, {
        selectAll,
        quickAssign: vi.fn(),
        openNaming,
        openLinking,
        hasCandidate: false,
      })
    })

    act(() => fireKey('ArrowDown'))

    act(() => fireKey('A'))
    expect(selectAll).toHaveBeenCalledOnce()

    act(() => fireKey('N'))
    expect(openNaming).toHaveBeenCalledOnce()

    act(() => fireKey('L'))
    expect(openLinking).toHaveBeenCalledOnce()
  })

  it('ignores keystrokes from select elements', () => {
    const selectAll = vi.fn()
    const { result } = renderHook(() => useTriageKeyboard(3))
    const el = document.createElement('div')
    const select = document.createElement('select')

    act(() => {
      result.current.registerCard(0, el, {
        selectAll,
        quickAssign: vi.fn(),
        openNaming: vi.fn(),
        openLinking: vi.fn(),
        hasCandidate: false,
      })
    })

    act(() => fireKey('ArrowDown'))
    act(() => fireKey('a', select))
    expect(selectAll).not.toHaveBeenCalled()
  })
})
