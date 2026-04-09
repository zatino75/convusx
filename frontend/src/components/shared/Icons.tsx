import React from "react"

type IconProps = {
  size?: number
  color?: string
  style?: React.CSSProperties
  className?: string
}

function SvgIcon({ d, size = 18, color = "currentColor", viewBox = "0 0 24 24", style, className }: IconProps & { d: string; viewBox?: string }) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
      <path d={d} />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return <SvgIcon d="M12 5v14M5 12h14" {...props} />
}

export function SearchIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke={props.color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={props.style} className={props.className}>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke={props.color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={props.style} className={props.className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  )
}

export function FolderIcon(props: IconProps) {
  return <SvgIcon d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" {...props} />
}

export function FileIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke={props.color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={props.style} className={props.className}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke={props.color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={props.style} className={props.className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}

export function PencilIcon(props: IconProps) {
  return <SvgIcon d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" {...props} />
}

export function ChevronIcon({ direction = "right", ...props }: IconProps & { direction?: "left" | "right" | "up" | "down" }) {
  const paths: Record<string, string> = {
    right: "M9 18l6-6-6-6",
    left: "M15 18l-6-6 6-6",
    up: "M18 15l-6-6-6 6",
    down: "M6 9l6 6 6-6"
  }
  return <SvgIcon d={paths[direction]} {...props} />
}

export function DotsIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill={props.color ?? "currentColor"} style={props.style} className={props.className}>
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  )
}

export function ImageIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke={props.color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={props.style} className={props.className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

export function DashboardIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke={props.color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={props.style} className={props.className}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  )
}

export function BenchmarkIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke={props.color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={props.style} className={props.className}>
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke={props.color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={props.style} className={props.className}>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

export function MoonIcon(props: IconProps) {
  return <SvgIcon d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" {...props} />
}

export function PinIcon(props: IconProps) {
  return <SvgIcon d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4.5L6 21l1.5-7.5L2 9h7z" {...props} />
}

export function CopyIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke={props.color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={props.style} className={props.className}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return <SvgIcon d="M20 6L9 17l-5-5" {...props} />
}

export function GridIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke={props.color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={props.style} className={props.className}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}
