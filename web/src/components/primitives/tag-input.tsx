import { Plus, X } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'

interface TagInputProps {
  tags: { id: number; word: string }[]
  onAdd: (word: string) => void
  onRemove: (id: number) => void
  placeholder?: string
  disabled?: boolean
}

export function TagInput({
  tags,
  onAdd,
  onRemove,
  placeholder = 'Add tag...',
  disabled = false,
}: TagInputProps) {
  const [input, setInput] = useState('')

  function handleSubmit() {
    const word = input.trim().toLowerCase()
    if (!word) return
    onAdd(word)
    setInput('')
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-md bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent"
          >
            {tag.word}
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(tag.id)}
                className="rounded-sm p-0.5 hover:bg-accent/20"
                aria-label={`Remove ${tag.word}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 rounded-lg border border-border bg-control px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="rounded-lg bg-accent p-1.5 text-white transition-colors hover:bg-accent-foreground disabled:opacity-40"
            aria-label="Add tag"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
