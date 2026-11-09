import "../src/config.js";
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { PrismaClient } from "@prisma/client";
import { hashPassword, parseInput, userCreateSchema } from "../src/auth.js";

const db = new PrismaClient();
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const terminal = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
try {
  const username =
    process.env.BOOTSTRAP_USERNAME ??
    (await terminal.question("管理员账号（3–40 位字母、数字、_ 或 -）："));
  const name = process.env.BOOTSTRAP_NAME ?? (await terminal.question("显示名称："));
  let password = process.env.BOOTSTRAP_PASSWORD;
  if (!password) {
    process.stdout.write("密码（至少 10 位，输入不显示）：");
    muted = true;
    password = await terminal.question("");
    muted = false;
    process.stdout.write("\n");
  }
  const input = parseInput(userCreateSchema, { username, name, password, role: "ADMIN" });
  if (await db.user.count({ where: { role: "ADMIN", enabled: true } }))
    throw new Error("已有有效管理员，请通过账号管理页面创建其他账号");
  await db.user.create({
    data: {
      id: randomUUID(),
      username: input.username,
      name: input.name,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    },
  });
  console.log("管理员已创建，请前往工作台登录。");
} finally {
  terminal.close();
  await db.$disconnect();
}
