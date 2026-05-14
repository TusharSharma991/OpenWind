export interface FileMetadata {
  key: string;
  name: string;
  size: number;
  mimeType: string;
  tenantId: string;
  entityId?: string;
  uploadedBy: string;
  uploadedAt: Date;
}
