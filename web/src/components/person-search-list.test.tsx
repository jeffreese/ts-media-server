import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonSearchList } from '~/components/person-search-list'

const mockResults = {
  items: [
    {
      personId: 1,
      names: [{ id: 1, personId: 1, name: 'Alice Smith', preferred: true }],
      firstFeature: { id: 1, featureId: 10, personId: 1, itemId: 100 },
      photoCount: 5,
    },
    {
      personId: 2,
      names: [{ id: 2, personId: 2, name: 'Bob Jones', preferred: true }],
      firstFeature: null,
      photoCount: 0,
    },
    {
      personId: 3,
      names: [{ id: 3, personId: 3, name: 'Charlie Brown', preferred: true }],
      firstFeature: null,
      photoCount: 2,
    },
  ],
}

afterEach(cleanup)

describe('PersonSearchList', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResults), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  it('renders search results', async () => {
    const onSelect = vi.fn()
    render(<PersonSearchList onSelect={onSelect} />)

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeDefined()
    })
    expect(screen.getByText('Bob Jones')).toBeDefined()
    expect(screen.getByText('Charlie Brown')).toBeDefined()
  })

  it('calls onSelect when a person is clicked', async () => {
    const onSelect = vi.fn()
    render(<PersonSearchList onSelect={onSelect} />)

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeDefined()
    })

    await userEvent.click(screen.getByText('Alice Smith'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('excludes specified person IDs', async () => {
    const onSelect = vi.fn()
    render(<PersonSearchList onSelect={onSelect} excludePersonIds={[2]} />)

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeDefined()
    })

    expect(screen.queryByText('Bob Jones')).toBeNull()
    expect(screen.getByText('Charlie Brown')).toBeDefined()
  })

  it('shows photo count for each person', async () => {
    const onSelect = vi.fn()
    render(<PersonSearchList onSelect={onSelect} />)

    await waitFor(() => {
      expect(screen.getByText('5 photos')).toBeDefined()
    })
    expect(screen.getByText('0 photos')).toBeDefined()
    expect(screen.getByText('2 photos')).toBeDefined()
  })
})
