import { useCallback, useEffect, useRef, useState } from 'react'

export interface ClusterActions {
  selectAll: () => void
  quickAssign: () => void
  openNaming: () => void
  openLinking: () => void
  hasCandidate: boolean
}

export interface UseTriageKeyboardResult {
  focusedIndex: number
  setFocusedIndex: (index: number) => void
  registerCard: (index: number, el: HTMLDivElement | null, actions: ClusterActions) => void
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

export function useTriageKeyboard(clusterCount: number): UseTriageKeyboardResult {
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const actionsRef = useRef<Map<number, ClusterActions>>(new Map())
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const registerCard = useCallback(
    (index: number, el: HTMLDivElement | null, actions: ClusterActions) => {
      if (el) {
        cardRefs.current.set(index, el)
        actionsRef.current.set(index, actions)
      } else {
        cardRefs.current.delete(index)
        actionsRef.current.delete(index)
      }
    },
    [],
  )

  const scrollToCard = useCallback((index: number) => {
    const el = cardRefs.current.get(index)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (clusterCount === 0) {
      setFocusedIndex(-1)
      return
    }
    setFocusedIndex((prev) => {
      if (prev >= clusterCount) return clusterCount - 1
      return prev
    })
  }, [clusterCount])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (clusterCount === 0) return

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      switch (key) {
        case 'ArrowDown':
        case 'j': {
          e.preventDefault()
          setFocusedIndex((prev) => {
            const next = Math.min(prev + 1, clusterCount - 1)
            scrollToCard(next)
            return next
          })
          break
        }
        case 'ArrowUp':
        case 'k': {
          if (focusedIndex < 0) break
          e.preventDefault()
          setFocusedIndex((prev) => {
            const next = Math.max(prev - 1, 0)
            scrollToCard(next)
            return next
          })
          break
        }
        case 'a': {
          const actions = actionsRef.current.get(focusedIndex)
          if (actions) {
            e.preventDefault()
            actions.selectAll()
          }
          break
        }
        case 'Enter': {
          const actions = actionsRef.current.get(focusedIndex)
          if (actions?.hasCandidate) {
            e.preventDefault()
            actions.quickAssign()
          }
          break
        }
        case 'n': {
          const actions = actionsRef.current.get(focusedIndex)
          if (actions) {
            e.preventDefault()
            actions.openNaming()
          }
          break
        }
        case 'l': {
          const actions = actionsRef.current.get(focusedIndex)
          if (actions) {
            e.preventDefault()
            actions.openLinking()
          }
          break
        }
        case 'Escape': {
          setFocusedIndex(-1)
          break
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [clusterCount, focusedIndex, scrollToCard])

  return { focusedIndex, setFocusedIndex, registerCard }
}
