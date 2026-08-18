// Thin façade — the email layout moved to @linyup/shared so the web app's
// template editor previews with the exact same chrome the functions send.
// Kept so the many existing '../utils/emailLayout' imports stay stable.
export {
  BRAND,
  gradients,
  detailsBox,
  factLines,
  ctaButton,
  wrapInLayout,
  buildTeamFooter,
  htmlToPlainText,
} from '@linyup/shared'
