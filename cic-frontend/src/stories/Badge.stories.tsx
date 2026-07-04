import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from '@/components/ui/badge'

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'destructive', 'outline', 'success', 'warning'],
    },
  },
}

export default meta
type Story = StoryObj<typeof Badge>

export const Default: Story = { args: { children: 'New', variant: 'default' } }
export const Secondary: Story = { args: { children: 'Pending', variant: 'secondary' } }
export const Destructive: Story = { args: { children: 'Rejected', variant: 'destructive' } }
export const Outline: Story = { args: { children: 'Draft', variant: 'outline' } }
export const Success: Story = { args: { children: 'Paid', variant: 'success' } }
export const Warning: Story = { args: { children: 'Flagged', variant: 'warning' } }
