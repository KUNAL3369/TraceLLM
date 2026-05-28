import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricCardSkeleton, EmptyState } from '../components/ui/DashboardComponents'

describe('MetricCardSkeleton', () => {
  it('renders an animated placeholder', () => {
    const { container } = render(<MetricCardSkeleton />)
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
  })
})

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No data" description="Nothing to show" />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getByText('Nothing to show')).toBeInTheDocument()
  })

  it('renders action element when provided', () => {
    render(
      <EmptyState
        title="Test"
        action={<button>Click me</button>}
      />
    )
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('renders custom icon', () => {
    render(<EmptyState icon="📡" title="Test" />)
    expect(screen.getByText('📡')).toBeInTheDocument()
  })
})
