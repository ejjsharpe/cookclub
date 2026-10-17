import {
  PanelLeftClose,
  PanelLeftOpen,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export function AdminShell({
  activePage,
  children,
}: {
  activePage: "users" | "moderation";
  children: ReactNode;
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 920px)");
    const updateSidebar = () => setIsSidebarOpen(!mobileViewport.matches);

    updateSidebar();
    mobileViewport.addEventListener("change", updateSidebar);
    return () => mobileViewport.removeEventListener("change", updateSidebar);
  }, []);

  return (
    <main
      className={`admin-shell ${
        isSidebarOpen ? "sidebar-open" : "sidebar-collapsed"
      }`}
    >
      <aside
        aria-hidden={!isSidebarOpen}
        aria-label="Admin navigation"
        className="side-rail"
        id="admin-sidebar"
        inert={!isSidebarOpen}
      >
        <div className="brand-lockup">
          <img alt="" className="brand-mark" src="/icons/icon.png" />
          <div>
            <strong>cookclub</strong>
            <span>Admin</span>
          </div>
        </div>
        <nav className="side-nav">
          <a
            aria-current={activePage === "users" ? "page" : undefined}
            href="/"
          >
            <Users size={18} />
            Users
          </a>
          <a
            aria-current={activePage === "moderation" ? "page" : undefined}
            href="/moderation"
          >
            <ShieldAlert size={18} />
            Moderation
          </a>
        </nav>
        <div className="side-footer">
          <span>Console</span>
          <strong>Workspace</strong>
        </div>
      </aside>

      <button
        aria-controls="admin-sidebar"
        aria-expanded={isSidebarOpen}
        aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
        className="icon-button sidebar-toggle"
        onClick={() => setIsSidebarOpen((isOpen) => !isOpen)}
        title={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
        type="button"
      >
        {isSidebarOpen ? (
          <PanelLeftClose size={18} />
        ) : (
          <PanelLeftOpen size={18} />
        )}
      </button>

      <button
        aria-label="Close sidebar"
        className="sidebar-scrim"
        hidden={!isSidebarOpen}
        onClick={() => setIsSidebarOpen(false)}
        type="button"
      />

      {children}
    </main>
  );
}
