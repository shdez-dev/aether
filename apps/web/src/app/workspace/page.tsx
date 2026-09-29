import type { Metadata } from "next";
import WorkspaceScreen from "../../components/workspace/workspace-screen";
import "../../components/workspace/workspace.css";
import "../../components/workspace/first-steps.css";
import "../../components/workspace/workspace-dashboard.css";
import "../../components/workspace/workspace-gravity.css";
import "../../components/workspace/workspace-context.css";
import "../../components/workspace/workspace-loading.css";
import "../../components/workspace/workspace-signed-out.css";
import "../../components/workspace/workspace-logout.css";
import "../../components/workspace/daily-brief.css";
import "../../components/workspace/user-settings.css";
import "../../components/workspace/user-profile.css";
import "../../components/workspace/organization-center.css";

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
