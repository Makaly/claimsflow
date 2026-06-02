import type { ElementType, ReactNode } from 'react'
import { useReveal } from '@/hooks/useReveal'
import { cn } from '@/lib/utils'

/**
 * Wraps children in a scroll-revealed element. Add `delay` (ms) to stagger
 * items within a group. Honours `prefers-reduced-motion` via the CSS in
 * index.css (the `.reveal` rule is neutralised there).
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  delay?: number
  as?: ElementType
}) {
  const { ref, visible } = useReveal<HTMLElement>()

  return (
    <Tag
      ref={ref}
      style={delay ? { ['--reveal-delay' as string]: `${delay}ms` } : undefined}
      className={cn('reveal', visible && 'is-visible', className)}
    >
      {children}
    </Tag>
  )
}
