// Glowing status dot used on crossing cards.
export default function Dot({ color, pulse, size = 12 }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 8px ${color}`,
        animation: pulse ? 'pulse-dot 1.2s infinite' : 'none',
        flexShrink: 0,
      }}
    />
  )
}