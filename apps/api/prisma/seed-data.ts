import type { PrismaClient } from "@prisma/client";

/** Fixed synthetic fixtures, never resets or overwrites existing business records. */
export async function seedData(db: PrismaClient) {
  const names = ["演示客户 A", "演示客户 B", "演示客户 C", "演示客户 D", "演示客户 E"];
  const products = [
    ["PHONE-001", "智能手机"],
    ["LAPTOP-001", "轻薄笔记本"],
    ["HEADSET-001", "无线耳机"],
    ["MONITOR-001", "办公显示器"],
    ["KEYBOARD-001", "机械键盘"],
    ["MOUSE-001", "无线鼠标"],
    ["TABLET-001", "办公平板"],
    ["CHARGER-001", "快充充电器"],
    ["DOCK-001", "扩展坞"],
    ["WEBCAM-001", "会议摄像头"],
  ];
  const warehouses = [
    ["SZ-01", "深圳一号仓"],
    ["SH-01", "上海一号仓"],
    ["BJ-01", "北京一号仓"],
  ];
  const states = [
    "SHIPPED",
    "PROCESSING",
    "DELIVERED",
    "PENDING",
    "SHIPPED",
    "CANCELLED",
    "DELIVERED",
    "SHIPPED",
    "PROCESSING",
    "DELIVERED",
  ];
  await db.$transaction([
    ...names.map((name, i) =>
      db.customer.upsert({
        where: { id: `CUST-00${i + 1}` },
        update: {},
        create: { id: `CUST-00${i + 1}`, name, email: `customer${i + 1}@example.test` },
      }),
    ),
    ...products.map(([sku, name]) =>
      db.product.upsert({
        where: { sku },
        update: {},
        create: { sku, name, description: `${name}（独立演示数据）` },
      }),
    ),
    ...warehouses.map(([code, name]) =>
      db.warehouse.upsert({ where: { code }, update: {}, create: { code, name } }),
    ),
    ...products.flatMap(([sku], i) =>
      warehouses.map(([warehouse], j) =>
        db.inventory.upsert({
          where: { sku_warehouse: { sku, warehouse } },
          update: {},
          create: {
            id: `INV-${i}-${j}`,
            sku,
            warehouse,
            available: i === 0 && j === 0 ? 128 : i === 9 && j === 2 ? 0 : 20 + i * 17 + j * 8,
            reserved: i === 0 && j === 0 ? 12 : i + j,
          },
        }),
      ),
    ),
    ...products.map(([sku], i) =>
      db.order.upsert({
        where: { id: `SO202611${String(i + 1).padStart(3, "0")}` },
        update: {},
        create: {
          id: `SO202611${String(i + 1).padStart(3, "0")}`,
          customerId: `CUST-00${(i % 5) + 1}`,
          status: states[i],
          estimatedDelivery:
            i === 5 ? null : new Date(`2026-11-${String(3 + i).padStart(2, "0")}T00:00:00Z`),
          items: { create: { id: `ITEM-${i + 1}`, sku, quantity: 1 + (i % 2) } },
        },
      }),
    ),
    db.afterSalesTicket.upsert({
      where: { idempotencyKey: "seed-demo-ticket" },
      update: {},
      create: {
        id: "AS202611000",
        orderId: "SO202611003",
        type: "RETURN",
        description: "演示耳机无声",
        priority: "NORMAL",
        status: "PROCESSING",
        idempotencyKey: "seed-demo-ticket",
      },
    }),
  ]);
}
