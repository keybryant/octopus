export default function Quickstart() {
  const links = [
    { label: "进入主界面", href: "/" },
    { label: "插件市场", href: "/marketplace" },
    { label: "设置", href: "/settings" },
  ]
  return (
    <ul className="quickstart">
      {links.map((link) => (
        <li key={link.href}>
          <a href={link.href}>{link.label}</a>
        </li>
      ))}
    </ul>
  )
}
