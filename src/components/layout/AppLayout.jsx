import { useEffect } from "react";
import { useAuthStore } from "../../stores/authStore";
import { useProjectStore } from "../../stores/projectStore";
import Sidebar from "./Sidebar";

export default function AppLayout({ children }) {
  const user = useAuthStore((s) => s.user);
  const loadProjects = useProjectStore((s) => s.loadProjects);

  useEffect(() => {
    if (user) loadProjects();
  }, [user, loadProjects]);

  return (
    <div className="flex min-h-screen bg-[#0f172a]">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
