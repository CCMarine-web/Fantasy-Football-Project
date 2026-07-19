import type { DefaultSession } from "@auth/core/types";

declare module "@auth/core/types" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "MEMBER";
      managerId?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: "ADMIN" | "MEMBER";
    managerId?: string | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: "ADMIN" | "MEMBER";
    managerId?: string | null;
  }
}
