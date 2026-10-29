import { createSignal } from "solid-js"
import { SettingsPanelStack } from "./panel-stack"

export function createPanelStackFixture(onReady: (select: (id: "permissions" | "network") => void) => void) {
  const [active, setActive] = createSignal<"permissions" | "network">("permissions")
  const mounts = { permissions: 0, network: 0 }
  const Permissions = () => {
    mounts.permissions += 1
    return <input aria-label="Permission filter" value="remember me" />
  }
  const Network = () => {
    mounts.network += 1
    return <div>Network settings</div>
  }
  onReady(setActive)

  return {
    mounts,
    view: () => (
      <SettingsPanelStack
        active={active}
        panels={() => [
          { id: "permissions", component: Permissions },
          { id: "network", component: Network },
        ]}
      />
    ),
  }
}
