import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider'

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-2' })

const poolId = () => {
  const id = process.env.COGNITO_USER_POOL_ID
  if (!id) throw new Error('COGNITO_USER_POOL_ID is not set on this function')
  return id
}

const subOf = (attributes?: { Name?: string, Value?: string }[]) =>
  attributes?.find(a => a.Name === 'sub')?.Value

export const findUserByEmail = async (email: string) => {
  const res = await client.send(new ListUsersCommand({
    UserPoolId: poolId(),
    Filter: `email = "${email}"`,
    Limit: 1,
  }))
  const user = res.Users?.[0]
  if (!user?.Username) return null
  return { sub: subOf(user.Attributes), username: user.Username }
}

/**
 * Creates a user with no password of our choosing. SUPPRESS stops Cognito from
 * mailing its own temporary-password message — onboarding sends a claim link
 * instead. The user stays in FORCE_CHANGE_PASSWORD until the claim sets a
 * permanent one. email_verified stays false on purpose: clicking the claim link
 * is what proves the payer owns the address the merchant asserted.
 */
export const adminCreateUser = async (email: string) => {
  const res = await client.send(new AdminCreateUserCommand({
    UserPoolId: poolId(),
    Username: email,
    MessageAction: 'SUPPRESS',
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'false' },
    ],
  }))
  const sub = subOf(res.User?.Attributes)
  if (!sub || !res.User?.Username) throw new Error('AdminCreateUser returned no sub')
  return { sub, username: res.User.Username }
}

export const addUserToGroup = (username: string, groupName: string) =>
  client.send(new AdminAddUserToGroupCommand({
    UserPoolId: poolId(),
    Username: username,
    GroupName: groupName,
  }))

/**
 * Sets the users's chosen password as permanent. Throws
 * InvalidPasswordException when the password fails the pool policy.
 */
export const adminSetUserPassword = (username: string, password: string) =>
  client.send(new AdminSetUserPasswordCommand({
    UserPoolId: poolId(),
    Username: username,
    Password: password,
    Permanent: true,
  }))

/** Claiming the link is the proof the user owns the address the merchant asserted. */
export const adminSetEmailVerified = (username: string) =>
  client.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: poolId(),
    Username: username,
    UserAttributes: [{ Name: 'email_verified', Value: 'true' }],
  }))


export const getUserStatus = async (username: string) => {
  const res = await client.send(new AdminGetUserCommand({ UserPoolId: poolId(), Username: username }))
  return res.UserStatus
}
