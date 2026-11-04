import type { PrismaClient } from "@prisma/client";
import type { InventoryArguments, InventoryResult } from "@salespilot/contracts";
import { BusinessError } from "../errors.js";

export async function getInventory(
  db: PrismaClient,
  { sku, warehouse }: InventoryArguments,
): Promise<InventoryResult> {
  if (!(await db.product.findUnique({ where: { sku } }))) {
    throw new BusinessError("SKU_NOT_FOUND", "未找到对应商品，请核对商品编码", 404);
  }
  if (!(await db.warehouse.findUnique({ where: { code: warehouse } }))) {
    throw new BusinessError("WAREHOUSE_NOT_FOUND", "未找到对应仓库，请核对仓库编码", 404);
  }
  const stock = await db.inventory.findUnique({
    where: { sku_warehouse: { sku, warehouse } },
    include: { product: true, site: true },
  });
  if (!stock) throw new BusinessError("INVENTORY_NOT_FOUND", "该商品在指定仓库没有库存记录", 404);
  return {
    kind: "inventory",
    sku,
    productName: stock.product.name,
    warehouse,
    warehouseName: stock.site.name,
    available: stock.available,
    reserved: stock.reserved,
    updatedAt: stock.updatedAt.toISOString(),
  };
}
