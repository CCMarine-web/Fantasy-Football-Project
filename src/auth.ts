import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/lib/validation/auth";
import { clientIp, isThrottled, recordFailure, recordSuccess } from "@/server/auth/login-throttle";

/**
 * A bcrypt hash of a random throwaway string. Compared against when the email
 * is unknown, so a missing account takes as long to reject as a wrong
 * password — otherwise the response time says which emails have accounts.
 */
const TIMING_DUMMY_HASH = "$2b$10$kKoEzYiI0zJ1ozp54mUGqe05GqhG0cBUL.Lbkb9nGUcHtQYdGTww.";

/**
 * How often a signed-in session is re-checked against the database. A JWT
 * session is otherwise frozen at sign-in: a demoted admin or a deleted user
 * kept their access for as long as the cookie lived.
 */
const RECHECK_MS = 5 * 60_000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const ip = clientIp(request?.headers);

        // Locked keys are refused before any password is checked.
        if (await isThrottled(email, ip)) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        const passwordValid = await bcrypt.compare(password, user?.passwordHash ?? TIMING_DUMMY_HASH);
        if (!user || user.deletedAt || !passwordValid) {
          await recordFailure(email, ip);
          return null;
        }
        await recordSuccess(email);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          managerId: user.managerId,
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.managerId = user.managerId ?? null;
        token.checkedAt = Date.now();
        return token;
      }
      if (token.id && Date.now() - (token.checkedAt ?? 0) > RECHECK_MS) {
        const current = await prisma.user.findUnique({
          where: { id: token.id },
          select: { role: true, managerId: true, deletedAt: true },
        });
        // Returning null clears the session cookie: the account is gone.
        if (!current || current.deletedAt) return null;
        token.role = current.role;
        token.managerId = current.managerId;
        token.checkedAt = Date.now();
      }
      return token;
    },
    session: async ({ session, token }) => {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.managerId = token.managerId;
      return session;
    },
  },
});
