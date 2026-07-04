import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ClaimLabelBadge from './ClaimLabelBadge'

describe('<ClaimLabelBadge />', () => {
  it('renders nothing when label is empty', () => {
    const { container } = render(<ClaimLabelBadge label={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for unknown labels', () => {
    const { container } = render(<ClaimLabelBadge label="mystery" />)
    expect(container.firstChild).toBeNull()
  })

  it.each(['legitimate', 'suspicious', 'fraud'])('renders the %s label', (label) => {
    render(<ClaimLabelBadge label={label} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('uses red styling for fraud', () => {
    const { container } = render(<ClaimLabelBadge label="fraud" />)
    expect(container.firstChild).toHaveClass('bg-red-100')
  })
})
