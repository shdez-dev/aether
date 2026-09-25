import type { Metadata } from "next";
import WorkspaceScreen from "../../components/workspace/workspace-screen";
import "../../components/workspace/workspace.css";
import "../../components/workspace/first-steps.css";
import "../../components/workspace/workspace-dashboard.css";
import "../../components/workspace/workspace-gravity.css";
import "../../components/workspace/workspace-loading.css";

export const metadata: Metadata = {
  title: "Espacio de trabajo | Aether",
  robots: { index: false, follow: false },
};

export default function WorkspacePage() {
  return (
    <div className="workspace-shell">
      <WorkspaceScreen />
    </div>
  );
}
