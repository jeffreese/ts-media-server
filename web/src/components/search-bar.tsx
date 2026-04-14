import { Search, X } from 'lucide-react'
import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

export function SearchBar() {
  const [value, setValue] = useState('')
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return
    navigate(`/search?q=${encodeURIComponent(trimmed)}`)
    setExpanded(false)
    inputRef.current?.blur()
  }, [value, navigate])

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') {
      setValue('')
      setExpanded(false)
      inputRef.current?.blur()
    }
  }

  const clear = () => {
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div className="relative flex items-center">
      {expanded ? (
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 transition-all focus-within:border-accent">
          <Search className="h-4 w-4 shrink-0 text-foreground-faint" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!value) setExpanded(false)
            }}
            placeholder="Search media..."
            className="w-40 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-faint sm:w-56"
            autoFocus
          />
          {value && (
            <button
              type="button"
              onClick={clear}
              className="rounded p-0.5 text-foreground-faint hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-lg p-1.5 text-foreground-muted transition-colors hover:bg-control hover:text-foreground"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
