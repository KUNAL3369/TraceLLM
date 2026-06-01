import { create } from "zustand";
import { supabase } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export const useProjectStore = create((set, get) => ({
  projects: [],
  selectedProjectId: null,
  loading: false,

  selectedProject: () => {
    const { projects, selectedProjectId } = get();
    return projects.find((p) => p.id === selectedProjectId) || null;
  },

  loadProjects: async () => {
    set({ loading: true });
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      set({ loading: false });
      return;
    }

    const url = `${API_URL}/api/projects`;
    if (import.meta.env.DEV) {
      console.log("[projectStore] loadProjects:", url);
    }
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const projects = await res.json();
        set((state) => ({
          projects,
          selectedProjectId: state.selectedProjectId || projects[0]?.id || null,
          loading: false,
        }));
      } else {
        const body = await res.text().catch(() => "");
        console.error(
          "[projectStore] loadProjects failed:",
          url,
          res.status,
          body,
        );
        set({ loading: false });
      }
    } catch (err) {
      console.error("[projectStore] loadProjects error:", url, err.message);
      set({ loading: false });
    }
  },

  setSelectedProject: (id) => set({ selectedProjectId: id }),
}));
