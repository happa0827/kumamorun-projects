import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "void/client";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [emailOTPClient(), passkeyClient()],
});
