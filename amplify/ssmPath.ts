export const SSM_PATH = process.env.SSM_PATH ?? '/loudibly/api/'

console.log(
  `SYNTH: SSM_PATH=${SSM_PATH} (build env: ${process.env.SSM_PATH ?? 'unset'})` +
  ` AWS_BRANCH=${process.env.AWS_BRANCH ?? 'unset'}` +
  ` AWS_APP_ID=${process.env.AWS_APP_ID ?? 'unset'}`
)
