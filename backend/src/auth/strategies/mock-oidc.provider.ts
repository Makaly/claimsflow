/**
 * MockOidcProvider — in-process stub that satisfies the OIDC strategy in local
 * development without an external IdP. Set SSO_PROVIDER=mock in .env.
 *
 * Usage: POST /api/auth/sso/mock with { email, name } → returns a JWT cookie
 * the same way the real OIDC callback would.
 *
 * TODO: remove or gate behind NODE_ENV !== 'production' in the SSO controller.
 */
export class MockOidcProvider {
  static buildProfile(email: string, name: string) {
    return {
      id: `mock-${email}`,
      displayName: name,
      emails: [{ value: email }],
      _json: { email },
    };
  }
}
