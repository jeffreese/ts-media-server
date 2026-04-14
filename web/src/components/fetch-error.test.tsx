import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { FetchError } from '~/components/fetch-error'

afterEach(cleanup)

describe('FetchError', () => {
  it('displays the error message', () => {
    render(<FetchError message="Connection failed" />)
    expect(screen.getByText('Connection failed')).toBeDefined()
  })

  it('renders a retry button when onRetry is provided', () => {
    const onRetry = vi.fn()
    render(<FetchError message="Error" onRetry={onRetry} />)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
  })

  it('does not render a retry button when onRetry is omitted', () => {
    render(<FetchError message="Error" />)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('calls onRetry when retry button is clicked', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<FetchError message="Error" onRetry={onRetry} />)

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
