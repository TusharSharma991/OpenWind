import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  db,
  withTenantContext,
  executeRawInTenantContext,
  modules,
  tenants,
} from "@platform/db";
import { logger } from "@platform/logger";

export function getWorkspaceRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd(); // fallback
}

export class ModuleService {
  /**
   * seedRegistry - Populates default standard modules into the database
   */
  static async seedRegistry(): Promise<void> {
    const standardModules = [
      {
        slug: "helpdesk",
        name: "Helpdesk",
        description:
          "Support ticket management with priority, SLA, and category tracking",
        version: "0.0.1",
        isSystem: false,
        minPlan: "standard",
      },
      {
        slug: "crm",
        name: "CRM",
        description: "Sales pipeline and deal tracking from lead to close",
        version: "0.0.1",
        isSystem: false,
        minPlan: "standard",
      },
      {
        slug: "hrms",
        name: "HRMS",
        description: "Leave request and employee workflow management",
        version: "0.0.1",
        isSystem: false,
        minPlan: "standard",
      },
      {
        slug: "reimbursements",
        name: "Reimbursements",
        description: "Expense claim submission, approval, and payment tracking",
        version: "0.0.1",
        isSystem: false,
        minPlan: "standard",
      },
      {
        slug: "projects",
        name: "Projects",
        description:
          "Task and project tracking with backlog, sprint, and review stages",
        version: "0.0.1",
        isSystem: false,
        minPlan: "standard",
      },
      {
        slug: "invoicing",
        name: "Invoicing",
        description:
          "Invoice lifecycle from draft through sent, viewed, to paid",
        version: "0.0.1",
        isSystem: false,
        minPlan: "standard",
      },
      {
        slug: "procurement",
        name: "Procurement",
        description:
          "Purchase order requests, approvals, and delivery tracking",
        version: "0.0.1",
        isSystem: false,
        minPlan: "standard",
      },
    ];

    logger.info("Seeding modules registry...");
    for (const mod of standardModules) {
      await db
        .insert(modules)
        .values({
          slug: mod.slug,
          name: mod.name,
          description: mod.description,
          version: mod.version,
          isSystem: mod.isSystem,
          minPlan: mod.minPlan,
        })
        .onConflictDoUpdate({
          target: modules.slug,
          set: {
            name: mod.name,
            description: mod.description,
            version: mod.version,
            updatedAt: new Date(),
          },
        });
    }
    logger.info("Modules registry seeded.");
  }

  /**
   * listModules - Returns all registered modules with installation status for a tenant.
   * Auto-seeds the registry on first call or after a reset so templates always appear.
   */
  static async listModules(
    tenantId: string,
  ): Promise<Record<string, unknown>[]> {
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    let allModules = await db.select().from(modules);

    // Auto-seed if the registry is empty (first boot or after a data reset)
    if (allModules.length === 0) {
      await ModuleService.seedRegistry();
      allModules = await db.select().from(modules);
    }
    const installedList = (
      tenant?.config as Record<string, unknown> | undefined
    )?.installed_modules;
    const installed = Array.isArray(installedList)
      ? (installedList as string[])
      : [];

    return allModules.map((m) => ({
      ...m,
      installed: installed.includes(m.slug),
    }));
  }

  /**
   * installModule - Installs a module for a tenant by running seed SQLs and updating config
   */
  static async installModule(
    tenantId: string,
    slug: string,
    options?: { workflowName?: string },
  ): Promise<void> {
    const [moduleRecord] = await db
      .select()
      .from(modules)
      .where(eq(modules.slug, slug))
      .limit(1);

    if (!moduleRecord) {
      throw new Error(`Module not found: ${slug}`);
    }

    // 1. Check if already installed (read tenant config)
    const [tenantCheck] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenantCheck) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    const config = (tenantCheck.config ?? {}) as Record<string, unknown>;
    const rawList = config.installed_modules;
    const installedList: string[] = Array.isArray(rawList)
      ? (rawList as string[])
      : [];

    if (installedList.includes(slug)) {
      return; // Already installed
    }

    // 2. Run seed SQL files using simple query protocol (supports data-modifying
    //    CTEs). Each file is a single CTE chain executed inside its own
    //    tenant-scoped transaction via executeRawInTenantContext.
    const seedDir = join(getWorkspaceRoot(), "modules", slug, "seed");
    if (existsSync(seedDir)) {
      const files = await fs.readdir(seedDir);
      const sqlFiles = files
        .filter((f) => f.endsWith(".sql"))
        .sort((a, b) => a.localeCompare(b));

      for (const file of sqlFiles) {
        const filePath = join(seedDir, file);
        const sqlContent = await fs.readFile(filePath, "utf8");

        // Replace tokens and add ::uuid casts so postgres-js simple-protocol
        // text literals satisfy uuid column type expectations.
        const processedSql = sqlContent
          .replaceAll("'{TENANT_ID}'", `'${tenantId}'::uuid`)
          .replaceAll("'{MODULE_ID}'", `'${moduleRecord.id}'::uuid`)
          .replaceAll(
            "{WORKFLOW_NAME}",
            options?.workflowName?.trim() ?? moduleRecord.name,
          );

        if (processedSql.trim().length > 0) {
          await executeRawInTenantContext(tenantId, processedSql);
        }
      }
    } else {
      logger.warn(
        { slug, seedDir },
        "No seed directory found for module during install",
      );
    }

    // 3. Update installed modules list inside a Drizzle transaction
    await withTenantContext(tenantId, async (tx) => {
      installedList.push(slug);
      await tx
        .update(tenants)
        .set({
          config: {
            ...config,
            installed_modules: installedList,
          },
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenantId));
    });
  }

  /**
   * uninstallModule - Uninstalls a module by removing from installed list
   */
  static async uninstallModule(tenantId: string, slug: string): Promise<void> {
    const [moduleRecord] = await db
      .select()
      .from(modules)
      .where(eq(modules.slug, slug))
      .limit(1);

    if (!moduleRecord) {
      throw new Error(`Module not found: ${slug}`);
    }

    await withTenantContext(tenantId, async (tx) => {
      const [tenant] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      if (!tenant) {
        throw new Error(`Tenant not found: ${tenantId}`);
      }

      const config = (tenant.config ?? {}) as Record<string, unknown>;
      const rawList = config.installed_modules;
      const installedList: string[] = Array.isArray(rawList)
        ? (rawList as string[])
        : [];

      if (!installedList.includes(slug)) {
        return; // Already uninstalled
      }

      const newInstalledList = installedList.filter((m) => m !== slug);

      await tx
        .update(tenants)
        .set({
          config: {
            ...config,
            installed_modules: newInstalledList,
          },
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenantId));
    });
  }
}
