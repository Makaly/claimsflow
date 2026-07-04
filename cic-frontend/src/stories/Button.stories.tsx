import type { Meta, StoryObj } from '@storybook/react'
import { Button } from '@/components/ui/button'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link', 'success'],
    },
    size: { control: 'select', options: ['default', 'sm', 'lg', 'icon'] },
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Default: Story = { args: { children: 'Submit claim', variant: 'default' } }
export const Destructive: Story = { args: { children: 'Reject', variant: 'destructive' } }
export const Outline: Story = { args: { children: 'Cancel', variant: 'outline' } }
export const Ghost: Story = { args: { children: 'More', variant: 'ghost' } }
export const Success: Story = { args: { children: 'Approve', variant: 'success' } }
export const Small: Story = { args: { children: 'Small', size: 'sm' } }
export const Large: Story = { args: { children: 'Large', size: 'lg' } }
