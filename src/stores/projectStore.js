import { create } from "zustand";
import { supabase } from "../lib/supabase";

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
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      set({ loading: false });
      return;
    }

    const res = await fetch("/api/projects", {
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
      set({ loading: false });
    }
  },

  setSelectedProject: (id) => set({ selectedProjectId: id }),
}));
