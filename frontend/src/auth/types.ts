export type AuthSessionUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  onboardingCompleted: boolean;
  agenda: string | null;
  xUsername: string | null;
  xLinked: boolean;
  xCanPost: boolean;
  isAdmin: boolean;
};
