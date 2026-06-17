export type SavedView = {
  id: string;
  name: string;
  filterConfig: { search?: string } | null;
  isDefault: boolean;
};
