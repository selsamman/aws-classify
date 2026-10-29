// Replaced by Vite environment variables for the deployed Cognito acceptance run.
export const provider = {
  issuer: import.meta.env.VITE_OIDC_ISSUER as string | undefined,
  clientId: import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined,
  redirectUri: import.meta.env.VITE_OIDC_REDIRECT_URI as string | undefined,
  scope: import.meta.env.VITE_OIDC_SCOPE as string | undefined,
};
