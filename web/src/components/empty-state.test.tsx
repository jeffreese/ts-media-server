import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, it, expect } from 'vitest'
import { EmptyState } from '~/components/empty-state'

afterEach(cleanup)

describe('EmptyState', () => {
  it('displays title', () => {
    render(<EmptyState icon={<span data-testid="icon" />} title="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeDefined()
    expect(screen.getByTestId('icon')).toBeDefined()
  })

  it('displays optional description', () => {
    render(
      <EmptyState
        icon={<span />}
        title="Empty"
        description="Try adding some items"
      />,
    )
    expect(screen.getByText('Try adding some items')).toBeDefined()
  })

  it('does not render description when not provided', () => {
    const { container } = render(
      <EmptyState icon={<span />} title="Empty" />,
    )
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
  })

  it('renders action slot', () => {
    render(
      <EmptyState
        icon={<span />}
        title="Empty"
        action={<button type="button">Do something</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Do something' })).toBeDefined()
  })
})
