import { jsx as r } from "/workbench/assets/vendor/jsx-runtime.js";
function t() {
  return /* @__PURE__ */ r("ul", { className: "quickstart", children: [
    { label: "进入主界面", href: "/" },
    { label: "插件市场", href: "/marketplace" },
    { label: "设置", href: "/settings" }
  ].map((e) => /* @__PURE__ */ r("li", { children: /* @__PURE__ */ r("a", { href: e.href, children: e.label }) }, e.href)) });
}
export {
  t as default
};
