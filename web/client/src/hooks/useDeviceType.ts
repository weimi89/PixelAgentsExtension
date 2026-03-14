import { useState, useEffect } from 'react'
import { MOBILE_BREAKPOINT_PX, TABLET_BREAKPOINT_PX } from '../constants.js'

export type DeviceType = 'mobile' | 'tablet' | 'desktop'

export interface DeviceInfo {
  deviceType: DeviceType
  isTouchDevice: boolean
  isMobile: boolean
  isTablet: boolean
}

export function useDeviceType(): DeviceInfo {
  const [deviceType, setDeviceType] = useState<DeviceType>(() => getDeviceType())
  const [isTouchDevice] = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0)

  useEffect(() => {
    const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`)
    const tabletQuery = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT_PX}px) and (max-width: ${TABLET_BREAKPOINT_PX}px)`)

    const update = () => setDeviceType(getDeviceType())

    mobileQuery.addEventListener('change', update)
    tabletQuery.addEventListener('change', update)
    return () => {
      mobileQuery.removeEventListener('change', update)
      tabletQuery.removeEventListener('change', update)
    }
  }, [])

  return {
    deviceType,
    isTouchDevice,
    isMobile: deviceType === 'mobile',
    isTablet: deviceType === 'tablet',
  }
}

function getDeviceType(): DeviceType {
  const w = window.innerWidth
  if (w < MOBILE_BREAKPOINT_PX) return 'mobile'
  if (w <= TABLET_BREAKPOINT_PX) return 'tablet'
  return 'desktop'
}
