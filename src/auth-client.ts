import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "void/client";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [passkeyClient()],
});
