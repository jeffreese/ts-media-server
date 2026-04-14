import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

interface BreadcrumbOverrides {
  [segment: string]: string
}

interface BreadcrumbContextValue {
  overrides: BreadcrumbOverrides
  setOverride: (segment: string, label: string) => void
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  overrides: {},
  setOverride: () => {},
})

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<BreadcrumbOverrides>({})

  const value = useMemo<BreadcrumbContextValue>(
    () => ({
      overrides,
      setOverride: (segment, label) =>
        setOverrides((prev) => (prev[segment] === label ? prev : { ...prev, [segment]: label })),
    }),
    [overrides],
  )

  return <BreadcrumbContext value={value}>{children}</BreadcrumbContext>
}

export function useBreadcrumb(segment: string, label: string | undefined) {
  const { setOverride } = useContext(BreadcrumbContext)

  useEffect(() => {
    if (label) {
      setOverride(segment, label)
    }
  }, [segment, label, setOverride])
}

export function useBreadcrumbOverrides() {
  return useContext(BreadcrumbContext).overrides
}
