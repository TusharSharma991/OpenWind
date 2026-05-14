export type PluginPermission =
  | `db:${string}`
  | `events:${string}`
  | `slots:${string}`
  | `api:${string}`
  | 'ai:inference'
  | 'files:read'
  | 'files:write';

export interface SlotRegistration {
  name: string;
  component: string;
  priority?: number;
  context?: string[];
}

export interface PageRegistration {
  path: string;
  component: string;
  title: string;
  icon?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  platformVersion: string;
  description?: string;
  authorUrl?: string;
  requires?: string[];
  permissions: PluginPermission[];
  migrations?: string;
  routes?: string;
  hooks?: string;
  jobs?: string;
  ui?: {
    remote: string;
    slots?: SlotRegistration[];
    pages?: PageRegistration[];
  };
  onActivate?: string;
  onDeactivate?: string;
}
