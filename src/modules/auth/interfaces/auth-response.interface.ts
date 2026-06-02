export interface AuthUserResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
}

export interface AuthResponse {
  user: AuthUserResponse;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken?: string;
}
