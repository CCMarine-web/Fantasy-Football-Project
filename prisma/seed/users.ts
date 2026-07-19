import bcrypt from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/client";
import type { ManagerKey } from "./types";

export interface DemoCredential {
  label: string;
  email: string;
  password: string;
}

const BCRYPT_COST = 10;

export async function seedUsers(
  prisma: PrismaClient,
  managerIdByKey: Record<ManagerKey, string>,
): Promise<DemoCredential[]> {
  const credentials: DemoCredential[] = [
    { label: "Admin (Sofia Reyes, commissioner)", email: "admin@gridirongazette.local", password: "GazetteAdmin123!" },
    { label: "Member (Marcus Cole)", email: "marcus@gridirongazette.local", password: "MemberPass123!" },
    { label: "Guest (spectator, no manager link)", email: "guest@gridirongazette.local", password: "MemberPass123!" },
  ];

  const [adminHash, marcusHash, guestHash] = await Promise.all(
    credentials.map((c) => bcrypt.hash(c.password, BCRYPT_COST)),
  );

  await prisma.user.create({
    data: {
      email: credentials[0]!.email,
      passwordHash: adminHash!,
      name: "Sofia Reyes",
      role: UserRole.ADMIN,
      managerId: managerIdByKey.sofia,
    },
  });

  await prisma.user.create({
    data: {
      email: credentials[1]!.email,
      passwordHash: marcusHash!,
      name: "Marcus Cole",
      role: UserRole.MEMBER,
      managerId: managerIdByKey.marcus,
    },
  });

  await prisma.user.create({
    data: {
      email: credentials[2]!.email,
      passwordHash: guestHash!,
      name: "Guest Spectator",
      role: UserRole.MEMBER,
    },
  });

  return credentials;
}
