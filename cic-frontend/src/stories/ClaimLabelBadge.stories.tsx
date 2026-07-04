import type { Meta, StoryObj } from '@storybook/react'
import ClaimLabelBadge from '@/components/ClaimLabelBadge'

const meta: Meta<typeof ClaimLabelBadge> = {
  title: 'Claims/ClaimLabelBadge',
  component: ClaimLabelBadge,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof ClaimLabelBadge>

export const Legitimate: Story = { args: { label: 'legitimate' } }
export const Suspicious: Story = { args: { label: 'suspicious' } }
export const Fraud: Story = { args: { label: 'fraud' } }
export const Unknown: Story = {
  args: { label: 'mystery' },
  parameters: {
    docs: {
      description: { story: 'Unknown labels render nothing — defensive fallback.' },
    },
  },
}
