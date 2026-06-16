import { useState, useEffect } from "react";
import { fetchWithAuth, API_URL } from "./api.js";

export type ProjectRole = string;

export function useRoles(): { roles: ProjectRole[]; loading: boolean } {
  const [roles, setRoles] = useState<ProjectRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth(`${API_URL}/roles`)
      .then((res) => {
        const r = res as { data: string[] };
        setRoles(r.data);
      })
      .catch(() => {
        setRoles(["admin", "agent", "user"]);
      })
      .finally(() => setLoading(false));
  }, []);

  return { roles, loading };
}
