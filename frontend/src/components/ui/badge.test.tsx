import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './badge'

describe('<Badge />', () => {
  it('renders its children', () => {
    render(<Badge>Active</Badge>)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('applies the success variant styling', () => {
    render(<Badge variant="success">Paid</Badge>)
    expect(screen.getByText('Paid')).toHaveClass('bg-emerald-100')
  })

  it('merges custom className with variant classes', () => {
    render(<Badge className="ml-2">Custom</Badge>)
    const el = screen.getByText('Custom')
    expect(el).toHaveClass('ml-2')
    expect(el.className).toMatch(/rounded-full/)
  })
})
