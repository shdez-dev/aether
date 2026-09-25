import { ArrowUpRight } from "lucide-react";
import { ActionButton } from "@aether/ui/action-button";
import { Brand } from "./Brand";

export function Header() {
  return (
    <header className="site-header">
      <div className="home-container header-inner">
        <Brand />
        <div className="header-actions">
          <ActionButton asChild variant="outline">
            <a href="/auth/login">
              Ingresar
              <ArrowUpRight aria-hidden="true" />
            </a>
          </ActionButton>
        </div>
      </div>
    </header>
  );
}
