import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod";

import authConfig from "@/auth.config";
import { prisma } from "@/lib/prisma";

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "管理员登录",
      credentials: {
        email: {
          label: "邮箱",
          type: "email",
        },
        password: {
          label: "密码",
          type: "password",
        },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const admin = await prisma.adminUser.findUnique({
          where: {
            email: parsed.data.email.toLowerCase(),
          },
        });

        if (!admin) {
          return null;
        }

        const isValid = await compare(parsed.data.password, admin.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: admin.id,
          name: admin.name,
          email: admin.email,
        };
      },
    }),
  ],
});
