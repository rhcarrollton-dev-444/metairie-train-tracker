// Wrapper card used in the About tab (`Vr`).
export default function AboutCard({ title, children }) {
  return (
    <div style={{ background: '#0d1420', border: '1px solid #1e2d45', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )
}