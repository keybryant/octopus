import { Sheet } from "octopus-ui"
import type { WorkbenchModuleInfo } from "../api"
import ModuleGrid from "../ModuleGrid"

export function ModulesDrawer({
  open,
  onClose,
  modules,
}: {
  open: boolean
  onClose: () => void
  modules: WorkbenchModuleInfo[]
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="已装模块" subtitle="由插件注册，点击卡片展开">
      <ModuleGrid modules={modules} />
    </Sheet>
  )
}
