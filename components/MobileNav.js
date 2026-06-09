'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function MobileNav() {
  const pathname = usePathname()

  const navItems = [
    { href: '/', label: 'Home' },
    { href: '/picks', label: 'Picks' },
    { href: '/props', label: 'Props' },
    { href: '/parlays', label: 'Parlays' },
    { href: '/games', label: 'Games' },
  ]

  const isActive = (href) => {
    if (href === '/') {
      return pathname === '/'
    }
    return pathname?.startsWith(href)
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-bg/90 backdrop-blur-md border-t border-white/[0.06] sm:hidden z-50 safe-area-inset-bottom">
      <div className="flex justify-around items-center h-14 px-2">
        {navItems.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center justify-center flex-1 h-full text-[11px] font-semibold uppercase tracking-wide transition-colors duration-100 ${
                active
                  ? 'text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <span>{item.label}</span>
              {active && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-px bg-slate-100" />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

