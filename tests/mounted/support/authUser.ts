import type { AuthSessionUser } from "../../../src/auth/types";

export const authUser = (id: string): AuthSessionUser => ({
  id,
  email: null,
  displayName: null,
  avatarUrl: null,
  onboardingCompleted: true,
  agenda: null,
  xUsername: null,
  xLinked: false,
  xCanPost: false,
  isAdmin: false,
});
