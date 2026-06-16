import React, { createContext, useContext, useEffect, useState } from "react";
import { fetchWithAuth, API_URL } from "./auth.js";

export type EntityType = {
  id: string;
  name: string;
  plural: string;
  icon: string | null;
  moduleId: string | null;
};

export type Module = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  installed: boolean;
};

type EntityTypeContextValue = {
  entityTypes: EntityType[];
  modules: Module[];
  getTypeBySlug: (slug: string) => EntityType | undefined;
  getTypeById: (id: string) => EntityType | undefined;
  reload: () => void;
};

export function toTypeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

const EntityTypeContext = createContext<EntityTypeContextValue>({
  entityTypes: [],
  modules: [],
  getTypeBySlug: () => undefined,
  getTypeById: () => undefined,
  reload: () => {},
});

export function EntityTypeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void Promise.allSettled([
      fetchWithAuth(`${API_URL}/entity-types`),
      fetchWithAuth(`${API_URL}/modules`),
    ]).then(([etRes, modRes]) => {
      if (etRes.status === "fulfilled") {
        setEntityTypes((etRes.value as { data?: EntityType[] }).data ?? []);
      }
      if (modRes.status === "fulfilled") {
        setModules((modRes.value as { data?: Module[] }).data ?? []);
      }
    });
  }, [tick]);

  function getTypeBySlug(slug: string): EntityType | undefined {
    return entityTypes.find(
      (et) =>
        toTypeSlug(et.name) === slug ||
        toTypeSlug(et.plural || et.name) === slug,
    );
  }

  function getTypeById(id: string): EntityType | undefined {
    return entityTypes.find((et) => et.id === id);
  }

  return (
    <EntityTypeContext.Provider
      value={{
        entityTypes,
        modules,
        getTypeBySlug,
        getTypeById,
        reload: () => setTick((t) => t + 1),
      }}
    >
      {children}
    </EntityTypeContext.Provider>
  );
}

export function useEntityTypes(): EntityTypeContextValue {
  return useContext(EntityTypeContext);
}
