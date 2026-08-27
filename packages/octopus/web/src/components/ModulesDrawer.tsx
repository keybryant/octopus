import { Sheet } from "octopus-ui"
import ModuleGrid from "../ModuleGrid"
import type { WorkbenchModuleInfo } from "../api"

export interface ModulesDrawerProps {
  open: boolean
  onClose: () => void
  modules: WorkbenchModuleInfo[]
}

/** 已装模块抽屉：复用 ModuleGrid（保住懒加载链路），空数组时显示占位 */
export function ModulesDrawer({ open, onClose, modules }: ModulesDrawerProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="已装模块"
      subtitle="由插件注册，点击卡片展开"
    >
      <ModuleGrid modules={modules} />
    </Sheet>
  )
}
