export const SSM_PATH = process.env.SSM_PATH ?? '/loudibly/api/'

console.log(`SYNTH: SSM_PATH=${SSM_PATH} (build env: ${process.env.SSM_PATH ?? 'unset'})`)
