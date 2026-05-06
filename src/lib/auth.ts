import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

const workspaceDomain = (process.env.GOOGLE_WORKSPACE_DOMAIN ?? "").toLowerCase();

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      prompt: "select_account",
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/callback/:id" || !workspaceDomain) {
        return;
      }

      const email = String(ctx.context.newSession?.user.email ?? "").toLowerCase();
      if (!email.endsWith(`@${workspaceDomain}`)) {
        throw new APIError("BAD_REQUEST", {
          message: `Email must end with @${workspaceDomain}.`,
        });
      }
    }),
  },
});
