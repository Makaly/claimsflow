import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import ClaimLabelBadge from './ClaimLabelBadge'

expect.extend(toHaveNoViolations)

describe('<ClaimLabelBadge /> accessibility', () => {
  it.each(['legitimate', 'suspicious', 'fraud'])(
    'has no detectable a11y violations for the %s label',
    async (label) => {
      const { container } = render(<ClaimLabelBadge label={label} />)
      const results = await axe(container)
      expect(results).toHaveNoViolations()
    },
  )
})
