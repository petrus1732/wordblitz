import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { MouseEvent, ReactNode } from 'react'

const rawBase = import.meta.env.BASE_URL ?? '/'
const BASE_PATH = rawBase === '/' ? '' : rawBase.replace(/\/+$/, '')

type RouterValue = {
  path: string
  navigate: (to: string) => void
}

const RouterContext = createContext<RouterValue | null>(null)

export function RouterProvider({ children }: { children: ReactNode }) {
  const value = useBrowserRouter()
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter() {
  const context = useContext(RouterContext)
  if (!context) {
    throw new Error('useRouter must be used inside RouterProvider')
  }
  return context
}

export function Link({
  to,
  children,
  className,
}: {
  to: string
  children: ReactNode
  className?: string
}) {
  const { navigate } = useRouter()
  const href = buildHref(to)

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return
    }
    event.preventDefault()
    navigate(to)
  }

  return (
    <a href={href} onClick={handleClick} className={className}>
      {children}
    </a>
  )
}

function useBrowserRouter(): RouterValue {
  const getPath = () =>
    normalizePath(
      typeof window === 'undefined'
        ? '/'
        : stripBasePath(window.location.pathname),
    )
  const [path, setPath] = useState(getPath)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setPath(getPath())
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const navigate = (to: string) => {
    if (typeof window === 'undefined') return
    const nextPath = normalizePath(to)
    if (nextPath === path) return
    const href = buildHref(nextPath)
    window.history.pushState({}, '', href)
    setPath(nextPath)
  }

  return useMemo(
    () => ({
      path,
      navigate,
    }),
    [path],
  )
}

function normalizePath(path: string) {
  if (!path) return '/'
  const trimmed = path.trim()
  if (trimmed === '/') return '/'
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

function stripBasePath(pathname: string) {
  if (!pathname) return '/'
  if (!BASE_PATH) return pathname || '/'
  if (pathname === BASE_PATH) return '/'
  if (pathname.startsWith(`${BASE_PATH}/`)) {
    const stripped = pathname.slice(BASE_PATH.length)
    return stripped || '/'
  }
  return pathname
}

function buildHref(path: string) {
  const normalized = normalizePath(path)
  if (!BASE_PATH) return normalized
  if (normalized === '/') {
    return BASE_PATH || '/'
  }
  const suffix = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `${BASE_PATH}${suffix}`
}
