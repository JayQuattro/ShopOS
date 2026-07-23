/**
 * Auth UI strings.
 *
 * ShopOS localization (ADR 0010) is planned but not yet implemented: these are
 * temporary English literals, intentionally centralized here so the locale
 * foundation issue (#58) can lift them into checked-in ICU message catalogs
 * without hunting through components. Do not assemble translated sentences from
 * fragments and do not scatter additional user-visible literals elsewhere.
 */
export const authStrings = {
  brand: "ShopOS",
  signIn: {
    title: "Sign in",
    description: "Sign in to your ShopOS account.",
    emailLabel: "Email",
    passwordLabel: "Password",
    submit: "Sign in",
    forgotPassword: "Forgot your password?",
    needAccount: "Need an account?",
    signUp: "Sign up",
    twoFactorRequired: "Two-factor authentication is required.",
  },
  signUp: {
    title: "Create your account",
    description: "Create a ShopOS account to manage your shop.",
    nameLabel: "Full name",
    emailLabel: "Email",
    passwordLabel: "Password",
    passwordHint: "At least 12 characters.",
    submit: "Create account",
    haveAccount: "Already have an account?",
    signIn: "Sign in",
  },
  forgotPassword: {
    title: "Reset your password",
    description: "Enter your email and we'll send reset instructions if the account exists.",
    emailLabel: "Email",
    submit: "Send reset instructions",
    success:
      "If an account exists for that email, reset instructions have been sent. Check your inbox.",
    backToSignIn: "Back to sign in",
  },
  resetPassword: {
    title: "Set a new password",
    description: "Choose a new password for your account.",
    passwordLabel: "New password",
    passwordHint: "At least 12 characters.",
    submit: "Reset password",
    backToSignIn: "Back to sign in",
  },
  verifyEmail: {
    title: "Verify your email",
    description: "Enter the verification code sent to your email.",
    codeLabel: "Verification code",
    submit: "Verify email",
    resend: "Resend code",
    backToSignIn: "Back to sign in",
    verified: "Your email has been verified.",
  },
  verifyTwoFactor: {
    title: "Two-factor verification",
    description: "Enter the code from your authenticator app.",
    codeLabel: "Authentication code",
    submit: "Verify",
    useBackupCode: "Use a backup code",
    backupCodeLabel: "Backup code",
    backToSignIn: "Back to sign in",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    invalidCredentials: "Invalid email or password.",
    emailUnverified: "Please verify your email address before signing in.",
    rateLimited: "Too many attempts. Please wait and try again.",
  },
} as const;
